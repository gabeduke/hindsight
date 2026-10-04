package tape

import (
	"errors"
	"fmt"
	"log"
	"math"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The engine: one loaded tape, its mix, the transport, and the player that
// hands rendered blocks to the output device.
//
// Three goroutines touch it. API calls edit the model under mu and swap in a
// new Mix; the render goroutine owns the transport and keeps a few blocks
// rendered ahead; the device's callback (Sink.Open's pull) takes blocks and
// never blocks or allocates. If the tape falls over, it recovers its own
// panics: the dashcam keeps rolling.

const (
	// BlockFrames is what the renderer renders at a time: 21 ms.
	BlockFrames = 1024
	// aheadBlocks is how far ahead of the device it keeps: 107 ms.
	aheadBlocks = 5
)

var (
	ErrNoTape    = errors.New("no tape is loaded")
	ErrWrongTape = errors.New("that tape isn't the loaded one")
	ErrNotYet    = errors.New("that isn't in the buffer yet")
	ErrGone      = errors.New("that is no longer in the buffer")
	ErrNoPass    = errors.New("no complete pass of the loop to catch")
	ErrNoCapture = errors.New("there's no capture to catch from")
	ErrNotLined  = errors.New("the tape's output isn't lined up with the capture yet")
	ErrNotPlayed = errors.New("the tape didn't play those bars")
	ErrSlipped   = errors.New("the output slipped against the recording during that span; catch a later one")
)

// Source is a named capture pair the tape can catch from, with the buses that
// leak into it.
type Source struct {
	Name  string
	Pair  [2]int   // zero-based capture channels
	Leaks []string // buses heard in it
}

// DefaultSources is the Sidekick map: MAIN carries both buses, each CH tap
// its strip's bus, and AUX neither.
var DefaultSources = []Source{
	{Name: "main", Pair: [2]int{0, 1}, Leaks: []string{BusA, BusB}},
	{Name: "ch1", Pair: [2]int{2, 3}, Leaks: []string{BusA}},
	{Name: "ch2", Pair: [2]int{4, 5}, Leaks: []string{BusB}},
	{Name: "aux", Pair: [2]int{6, 7}},
}

// Capture is what the engine needs of the dashcam: its ring.
type Capture interface {
	Ring() *audio.Ring
}

// Options configures an engine.
type Options struct {
	Store   *Store
	Capture Capture // nil: nothing to catch from
	Sink    audio.Sink
	Sources []Source
	// MinFreeGB guards catches and drops as it guards saves, on the tapes'
	// own volume.
	MinFreeGB float64
	// LatencyMS takes every catch this much later in the recording
	// (TAPE_LATENCY_MS): for hearing the tape later than the instrument,
	// which makes a part land that much late.
	LatencyMS float64
	// Saver saves a mixdown as a take, in TakesDir; nil: no mixdowns.
	Saver    TakeSaver
	TakesDir string
	// MixdownTail is how many seconds a mixdown runs past Out
	// (TAPE_MIXDOWN_TAIL_S); 0 is DefaultMixdownTail.
	MixdownTail float64
}

type block struct {
	start uint64 // its first output frame
	data  []int32
}

// Engine runs one tape.
type Engine struct {
	store     *Store
	pool      *Pool
	capture   Capture
	sink      audio.Sink
	sources   []Source
	minFreeGB float64

	mu   sync.Mutex // the model: the loaded tape
	tape *Tape

	rebuildMu sync.Mutex // one mix built at a time, so the newest is stored last

	mix     atomic.Pointer[Mix]
	tr      *transport
	actions chan Action

	// player
	blocks    chan *block
	free      chan *block
	kick      chan struct{}
	cur       *block
	off       int
	delivered atomic.Uint64 // output frames handed to the device
	late      atomic.Uint64 // blocks delivered as silence because none was ready
	sinkBase  atomic.Int64  // engine output frame where the sink's own count began
	sinkName  string

	stop     chan struct{}
	done     chan struct{}
	started  atomic.Bool
	panicked atomic.Value // string: the last recovered panic

	latencyMS   float64
	saver       TakeSaver
	takesDir    string
	tailSeconds float64

	mixMu   sync.Mutex
	mixdown *Mixdown // the last mixdown

	recMu sync.Mutex
	rec   *Recording // a punch, or an armed track
	tap   *pendingTap

	// What each bus delivered, for the aligner (nil when the output knows
	// its own Δ), and the output frame after the newest.
	hist    [2][]atomic.Int32
	histEnd atomic.Uint64
	align   aligner
}

// NewEngine makes an engine with nothing loaded.
func NewEngine(o Options) *Engine {
	src := o.Sources
	if len(src) == 0 {
		src = DefaultSources
	}
	e := &Engine{
		store:     o.Store,
		pool:      NewPool(o.Store),
		capture:   o.Capture,
		sink:      o.Sink,
		sources:   src,
		minFreeGB: o.MinFreeGB,
		latencyMS: o.LatencyMS,
		saver:     o.Saver,
		takesDir:  o.TakesDir,
		tr:        newTransport(),
		actions:   make(chan Action, 32),
		blocks:    make(chan *block, aheadBlocks+3),
		free:      make(chan *block, aheadBlocks+3),
		kick:      make(chan struct{}, 1),
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	e.tailSeconds = o.MixdownTail
	if e.tailSeconds <= 0 {
		e.tailSeconds = DefaultMixdownTail
	}
	e.mix.Store(&Mix{})
	e.panicked.Store("")
	return e
}

// Start opens the output and starts rendering. Without a sink, nothing
// plays and the transport stands still, but tapes can still be edited and
// caught onto.
//
// If the output won't open, the engine runs without one, and says why.
func (e *Engine) Start() error {
	var err error
	if e.sink != nil {
		if _, ok := e.sink.(outputSink); ok {
			e.hist[0] = make([]atomic.Int32, histFrames)
			e.hist[1] = make([]atomic.Int32, histFrames)
		}
		// The device may pull the moment it's open.
		e.sinkBase.Store(int64(e.delivered.Load()))
		name, oerr := e.sink.Open(OutChannels, e.pull)
		if oerr != nil {
			e.sink = nil
			err = fmt.Errorf("tape output: %w", oerr)
		} else {
			e.sinkName = name
			if name != "" {
				log.Printf("[*] tape output on %q", name)
			} else {
				log.Printf("[!] tape output: waiting for the device")
			}
		}
	}
	e.started.Store(true)
	go e.renderLoop()
	e.startAligner()
	return err
}

// Stop closes the output and stops rendering.
func (e *Engine) Stop() {
	select {
	case <-e.stop:
		return
	default:
	}
	close(e.stop)
	if e.sink != nil && e.started.Load() {
		e.sink.Close()
	}
	if e.started.Load() {
		<-e.done
	}
}

// pull is the device's callback: copy what's rendered, or silence. It never
// blocks and, once warm, never allocates.
func (e *Engine) pull(out []int32) {
	// It runs on the device's thread -- in the demo, the capture's: a bug
	// here plays silence rather than taking the recording down.
	start := e.delivered.Load()
	defer func() {
		if p := recover(); p != nil {
			clear(out)
			e.cur = nil
			e.delivered.Store(start + uint64(len(out)/OutChannels)) // the tape counts on
			e.panicked.Store(fmt.Sprint(p))
		}
	}()
	need := len(out) / OutChannels
	o := 0
	d := start
	for need > 0 {
		if e.cur == nil {
			select {
			case b := <-e.blocks:
				e.cur, e.off = b, 0
			default:
			}
			if e.cur == nil {
				clear(out[o*OutChannels:])
				e.late.Add(1)
				d += uint64(need)
				break
			}
		}
		at := e.cur.start + uint64(e.off)
		switch {
		case at < d: // rendered for a moment already played as silence
			skip := int(min64(int64(d-at), int64(BlockFrames-e.off)))
			e.off += skip
		case at > d: // a gap: silence until it starts
			k := int(min64(int64(at-d), int64(need)))
			clear(out[o*OutChannels : (o+k)*OutChannels])
			o, d, need = o+k, d+uint64(k), need-k
		default:
			k := min(need, BlockFrames-e.off)
			copy(out[o*OutChannels:(o+k)*OutChannels], e.cur.data[e.off*OutChannels:(e.off+k)*OutChannels])
			o, d, need, e.off = o+k, d+uint64(k), need-k, e.off+k
		}
		if e.off >= BlockFrames {
			select {
			case e.free <- e.cur:
			default:
			}
			e.cur = nil
		}
	}
	e.keepHistory(start, out)
	e.delivered.Store(d)
	select {
	case e.kick <- struct{}{}:
	default:
	}
}

// renderLoop keeps aheadBlocks rendered ahead of the device.
func (e *Engine) renderLoop() {
	defer close(e.done)
	// What the device played before the renderer was running isn't late.
	e.late.Store(0)
	var out uint64 // the next output frame to render
	fbuf := make([]float32, BlockFrames*OutChannels)
	for {
		select {
		case <-e.stop:
			return
		default:
		}
		d := e.delivered.Load()
		if out < d {
			// The device played silence where these would have gone (a
			// late render): the tape counts on through it.
			e.safely(func() { e.advance(nil, out, int(d-out)) })
			out = d
		}
		if e.sink == nil {
			e.safely(func() { e.idle(out) })
		} else if out-d >= aheadBlocks*BlockFrames {
			// Far enough ahead to wait -- but not to leave a load waiting
			// on a device that isn't pulling.
			e.safely(func() { e.drain(out, e.mix.Load()) })
		}
		if out-d >= aheadBlocks*BlockFrames || e.sink == nil {
			select {
			case <-e.stop:
				return
			case <-e.kick:
			case <-time.After(10 * time.Millisecond):
			}
			continue
		}
		var b *block
		select {
		case b = <-e.free:
		default:
			b = &block{data: make([]int32, BlockFrames*OutChannels)}
		}
		clear(fbuf)
		start := out
		e.safely(func() { e.advance(fbuf, start, BlockFrames) })
		ToInt32(b.data, fbuf)
		b.start = out
		out += BlockFrames
		select {
		case e.blocks <- b:
		case <-e.stop:
			return
		}
	}
}

// safely runs a render step, recovering a panic: a bug in the tape plays
// silence and says so; it never takes the process -- the ring -- with it.
func (e *Engine) safely(f func()) {
	defer func() {
		if p := recover(); p != nil {
			msg := fmt.Sprint(p)
			e.panicked.Store(msg)
			log.Printf("[!] tape: render panicked: %v\n%s", p, debug.Stack())
		}
	}()
	f()
}

// advance moves the transport n output frames from out, rendering into dst
// (nil: just count), applying queued actions on their frames and wrapping
// at the loop's end.
func (e *Engine) advance(dst []float32, out uint64, n int) {
	tr := e.tr
	m := e.mix.Load()
	length := m.length
	e.drain(out, m)
	off := 0
	for n > 0 {
		for len(tr.pend) > 0 && tr.pend[0].at <= out {
			a := tr.pend[0].action
			tr.apply(a, out, m, length)
			tr.pend = tr.pend[1:]
			if a.done != nil {
				close(a.done)
			}
		}
		span := int64(n)
		if len(tr.pend) > 0 {
			span = min64(span, int64(tr.pend[0].at-out))
		}
		if !tr.playing && tr.countIn > 0 {
			// The count-in: a bar of click with the tape standing, then
			// play from there.
			span = min64(span, tr.countIn)
			if dst != nil {
				m.renderCountIn(dst[off*OutChannels:], tr.countLen-tr.countIn, int(span))
			}
			tr.countIn -= span
			if tr.countIn == 0 {
				at := out + uint64(span)
				tr.playing = true
				tr.cycleStart = -1
				if m.loop.On && tr.pos == m.loop.In {
					tr.cycleStart, tr.cycleIn = int64(at), m.loop.In
				}
				tr.record(at)
			}
		} else if tr.playing && tr.onceEnd > 0 {
			// A mixdown's pass: In to Out once, no loop, no click, with a
			// declick where it starts and stops; then the tape stands.
			end := min64(tr.onceEnd, length)
			if tr.pos >= end {
				tr.playing = false
				tr.record(out)
				tr.endOnce(out)
				continue
			}
			span = min64(span, end-tr.pos)
			if dst != nil {
				d := dst[off*OutChannels:]
				m.renderTape(d, tr.pos, int(span), false)
				m.declickEdges(d, tr.pos, int(span), tr.onceFrom, end)
			}
			tr.pos += span
		} else if tr.playing {
			looping := m.loop.On && tr.pos < m.loop.Out
			if looping {
				span = min64(span, m.loop.Out-tr.pos)
			} else {
				end := min64(m.end, length)
				if tr.pos >= end {
					tr.playing = false
					tr.cycleStart = -1
					tr.record(out)
					continue
				}
				span = min64(span, end-tr.pos)
			}
			if dst != nil {
				m.render(dst[off*OutChannels:], tr.pos, int(span), tr.sinceWrap(out, m.loop))
			}
			tr.pos += span
			if looping && tr.pos == m.loop.Out {
				at := out + uint64(span)
				// A whole pass: from this loop's In to its Out without a
				// break. One begun under another loop (an edit moved In or
				// Out mid-pass) isn't one, and isn't logged.
				if tr.cycleStart >= 0 && tr.cycleIn == m.loop.In && int64(at)-tr.cycleStart == m.loop.Len() {
					tr.logCycle(Cycle{Out: uint64(tr.cycleStart), In: m.loop.In, Len: m.loop.Len()})
				}
				tr.pos = m.loop.In
				tr.cycleStart, tr.cycleIn = int64(at), m.loop.In
				tr.wrapped, tr.wrapOut, tr.wrapIn = true, at, m.loop.In
				tr.recordWrap(at)
			}
		}
		out += uint64(span)
		off += int(span)
		n -= int(span)
	}
	tr.mu.Lock()
	tr.view = Status{Playing: tr.playing, Pos: tr.pos, Out: out, Pending: len(tr.pend), CountIn: tr.countIn}
	tr.mu.Unlock()
}

// drain takes what's been asked of the transport, with the render head at
// out: a reset at once, anything else queued for its frame.
func (e *Engine) drain(out uint64, m *Mix) {
	tr := e.tr
	for {
		select {
		case a := <-e.actions:
			if a.Kind == "reset" {
				tr.reset(out)
				close(a.done)
				continue
			}
			tr.queue(pending{at: tr.target(a, out, m, m.grid), action: a})
			continue
		default:
		}
		return
	}
}

// idle applies queued actions when nothing plays the tape: without an
// output it can be located, but not played.
func (e *Engine) idle(out uint64) {
	tr := e.tr
	m := e.mix.Load()
	for {
		select {
		case a := <-e.actions:
			switch a.Kind {
			case "reset":
				tr.reset(out)
				close(a.done)
			case "play", "once": // nothing plays it
			default:
				tr.apply(a, out, m, m.length)
			}
			if a.done != nil && a.Kind != "reset" {
				close(a.done)
			}
			continue
		default:
		}
		break
	}
	tr.mu.Lock()
	tr.view = Status{Playing: tr.playing, Pos: tr.pos, Out: out}
	tr.mu.Unlock()
}

// HasOutput reports whether anything plays the tape.
func (e *Engine) HasOutput() bool { return e.sink != nil }

// --- the model ----------------------------------------------------------------

// Load makes a tape the loaded one, stopped at its start.
func (e *Engine) Load(id string) (*Tape, error) {
	t, err := e.store.Load(id)
	if err != nil {
		return nil, err
	}
	// Stop the last tape, and forget its passes, before this one can play.
	// A punch or a tap was for the last one too.
	e.reset()
	e.mu.Lock()
	e.tape = t
	e.mu.Unlock()
	// After the switch: a Record or Tap checks the tape under recMu, so one
	// racing this either sees the new tape or is cleared here.
	e.recMu.Lock()
	e.rec, e.tap = nil, nil
	e.recMu.Unlock()
	if err := e.store.Remember(id); err != nil {
		log.Printf("[!] tape: noting %s as loaded: %v", id, err)
	}
	e.rebuild()
	e.Do(Action{Kind: "locate", Pos: t.Loop.In})
	return t, nil
}

// reset stops the transport, drops its queue and forgets its passes, and
// waits until that's done: the render goroutine owns the transport, so it
// does it, between two blocks.
func (e *Engine) reset() {
	select {
	case <-e.stop:
		return
	default:
	}
	if !e.started.Load() {
		e.tr.reset(e.delivered.Load())
		return
	}
	done := make(chan struct{})
	select {
	case e.actions <- Action{Kind: "reset", done: done}:
	case <-time.After(time.Second):
		log.Printf("[!] tape: the transport queue is stuck; loading anyway")
		return
	}
	select {
	case <-done:
	case <-e.stop:
	case <-time.After(2 * time.Second):
		log.Printf("[!] tape: the transport didn't answer; loading anyway")
	}
}

// Loaded is a copy of the loaded tape, or nil.
func (e *Engine) Loaded() *Tape {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.tape == nil {
		return nil
	}
	c := *e.tape
	c.State = e.tape.State.clone()
	c.History, c.Future = nil, nil
	return &c
}

// UndoDepth is how many steps undo and redo have.
func (e *Engine) UndoDepth() (undo, redo int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.tape == nil {
		return 0, 0
	}
	return len(e.tape.History), len(e.tape.Future)
}

// rebuild makes the mix the render goroutine plays from the loaded tape.
// Rebuilds take turns, each from the tape as it is when its turn comes, so
// the last one stored is always the newest.
func (e *Engine) rebuild() {
	e.rebuildMu.Lock()
	defer e.rebuildMu.Unlock()
	e.mu.Lock()
	var st State
	var id string
	var length int64
	var click bool
	keep := map[string]bool{}
	if t := e.tape; t != nil {
		st, id, length, click = t.State.clone(), t.ID, t.Length, t.Click
		// Keep what one undo or redo would play, so it's heard at once.
		st.files(keep)
		if n := len(t.History); n > 0 {
			t.History[n-1].files(keep)
		}
		if n := len(t.Future); n > 0 {
			t.Future[n-1].files(keep)
		}
	}
	e.mu.Unlock()
	m := NewMix(st, e.pool, e.store.SampleRate())
	m.tapeID, m.length, m.click = id, length, click
	e.mix.Store(m)
	e.pool.Keep(keep)
}

// Edit changes the loaded tape (which must be id) as one undo step, saves it
// and plays the result.
func (e *Engine) Edit(id, kind string, fn func(t *Tape, s *State) error) error {
	e.mu.Lock()
	if e.tape == nil {
		e.mu.Unlock()
		return ErrNoTape
	}
	if e.tape.ID != id {
		e.mu.Unlock()
		return ErrWrongTape
	}
	t := e.tape.draft()
	err := t.Change(kind, time.Now(), func(s *State) error { return fn(t, s) })
	if err == nil {
		err = e.store.Save(t)
	}
	if err == nil {
		e.tape = t
	}
	e.mu.Unlock()
	if err != nil {
		return err
	}
	e.rebuild()
	return nil
}

// Undo and Redo step the loaded tape.
func (e *Engine) Undo(id string, redo bool) error {
	e.mu.Lock()
	if e.tape == nil || e.tape.ID != id {
		e.mu.Unlock()
		return ErrWrongTape
	}
	t := e.tape.draft()
	var err error
	if redo {
		err = t.Redo()
	} else {
		err = t.Undo()
	}
	if err == nil {
		err = e.store.Save(t)
	}
	if err == nil {
		e.tape = t
	}
	e.mu.Unlock()
	if err == nil {
		e.rebuild()
	}
	return err
}

// doWait queues an action and waits, briefly, until it's carried out: for
// a caller whose answer depends on it.
func (e *Engine) doWait(a Action) {
	if !e.started.Load() {
		e.Do(a)
		return
	}
	done := make(chan struct{})
	a.done = done
	e.Do(a)
	select {
	case <-done:
	case <-e.stop:
	case <-time.After(500 * time.Millisecond):
	}
}

// Do queues a transport action; the render goroutine carries it out on its
// quantum's next boundary.
func (e *Engine) Do(a Action) {
	select {
	case e.actions <- a:
	default:
		log.Printf("[!] tape: transport queue full, %q dropped", a.Kind)
	}
}

// Live is what the page shows.
type Live struct {
	Status
	Heard     int64      `json:"heard"`     // the tape frame at the device now
	Delivered uint64     `json:"delivered"` // output frames played
	Late      uint64     `json:"late"`      // device periods with nothing rendered, played as silence
	Output    string     `json:"output"`    // the output device, or ""
	Delta     *int64     `json:"delta"`     // ring frame − output frame, if known
	Aligned   string     `json:"aligned"`   // exact (the demo), locked, estimated or none
	Cycles    []Cycle    `json:"cycles"`    // the last complete passes
	Failed    []string   `json:"failed"`    // pool files that couldn't be read
	Problem   string     `json:"problem,omitempty"`
	Record    *Recording `json:"record,omitempty"`  // a punch, or an armed track
	Tapped    bool       `json:"tapped,omitempty"`  // a free loop's first tap is in
	Mixdown   *Mixdown   `json:"mixdown,omitempty"` // the last mixdown
}

func (e *Engine) Live() Live {
	l := Live{Status: e.tr.Status(), Delivered: e.delivered.Load(), Late: e.late.Load(), Output: e.sinkName,
		Failed: e.pool.Failed(), Problem: e.panicked.Load().(string)}
	if n, ok := e.sink.(interface{ Name() string }); ok && e.sink != nil {
		l.Output = n.Name() // "" while the device is away
	}
	if p, ok := e.tr.PosAt(l.Delivered); ok {
		l.Heard = p
	} else {
		l.Heard = l.Pos
	}
	if d, how := e.delta(); how != "none" {
		l.Delta = &d
		l.Aligned = how
	} else {
		l.Aligned = "none"
	}
	l.Record = e.Recording()
	l.Tapped = e.tapPending()
	l.Mixdown = e.MixdownStatus()
	l.Cycles = e.tr.Cycles()
	if l.Cycles == nil {
		l.Cycles = []Cycle{}
	}
	if l.Failed == nil {
		l.Failed = []string{}
	}
	return l
}

// --- catching -----------------------------------------------------------------

// CatchRequest names what to catch and where it goes.
type CatchRequest struct {
	Track  int    `json:"track"`
	Source string `json:"source"`
	Pass   int    `json:"pass"` // 1 is the last complete pass of the loop, 2 the one before
	// Out names a pass by the output frame it began at (a cycle's out), so
	// a tap means the pass that was on screen even if another has finished
	// since. It wins over Pass.
	Out     *uint64 `json:"out,omitempty"`
	Bars    int     `json:"bars"`    // or: the last this many bars
	Replace bool    `json:"replace"` // clear what's under it instead of layering
}

func (e *Engine) source(name string) (Source, bool) {
	for _, s := range e.sources {
		if s.Name == name {
			return s, true
		}
	}
	return Source{}, false
}

// Catch puts a span the tape just played over -- a pass of the loop, or the
// last N bars -- from a capture source onto a track: the range of the ring
// that heard it, written once to the pool, placed where it was played.
func (e *Engine) Catch(id string, req CatchRequest) (Clip, error) {
	if e.capture == nil {
		return Clip{}, ErrNoCapture
	}
	src, ok := e.source(req.Source)
	if !ok {
		return Clip{}, fmt.Errorf("%w: no source %q", ErrBadParameter, req.Source)
	}
	t := e.Loaded()
	if t == nil {
		return Clip{}, ErrNoTape
	}
	if t.ID != id {
		return Clip{}, ErrWrongTape
	}
	if _, err := t.Track(req.Track); err != nil {
		return Clip{}, err
	}
	delta, aligned := e.delta()
	if aligned == "none" {
		return Clip{}, ErrNotLined
	}

	// Which output frames, and where on the tape.
	var outFrom uint64
	var frames, at int64
	switch {
	case req.Out != nil:
		found := false
		for _, c := range e.tr.Cycles() {
			if c.Out == *req.Out {
				outFrom, frames, at, found = c.Out, c.Len, c.In, true
			}
		}
		if !found {
			return Clip{}, fmt.Errorf("%w: that pass is no longer kept", ErrNoPass)
		}
	case req.Pass > 0:
		cyc := e.tr.Cycles()
		if req.Pass > len(cyc) {
			return Clip{}, ErrNoPass
		}
		c := cyc[len(cyc)-req.Pass]
		outFrom, frames, at = c.Out, c.Len, c.In
	case req.Bars > 0:
		if t.Grid == nil {
			return Clip{}, ErrNoGrid
		}
		var err error
		outFrom, frames, at, err = e.lastBars(t, req.Bars, delta)
		if err != nil {
			return Clip{}, err
		}
	default:
		return Clip{}, fmt.Errorf("%w: catch a pass or some bars", ErrBadParameter)
	}
	placed, err := e.catchSpan(t, src, outFrom, frames, at, func(s *State, c Clip) ([]Clip, error) {
		return placeWrapped(s, req.Track, c, req.Replace)
	})
	if err != nil {
		return Clip{}, err
	}
	return placed[0], nil
}

// catchSpan copies what a source heard while the tape played output frames
// [outFrom, outFrom+frames) into the pool, as one clip that starts at tape
// frame at, and has place put it on the tape -- split where it was played,
// if it wrapped.
func (e *Engine) catchSpan(t *Tape, src Source, outFrom uint64, frames, at int64, place func(*State, Clip) ([]Clip, error)) ([]Clip, error) {
	id := t.ID
	if frames <= 0 {
		return nil, fmt.Errorf("%w: nothing to keep", ErrNotPlayed)
	}
	sr := int64(e.store.SampleRate())
	over := int64(OverhangSeconds * float64(sr))
	// The Δ that held when the span played, and any latency set by hand. A
	// span with a slip inside it has no one Δ.
	if e.segAt(outFrom) != e.segAt(outFrom+uint64(frames)-1) {
		return nil, ErrSlipped
	}
	delta, aligned := e.deltaAt(outFrom)
	if aligned == "none" {
		return nil, ErrNotLined
	}
	delta += int64(math.Round(e.latencyMS * float64(sr) / 1000))
	ringFrom := int64(outFrom) + delta - over
	ringTo := int64(outFrom) + frames + delta + over
	ring := e.capture.Ring()
	// The span is behind real time by the output and capture pipelines; wait
	// for it to reach the ring.
	for tries := 0; ; tries++ {
		oldest, total := ring.Window()
		if ringFrom < int64(oldest) {
			return nil, ErrGone
		}
		if ringTo <= int64(total) {
			break
		}
		if tries >= 100 {
			return nil, ErrNotYet
		}
		time.Sleep(20 * time.Millisecond)
	}

	if e.minFreeGB > 0 {
		if free, _ := audio.FreeGB(e.store.Dir()); free < e.minFreeGB {
			return nil, fmt.Errorf("%w: %.2f GB free where the tapes are, need %.2f GB", audio.ErrLowDisk, free, e.minFreeGB)
		}
	}
	rel, path, err := e.store.NewPoolFile("catch", time.Now())
	if err != nil {
		return nil, err
	}
	if err := audio.WriteSpan(ring, uint64(ringFrom), uint64(ringTo), src.Pair[:], path, int(sr)); err != nil {
		return nil, err
	}
	clean := true
	for _, b := range src.Leaks {
		for _, tr := range t.Tracks {
			if tr.Bus == b && len(tr.Clips) > 0 && !tr.Mute {
				clean = false
			}
		}
	}
	clip := Clip{File: rel, Src: over, Frames: frames, At: at, Source: src.Name, Clean: clean, Aligned: aligned}
	var placed []Clip
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		if tp.Empty() {
			tp.Click = false // the click is for a tape with nothing on it
		}
		var err error
		placed, err = place(s, clip)
		return err
	})
	if err != nil {
		return nil, err
	}
	return placed, nil
}

