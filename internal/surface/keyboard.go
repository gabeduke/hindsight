// Package surface speaks to the SMK-37 on Hindsight's own firmware
// (gabeduke/smk37-hindsight; its protocol is app/hindsight.h there, and
// docs/plan/the-instrument.md step 7 here). It finds the keyboard, takes
// its screen and draws on it, and sets where its encoders stand. The
// keyboard answers every message with an ack carrying its seq, says
// RELEASE itself when HOME gives the screen back, and OFFER when HOME held
// for a second and let go hands it to Hindsight again.
//
// The keyboard's mailbox holds one message, so one is in flight at a time:
// the next goes when its ack comes, and one with no ack is sent again.
// Frames are written in the order the keyboard should see them, under the
// Keyboard's lock, so send must not block or call back into the Keyboard.
// A TEXT waiting for the same place as a newer one is replaced, so a counter
// updated faster than the keyboard draws never piles up.
//
// What the keyboard's panel sends while Hindsight has its screen is plain
// MIDI, and goes to Play mode's bus with every other controller's
// (internal/api's controls).
package surface

import (
	"strings"
	"sync"
	"time"
)

// Colour is the keyboard's palette.
type Colour byte

const (
	Black Colour = iota
	Panel
	Text
	Dim
	Accent
	Green
	Amber
	colours
)

// The protocol, app/hindsight.h: F0 7D 48 53 01 <seq> <cmd> <payload> F7.
const (
	cmdHello   = 0x00
	cmdClear   = 0x01
	cmdText    = 0x02
	cmdRelease = 0x03
	cmdKnob    = 0x04
	cmdOffer   = 0x05
	cmdAck     = 0x7F

	statusOK       = 0
	statusReleased = 4

	// Width and Height are the screen's, in pixels; a glyph is 6 by 7 at
	// scale 1, and a TEXT holds MaxText characters.
	Width   = 240
	Height  = 240
	MaxText = 40
	// Knobs is how many encoders KNOB can set.
	Knobs = 7
)

var header = []byte{0xF0, 0x7D, 'H', 'S', 0x01}

// Status is what the keyboard is doing, as far as Hindsight knows.
type Status struct {
	// Present: it answered HELLO, so it runs Hindsight's firmware.
	Present bool
	// Screen: Hindsight has its screen.
	Screen bool
	// Homed: its player gave the screen back with HOME. It holds until the
	// keyboard is unplugged (Gone), its player holds HOME and lets it go to
	// hand the screen over (OFFER), or Hindsight takes the screen again.
	Homed bool
	// RTT is the last ack's round trip, message to ack.
	RTT time.Duration
}

type message struct {
	cmd     byte
	payload []byte
	seq     byte
	tries   int
	sent    time.Time
}

// Keyboard is one SMK-37 on Hindsight's firmware.
type Keyboard struct {
	send      func([]byte)
	connected func() bool
	now       func() time.Time

	// AckTimeout is how long a message waits for its ack before it is sent
	// again, Tries times in all; Probe is how often HELLO asks whether the
	// keyboard is there. Set them before Start.
	AckTimeout time.Duration
	Tries      int
	Probe      time.Duration

	mu        sync.Mutex
	queue     []*message
	flight    *message
	seq       byte
	status    Status
	probed    time.Time
	onPresent func()

	stop chan struct{}
	done chan struct{}
}

// New makes a Keyboard that writes with send, which must not block (a
// midi.Out's Send), and knows from connected whether the keyboard is
// plugged in and open as a controller.
func New(send func([]byte), connected func() bool) *Keyboard {
	return &Keyboard{
		send:       send,
		connected:  connected,
		now:        time.Now,
		AckTimeout: 250 * time.Millisecond,
		Tries:      3,
		Probe:      2 * time.Second,
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// OnPresent says what to do when the keyboard first answers HELLO, or
// answers it again after going: take its screen, say. It runs on its own.
func (k *Keyboard) OnPresent(f func()) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.onPresent = f
}

// Start sends, resends and probes until Stop.
func (k *Keyboard) Start() {
	go func() {
		defer close(k.done)
		t := time.NewTicker(20 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-k.stop:
				return
			case <-t.C:
				k.tick()
			}
		}
	}()
}

// Stop ends the loop and waits for it.
func (k *Keyboard) Stop() {
	close(k.stop)
	<-k.done
}

// Farewell is the RELEASE to send as Hindsight stops, when it has the
// screen: the panel would go on talking to nobody until HOME otherwise. It
// expects no ack; nil when there's nothing to give back.
func (k *Keyboard) Farewell() []byte {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Screen {
		return nil
	}
	k.status.Screen = false
	return k.frame(&message{cmd: cmdRelease, seq: k.nextSeq()})
}

// Status is a copy of what the keyboard is doing.
func (k *Keyboard) Status() Status {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.status
}

// Clear takes the screen and fills it with c. False when the keyboard
// isn't there to take it.
func (k *Keyboard) Clear(c Colour) bool {
	if c >= colours {
		return false
	}
	return k.enqueue(cmdClear, []byte{byte(c)})
}

// Text puts s at (x, y) at scale 1 to 4 in c, replacing what was there; an
// empty s removes it. It is drawn in capitals, cut to what fits, and only
// while Hindsight has the screen.
func (k *Keyboard) Text(x, y, scale int, c Colour, s string) bool {
	if x < 0 || y < 0 || scale < 1 || scale > 4 || c >= colours ||
		x+6*scale > Width || y+7*scale > Height {
		return false
	}
	var b strings.Builder
	for _, r := range s {
		if r < ' ' || r > '~' {
			r = '?'
		}
		b.WriteRune(r)
	}
	text := b.String()
	if fit := (Width - x) / (6 * scale); len(text) > fit {
		text = text[:fit]
	}
	if len(text) > MaxText {
		text = text[:MaxText]
	}
	payload := append([]byte{byte(x & 127), byte(x >> 7), byte(y & 127), byte(y >> 7), byte(scale), byte(c)}, text...)
	return k.enqueue(cmdText, payload)
}

