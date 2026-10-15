package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/websocket"
)

// Play mode's pads: GET /api/tapes/play is a WebSocket. The page sends a
// press the moment a pad is touched and a release the moment it's let go;
// the Pi quantises both on its render head (tape.Engine.Press), so a phone's
// Wi-Fi delay lands on the grid instead of late. Back come the lead -- how
// long a press takes to be heard -- and, for each press and release, when it
// will actually be heard, so the page lights the pad then.
//
//	page → Pi  {"t":"press","pad":"stop","q":"16th"}
//	           {"t":"press","pad":"filter","q":"16th","v":0.8}
//	           {"t":"set","pad":"filter","v":0.4}
//	           {"t":"release","pad":"stop"}
//	           {"t":"release_all"}
//	Pi → page  {"t":"hello","pads":[…],"mods":[…],"lead_ms":212}
//	           {"t":"lead","ms":212}
//	           {"t":"at","pad":"stop","on":true,"in_ms":187,"pos":…}
//	           {"t":"at","pad":"filter","v":0.4,"move":true,…}
//	           {"t":"refused","pad":"stop","why":"…"}
//
// A pad sounds while any connection holds it: two phones holding BREAK keep
// the break until both let go. A connection that goes -- a dropped Wi-Fi, a
// locked phone, a closed tab -- lets go of what it held, so the tape never
// stays broken with nobody holding anything.
//
// A controller plugged into the Pi is one more holder (controls.go), and
// MIDI LEARN for it travels here (docs/superpowers/specs/2026-10-15-instrument-strip-design.md):
//
//	page → Pi  {"t":"learn","action":"stop","port":"SMK-37"}   port "" is any controller
//	           {"t":"learn_cancel"}
//	Pi → page  {"t":"learned","action":"stop","port":"SMK-37","midi":{"note":43,"ch":10}}
//	           {"t":"refused","learn":"stop","why":"no controller moved in 10 s"}
//
// and hello lists the pads held as the page arrives ("held"), so a pad held
// on the controller lights on a page opened mid-hold.
//
// The punch-in FX carry an amount, v: read at the press (a velocity), and
// moved while held by a set (aftertouch, the mod wheel, the pitch wheel for
// the bend). A set of a tape mod -- mod.wow, mod.flutter, mod.drive,
// mod.age -- previews it: heard at once, saved nowhere. The page commits it
// with PATCH /api/tapes {style} when the finger lifts; a release of the mod,
// or the connection going, puts the tape's own value back. Every screen
// hears of an amount moving through an at with move set, no more than 30
// times a second a pad.

// playPing is how often the Pi pings a player, and playReadWait how long it
// waits to hear back before taking the player for gone. A held pad of a
// phone that vanished is released within about that long.
const (
	playPing     = time.Second
	playReadWait = 3 * time.Second
	// playPoll is how often a player's socket looks for new events: the
	// lead is a fifth of a second, so 15 ms is never what makes a pad late.
	playPoll = 15 * time.Millisecond
)

// tricks is what Play mode needs of the tape engine; tests stand in for it.
type tricks interface {
	Press(pad, quantum string) error
	PressAmount(pad, quantum string, v float64) error
	Set(pad string, v float64) error
	PreviewMod(mod string, v float64, owner string) error
	EndPreview(mod, owner string) error
	Release(pad string) error
	TrickEventsSince(seq uint64) ([]tape.TrickEvent, uint64)
	MovesSince(seq uint64) ([]tape.TrickEvent, uint64)
	TrickLead() (time.Duration, bool)
	HeardIn(out uint64) (time.Duration, bool)
}

// playHolds counts, per pad, the connections holding it.
type playHolds struct {
	mu sync.Mutex
	n  map[string]int
}

// press holds pad for one more connection; the first one presses it.
func (h *playHolds) press(pad string, do func() error) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.n == nil {
		h.n = map[string]int{}
	}
	if h.n[pad] == 0 {
		if err := do(); err != nil {
			return err
		}
	}
	h.n[pad]++
	return nil
}