// placeWrapped places a clip, splitting one that runs across the loop's seam
// into a head at its place and a tail at the loop's start, as it was played.
func placeWrapped(s *State, track int, c Clip, replace bool) ([]Clip, error) {
	l := s.Loop
	if l.On && c.At < l.Out && c.End() > l.Out {
		headLen := l.Out - c.At
		head := c
		head.Frames = headLen
		tail := c
		tail.At, tail.Src, tail.Frames = l.In, c.Src+headLen, c.Frames-headLen
		h, err := s.Place(track, head, replace)
		if err != nil {
			return nil, err
		}
		tl, err := s.Place(track, tail, replace)
		if err != nil {
			return nil, err
		}
		return []Clip{h, tl}, nil
	}
	p, err := s.Place(track, c, replace)
	return []Clip{p}, err
}

// lastBars finds the last n bars the tape played without a stop or locate,
// ending on the last bar line already in the ring. It returns the output
// frame they began at, their length, and the tape frame they began at.
func (e *Engine) lastBars(t *Tape, n int, delta int64) (uint64, int64, int64, error) {
	g := *t.Grid
	_, total := e.capture.Ring().Window()
	ref := int64(total) - delta // the newest output frame the ring holds
	if d := int64(e.delivered.Load()); ref > d {
		ref = d
	}
	if ref <= 0 {
		return 0, 0, 0, ErrNotYet
	}
	pos, ok := e.tr.PosAt(uint64(ref))
	if !ok {
		return 0, 0, 0, fmt.Errorf("%w: it isn't playing", ErrNotPlayed)
	}
	// Back to the last bar line, then n bars further, through the loop's
	// wraps; the frames counted are the output frames it took.
	bar := g.BarAt(pos)
	end := g.BarStart(bar)
	back := pos - end
	length := g.BarStart(bar) - g.BarStart(bar-int64(n))
	startPos := end - length
	if t.Loop.On && startPos < t.Loop.In {
		// Wrapped: the bars before In were played at the loop's end.
		startPos = t.Loop.Out - (t.Loop.In - startPos)
		if length > t.Loop.Len() {
			return 0, 0, 0, fmt.Errorf("%w: a catch can't be longer than the loop", ErrBadParameter)
		}
	} else if startPos < 0 {
		return 0, 0, 0, fmt.Errorf("%w: the tape hasn't played %d bars", ErrBadParameter, n)
	}
	endOut := uint64(ref - back)
	if int64(endOut) < length {
		return 0, 0, 0, ErrNotYet
	}
	from := endOut - uint64(length)
	if p0, ok := e.tr.continuous(from, endOut, t.Loop); !ok || p0 != startPos {
		return 0, 0, 0, fmt.Errorf("%w: it stopped or moved during them", ErrNotPlayed)
	}
	return from, length, startPos, nil
}

