package tape

import (
	"errors"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// Play mode's tricks: what a held pad does to what the room hears.
//
// A trick is a read head that leaves the transport while its pad is held.
// The transport keeps counting underneath -- its position, the history that
// catches and punches read, the MIDI clock -- and none of them ever see the
// head. Let go, and the renderer reads from the transport again, which is in
// time because it never stopped. That is the whole design
// (docs/superpowers/specs/2026-10-14-play-mode-sound-design.md): no rate in
// the position map, nothing to resynchronise on release.
//
// None of this is the tape's State. It is never undone, saved, or built into
// a Mix: a jam of a hundred presses leaves the undo history exactly where it
// was. It belongs to the render goroutine, which alone touches perf; the API
// reaches it through an inbox that never drops a release, because a dropped
// release is a pad stuck down with no key that lets it up.

// The pads, by the names the page gives them (web/static/lib/play/keymap.js).
const (
	PadTrack1  = "track1"
	PadTrack2  = "track2"
	PadTrack3  = "track3"
	PadTrack4  = "track4"
	PadBreak   = "break"
	PadReverse = "reverse"
	PadChop    = "chop"
	PadStop    = "stop"
	PadHalf    = "half"
	PadDouble  = "double"
	// The punch-in FX (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md):
	// ROLL moves the head as the tricks do; FILTER, ECHO and CRUSH work on
	// what the head plays (fx.go); the bend nudges the head's speed.
	PadRoll   = "roll"
	PadFilter = "filter"
	PadEcho   = "echo"
	PadCrush  = "crush"
	PadBend   = "bend"
)

// pads in index order: the track keys, the pads that move the head, then
// the punch-in FX.
var pads = [...]string{PadTrack1, PadTrack2, PadTrack3, PadTrack4,
	PadBreak, PadReverse, PadChop, PadStop, PadHalf, PadDouble,
	PadRoll, PadFilter, PadEcho, PadCrush, PadBend}

// The punch-in FX pads, by index.
const (
	iRoll = iota + 10
	iFilter
	iEcho
	iCrush
	iBend
)

const (
	trackPads = 4
	numPads   = len(pads)
	// numAmounts counts what has an amount a page can draw: every pad (only
	// the punch-in FX use theirs), then the mods' previews.
	numAmounts = numPads + numMods
	// maxPresses bounds the inbox. A press past it is dropped -- a pad that
	// didn't sound, which is harmless. A release never is.
	maxPresses = 64
	// maxStep is the furthest the head moves in one frame while playing on
	// (2× moves 2); a bigger step is a jump -- CHOP's seam, a loop's wrap --
	// and is crossfaded as the renderer crossfades any seam.
	maxStep = 4
)

// ErrNoSuchPad is a press or release of a pad Play mode doesn't have.
var ErrNoSuchPad = errors.New("no such pad")

// ErrNoAmount is a set of a pad that has no amount to move.
var ErrNoAmount = errors.New("that pad has no amount")

// defaultAmount is a punch-in FX's amount when its press doesn't say: a key
// on a computer keyboard has no velocity. The bend's is its centre.
const defaultAmount = 0.5

// amountPad says whether pad i carries an amount: the punch-in FX.
func amountPad(i int) bool { return i >= iRoll && i <= iBend }

// fxPad says whether pad i is one of the FX on the output (fx.go).
func fxPad(i int) bool { return i == iFilter || i == iEcho || i == iCrush }

// headPad says whether pad i moves the head: the tricks, and ROLL.
func headPad(i int) bool { return i >= trackPads && i <= iRoll }

// clampAmount keeps an amount in its range: -1 to 1 for the bend, 0 to 1
// for the rest.
func clampAmount(i int, v float64) float64 {
	lo := 0.0
	if i == iBend {
		lo = -1
	}
	return math.Max(lo, math.Min(1, v))
}

// slotName is the name of an amount's slot: a pad, or a mod.
func slotName(i int) string {
	if i >= numPads {
		return modNames[i-numPads]
	}
	return pads[i]
}

// Pads is every pad, by name, track keys first.
func Pads() []string { return append([]string(nil), pads[:]...) }

func padIndex(name string) int {
	for i, p := range pads {
		if p == name {
			return i
		}
	}
	return -1
}

// trickQuantum is when a press may land: the next line of a grid division,
// or now. "off" is the page's name for now.
func trickQuantum(q string) (string, error) {
	switch q {
	case "", "off", QuantumNow:
		return QuantumNow, nil
	case QuantumSixteenth, QuantumEighth, QuantumBeat, QuantumBar:
		return q, nil
	}
	return "", ErrBadParameter
}

// trickMsg is a press or a release on its way to the render goroutine, or
// an amount moved.
type trickMsg struct {
	pad     int // index into pads; numPads+i for mod i's preview
	press   bool
	all     bool    // a release of every pad
	quantum string  // when it lands
	set     bool    // an amount moved, from the next block rendered
	clear   bool    // a mod's preview let go: back to the tape's own
	v       float64 // a press's amount, or a set's
}

// trickInbox is where Press, Release and ReleaseAll leave their messages for
// the render goroutine's next drain.
type trickInbox struct {
	mu   sync.Mutex
	msgs []trickMsg
}

// Press holds a pad down from the next line of quantum -- now, 16th, 8th,
// beat or bar. A track key drops its track out; a trick pad moves the head;
// a punch-in FX comes in at its default amount.
func (e *Engine) Press(pad, quantum string) error {
	return e.press(pad, quantum, math.NaN())
}

// PressAmount is Press with an amount, 0 to 1 (the bend -1 to 1): a
// velocity, read at the press. Only the punch-in FX use it.
func (e *Engine) PressAmount(pad, quantum string, v float64) error {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fmt.Errorf("%w: an amount is a number", ErrBadParameter)
	}
	return e.press(pad, quantum, v)
}

