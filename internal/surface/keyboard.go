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
// After a press, a banner takes the screen's top line for BannerFor, timed
// by the Keyboard's own clock and loop (Banner), then the line that was
// there comes back. While it shows, a TEXT for the top line is kept for
// then rather than drawn over it.
//
// The keyboard's HELLO ack says its protocol version. On version 1 the
// screen is what Clear and Text draw, with the banner as above. On version
// 2 it is Layout's (layout.go) of the State that Show was last given, or
// that Follow's source gives every Refresh: each change is planned against
// what the keyboard has (diff.go) and sent as BATCH frames of at most
// MaxFrame bytes, one in flight at a time, so a screen changing faster than
// the keyboard draws sends only what it is when the link is free. The
// banner is Layout's then, a box and its words over the top line.
//
// What the keyboard's panel sends while Hindsight has its screen is plain
// MIDI, and goes to Play mode's bus with every other controller's
// (internal/api's controls).
package surface

import (
	"log"
	"sync"
	"time"
)

// Colour is the keyboard's palette: version 1's seven, then version 2's
// (layout.go).
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

// The protocol, app/hindsight.h: F0 7D 48 53 <v> <seq> <cmd> <payload> F7.
const (
	cmdHello   = 0x00
	cmdClear   = 0x01
	cmdText    = 0x02
	cmdRelease = 0x03
	cmdKnob    = 0x04
	cmdOffer   = 0x05
	cmdBox     = 0x06 // version 2's, as are BAR, LED and BATCH
	cmdBar     = 0x07
	cmdBatch   = 0x09
	cmdAck     = 0x7F

	statusOK       = 0
	statusReleased = 4

	// MaxItems is how many items version 2's screen holds.
	MaxItems = 96

	// Width and Height are the screen's, in pixels; a glyph is 6 by 7 at
	// scale 1, and a TEXT holds MaxText characters.
	Width   = 240
	Height  = 240
	MaxText = 40
	// Knobs is how many encoders KNOB can set.
	Knobs = 7

	// TopX and TopY are the top line's place. The banner takes that place,
	// as TEXT works by place, so a layout puts its top line there: a line
	// anywhere else would show under the banner. BannerScale is the
	// banner's, 19 characters from TopX.
	TopX        = 8
	TopY        = 8
	BannerScale = 2
	// BannerFor is how long a banner shows, from its press
	// (docs/plan/the-instrument.md, *The flash*).
	BannerFor = time.Second
)

// header is a frame's start, before its version: F0 7D "HS".
var header = []byte{0xF0, 0x7D, 'H', 'S'}

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
	// Version is the protocol its HELLO ack named: 1 or 2.
	Version int
}

type message struct {
	cmd     byte
	payload []byte
	version byte
	seq     byte
	tries   int
	sent    time.Time
	// items are a BATCH's commands, put in the screen's list as it's acked.
	items []Item
}

// Keyboard is one SMK-37 on Hindsight's firmware.
type Keyboard struct {
	send      func([]byte)
	connected func() bool

	// AckTimeout is how long a message waits for its ack before it is sent
	// again, Tries times in all; Probe is how often HELLO asks whether the
	// keyboard is there. Clock is the Keyboard's time, time.Now; a test
	// stands in. Set them before Start.
	AckTimeout time.Duration
	Tries      int
	Probe      time.Duration
	Clock      func() time.Time
	// Refresh is how often, on version 2, Follow's source is asked for the
	// screen; MeterEvery how often its meters are taken from it, the rest
	// of the time held as they were, so the levels' flicker can't fill the
	// link (docs/architecture.md, *The SMK-37's screen*).
	Refresh    time.Duration
	MeterEvery time.Duration
	// Heal is the least time between the CLEARs that draw the screen again
	// whole after the keyboard refused part of it.
	Heal time.Duration

	mu        sync.Mutex
	queue     []*message
	flight    *message
	seq       byte
	status    Status
	probed    time.Time
	onPresent func()

	// top is the top line's TEXT payload as the layout last drew it, nil
	// when it drew none since the last CLEAR; banner is when the banner
	// showing over it goes, zero when none shows.
	top    []byte
	banner time.Time

	// Version 2: flash is the banner's words while banner is set; state is
	// what Show was last given, nil when nothing is to be drawn; want is
	// its Layout, and shown the keyboard's list as its acks have said.
	// follow is Follow's source, pulled at pulled; metered is when the
	// meters were last taken.
	flash   Flash
	state   *State
	want    []Item
	shown   []Item
	follow  func() State
	pulled  time.Time
	metered time.Time
	// refused: the keyboard refused a screen's command, so nothing is drawn
	// until a CLEAR takes the screen again: the Keyboard's own, at most
	// every Heal after the last, or the API's. healed is the last.
	refused bool
	healed  time.Time

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
		Clock:      time.Now,
		AckTimeout: 250 * time.Millisecond,
		Tries:      3,
		Probe:      2 * time.Second,
		Refresh:    40 * time.Millisecond,
		MeterEvery: 100 * time.Millisecond,
		Heal:       2 * time.Second,
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
				k.Tick()
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
	return k.frame(&message{cmd: cmdRelease, version: k.version(), seq: k.nextSeq()})
}

