package tape

import (
	"errors"
	"log"
	"math"
	"sync"
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
)

// pads in index order: the track keys, then the pads that move the head.
var pads = [...]string{PadTrack1, PadTrack2, PadTrack3, PadTrack4,
	PadBreak, PadReverse, PadChop, PadStop, PadHalf, PadDouble}

const (
	trackPads = 4
	numPads   = len(pads)
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

// trickMsg is a press or a release on its way to the render goroutine.
type trickMsg struct {
	pad     int // index into pads
	press   bool
	all     bool   // a release of every pad
	quantum string // when it lands
}

// trickInbox is where Press, Release and ReleaseAll leave their messages for
// the render goroutine's next drain.
type trickInbox struct {
	mu   sync.Mutex
	msgs []trickMsg
}

// Press holds a pad down from the next line of quantum -- now, 16th, 8th,
// beat or bar. A track key drops its track out; a trick pad moves the head.
func (e *Engine) Press(pad, quantum string) error {
	i := padIndex(pad)
	if i < 0 {
		return ErrNoSuchPad
	}
	q, err := trickQuantum(quantum)
	if err != nil {
		return err
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
	e.tricks.msgs = append(e.tricks.msgs, trickMsg{pad: i, press: true, quantum: q})
	e.tricks.mu.Unlock()
	e.wake()
	return nil
}

// Release lets a pad go, on the next line of the quantum it was pressed with
// and never before it has sounded for one whole line.
func (e *Engine) Release(pad string) error {
	i := padIndex(pad)
	if i < 0 {
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
		if w.all != m.all || (!m.all && w.pad != m.pad) {
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
			at := e.tr.target(Action{Quantum: msg.quantum}, out, m, m.grid)
			p.down[msg.pad], p.quantum[msg.pad], p.pressAt[msg.pad] = true, msg.quantum, at
			e.tr.queue(pending{at: at, action: Action{Kind: "trick", trick: &trickMsg{pad: msg.pad, press: true}}})
		default:
			if p.down[msg.pad] {
				e.queueRelease(msg.pad, p.quantum[msg.pad], out, m)
			}
		}
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

	// Scratch, made once.
	a, b, tb, buf []float32
	pos, opos     []float64
	lvl, olvl     []float32
	runs          []run
}

// run is a stretch of output frames [k, j) the head reads without a jump,
// and, if a jump landed on it within a crossfade, what it left.
type run struct {
	k, j   int
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

// head is where a trick reads the tape from.
type head struct {
	on     bool
	pad    int
	anchor int64   // the tape frame it left the transport at
	start  uint64  // the output frame it left at
	beat   float64 // frames in a beat: STOP's wind-down
	slice  int64   // CHOP's length
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
		from := max64(0, h.anchor-h.slice)
		return float64(from + k%h.slice), 1, true
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
	if !l.On || l.Out <= l.In || anchor < l.In || anchor >= l.Out {
		return p
	}
	in, n := float64(l.In), float64(l.Out-l.In)
	return in + math.Mod(math.Mod(p-in, n)+n, n)
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
// transport at tape frame pos.
func (p *perf) apply(msg trickMsg, o uint64, pos int64, playing bool, m *Mix) {
	i := msg.pad
	if i < 0 || i >= numPads {
		return
	}
	if msg.press {
		if p.held[i] {
			return
		}
		p.held[i] = true
		if i < trackPads {
			p.setCut(i, 1, o, m)
			return
		}
		p.order = append(p.order, i)
		if playing {
			p.engage(i, pos, o, m)
		}
		return
	}
	if !p.held[i] {
		return
	}
	p.held[i] = false
	if i < trackPads {
		p.setCut(i, 0, o, m)
		return
	}
	was := p.top()
	for j, x := range p.order {
		if x == i {
			p.order = append(p.order[:j], p.order[j+1:]...)
			break
		}
	}
	if was != i || !p.head.on {
		return // one held underneath let go: what's heard doesn't change
	}
	if t := p.top(); t >= 0 {
		p.engage(t, pos, o, m)
	} else {
		p.fade = sourceFade{on: true, start: o, prev: p.head}
		p.head.on = false
	}
}

// engage moves the head to pad from the transport's position, crossfading
// from whatever was heard.
func (p *perf) engage(pad int, pos int64, o uint64, m *Mix) {
	p.fade = sourceFade{on: true, start: o, prev: p.head}
	p.head = p.newHead(pad, pos, o, m)
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

// reset forgets everything held: a new tape, or the transport reset.
func (p *perf) reset() {
	keep := perf{a: p.a, b: p.b, tb: p.tb, buf: p.buf, pos: p.pos, opos: p.opos, lvl: p.lvl, olvl: p.olvl, runs: p.runs}
	*p = keep
}

// active says whether anything here changes what's heard from output frame
// o: when nothing is, the renderer takes its usual path untouched.
func (p *perf) active(o uint64, m *Mix) bool {
	if p.head.on || p.fade.on {
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
}

// render adds what the room hears for output frames [o, o+n), with the
// transport at tape frame pos: the transport or the head, each track at its
// track key's level, crossfading where the source just changed.
func (p *perf) render(dst []float32, m *Mix, o uint64, n int, pos int64, afterWrap bool) {
	p.ensure(n, m)
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
// -- track by track, each at its track key's level.
func (p *perf) source(dst []float32, m *Mix, h head, o uint64, n int, pos int64, afterWrap bool) {
	if h.on {
		p.plan(m, h, o, n)
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
		if h.on {
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

// plan works out where the head reads for output frames [o, o+n): the
// positions, and the runs between jumps. The same for every track, so done
// once.
//
// The head's frames are fractional (½× reads half a frame on, STOP fewer
// still), so each run is rendered at the tape's own frames into scratch and
// read out with a 4-point Hermite. Where the head jumps -- CHOP's seam, a
// loop's wrap -- the run before carries on past it, fading out under the run
// after, as the renderer crossfades every seam.
func (p *perf) plan(m *Mix, h head, o uint64, n int) {
	pos, lvl := p.pos[:n], p.lvl[:n]
	k0 := int64(o - h.start)
	for k := 0; k < n; k++ {
		x, l, ok := h.read(k0+int64(k), m.loop)
		if !ok {
			l = 0
		}
		pos[k], lvl[k] = x, l
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
		r := run{k: k, j: j, phase: -1}
		// The last jump into this run, if recent enough to be still
		// crossfading.
		kk := k0 + int64(k)
		if at, from, step, fl, ok := h.lastJump(kk, m.loop, xf); ok {
			r.phase, r.from, r.step, r.level, r.jumped = kk-at, from, step, fl, true
		}
		p.runs = append(p.runs, r)
		k = j
	}
}

// readHead adds track ti along the plan.
func (p *perf) readHead(dst []float32, m *Mix, ti int) {
	xf := max64(1, m.xfade)
	for _, r := range p.runs {
		p.readRun(dst, m, ti, p.pos[r.k:r.j], p.lvl[r.k:r.j], r.k, r.phase, false, xf)
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
			ol[q] = r.level
		}
		p.readRun(dst, m, ti, op, ol, r.k, r.phase, true, xf)
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
		if !aok || !bok || math.Abs(b-a) <= maxStep {
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

// readRun adds track ti read at positions xs (levels ls) into dst from frame
// at on. With phase ≥ 0 the run is phase frames into a crossfade: rising on
// a sine, or -- out -- falling on a cosine.
func (p *perf) readRun(dst []float32, m *Mix, ti int, xs []float64, ls []float32, at int, phase int64, out bool, xf int64) {
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
	m.renderTrack(buf, ti, first, width, false)
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

// hermite is the 4-point, third-order Hermite curve through y1 at t = 0 and
// y2 at t = 1: cheap, and smooth enough for tape.
func hermite(y0, y1, y2, y3, t float32) float32 {
	c1 := 0.5 * (y2 - y0)
	c2 := y0 - 2.5*y1 + 2*y2 - 0.5*y3
	c3 := 0.5*(y3-y0) + 1.5*(y1-y2)
	return ((c3*t+c2)*t+c1)*t + y1
}