func (e *Engine) press(pad, quantum string, v float64) error {
	i := padIndex(pad)
	if i < 0 {
		return ErrNoSuchPad
	}
	q, err := trickQuantum(quantum)
	if err != nil {
		return err
	}
	if i == iBend {
		// A wheel off its centre is a hand on the tape's speed, not a beat:
		// it lands now, whatever the quantise switch says.
		q = QuantumNow
	}
	switch {
	case !amountPad(i):
		v = 0
	case math.IsNaN(v) && i == iBend:
		v = 0
	case math.IsNaN(v):
		v = defaultAmount
	default:
		v = clampAmount(i, v)
	}
	// A mixdown's pass renders straight, so a trick wouldn't be heard in it;
	// printing tricks into one is a later, deliberate feature.
	if md := e.MixdownStatus(); md != nil && md.busy() {
		return ErrMixingDown
	}
	e.tricks.mu.Lock()
	n := 0
	for _, m := range e.tricks.msgs {
		if m.press {
			n++
		}
	}
	if n >= maxPresses {
		e.tricks.mu.Unlock()
		log.Printf("[!] tape: trick inbox full, a press of %s dropped", pad)
		return nil
	}
	e.tricks.msgs = append(e.tricks.msgs, trickMsg{pad: i, press: true, quantum: q, v: v})
	e.tricks.mu.Unlock()
	e.wake()
	return nil
}

// Set moves an amount from the next block rendered, unquantised: a held
// punch-in FX's (aftertouch, the mod wheel, the pitch wheel for the bend),
// or a mod's preview (mod.wow and the rest) -- heard at once, and nothing
// saved: the tape's own value comes back when the preview is let go
// (Release), or is replaced when the tape's mods change. A flood of sets
// costs nothing: one waiting for the render goroutine is replaced, not
// queued behind.
func (e *Engine) Set(pad string, v float64) error {
	i := padIndex(pad)
	if i < 0 {
		if m := modIndex(pad); m >= 0 {
			i = numPads + m
		}
	}
	switch {
	case i < 0:
		return ErrNoSuchPad
	case i < numPads && !amountPad(i):
		return ErrNoAmount
	case math.IsNaN(v) || math.IsInf(v, 0):
		return fmt.Errorf("%w: an amount is a number", ErrBadParameter)
	}
	if i < numPads {
		v = clampAmount(i, v)
	} else {
		v = math.Max(0, math.Min(1, v))
	}
	e.postAmount(trickMsg{pad: i, set: true, v: v})
	return nil
}

// postAmount queues a set or a preview's release, replacing one for the same
// slot still waiting with nothing between them for that pad.
func (e *Engine) postAmount(m trickMsg) {
	e.tricks.mu.Lock()
	for j := len(e.tricks.msgs) - 1; j >= 0; j-- {
		w := e.tricks.msgs[j]
		if w.all && m.pad < numPads {
			break
		}
		if w.pad != m.pad {
			continue
		}
		if w.set || w.clear {
			e.tricks.msgs[j] = m
			e.tricks.mu.Unlock()
			e.wake()
			return
		}
		break
	}
	e.tricks.msgs = append(e.tricks.msgs, m)
	e.tricks.mu.Unlock()
	e.wake()
}

// Release lets a pad go, on the next line of the quantum it was pressed with
// and never before it has sounded for one whole line. Released, a mod's
// preview goes back to the tape's own value.
func (e *Engine) Release(pad string) error {
	i := padIndex(pad)
	if i < 0 {
		if m := modIndex(pad); m >= 0 {
			e.postAmount(trickMsg{pad: numPads + m, clear: true})
			return nil
		}
		return ErrNoSuchPad
	}
	e.post(trickMsg{pad: i})
	return nil
}

// ReleaseAll lets every pad go, on the next line of quantum: for a player
// who has gone -- a dropped connection, a closed tab.
func (e *Engine) ReleaseAll(quantum string) {
	q, err := trickQuantum(quantum)
	if err != nil {
		q = QuantumNow
	}
	e.post(trickMsg{pad: -1, all: true, quantum: q})
}

// post queues a release. It is never dropped; one already waiting for the
// same pad, with no press after it, is the same release and is enough --
// which is what keeps the inbox bounded.
func (e *Engine) post(m trickMsg) {
	e.tricks.mu.Lock()
	for j := len(e.tricks.msgs) - 1; j >= 0; j-- {
		w := e.tricks.msgs[j]
		if w.set || w.clear {
			continue // an amount: not a press or a release
		}
		if m.all {
			if w.press {
				break // pressed since the last release of everything: this one is needed
			}
			if w.all {
				e.tricks.mu.Unlock()
				return
			}
			continue
		}
		if w.all || w.pad != m.pad {
			continue
		}
		if !w.press {
			e.tricks.mu.Unlock()
			return
		}
		break
	}
	e.tricks.msgs = append(e.tricks.msgs, m)
	e.tricks.mu.Unlock()
	e.wake()
}

// wake has the render goroutine drain soon, rather than at its next block.
func (e *Engine) wake() {
	select {
	case e.kick <- struct{}{}:
	default:
	}
}

// drainTricks moves the inbox onto the transport's queue, each press and
// release on the output frame its quantum lands on, with the render head at
// out -- the same queue, and the same splitting of a block at its frame, as
// a quantised ▶.
func (e *Engine) drainTricks(out uint64, m *Mix) {
	e.tricks.mu.Lock()
	msgs := e.tricks.msgs
	e.tricks.msgs = nil
	e.tricks.mu.Unlock()
	p := &e.perf
	for _, msg := range msgs {
		switch {
		case msg.set:
			if msg.pad >= numPads {
				p.preview[msg.pad-numPads] = preview{on: true, v: msg.v}
			} else {
				p.setAmount(msg.pad, msg.v, out)
			}
			p.moved[msg.pad] = true
		case msg.clear:
			p.preview[msg.pad-numPads].on = false
			p.moved[msg.pad] = true
		case msg.all:
			for i := range pads {
				if p.down[i] {
					e.queueRelease(i, msg.quantum, out, m)
				}
			}
		case msg.press:
			if p.down[msg.pad] {
				continue
			}
			if amountPad(msg.pad) {
				p.setAmount(msg.pad, msg.v, out)
			}
			if e.cancelRelease(msg.pad) {
				// Let go and pressed again before the release landed: the
				// finger is down, so the pad simply stays held.
				p.down[msg.pad] = true
				continue
			}
			at := e.tr.target(Action{Quantum: msg.quantum}, out, m, m.grid)
			p.down[msg.pad], p.quantum[msg.pad], p.pressAt[msg.pad] = true, msg.quantum, at
			e.tr.queue(pending{at: at, action: Action{Kind: "trick", trick: &trickMsg{pad: msg.pad, press: true}}})
		default:
			if p.down[msg.pad] {
				e.queueRelease(msg.pad, p.quantum[msg.pad], out, m)
			}
		}
	}
	e.logMoves(out, m)
}