// version is the frames' version byte: 2 on a keyboard that said so, else
// 1, which every version reads. Called with mu held.
func (k *Keyboard) version() byte {
	if k.status.Version >= 2 {
		return 2
	}
	return 1
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
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Present {
		return false
	}
	k.top, k.banner = nil, time.Time{} // a CLEAR wipes the banner with everything else
	k.queueLocked(cmdClear, []byte{byte(c)})
	return true
}

// Text puts s at (x, y) at scale 1 to 4 in c, replacing what was there; an
// empty s removes it. It is drawn in capitals, cut to what fits, and only
// while Hindsight has the screen. The top line, while a banner shows, is
// drawn when the banner goes. Version 1's: on version 2 the screen is
// Show's, and Text refuses.
func (k *Keyboard) Text(x, y, scale int, c Colour, s string) bool {
	payload, ok := textPayload(x, y, scale, c, s)
	if !ok {
		return false
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Present || k.status.Version >= 2 {
		return false
	}
	if x == TopX && y == TopY {
		k.top = payload
		if s == "" {
			k.top = nil
		}
		if !k.banner.IsZero() {
			return true // drawn when the banner goes
		}
	}
	k.queueLocked(cmdText, payload)
	return true
}

// textPayload is version 1's TEXT payload: false when it can't be drawn.
func textPayload(x, y, scale int, c Colour, s string) ([]byte, bool) {
	if x < 0 || y < 0 || scale < 1 || scale > 4 || c >= colours ||
		x+6*scale > Width || y+7*scale > Height {
		return nil, false
	}
	text := []byte(cleanText(x, scale, s))
	return append([]byte{byte(x & 127), byte(x >> 7), byte(y & 127), byte(y >> 7), byte(scale), byte(c)}, text...), true
}

// v1Colour is c in version 1's seven: the accent for red, as KEEP's banner
// has been there, the text's white for white and the tracks.
func v1Colour(c Colour) Colour {
	switch {
	case c < colours:
		return c
	case c == Red || c == Violet:
		return Accent
	case c == Orange:
		return Amber
	case c == Deep:
		return Panel
	}
	return Text
}

// Now is the Keyboard's clock: a press is stamped with it, so its banner is
// timed from the press (Banner).
func (k *Keyboard) Now() time.Time { return k.Clock() }

// Banner puts s over the top line in c until BannerFor after pressed, then
// puts back the line that was there; a banner already showing is replaced,
// and its time starts again from pressed. Nothing is drawn unless Hindsight
// has the screen, or once that time has passed (a verb that took longer
// than it). False when nothing was drawn. c is version 2's colour, drawn
// as version 1 has it there (v1Colour); on version 2 the banner is a box
// in c with its words over it (Layout).
func (k *Keyboard) Banner(pressed time.Time, c Colour, s string) bool {
	if c >= coloursV2 || s == "" {
		return false
	}
	payload, ok := textPayload(TopX, TopY, BannerScale, v1Colour(c), s)
	if !ok {
		return false
	}
	until := pressed.Add(BannerFor)
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Present || !k.status.Screen || !k.Now().Before(until) {
		return false
	}
	// Queued under the same lock as the check: a HOME between the two
	// would otherwise find nothing to drop, and the banner would follow it.
	k.banner = until
	if k.status.Version >= 2 {
		k.flash = Flash{Words: s, Colour: c}
		k.redraw()
		k.next()
		return true
	}
	k.queueLocked(cmdText, payload)
	return true
}

// unbanner puts back the top line once the banner's time is up. Called with
// mu held, from tick.
func (k *Keyboard) unbanner() {
	if k.banner.IsZero() || k.Now().Before(k.banner) {
		return
	}
	k.banner = time.Time{}
	if !k.status.Screen {
		return // HOME since: the screen is the keyboard's
	}
	if k.status.Version >= 2 {
		k.redraw()
		k.next()
		return
	}
	payload := k.top
	if payload == nil {
		payload = []byte{TopX & 127, TopX >> 7, TopY & 127, TopY >> 7, BannerScale, byte(Text)} // no text: removed
	}
	k.queueLocked(cmdText, payload)
}

// heal draws the screen again from a CLEAR after the keyboard refused part
// of it, so one refusal doesn't freeze it, but not more often than Heal, so
// a screen it can't take isn't sent over and over. Called with mu held.
func (k *Keyboard) heal() {
	if !k.refused || !k.status.Screen || k.Now().Sub(k.healed) < k.Heal {
		return
	}
	k.healed = k.Now()
	log.Printf("[*] SMK-37: drawing the screen again whole, after a refusal")
	k.top, k.banner = nil, time.Time{}
	k.queueLocked(cmdClear, []byte{byte(Black)})
}

// Show draws s on a version 2 keyboard, when Hindsight has its screen:
// what changed since the last, as soon as nothing is in flight. Its meters
// are taken at most every MeterEvery; between, they stay as they were.
// False on version 1, or with no keyboard.
func (k *Keyboard) Show(s State) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	if !k.status.Present || k.status.Version < 2 {
		return false
	}
	if now := k.Now(); k.state != nil && now.Sub(k.metered) < k.MeterEvery {
		s.Meter = k.state.Meter
	} else {
		k.metered = now
	}
	k.state = &s
	k.redraw()
	k.next()
	return true
}