// list is the pads held now, by anyone.
func (h *playHolds) list() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := []string{}
	for p, n := range h.n {
		if n > 0 {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

// release lets go of pad for one connection; the last one releases it.
func (h *playHolds) release(pad string, do func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.n[pad] == 0 {
		return
	}
	h.n[pad]--
	if h.n[pad] == 0 {
		do()
	}
}

// player is the engine Play mode talks to.
func (a *API) player() tricks {
	if a.playFake != nil {
		return a.playFake
	}
	return a.tape
}

func (a *API) handleTapePlay(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	eng := a.player()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[!] play websocket upgrade: %v", err)
		return
	}
	defer conn.Close()

	// What this connection holds, so that its going lets go of exactly that;
	// and the mods it has previewed, which go back to the tape's as it goes
	// -- those still its own.
	var mineMu sync.Mutex
	mine := map[string]bool{}
	previews := map[string]bool{}
	// The engine keeps who previews each mod, and lets a preview go only
	// for whoever set it last: this page, by this name.
	me := fmt.Sprintf("page:%d", a.playConns.Add(1))
	unpreview := func(pad string) {
		mineMu.Lock()
		was := previews[pad]
		delete(previews, pad)
		mineMu.Unlock()
		if was {
			_ = eng.EndPreview(pad, me)
		}
	}
	unpreviewAll := func() {
		mineMu.Lock()
		var ps []string
		for p := range previews {
			ps = append(ps, p)
		}
		mineMu.Unlock()
		for _, p := range ps {
			unpreview(p)
		}
	}
	letGo := func(pad string) {
		mineMu.Lock()
		held := mine[pad]
		delete(mine, pad)
		mineMu.Unlock()
		if held {
			a.playHolds.release(pad, func() { _ = eng.Release(pad) })
		}
	}
	defer func() {
		mineMu.Lock()
		var held []string
		for p := range mine {
			held = append(held, p)
		}
		mineMu.Unlock()
		for _, p := range held {
			letGo(p)
		}
		unpreviewAll()
	}()

	// Only the loop below writes; the reader hands it what to say.
	notes := make(chan any, 16)
	note := func(v any) {
		select {
		case notes <- v:
		default:
		}
	}

	// MIDI LEARN this page started, still waiting: forgotten if it goes.
	var learnMu sync.Mutex
	var unlearn func()
	stopLearning := func() {
		learnMu.Lock()
		f := unlearn
		unlearn = nil
		learnMu.Unlock()
		if f != nil {
			f()
		}
	}
	defer stopLearning()

	gone := make(chan struct{})
	go func() {
		defer close(gone)
		conn.SetReadLimit(1024)
		_ = conn.SetReadDeadline(time.Now().Add(playReadWait))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(playReadWait)) })
		for {
			_, b, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(playReadWait))
			var m struct {
				T   string   `json:"t"`
				Pad string   `json:"pad"`
				Q   string   `json:"q"`
				V   *float64 `json:"v"`
				// MIDI LEARN: the action, and the controller ("" any).
				Action string `json:"action"`
				Port   string `json:"port"`
			}
			if json.Unmarshal(b, &m) != nil {
				continue
			}
			switch m.T {
			case "press":
				mineMu.Lock()
				already := mine[m.Pad]
				mineMu.Unlock()
				if already {
					continue
				}
				press := func() error { return eng.Press(m.Pad, m.Q) }
				if m.V != nil {
					v := *m.V
					press = func() error { return eng.PressAmount(m.Pad, m.Q, v) }
				}
				if err := a.playHolds.press(m.Pad, press); err != nil {
					note(map[string]string{"t": "refused", "pad": m.Pad, "why": err.Error()})
					continue
				}
				mineMu.Lock()
				mine[m.Pad] = true
				mineMu.Unlock()
			case "learn":
				stopLearning()
				action := m.Action
				cancel, err := a.startLearn(action, m.Port,
					func(port string, b Binding) {
						note(map[string]any{"t": "learned", "action": action, "port": port, "midi": b})
					},
					func(why string) { note(map[string]any{"t": "refused", "learn": action, "why": why}) })
				if err != nil {
					note(map[string]any{"t": "refused", "learn": action, "why": err.Error()})
					continue
				}
				learnMu.Lock()
				unlearn = cancel
				learnMu.Unlock()
			case "learn_cancel":
				stopLearning()
			case "set":
				if m.V == nil {
					continue
				}
				pad, v := m.Pad, *m.V
				var err error
				if strings.HasPrefix(pad, "mod.") {
					err = eng.PreviewMod(pad, v, me)
				} else {
					err = eng.Set(pad, v)
				}
				if err != nil {
					note(map[string]string{"t": "refused", "pad": pad, "why": err.Error()})
					continue
				}
				if strings.HasPrefix(pad, "mod.") {
					mineMu.Lock()
					previews[pad] = true
					mineMu.Unlock()
				}
			case "release":
				letGo(m.Pad)
				unpreview(m.Pad)
			case "release_all":
				mineMu.Lock()
				var held []string
				for p := range mine {
					held = append(held, p)
				}
				mineMu.Unlock()
				for _, p := range held {
					letGo(p)
				}
				unpreviewAll()
			}
		}
	}()

	write := func(v any) error {
		b, _ := json.Marshal(v)
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteMessage(websocket.TextMessage, b)
	}
	leadMS := func() any {
		if d, ok := eng.TrickLead(); ok {
			return d.Milliseconds()
		}
		return nil
	}
	lead := leadMS()
	// Events from now on: what sounded before this page came is not news.
	// Asking from past the end returns none, and where the log is.
	_, seq := eng.TrickEventsSince(^uint64(0) >> 1)
	_, moveSeq := eng.MovesSince(^uint64(0) >> 1)
	if err := write(map[string]any{"t": "hello", "pads": tape.Pads(), "mods": tape.Mods(), "lead_ms": lead, "held": a.playHolds.list()}); err != nil {
		return
	}

	poll := time.NewTicker(playPoll)
	defer poll.Stop()
	leadCheck := time.NewTicker(250 * time.Millisecond)
	defer leadCheck.Stop()
	ping := time.NewTicker(playPing)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-gone:
			return
		case v := <-notes:
			if write(v) != nil {
				return
			}
		case <-poll.C:
			var ev, mv []tape.TrickEvent
			ev, seq = eng.TrickEventsSince(seq)
			mv, moveSeq = eng.MovesSince(moveSeq)
			for _, e := range byOut(ev, mv) {
				msg := map[string]any{"t": "at", "pad": e.Pad, "pos": e.Pos}
				if !e.Move {
					msg["on"] = e.On // a move lights nothing: only a press or a release does
				}
				if d, ok := eng.HeardIn(e.Out); ok {
					msg["in_ms"] = d.Milliseconds()
				}
				if e.V != nil {
					msg["v"] = *e.V
				}
				if e.Move {
					msg["move"] = true
				}
				if write(msg) != nil {
					return
				}
			}
		case <-leadCheck.C:
			// Only a change worth redrawing: the lead wanders by a block as
			// the renderer works ahead.
			now := leadMS()
			if moved(lead, now, 15) {
				lead = now
				if write(map[string]any{"t": "lead", "ms": now}) != nil {
					return
				}
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}

// byOut merges the presses and releases with the moves in the order they
// were heard: a set and then a release in one block arrive in that order,
// never a release and then a stale move. A move on the frame a press or
// release lands was drained before it, so goes first.
func byOut(ev, mv []tape.TrickEvent) []tape.TrickEvent {
	if len(mv) == 0 {
		return ev
	}
	out := make([]tape.TrickEvent, 0, len(ev)+len(mv))
	for len(ev) > 0 || len(mv) > 0 {
		if len(ev) == 0 || (len(mv) > 0 && mv[0].Out <= ev[0].Out) {
			out, mv = append(out, mv[0]), mv[1:]
		} else {
			out, ev = append(out, ev[0]), ev[1:]
		}
	}
	return out
}

// moved says whether a lead (ms, or nil for none) changed by more than tol.
func moved(was, now any, tol int64) bool {
	a, aok := was.(int64)
	b, bok := now.(int64)
	if aok != bok {
		return true
	}
	if !aok {
		return false
	}
	d := a - b
	return d > tol || d < -tol
}