// moveEvery is the most often an amount's moves are told to the pages: 30
// times a second.
const moveEvery = 1.0 / 30

// logMoves tells the pages of amounts that moved, no more than 30 times a
// second each: a flood of sets is drawn, not queued. The last move always
// gets out, a little later.
func (e *Engine) logMoves(out uint64, m *Mix) {
	p := &e.perf
	every := uint64(moveEvery * m.rate())
	for i := range p.moved {
		if !p.moved[i] || (p.movedEver[i] && out < p.movedAt[i]+every) {
			continue
		}
		p.moved[i], p.movedEver[i], p.movedAt[i] = false, true, out
		ev := TrickEvent{Pad: slotName(i), Out: out, Pos: e.tr.pos, Move: true}
		if i < numPads {
			v := p.amount[i]
			ev.On, ev.V = p.held[i], &v
		} else {
			v := p.modTarget(i-numPads, m)
			ev.On, ev.V = p.preview[i-numPads].on, &v
		}
		e.moveLog.add(ev)
	}
}

// queueRelease queues pad i's release on quantum's next line, and no sooner
// than one whole line after its press: a tap shorter than a sixteenth still
// plays a sixteenth, as the page's surface promises (lib/play/surface.js).
func (e *Engine) queueRelease(i int, quantum string, out uint64, m *Mix) {
	p := &e.perf
	at := e.tr.target(Action{Quantum: quantum}, out, m, m.grid)
	if u := unitFrames(p.quantum[i], m); at < p.pressAt[i]+u {
		at = p.pressAt[i] + u
	}
	p.down[i] = false
	e.tr.queue(pending{at: at, action: Action{Kind: "trick", trick: &trickMsg{pad: i}}})
}

// cancelRelease takes pad i's release off the queue if it hasn't landed,
// and says whether there was one.
func (e *Engine) cancelRelease(i int) bool {
	for j, q := range e.tr.pend {
		if t := q.action.trick; t != nil && !t.press && t.pad == i {
			e.tr.pend = append(e.tr.pend[:j], e.tr.pend[j+1:]...)
			return true
		}
	}
	return false
}

// unitFrames is one line of a quantum, in frames; 0 for now, or a tape with
// no grid.
func unitFrames(quantum string, m *Mix) uint64 {
	if m.grid == nil {
		return 0
	}
	bar := m.grid.BarFrames()
	switch quantum {
	case QuantumSixteenth:
		return uint64(math.Round(bar / 16))
	case QuantumEighth:
		return uint64(math.Round(bar / 8))
	case QuantumBeat:
		return uint64(math.Round(bar / BeatsPerBar))
	case QuantumBar:
		return uint64(math.Round(bar))
	}
	return 0
}

// ---------------------------------------------------------------------------
// The render goroutine's side.

// perf is what's held, and the head. Only the render goroutine touches it.
type perf struct {
	// The drain's view: pressed, whether or not it has landed yet.
	down    [numPads]bool
	quantum [numPads]string
	pressAt [numPads]uint64 // the output frame its press lands on

	// The render's view: sounding.
	held  [numPads]bool
	order []int // trick pads sounding, oldest first; the newest is heard

	cut  [trackPads]ramp // each track key: how far its track is dropped out
	head head
	fade sourceFade

	// The punch-in FX and the mods: each pad's amount, as pressed or last
	// set; the mods' previews; and the stages that play them.
	amount  [numPads]float64
	preview [numMods]preview
	style   [numMods]float64 // the tape's mods as last seen: a change ends a preview
	styled  bool
	mod     modulation
	bus     fxBus
	// The amounts the pages are told of (logMoves).
	moved, movedEver [numAmounts]bool
	movedAt          [numAmounts]uint64

	// Scratch, made once.
	a, b, tb, buf []float32
	pos, opos     []float64
	lvl, olvl     []float32
	runs          []run
	// The span's offsets from where the head would read: WOW and FLUTTER's,
	// the bend's, and theirs together on the source being planned.
	wf, bendArr, off []float64
	wfOn, bendFilled bool
	planOff          []float64
	round            []bool
}

// preview is a mod moved on a page or a controller and not yet saved.
type preview struct {
	on bool
	v  float64
}

// modTarget is where mod i is going: its preview, or the tape's own.
func (p *perf) modTarget(i int, m *Mix) float64 {
	if p.preview[i].on {
		return p.preview[i].v
	}
	return m.style[i]
}

// setAmount moves pad i's amount, from output frame out.
func (p *perf) setAmount(i int, v float64, out uint64) {
	p.amount[i] = v
	if i == iRoll {
		p.reslice(out)
	}
}

// targets points every amount where it's going, at the start of a render:
// the mods at their previews or the tape's, the bend at the wheel. A change
// of the tape's own mod ends its preview -- saved, or replaced.
func (p *perf) targets(m *Mix) {
	for i := range p.style {
		if p.styled && p.style[i] != m.style[i] && p.preview[i].on {
			p.preview[i].on = false
			p.moved[numPads+i] = true
		}
	}
	p.style, p.styled = m.style, true
	p.mod.wow.to = p.modTarget(modWow, m)
	p.mod.flutter.to = p.modTarget(modFlutter, m)
	if p.mod.bendOn {
		p.mod.bend.to = p.amount[iBend]
	}
	p.bus.drive.to = p.modTarget(modDrive, m)
	p.bus.age.to = p.modTarget(modAge, m)
}

