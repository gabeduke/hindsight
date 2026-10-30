package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// /api/tapes/changes tells a page the moment the tape changes, so that it
// polls /api/tapes/state at once instead of at its next tick
// (docs/architecture/push.md). It sends a nudge, not the state:
//
//	{"rev":N,"takes_rev":M,"at_ms":…}
//
// rev is the engine's revision (tape.Changes), takes_rev the take list's
// (takes_rev.go), at_ms the Pi's clock as it was sent, so a page can time
// the push. One goes out when the socket
// opens, one after each change (taps coalesce, so a burst of changes is one
// or two), and one every changesBeat whether anything changed or not: a
// nudge socket is otherwise silent while nothing happens, and lib/socket.js
// takes a silent socket for a dead one. A beat whose rev differs from the
// last the page heard also catches a nudge that was lost.
//
// A press on the keyboard (press.go) goes out at once as well, with the
// revision as it is then and the press under "press":
//
//	{"rev":N,"at_ms":…,"press":{"words":"PLAY","role":"play","lit":["play"],"at_ms":…}}
//
// so a page that hears one hears a nudge too when the revision moved.
//
// A move of the take list's revision is said the same way, as a message
// whose takes_rev is new; the socket holds the list's scan open while it
// is (takes_rev.go).
//
// The page never writes to it; the reader is there for close frames and the
// pong deadline, as /api/live's is.

// changesBeat is how often a quiet socket says the revision anyway.
const changesBeat = time.Second

type changesMsg struct {
	Rev      uint64    `json:"rev"`
	TakesRev uint64    `json:"takes_rev"`
	AtMS     int64     `json:"at_ms"`
	Press    *keyPress `json:"press,omitempty"`
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
	presses, unpress := a.presses.subscribe()
	defer unpress()
	takes, untakes := a.takesRev.Subscribe()
	defer untakes()
	defer a.takesRev.hold()()

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

	// last and lastTakes are the revisions last said. A tap whose revision
	// that already was (a bump between Subscribe and the hello) says
	// nothing: a nudge is always news, and only the beat repeats.
	var last, lastTakes uint64
	send := func(p *keyPress) error {
		last, lastTakes = changes.Rev(), a.takesRev.Rev()
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteJSON(changesMsg{Rev: last, TakesRev: lastTakes, AtMS: time.Now().UnixMilli(), Press: p})
	}
	if send(nil) != nil {
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
			if changes.Rev() == last {
				continue
			}
			if send(nil) != nil {
				return
			}
			// A change has just been said: the next beat is a second from now.
			beat.Reset(changesBeat)
		case <-takes:
			if a.takesRev.Rev() == lastTakes {
				continue
			}
			if send(nil) != nil {
				return
			}
			beat.Reset(changesBeat)
		case p := <-presses:
			if send(&p) != nil {
				return
			}
			beat.Reset(changesBeat)
		case <-beat.C:
			if send(nil) != nil {
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
