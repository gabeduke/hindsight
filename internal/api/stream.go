package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/websocket"
)

// The tape's mix to a browser: GET /api/tapes/stream is a WebSocket of
// stamped PCM16 packets (tape.EncodePacket), with JSON text messages for
// hello, mode and moved; the page reports its buffer as {"type":"fill"}.
// PUT /api/tapes/output moves the tape between the jam room, a phone, both.

// streamReadWait is how long the stream waits to hear from the page. It
// reports its fill every 500 ms, so 2 s of silence means the phone has gone
// (a Wi-Fi blip, a locked screen): drop it now, so the tape's 6 s
// drop-pause starts counting, rather than when the TCP buffer finally fills.
const streamReadWait = 2 * time.Second

// wsListener queues packets for the connection's writer. Send never blocks:
// a full queue loses its oldest packet.
type wsListener struct {
	out   chan []byte
	moved chan struct{}
	once  sync.Once
}

func newWSListener() *wsListener {
	return &wsListener{out: make(chan []byte, 64), moved: make(chan struct{})}
}

func (l *wsListener) Send(p []byte) bool {
	for {
		select {
		case l.out <- p:
			return true
		default:
		}
		select {
		case <-l.out:
		default:
		}
	}
}

func (l *wsListener) Moved() { l.once.Do(func() { close(l.moved) }) }

func (a *API) handleTapeStream(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	st := a.tape.Stream()
	if st == nil {
		tapeErr(w, tape.ErrNoStream)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[!] stream websocket upgrade: %v", err)
		return
	}
	defer conn.Close()
	l := newWSListener()
	detach := st.Attach(l)
	defer detach()

	write := func(mt int, b []byte) error {
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteMessage(mt, b)
	}
	sendJSON := func(v any) error {
		b, _ := json.Marshal(v)
		return write(websocket.TextMessage, b)
	}
	mode := a.tape.OutputMode()
	if err := sendJSON(map[string]any{"type": "hello", "rate": st.Rate(), "mode": mode}); err != nil {
		return
	}

	gone := make(chan struct{})
	go func() {
		defer close(gone)
		conn.SetReadLimit(1024)
		_ = conn.SetReadDeadline(time.Now().Add(streamReadWait))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(streamReadWait)) })
		for {
			_, b, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(streamReadWait))
			var m struct {
				Type string `json:"type"`
				MS   int    `json:"ms"`
			}
			if json.Unmarshal(b, &m) == nil && m.Type == "fill" && m.MS >= 0 && m.MS < 60000 {
				st.SetFill(m.MS)
			}
		}
	}()

	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()
	modeCheck := time.NewTicker(500 * time.Millisecond)
	defer modeCheck.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-gone:
			return
		case <-l.moved:
			_ = sendJSON(map[string]string{"type": "moved"})
			return
		case p := <-l.out:
			if err := write(websocket.BinaryMessage, p); err != nil {
				return
			}
		case <-modeCheck.C:
			if m := a.tape.OutputMode(); m != mode {
				mode = m
				if err := sendJSON(map[string]any{"type": "mode", "mode": m}); err != nil {
					return
				}
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (a *API) handleTapeOutput(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "send {\"mode\": \"jam\", \"phone\" or \"both\"}")
		return
	}
	if err := a.tape.SetOutputMode(tape.OutputMode(body.Mode)); err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mode": body.Mode})
}