// Follow asks f for the screen every Refresh while a version 2 keyboard's
// screen is Hindsight's, and shows it. f runs on the Keyboard's loop
// without its lock, so it may take its own.
func (k *Keyboard) Follow(f func() State) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.follow = f
}

// pull shows Follow's screen when it is due.
func (k *Keyboard) pull() {
	k.mu.Lock()
	f := k.follow
	due := f != nil && k.status.Present && k.status.Version >= 2 && k.status.Screen &&
		k.Now().Sub(k.pulled) >= k.Refresh
	if due {
		k.pulled = k.Now()
	}
	k.mu.Unlock()
	if due {
		k.Show(f())
	}
}

// redraw is the screen to want now: the state's Layout, with the banner
// while it shows. Called with mu held.
func (k *Keyboard) redraw() {
	if k.state == nil {
		k.want = nil
		return
	}
	s := *k.state
	s.Banner = nil
	if !k.banner.IsZero() {
		f := k.flash
		s.Banner = &f
	}
	k.want = Layout(s)
}

// queueScreen queues the next BATCH of what the screen wants, when nothing
// else waits. Called with mu held.
func (k *Keyboard) queueScreen() {
	if k.status.Version < 2 || !k.status.Screen || k.want == nil || k.refused {
		return
	}
	cmds := plan(k.shown, k.want)
	if len(cmds) == 0 {
		return
	}
	payload, n := nextBatch(cmds)
	k.queue = append(k.queue, &message{cmd: cmdBatch, payload: payload, version: 2, items: cmds[:n]})
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
	k.queueLocked(cmd, payload)
	return true
}

// queueLocked is enqueue with mu held, for a keyboard that is there.
func (k *Keyboard) queueLocked(cmd byte, payload []byte) {
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
		k.queue = append(k.queue, &message{cmd: cmd, payload: payload, version: k.version()})
	}
	k.next()
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
	if k.flight == nil && len(k.queue) == 0 {
		k.queueScreen()
	}
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
	m.sent = k.Now()
	v := m.version
	if v == 0 {
		v = 1
	}
	out := append(append([]byte{}, header...), v, m.seq, m.cmd)
	out = append(out, m.payload...)
	return append(out, 0xF7)
}

// Tick probes, sends again what had no ack, puts back the top line once a
// banner's time is up, and forgets a keyboard that stopped answering or was
// unplugged. Start's loop calls it every 20 ms; a test with its own Clock
// may call it instead of Start.
func (k *Keyboard) Tick() {
	connected := k.connected()
	k.pull()
	k.mu.Lock()
	defer k.mu.Unlock()
	k.unbanner()
	k.heal()
	switch {
	case !connected:
		k.forget()
	case k.flight != nil && k.Now().Sub(k.flight.sent) >= k.AckTimeout:
		if k.flight.tries < k.Tries {
			k.send(k.frame(k.flight))
		} else if k.status.Present {
			// Three times unanswered: not Hindsight's firmware any more, or
			// not listening. Probe until it answers again.
			k.forget()
		} else {
			k.flight = nil
		}
	case !k.status.Present && k.flight == nil && k.Now().Sub(k.probed) >= k.Probe:
		k.probed = k.Now()
		k.queue = append([]*message{{cmd: cmdHello, version: 1}}, k.queue...) // read by every version
		k.next()
	}
}