// --- drops ------------------------------------------------------------------------

// DropTake puts frames [from, to) of a take onto a track at the tape's
// playhead (or, on an empty tape, as its first loop: bars sets its tempo).
// It's how a phone recording or a take's selection gets onto tape.
func (e *Engine) DropTake(id string, take string, from, to int64, track, bars int, pick []int) (Clip, error) {
	t := e.Loaded()
	if t == nil {
		return Clip{}, ErrNoTape
	}
	if t.ID != id {
		return Clip{}, ErrWrongTape
	}
	if _, err := t.Track(track); err != nil {
		return Clip{}, err
	}
	info, err := audio.ReadWAVInfo(take)
	if err != nil {
		return Clip{}, err
	}
	if info.SampleRate != e.store.SampleRate() {
		return Clip{}, fmt.Errorf("%w: the take is at %d Hz, the tape at %d", ErrBadParameter, info.SampleRate, e.store.SampleRate())
	}
	if from < 0 || to <= from || to > info.Frames() {
		return Clip{}, fmt.Errorf("%w: that span isn't in the take", ErrBadParameter)
	}
	if e.minFreeGB > 0 {
		if free, _ := audio.FreeGB(e.store.Dir()); free < e.minFreeGB {
			return Clip{}, fmt.Errorf("%w: %.2f GB free where the tapes are, need %.2f GB", audio.ErrLowDisk, free, e.minFreeGB)
		}
	}
	over := int64(OverhangSeconds * float64(info.SampleRate))
	fileFrom, fileTo := max64(0, from-over), min64(info.Frames(), to+over)
	rel, path, err := e.store.NewPoolFile("drop", time.Now())
	if err != nil {
		return Clip{}, err
	}
	if err := audio.CopyWAVSpan(take, fileFrom, fileTo, pick, path); err != nil {
		return Clip{}, err
	}
	frames := to - from
	clip := Clip{File: rel, Src: from - fileFrom, Frames: frames, Source: "take"}
	var placed Clip
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		if tp.Empty() {
			tp.Click = false
		}
		if tp.Empty() && s.Grid == nil {
			// The first loop: its length is the grid, and it loops.
			if bars <= 0 {
				bars = guessBars(frames, e.store.SampleRate())
			}
			if bpm := (Grid{Frames: frames, Bars: bars}).BPM(e.store.SampleRate()); bars > 64 || bpm < 20 || bpm > 400 {
				return fmt.Errorf("%w: %.2f s as %d bars is %.0f BPM; a first loop is 20–400 BPM",
					ErrBadParameter, float64(frames)/float64(e.store.SampleRate()), bars, bpm)
			}
			s.Grid = &Grid{Frames: frames, Bars: bars}
			s.Loop = Loop{In: 0, Out: frames, On: true}
			clip.At = 0
		} else {
			clip.At = e.tr.Status().Pos
			if clip.At+frames > tp.Length {
				return fmt.Errorf("%w: %.1f s of room is left after the playhead", ErrPastTheEnd,
					float64(tp.Length-clip.At)/float64(tp.SampleRate))
			}
		}
		var err error
		placed, err = s.Place(track, clip, true)
		return err
	})
	return placed, err
}