// step moves the modulation on over the next n frames, from output frame o,
// the tape moving under them or not: rendering, it fills the span's
// offsets; not (a late render), it only counts, and the FX bus drops what
// was ringing.
func (p *perf) step(n int, o uint64, rendering, moving bool, m *Mix) {
	if !rendering {
		p.mod.skip(n, m.rate(), moving)
		p.bus.skip(n, o, m)
		p.wfOn, p.bendFilled = false, false
		return
	}
	p.ensure(max(n, BlockFrames), m)
	p.wfOn = p.mod.wobbles()
	p.bendFilled = p.mod.bendOn || p.mod.bendOff != 0
	p.mod.run(p.wf[:n], p.bendArr[:n], n, m.rate(), moving)
}

// post runs output frames [o, o+n) of d through the tape's character and the
// punch-in FX, in place, before the click is added. A mixdown's pass (once)
// gets the mods and not the FX.
func (p *perf) post(d []float32, o uint64, n int, m *Mix, once bool) {
	if p.bus.quiet() || n <= 0 {
		return
	}
	p.bus.process(d[:n*OutChannels], n, o, m, &p.amount, once)
}

// wobbles says whether WOW or FLUTTER moves the head this span.
func (p *perf) wobbles() bool { return p.wfOn }

// rollSlice is ROLL's slice at amount v: under .25 a quarter note, under .5
// an eighth, under .75 a sixteenth, otherwise a thirty-second.
func rollSlice(v, beat float64) int64 {
	div := 8.0
	switch {
	case v < .25:
		div = 1
	case v < .5:
		div = 2
	case v < .75:
		div = 4
	}
	return max64(maxStep+1, int64(math.Round(beat/div)))
}

// reslice moves a sounding ROLL to its amount's slice from its next repeat,
// so it stays on the grid.
func (p *perf) reslice(out uint64) {
	h := &p.head
	if !h.on || h.pad != iRoll {
		return
	}
	s := rollSlice(p.amount[iRoll], h.beat)
	if s == h.slice {
		return
	}
	k := int64(out) - int64(h.start)
	if k <= h.origin {
		h.slice = s // its last change hasn't begun: this one replaces it
		return
	}
	next := h.origin + (k-h.origin+h.slice-1)/h.slice*h.slice
	h.prevOrigin, h.prevSlice = h.origin, h.slice
	h.origin, h.slice = next, s
}

// run is a stretch of output frames [k, j) the head reads without a jump,
// and, if a jump landed on it within a crossfade, what it left.
type run struct {
	k, j   int
	fresh  bool    // the transport's first pass from In: no crossfade from past Out
	phase  int64   // frames since the jump; -1 for none
	from   float64 // the position it left
	step   float64 // and how fast it was moving
	level  float32
	jumped bool
}

// ramp is a track's cut: 0 heard, 1 dropped out, moving from `from` to `to`
// over the declick's length from output frame at.
type ramp struct {
	from, to float32
	at       uint64
}

func (r ramp) value(o uint64, length int64) float32 {
	if r.from == r.to || length <= 0 || o < r.at {
		if o < r.at {
			return r.from
		}
		return r.to
	}
	x := float32(o-r.at+1) / float32(length)
	if x >= 1 {
		return r.to
	}
	return r.from + (r.to-r.from)*x
}

// head is where a trick reads the tape from. Off, it is the transport, and
// still says whether the bend moves it.
type head struct {
	on     bool
	pad    int
	anchor int64   // the tape frame it left the transport at
	start  uint64  // the output frame it left at
	beat   float64 // frames in a beat: STOP's wind-down
	slice  int64   // CHOP's length, and ROLL's
	// ROLL repeats its slice from origin frames after it left; before that,
	// prevSlice from prevOrigin (a set changes it at its next repeat).
	origin, prevOrigin, prevSlice int64
	bent                          bool    // the bend moves it
	bendHold                      float64 // a bend let go, frozen, as it fades out
}

// sourceFade is a change of source: from the transport to a head, a head to
// another, or a head back to the transport, crossfaded over the renderer's
// seam length.
type sourceFade struct {
	on    bool
	start uint64
	prev  head // what fades out; the transport when !prev.on
}

// read is where the head reads k output frames after it left the transport,
// at what level, and whether it sounds at all.
func (h *head) read(k int64, loop Loop) (float64, float32, bool) {
	if !h.on || k < 0 {
		return 0, 0, false
	}
	a := float64(h.anchor)
	x := float64(k)
	var p float64
	level := float32(1)
	switch pads[h.pad] {
	case PadBreak:
		return 0, 0, false
	case PadStop:
		// The tape winds down to a stop over a beat: its speed falls in a
		// straight line, and so does its level, as a tape's does -- the
		// playback head reads less signal the slower the tape moves past it.
		if x >= h.beat {
			return 0, 0, false
		}
		p, level = a+x-x*x/(2*h.beat), float32(1-x/h.beat)
	case PadChop:
		// The last slice heard: inside the loop that slice is the loop's own
		// frames -- pressed on the downbeat, the loop's last sixteenth, not
		// the tape before In, which nobody heard.
		if inLoop(loop, h.anchor) {
			return wrapLoop(float64(h.anchor-h.slice+k%h.slice), loop, h.anchor), 1, true
		}
		from := max64(0, h.anchor-h.slice)
		return float64(from + k%h.slice), 1, true
	case PadRoll:
		// The slice from where it landed, again and again.
		o, s := h.origin, h.slice
		if k < h.origin && h.prevSlice > 0 {
			o, s = h.prevOrigin, h.prevSlice
		}
		r := (k - o) % s
		if r < 0 {
			r += s
		}
		return wrapLoop(float64(h.anchor+r), loop, h.anchor), 1, true
	case PadReverse:
		p = a - x
	case PadHalf:
		p = a + x/2
	case PadDouble:
		p = a + 2*x
	default:
		return 0, 0, false
	}
	p = wrapLoop(p, loop, h.anchor)
	if p < 0 {
		return 0, 0, false
	}
	return p, level, true
}

