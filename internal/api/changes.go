package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// /api/tapes/changes tells a page the moment the tape changes, so that it
// polls /api/tapes/state at once instead of at its next tick
// (docs/plan/pushing-tape-state.md). It sends a nudge, not the state:
//
//	{"rev":N,"at_ms":…}
//
// rev is the engine's revision (tape.Changes), at_ms the Pi's clock as it
// was sent, so a page can time the push. One goes out when the socket
// opens, one after each change (taps coalesce, so a burst of changes is one
// or two), and one every changesBeat whether anything changed or not: a
// nudge socket is otherwise silent while nothing happens, and lib/socket.js
// takes a silent socket for a dead one. A beat whose rev differs from the
// last the page heard also catches a nudge that was lost.
//
// The page never writes to it; the reader is there for close frames and the
// pong deadline, as /api/live's is.

// changesBeat is how often a quiet socket says the revision anyway.
const changesBeat = time.Second

type changesMsg struct {
	Rev  uint64 `json:"rev"`
	AtMS int64  `json:"at_ms"`
}

func (a *API) handleTapeChanges(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	changes := a.tape.Changes()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[!] changes websocket upgrade: %v", err)
		return
	}
	defer conn.Close()

	taps, cancel := changes.Subscribe()
	defer cancel()

	gone := make(chan struct{})
	go func() {
		defer close(gone)
		conn.SetReadLimit(512)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(pongWait))
		})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	send := func() error {
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteJSON(changesMsg{Rev: changes.Rev(), AtMS: time.Now().UnixMilli()})
	}
	if send() != nil {
		return
	}

	beat := time.NewTicker(changesBeat)
	defer beat.Stop()
	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-gone:
			return
		case <-taps:
			if send() != nil {
				return
			}
			// A change has just been said: the next beat is a second from now.
			beat.Reset(changesBeat)
		case <-beat.C:
			if send() != nil {
				return
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}