// guessBars picks the bar count that puts a loop's tempo nearest 90 BPM.
func guessBars(frames int64, sampleRate int) int { return guessBarsNear(frames, sampleRate, 90) }

// SetMeta changes what isn't part of undo -- the name, the click -- on the
// loaded tape, and saves it.
func (e *Engine) SetMeta(id string, fn func(t *Tape) error) error {
	e.mu.Lock()
	if e.tape == nil || e.tape.ID != id {
		e.mu.Unlock()
		return ErrWrongTape
	}
	t := e.tape.draft()
	err := fn(t)
	if err == nil {
		err = e.store.Save(t)
	}
	if err == nil {
		e.tape = t
	}
	e.mu.Unlock()
	if err != nil {
		return err
	}
	e.rebuild() // the click is in the mix
	return nil
}

// LoadedID is the loaded tape's id, or "".
func (e *Engine) LoadedID() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.tape == nil {
		return ""
	}
	return e.tape.ID
}

// Sources lists the capture pairs catches can come from, each with whether
// it's clean -- no bus with audio sounding into it -- on the loaded tape.
func (e *Engine) Sources() []SourceState {
	t := e.Loaded()
	var out []SourceState
	for _, s := range e.sources {
		st := SourceState{Name: s.Name, Leaks: s.Leaks, Clean: true}
		if st.Leaks == nil {
			st.Leaks = []string{}
		}
		if t != nil {
			for _, b := range s.Leaks {
				for _, tr := range t.Tracks {
					if tr.Bus == b && len(tr.Clips) > 0 && !tr.Mute {
						st.Clean = false
					}
				}
			}
		}
		out = append(out, st)
	}
	return out
}

// SourceState is a source as the page shows it.
type SourceState struct {
	Name  string   `json:"name"`
	Leaks []string `json:"leaks"`
	Clean bool     `json:"clean"`
}

// Store is the engine's tape store.
func (e *Engine) Store() *Store { return e.store }