// wrapLoop keeps a head that left inside the loop inside it: past Out it
// comes round to In, and back past In, to Out.
func wrapLoop(p float64, l Loop, anchor int64) float64 {
	if !inLoop(l, anchor) {
		return p
	}
	in, out := float64(l.In), float64(l.Out)
	n := out - in
	// Nearly always inside, or less than a loop past either end: no Mod,
	// which costs as much as reading the tape.
	if p >= in && p < out {
		return p
	}
	if r := p - n; p >= out && r >= in && r < out {
		return r
	}
	if r := p + n; p < in && r >= in && r < out {
		return r
	}
	return in + math.Mod(math.Mod(p-in, n)+n, n)
}

// inLoop says whether a head that left at anchor plays inside l.
func inLoop(l Loop, anchor int64) bool {
	return l.On && l.Out > l.In && anchor >= l.In && anchor < l.Out
}

// newHead is pad's head, leaving the transport at tape frame pos on output
// frame o.
func (p *perf) newHead(pad int, pos int64, o uint64, m *Mix) head {
	h := head{on: true, pad: pad, anchor: pos, start: o, beat: 0.5 * m.sr}
	if m.grid != nil {
		h.beat = m.grid.BarFrames() / BeatsPerBar
	}
	// CHOP's slice is the quantise switch's line: the last sixteenth, eighth,
	// beat or bar before the press.
	h.slice = int64(unitFrames(p.quantum[pad], m))
	if h.slice == 0 {
		h.slice = int64(unitFrames(QuantumSixteenth, m))
	}
	if h.slice == 0 {
		h.slice = int64(0.125 * m.sr)
	}
	if h.slice < 1 {
		h.slice = 1
	}
	if pad == iRoll {
		h.slice = rollSlice(p.amount[iRoll], h.beat)
	}
	h.bent = p.mod.bendOn
	return h
}

// top is the trick pad heard: the newest still held, or -1.
func (p *perf) top() int {
	if len(p.order) == 0 {
		return -1
	}
	return p.order[len(p.order)-1]
}

// apply carries out a press or release on output frame o, with the
// transport at tape frame pos, and says whether it changed what's held.
func (p *perf) apply(msg trickMsg, o uint64, pos int64, playing bool, m *Mix) bool {
	i := msg.pad
	if i < 0 || i >= numPads {
		return false
	}
	if msg.press {
		if p.held[i] {
			return false
		}
		p.held[i] = true
		switch {
		case i < trackPads:
			p.setCut(i, 1, o, m)
		case fxPad(i):
			// On the output, so heard whether or not the tape plays: an echo
			// rings on over a stopped tape.
			p.bus.press(i, p.amount[i], o, m)
		case i == iBend:
			p.bendPress()
		default:
			p.order = append(p.order, i)
			if playing {
				p.engage(i, pos, o, m)
			}
		}
		return true
	}
	if !p.held[i] {
		return false
	}
	p.held[i] = false
	switch {
	case i < trackPads:
		p.setCut(i, 0, o, m)
		return true
	case fxPad(i):
		p.bus.release(i, o, m)
		return true
	case i == iBend:
		p.bendRelease(o)
		return true
	}
	was := p.top()
	for j, x := range p.order {
		if x == i {
			p.order = append(p.order[:j], p.order[j+1:]...)
			break
		}
	}
	if was != i || !p.head.on {
		return true // one held underneath let go: what's heard doesn't change
	}
	if t := p.top(); t >= 0 {
		p.engage(t, pos, o, m)
	} else {
		off := p.head
		off.on = false
		p.setSource(off, o)
	}
	return true
}

// bendPress starts the bend: whatever is heard reads ahead or behind by
// what the bend adds up to, from nothing.
func (p *perf) bendPress() {
	p.mod.bendOn, p.mod.bendOff = true, 0
	p.mod.bend = smooth{to: p.amount[iBend]}
	p.head.bent = true
}

// bendRelease lets the bend go on output frame o: what's heard rejoins the
// transport (or the trick it was bending), crossfading from where the bend
// had taken it, as every trick's return does.
func (p *perf) bendRelease(o uint64) {
	p.mod.bendOn = false
	was := p.head
	was.bent, was.bendHold = false, was.bendHold+p.mod.bendOff
	p.head = was
	now := was
	now.bendHold = 0
	p.setSource(now, o)
}

// heldMask is what's held, a bit per pad, for readers off the render
// goroutine.
func (p *perf) heldMask() uint32 {
	var m uint32
	for i, h := range p.held {
		if h {
			m |= 1 << i
		}
	}
	return m
}

// engage moves the head to pad from the transport's position, crossfading
// from whatever was heard.
func (p *perf) engage(pad int, pos int64, o uint64, m *Mix) {
	p.setSource(p.newHead(pad, pos, o, m), o)
}

// setSource makes h what's heard from output frame o, crossfading from what
// was heard on the frame before. Two changes on one frame -- REV let go as
// CHOP lands, two pads let go together -- fade from what was actually heard,
// not from a head that never sounded; transport to transport is no change.
func (p *perf) setSource(h head, o uint64) {
	prev := p.head
	if p.fade.on && p.fade.start == o {
		prev = p.fade.prev
	}
	p.head = h
	moved := prev.bent != h.bent || prev.bendHold != h.bendHold
	p.fade = sourceFade{on: prev.on || h.on || moved, start: o, prev: prev}
}

// setCut moves track i's cut toward to from output frame o.
func (p *perf) setCut(i int, to float32, o uint64, m *Mix) {
	cur := p.cut[i].value(o, m.declick)
	p.cut[i] = ramp{from: cur, to: to, at: o}
}

// lose drops the head where the transport stopped or jumped: a held pad
// takes it up again, from the new position, when the tape next plays.
func (p *perf) lose() {
	p.head.on = false
	p.fade.on = false
}