// forget is a keyboard that stopped answering: nothing waits, nothing is in
// flight. A HOME is remembered, so an answer again doesn't take the screen
// back. Called with mu held.
func (k *Keyboard) forget() {
	k.status = Status{Homed: k.status.Homed}
	k.flight, k.queue = nil, nil
	k.top, k.banner = nil, time.Time{}
	k.state, k.want, k.shown, k.refused = nil, nil, nil, false
}

// dropDrawing forgets the CLEARs and TEXTs waiting or in flight, after
// HOME: they draw a screen that is the keyboard's now. A late ack for one
// in flight then matches nothing. Called with mu held.
func (k *Keyboard) dropDrawing() {
	k.banner = time.Time{} // nothing to put back on a screen that isn't ours
	k.shown = nil          // a CLEAR starts it again
	drawing := func(m *message) bool { return m.cmd == cmdClear || m.cmd == cmdText || m.cmd == cmdBatch }
	if k.flight != nil && drawing(k.flight) {
		k.flight = nil
	}
	kept := k.queue[:0]
	for _, m := range k.queue {
		if !drawing(m) {
			kept = append(kept, m)
		}
	}
	k.queue = kept
	k.next()
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
// keyboard's own RELEASE or OFFER. Anything else is ignored. An ack comes
// in the version its message went in, 1 or 2; the keyboard's own RELEASE
// and OFFER always say 1.
func (k *Keyboard) Feed(msg []byte) {
	if len(msg) < 8 || string(msg[:4]) != string(header) || (msg[4] != 1 && msg[4] != 2) || msg[len(msg)-1] != 0xF7 {
		return
	}
	seq, cmd := msg[5], msg[6]
	k.mu.Lock()
	if cmd == cmdRelease && seq == 0 {
		// HOME on the keyboard: the screen is its own until a CLEAR. A
		// CLEAR still waiting would take it straight back, sent again
		// because its ack was late or lost (the keyboard keeps one reply
		// per port, and its RELEASE can take the ack's place).
		k.status.Screen = false
		k.status.Homed = true
		k.dropDrawing()
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
	k.status.RTT = k.Now().Sub(done.sent)
	var present func()
	switch {
	case done.cmd == cmdHello && status == statusOK && !k.status.Present:
		k.status.Present = true
		// HELLO's ack adds <version> <items>: 02 60 on version 2.
		k.status.Version = 1
		if len(msg) >= 11 && msg[8] >= 2 {
			k.status.Version = 2
		}
		present = k.onPresent
	case done.cmd == cmdClear && status == statusOK:
		k.status.Screen = true
		k.status.Homed = false
		k.shown, k.refused = nil, false // the list is empty
	case done.cmd == cmdBatch && status == statusOK:
		for _, it := range done.items {
			k.shown = apply(k.shown, it)
		}
	case done.cmd == cmdBatch && status != statusReleased:
		// Stopped short: what came before it is done. A screen the keyboard
		// won't take would only be refused again, so it stops being drawn
		// until the screen is taken again.
		n := 0
		if len(msg) >= 11 {
			n = int(msg[8]) | int(msg[9])<<7
		}
		for _, it := range done.items[:min(n, len(done.items))] {
			k.shown = apply(k.shown, it)
		}
		log.Printf("[!] SMK-37: the keyboard refused a screen's command %d (status %d): %v", n, status, done.items[min(n, len(done.items)-1)])
		k.refused = true // until heal draws it again whole
	case status == statusReleased:
		// A TEXT the keyboard wouldn't draw. Once a CLEAR has taken the
		// screen only HOME gives it back, so on Hindsight's screen this
		// was HOME, its RELEASE lost behind an ack.
		if k.status.Screen {
			k.status.Homed = true
			k.dropDrawing()
		}
		k.status.Screen = false
	case done.cmd == cmdRelease && status == statusOK:
		k.status.Screen = false
	}
	k.next()
	k.mu.Unlock()
	if present != nil {
		go present()
	}
}