// Release gives the screen back.
func (k *Keyboard) Release() bool { return k.enqueue(cmdRelease, nil) }

// Knob says where encoder i stands, 0 to 127, so a turn starts from there.
func (k *Keyboard) Knob(i, value int) bool {
	if i < 0 || i >= Knobs || value < 0 || value > 127 {
		return false
	}
	return k.enqueue(cmdKnob, []byte{byte(i), byte(value)})
}

// enqueue adds a message for a keyboard that is there. A TEXT for a place
// another waiting TEXT has replaces it there, unless a CLEAR or another
// message waits between them.
func (k *Keyboard) enqueue(cmd byte, payload []byte) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Present {
		return false
	}
	queued := false
	if cmd == cmdText {
		for i := len(k.queue) - 1; i >= 0 && k.queue[i].cmd == cmdText; i-- {
			if m := k.queue[i]; string(m.payload[:4]) == string(payload[:4]) {
				m.payload = payload
				queued = true
				break
			}
		}
	}
	if !queued {
		k.queue = append(k.queue, &message{cmd: cmd, payload: payload})
	}
	k.next()
	return true
}

// nextSeq is 1 to 127: seq 0 is the keyboard's own RELEASE and OFFER.
// Called with mu held.
func (k *Keyboard) nextSeq() byte {
	k.seq = k.seq%127 + 1
	return k.seq
}

// next puts the first waiting message in flight, when none is, and sends
// it. Called with mu held.
func (k *Keyboard) next() {
	if k.flight != nil || len(k.queue) == 0 {
		return
	}
	k.flight, k.queue = k.queue[0], k.queue[1:]
	k.flight.seq = k.nextSeq()
	k.send(k.frame(k.flight))
}

// frame stamps m as sent now and encodes it. Called with mu held.
func (k *Keyboard) frame(m *message) []byte {
	m.tries++
	m.sent = k.now()
	out := append(append([]byte{}, header...), m.seq, m.cmd)
	out = append(out, m.payload...)
	return append(out, 0xF7)
}

// tick probes, sends again what had no ack, and forgets a keyboard that
// stopped answering or was unplugged.
func (k *Keyboard) tick() {
	connected := k.connected()
	k.mu.Lock()
	defer k.mu.Unlock()
	switch {
	case !connected:
		k.forget()
	case k.flight != nil && k.now().Sub(k.flight.sent) >= k.AckTimeout:
		if k.flight.tries < k.Tries {
			k.send(k.frame(k.flight))
		} else if k.status.Present {
			// Three times unanswered: not Hindsight's firmware any more, or
			// not listening. Probe until it answers again.
			k.forget()
		} else {
			k.flight = nil
		}
	case !k.status.Present && k.flight == nil && k.now().Sub(k.probed) >= k.Probe:
		k.probed = k.now()
		k.queue = append([]*message{{cmd: cmdHello}}, k.queue...)
		k.next()
	}
}

// forget is a keyboard that stopped answering: nothing waits, nothing is in
// flight. A HOME is remembered, so an answer again doesn't take the screen
// back. Called with mu held.
func (k *Keyboard) forget() {
	k.status = Status{Homed: k.status.Homed}
	k.flight, k.queue = nil, nil
}

// Gone says the keyboard's port went (internal/midi's ControllerGone). A
// keyboard plugged in again starts afresh.
func (k *Keyboard) Gone() {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.forget()
	k.status.Homed = false
}

// Feed takes a SysEx message from the keyboard's port: an ack, or the
// keyboard's own RELEASE or OFFER. Anything else is ignored.
func (k *Keyboard) Feed(msg []byte) {
	if len(msg) < 8 || string(msg[:5]) != string(header) || msg[len(msg)-1] != 0xF7 {
		return
	}
	seq, cmd := msg[5], msg[6]
	k.mu.Lock()
	if cmd == cmdRelease && seq == 0 {
		// HOME on the keyboard: the screen is its own until a CLEAR.
		k.status.Screen = false
		k.status.Homed = true
		k.mu.Unlock()
		return
	}
	if cmd == cmdOffer && seq == 0 {
		// HOME held and let go: the player hands the screen over. It is
		// taken as when the keyboard first answered, or then, if it hasn't
		// yet (or Hindsight forgot it).
		k.status.Homed = false
		present := k.onPresent
		if !k.status.Present {
			present = nil
		}
		k.mu.Unlock()
		if present != nil {
			go present()
		}
		return
	}
	if cmd != cmdAck || len(msg) < 9 || k.flight == nil || k.flight.seq != seq {
		k.mu.Unlock()
		return
	}
	done, status := k.flight, msg[7]
	k.flight = nil
	k.status.RTT = k.now().Sub(done.sent)
	var present func()
	switch {
	case done.cmd == cmdHello && status == statusOK && !k.status.Present:
		k.status.Present = true
		present = k.onPresent
	case done.cmd == cmdClear && status == statusOK:
		k.status.Screen = true
		k.status.Homed = false
	case status == statusReleased, done.cmd == cmdRelease && status == statusOK:
		k.status.Screen = false
	}
	k.next()
	k.mu.Unlock()
	if present != nil {
		go present()
	}
}