// reset forgets everything held, and everything the FX had ringing: a new
// tape, or the transport reset.
func (p *perf) reset() {
	keep := perf{a: p.a, b: p.b, tb: p.tb, buf: p.buf, pos: p.pos, opos: p.opos, lvl: p.lvl, olvl: p.olvl, runs: p.runs,
		wf: p.wf, bendArr: p.bendArr, off: p.off, round: p.round}
	keep.bus.echo.line = p.bus.echo.line[:0]
	*p = keep
}

// active says whether anything here changes what's heard from output frame
// o: when nothing is, the renderer takes its usual path untouched.
func (p *perf) active(o uint64, m *Mix) bool {
	if p.head.on || p.fade.on || p.head.bent || p.wfOn {
		return true
	}
	for i := range p.cut {
		if p.cut[i].to != 0 || p.cut[i].value(o, m.declick) != 0 {
			return true
		}
	}
	return false
}

// ensure makes the scratch buffers big enough for n frames.
func (p *perf) ensure(n int, m *Mix) {
	if len(p.pos) >= n {
		return
	}
	p.a = make([]float32, n*OutChannels)
	p.b = make([]float32, n*OutChannels)
	p.tb = make([]float32, n*OutChannels)
	// The head reads up to maxStep frames of tape per output frame, plus the
	// interpolation's neighbours either side.
	p.buf = make([]float32, (maxStep*n+int(m.xfade)*maxStep+8)*OutChannels)
	p.pos = make([]float64, n)
	p.lvl = make([]float32, n)
	p.opos = make([]float64, max64(1, m.xfade))
	p.olvl = make([]float32, max64(1, m.xfade))
	p.wf = make([]float64, n)
	p.bendArr = make([]float64, n)
	p.off = make([]float64, n)
	p.round = make([]bool, n)
}

// render adds what the room hears for output frames [o, o+n), with the
// transport at tape frame pos: the transport or the head, each track at its
// track key's level, crossfading where the source just changed.
func (p *perf) render(dst []float32, m *Mix, o uint64, n int, pos int64, afterWrap bool) {
	p.ensure(max(n, BlockFrames), m)
	xf := uint64(max64(1, m.xfade))
	fading := 0
	if p.fade.on {
		if end := p.fade.start + xf; o < end {
			fading = int(min64(int64(end-o), int64(n)))
		} else {
			p.fade.on = false
		}
	}
	if fading == 0 {
		p.source(dst, m, p.head, o, n, pos, afterWrap)
		return
	}
	// Both sources: the new rising on a sine as the old falls on a cosine.
	a := p.a[:n*OutChannels]
	clear(a)
	p.source(a, m, p.head, o, n, pos, afterWrap)
	b := p.b[:fading*OutChannels]
	clear(b)
	p.source(b, m, p.fade.prev, o, fading, pos, afterWrap)
	for k := 0; k < n; k++ {
		gIn, gOut := float32(1), float32(0)
		if k < fading {
			x := (float64(o+uint64(k)-p.fade.start) + 0.5) / float64(xf)
			gIn, gOut = float32(math.Sin(x*math.Pi/2)), float32(math.Cos(x*math.Pi/2))
		}
		for c := 0; c < OutChannels; c++ {
			v := a[k*OutChannels+c] * gIn
			if k < fading {
				v += b[k*OutChannels+c] * gOut
			}
			dst[k*OutChannels+c] += v
		}
	}
	if o+uint64(n) >= p.fade.start+xf {
		p.fade.on = false
	}
}

// source adds one source's sound -- the transport when !h.on, else the head
// -- track by track, each at its track key's level. WOW, FLUTTER or the bend
// take even the transport through the head's reader.
func (p *perf) source(dst []float32, m *Mix, h head, o uint64, n int, pos int64, afterWrap bool) {
	read := h.on || p.modded(h)
	if read {
		p.plan(m, h, o, n, pos, afterWrap)
	}
	for ti := range m.tracks {
		if m.tracks[ti].silent {
			continue
		}
		var r ramp
		if ti < trackPads {
			r = p.cut[ti]
		}
		if r.from == 1 && r.to == 1 {
			continue // dropped out, all of this span
		}
		into := dst
		if r.from != 0 || r.to != 0 {
			into = p.tb[:n*OutChannels]
			clear(into)
		}
		if read {
			p.readHead(into, m, ti)
		} else {
			m.renderTrack(into, ti, pos, n, afterWrap)
		}
		if r.from == 0 && r.to == 0 {
			continue
		}
		for k := 0; k < n; k++ {
			g := 1 - r.value(o+uint64(k), m.declick)
			for c := 0; c < OutChannels; c++ {
				dst[k*OutChannels+c] += into[k*OutChannels+c] * g
			}
		}
	}
}

// modded says whether WOW, FLUTTER or the bend move source h this span.
func (p *perf) modded(h head) bool {
	return p.wfOn || (h.bent && p.bendFilled) || h.bendHold != 0
}

// offsets is what WOW, FLUTTER and the bend add to where source h reads, over
// the span's n frames; nil for nothing.
func (p *perf) offsets(h head, n int) []float64 {
	bent := h.bent && p.bendFilled
	if !p.wfOn && !bent && h.bendHold == 0 {
		return nil
	}
	off := p.off[:n]
	for k := range off {
		d := h.bendHold
		if p.wfOn {
			d += p.wf[k]
		}
		if bent {
			d += p.bendArr[k]
		}
		off[k] = d
	}
	return off
}

// plan works out where the head reads for output frames [o, o+n): the
// positions, and the runs between jumps. The same for every track, so done
// once. A head that's off is the transport, at tape frame pos.
//
// The head's frames are fractional (½× reads half a frame on, STOP fewer
// still, WOW a little either side), so each run is rendered at the tape's
// own frames into scratch and read out with a 4-point Hermite. Where the
// head jumps -- CHOP's seam, a loop's wrap -- the run before carries on past
// it, fading out under the run after, as the renderer crossfades every seam.
//
// A head that's off follows the transport through WOW, FLUTTER or the bend:
// on a pass that began at In rather than coming round to it (afterWrap
// false), it reads the tape before In as the tape, and In without the
// crossfade from what follows Out -- as the plain tape plays it.
func (p *perf) plan(m *Mix, h head, o uint64, n int, from int64, afterWrap bool) {
	pos, lvl := p.pos[:n], p.lvl[:n]
	k0 := int64(o - h.start)
	anchor := from
	if h.on {
		anchor = h.anchor
		for k := 0; k < n; k++ {
			x, l, ok := h.read(k0+int64(k), m.loop)
			if !ok {
				l = 0
			}
			pos[k], lvl[k] = x, l
		}
	} else {
		for k := 0; k < n; k++ {
			pos[k], lvl[k] = float64(from+int64(k)), 1
		}
	}
	p.planOff = p.offsets(h, n)
	round := p.round[:n] // read past Out: come round to In
	clear(round)
	if off := p.planOff; off != nil {
		// Read a little ahead or behind; inside the loop, round it.
		l := m.loop
		wrap := inLoop(l, anchor)
		for k, d := range off {
			if lvl[k] == 0 {
				continue
			}
			x := pos[k] + d
			if wrap && (h.on || afterWrap || x >= float64(l.Out)) {
				round[k] = x >= float64(l.Out)
				x = wrapLoop(x, l, anchor)
			}
			pos[k] = x
		}
	}
	xf := max64(1, m.xfade)
	p.runs = p.runs[:0]
	for k := 0; k < n; {
		if lvl[k] == 0 {
			k++
			continue
		}
		j := k + 1
		for j < n && lvl[j] != 0 && math.Abs(pos[j]-pos[j-1]) <= maxStep {
			j++
		}
		r := run{k: k, j: j, phase: -1, fresh: !h.on && !afterWrap && !round[k]}
		// The last jump into this run, if recent enough to be still
		// crossfading. The transport never jumps but at the loop's seam.
		if kk := k0 + int64(k); h.on {
			if at, from, step, fl, ok := h.lastJump(kk, m.loop, xf); ok {
				r.phase, r.from, r.step, r.level, r.jumped = kk-at, from, step, fl, true
			}
		}
		p.runs = append(p.runs, r)
		k = j
	}
}

// readHead adds track ti along the plan.
func (p *perf) readHead(dst []float32, m *Mix, ti int) {
	xf := max64(1, m.xfade)
	for _, r := range p.runs {
		p.readRun(dst, m, ti, p.pos[r.k:r.j], p.lvl[r.k:r.j], r.k, r.phase, false, r.fresh, xf)
		if !r.jumped {
			continue
		}
		// What it left carries on, fading out, for the rest of the
		// crossfade (as much of it as falls in this run).
		c := int(min64(int64(r.j-r.k), xf-r.phase))
		if c <= 0 {
			continue
		}
		if c > len(p.opos) {
			p.opos, p.olvl = make([]float64, c), make([]float32, c)
		}
		op, ol := p.opos[:c], p.olvl[:c]
		for q := 0; q < c; q++ {
			op[q] = r.from + r.step*float64(r.phase+int64(q)+1)
			if p.planOff != nil {
				op[q] += p.planOff[r.k+q]
			}
			ol[q] = r.level
		}
		p.readRun(dst, m, ti, op, ol, r.k, r.phase, true, false, xf)
	}
}

// lastJump finds where the head last jumped, looking back no further than a
// crossfade from output frame kk (counted from when it left): the frame it
// landed on, the position it left from, the step it was moving at, and its
// level there.
func (h *head) lastJump(kk int64, loop Loop, xf int64) (int64, float64, float64, float32, bool) {
	for j := kk; j >= 1 && j > kk-xf; j-- {
		b, _, bok := h.read(j, loop)
		a, al, aok := h.read(j-1, loop)
		if !aok || !bok || math.Abs(b-a) <= maxStep || wraps(a, b, loop) {
			continue
		}
		step := 1.0
		if z, _, ok := h.read(j-2, loop); ok && math.Abs(a-z) <= maxStep {
			step = a - z
		}
		return j, a, step, al, true
	}
	return 0, 0, 0, 0, false
}

// wraps says whether the head going from a to b is the loop coming round:
// not a jump at all, but the tape carrying on through the loop's seam, which
// the renderer crossfades itself (readRun).
func wraps(a, b float64, l Loop) bool {
	if !l.On || l.Out <= l.In {
		return false
	}
	return math.Abs(math.Abs(b-a)-float64(l.Out-l.In)) <= maxStep
}

// readRun adds track ti read at positions xs (levels ls) into dst from frame
// at on. With phase ≥ 0 the run is phase frames into a crossfade: rising on
// a sine, or -- out -- falling on a cosine.
func (p *perf) readRun(dst []float32, m *Mix, ti int, xs []float64, ls []float32, at int, phase int64, out, fresh bool, xf int64) {
	if len(xs) == 0 {
		return
	}
	lo, hi := xs[0], xs[0]
	for _, x := range xs {
		lo, hi = math.Min(lo, x), math.Max(hi, x)
	}
	first := int64(math.Floor(lo)) - 1
	width := int(int64(math.Floor(hi))+3-first) + 1
	if need := width * OutChannels; len(p.buf) < need {
		p.buf = make([]float32, need)
	}
	buf := p.buf[:width*OutChannels]
	clear(buf)
	l := m.loop
	looped := l.On && l.Out > l.In && lo >= float64(l.In) && hi < float64(l.Out)
	// Inside a loop, reading near In is reading through its seam, so it's
	// rendered as playback renders a wrap: what follows Out fading out as
	// In fades in.
	aw := looped && lo < float64(l.In+m.xfade) && !fresh
	m.renderTrack(buf, ti, first, width, aw)
	if looped {
		// The interpolation's neighbours past Out, or before In, are the
		// loop's other end, as they are when it plays round -- not the tape
		// beyond it, which may be silence.
		if end := first + int64(width); end > l.Out {
			k := end - l.Out
			tail := buf[(l.Out-first)*OutChannels:]
			clear(tail)
			m.renderTrack(tail, ti, l.In, int(k), true)
		}
		if first < l.In {
			k := l.In - first
			head := buf[:k*OutChannels]
			clear(head)
			m.renderTrack(head, ti, l.Out-k, int(k), false)
		}
	}
	ch := m.tracks[ti].bus * 2
	for q, x := range xs {
		g := ls[q]
		if phase >= 0 {
			ph := phase + int64(q)
			if ph < xf {
				w := (float64(ph) + 0.5) / float64(xf)
				if out {
					g *= float32(math.Cos(w * math.Pi / 2))
				} else {
					g *= float32(math.Sin(w * math.Pi / 2))
				}
			} else if out {
				continue
			}
		}
		rel := x - float64(first)
		i := int(math.Floor(rel))
		t := float32(rel - float64(i))
		d := (at + q) * OutChannels
		for c := ch; c < ch+2; c++ {
			y0 := buf[(i-1)*OutChannels+c]
			y1 := buf[i*OutChannels+c]
			y2 := buf[(i+1)*OutChannels+c]
			y3 := buf[(i+2)*OutChannels+c]
			dst[d+c] += hermite(y0, y1, y2, y3, t) * g
		}
	}
}

// renderStraight adds a mixdown's pass for output frames [o, o+n), the tape
// at frame pos: read through WOW and FLUTTER, which are the tape's sound, and
// nothing else -- no trick, no track key, no bend.
func (p *perf) renderStraight(dst []float32, m *Mix, o uint64, n int, pos int64) {
	p.plan(m, head{}, o, n, pos, false)
	for ti := range m.tracks {
		if !m.tracks[ti].silent {
			p.readHead(dst, m, ti)
		}
	}
}

// hermite is the 4-point, third-order Hermite curve through y1 at t = 0 and
// y2 at t = 1: cheap, and smooth enough for tape.
func hermite(y0, y1, y2, y3, t float32) float32 {
	c1 := 0.5 * (y2 - y0)
	c2 := y0 - 2.5*y1 + 2*y2 - 0.5*y3
	c3 := 0.5*(y3-y0) + 1.5*(y1-y2)
	return ((c3*t+c2)*t+c1)*t + y1
}

// ---------------------------------------------------------------------------
// What the page is told.

// TrickEvent is a press or release as it actually sounded: on output frame
// Out, with the transport at tape frame Pos. A punch-in FX's carries its
// amount; a Move is an amount moving (a set, or a mod's preview), not a
// press or a release.
type TrickEvent struct {
	Seq  uint64   `json:"-"`
	Pad  string   `json:"pad"`
	On   bool     `json:"on"`
	Out  uint64   `json:"out"`
	Pos  int64    `json:"pos"`
	V    *float64 `json:"v,omitempty"`
	Move bool     `json:"move,omitempty"`
}

// trickLog keeps the last few events for the pages watching: the render
// goroutine writes them, a page's socket reads what it hasn't seen.
type trickLog struct {
	mu   sync.Mutex
	seq  uint64 // events ever logged
	ring [64]TrickEvent
}

func (e *Engine) logTrick(pad int, on bool, out uint64, pos int64) {
	ev := TrickEvent{Pad: pads[pad], On: on, Out: out, Pos: pos}
	if amountPad(pad) {
		v := e.perf.amount[pad]
		ev.V = &v
	}
	e.logEvent(ev)
}

func (e *Engine) logEvent(ev TrickEvent) {
	e.trickLog.add(ev)
	e.heldPads.Store(e.perf.heldMask())
}

func (l *trickLog) add(ev TrickEvent) {
	l.mu.Lock()
	l.seq++
	ev.Seq = l.seq
	l.ring[l.seq%uint64(len(l.ring))] = ev
	l.mu.Unlock()
}

// since is every event after seq still kept, oldest first, and the
// sequence to ask from next time.
func (l *trickLog) since(seq uint64) ([]TrickEvent, uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	last := l.seq
	if seq >= last {
		return nil, last
	}
	from := seq + 1
	if n := uint64(len(l.ring)); last-seq > n {
		from = last - n + 1
	}
	out := make([]TrickEvent, 0, last-from+1)
	for s := from; s <= last; s++ {
		out = append(out, l.ring[s%uint64(len(l.ring))])
	}
	return out, last
}

// TrickEventsSince is every press and release after seq still kept, oldest
// first, and the sequence to ask from next time. A reader that fell more
// than the log's length behind gets what's left.
func (e *Engine) TrickEventsSince(seq uint64) ([]TrickEvent, uint64) { return e.trickLog.since(seq) }

// MovesSince is every amount moved after seq still kept (its own sequence),
// oldest first: kept apart from the presses and releases, so a knob turning
// can't push one out before a page has seen it.
func (e *Engine) MovesSince(seq uint64) ([]TrickEvent, uint64) { return e.moveLog.since(seq) }

// resetTricks forgets everything held, and says so to Live.
func (e *Engine) resetTricks() {
	e.perf.reset()
	e.heldPads.Store(0)
}

// HeldPads is what's held now, by name.
func (e *Engine) HeldPads() []string {
	m := e.heldPads.Load()
	var out []string
	for i, p := range pads {
		if m&(1<<i) != 0 {
			out = append(out, p)
		}
	}
	return out
}

// HeardIn is how long from now output frame o will be heard; false with no
// output to hear it on.
func (e *Engine) HeardIn(o uint64) (time.Duration, bool) {
	if e.sink == nil {
		return 0, false
	}
	at, ok := e.heardAt(o)
	if !ok {
		return 0, false
	}
	return time.Duration(at - mono.Now()), true
}

// TrickLead is how long a press takes to be heard at best: the render head's
// frame, from now -- the blocks rendered ahead and the device's own latency.
// The page draws a pad's armed moment that much before its grid line.
func (e *Engine) TrickLead() (time.Duration, bool) {
	return e.HeardIn(e.tr.Status().Out)
}
