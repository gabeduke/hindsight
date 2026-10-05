package tape

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
)

// OutputMode is where the tape plays: the jam room's Sidekick, a phone
// (a browser listening to the stream), or both.
type OutputMode string

const (
	ModeJam   OutputMode = "jam"
	ModePhone OutputMode = "phone"
	ModeBoth  OutputMode = "both"
)

const (
	paceStep    = 20 * time.Millisecond
	deviceQuiet = 200 * time.Millisecond
	dropPause   = 2 * time.Second
	maxCatchUp  = 10 // pacer steps at most per tick: a stalled Pi drops time rather than racing
)

// StreamStatus is the stream as the page shows it.
type StreamStatus struct {
	Listeners int    `json:"listeners"`
	DelayMS   int    `json:"delay_ms"`
	State     string `json:"state"` // idle, playing, lost
	Rate      int    `json:"rate"`
}

// Output stands between the engine and the device. Whenever the device
// pulls, it is the tape's clock, in every mode: its block goes to the
// device, the stream, or both, and in phone mode the device plays silence.
// While the device is quiet (the Sidekick off) and someone listens, a pacer
// on the Pi's clock pulls instead; the frames it pulled move where the
// device's count begins, and its handback counts as a slip.
type Output struct {
	dev    audio.Sink
	eng    *Engine
	stream *Stream
	now    func() int64

	mode  atomic.Value // OutputMode
	drive sync.Mutex   // one puller at a time: the device or the pacer
	pull  func([]int32)
	name  string

	devFrames    atomic.Uint64 // frames the device pulled through us: its own count
	lastDevCall  atomic.Int64  // mono ns of its last callback (0: never)
	pacerOwed    int64         // under drive: frames the pacer pulled since the device last did
	handbacks    atomic.Uint64
	lastHandback atomic.Uint64 // devFrames at the latest handback

	lost         atomic.Bool
	modeAttaches atomic.Uint64 // the stream's attaches when the mode last changed, less any listening then

	// the pacer's own, under paceMu (its goroutine, or a test calling paceStep)
	paceMu    sync.Mutex
	paceAt    int64
	lostSince int64
	scratch   []int32

	stop, done chan struct{}
}

// bridgedOutput is an Output over a device that knows when its output is
// heard and where it slipped: the aligner and the MIDI clock read those
// through it.
type bridgedOutput struct {
	*Output
	b outputSink
}

// NewOutput wraps the tape's device sink.
func NewOutput(dev audio.Sink) audio.Sink {
	o := &Output{dev: dev, now: mono.Now}
	o.mode.Store(ModeJam)
	if b, ok := dev.(outputSink); ok {
		return bridgedOutput{Output: o, b: b}
	}
	return o
}

func (o *Output) router() *Output { return o }

// bind is called by NewEngine: the stream needs the tape's rate and
// transport.
func (o *Output) bind(e *Engine) {
	o.eng = e
	if e.store == nil {
		return // no tapes: no stream
	}
	o.stream = NewStream(e.store.SampleRate(), e.tr.PosAt)
	o.scratch = make([]int32, o.stream.step*OutChannels)
}

func (o *Output) Mode() OutputMode { return o.mode.Load().(OutputMode) }
func (o *Output) Stream() *Stream  { return o.stream }

// Silent says the device is playing silence: nothing to align against.
func (o *Output) Silent() bool { return o.Mode() == ModePhone }

// setMode moves the output. A listener already there when the mode
// changes counts as heard, so its leaving can stop the tape.
func (o *Output) setMode(m OutputMode) {
	o.mode.Store(m)
	o.modeAttaches.Store(o.stream.Attaches() - uint64(o.stream.Listeners()))
	o.lost.Store(false)
}

func (o *Output) Open(channels int, pull func([]int32)) (string, error) {
	o.pull = pull
	name, err := o.dev.Open(channels, o.devPull)
	if err != nil {
		return "", err
	}
	o.name = name
	if o.stream == nil {
		return name, nil // no tapes: the device alone
	}
	o.stop, o.done = make(chan struct{}), make(chan struct{})
	go o.stream.run(o.stop)
	go o.paceLoop()
	return name, nil
}

func (o *Output) Close() {
	if o.stop != nil {
		close(o.stop)
		<-o.done
		o.stop = nil
	}
	o.dev.Close()
}

// Name is the device's name while it plays, else the one Open got; "stream"
// while only the stream plays.
func (o *Output) Name() string {
	n := o.name
	if d, ok := o.dev.(interface{ Name() string }); ok {
		n = d.Name()
	}
	if n == "" && o.Mode() != ModeJam && o.stream != nil && o.stream.Listeners() > 0 {
		return "stream"
	}
	return n
}

// Delta passes on a device that knows its own Δ (the demo's).
func (o *Output) Delta() (int64, bool) {
	if kd, ok := o.dev.(audio.KnownDelta); ok {
		return kd.Delta()
	}
	return 0, false
}

func (b bridgedOutput) OutputBridge() *audio.ClockBridge { return b.b.OutputBridge() }
func (b bridgedOutput) Restarts() uint64                 { return b.b.Restarts() + b.handbacks.Load() }

// LastSlip is the latest of the device's own slips and the pacer's handbacks.
func (b bridgedOutput) LastSlip() uint64 {
	s := b.lastHandback.Load()
	if sp, ok := b.b.(slipPlacer); ok {
		s = max(s, sp.LastSlip())
	}
	return s
}

// devPull is the device's callback.
func (o *Output) devPull(out []int32) {
	o.lastDevCall.Store(o.now())
	n := uint64(len(out) / OutChannels)
	if !o.drive.TryLock() {
		// The pacer is mid-pull: this period plays silence, and the engine
		// didn't deliver it, so the device's count runs ahead of the engine's.
		clear(out)
		o.devFrames.Add(n)
		o.eng.sinkBase.Add(-int64(n))
		o.lastHandback.Store(o.devFrames.Load())
		o.handbacks.Add(1)
		return
	}
	defer o.drive.Unlock()
	if o.pacerOwed != 0 {
		o.eng.sinkBase.Add(o.pacerOwed) // engine frame = sinkBase + device frame, again
		o.pacerOwed = 0
		o.lastHandback.Store(o.devFrames.Load())
		o.handbacks.Add(1)
	}
	start := o.eng.delivered.Load()
	o.pull(out)
	o.devFrames.Add(n)
	if o.stream == nil {
		return
	}
	switch o.Mode() {
	case ModePhone:
		o.stream.Push(start, out)
		clear(out)
	case ModeBoth:
		o.stream.Push(start, out)
	}
}

func (o *Output) paceLoop() {
	defer close(o.done)
	t := time.NewTicker(paceStep)
	defer t.Stop()
	for {
		select {
		case <-o.stop:
			return
		case <-t.C:
			o.eng.safely(o.paceStep)
		}
	}
}

// paceStep pulls the 20 ms steps that have passed while the device is quiet
// and someone listens, and stops a phone's tape whose listener has gone.
func (o *Output) paceStep() {
	o.paceMu.Lock()
	defer o.paceMu.Unlock()
	now := o.now()
	o.watchDrop(now)
	quiet := now-o.lastDevCall.Load() >= int64(deviceQuiet)
	if o.Mode() == ModeJam || o.stream.Listeners() == 0 || !quiet {
		o.paceAt = 0
		return
	}
	if o.paceAt == 0 {
		o.paceAt = now
		return
	}
	steps := (now - o.paceAt) / int64(paceStep)
	if steps <= 0 {
		return
	}
	o.paceAt += steps * int64(paceStep)
	steps = min(steps, maxCatchUp)
	if !o.drive.TryLock() {
		return
	}
	defer o.drive.Unlock()
	for i := int64(0); i < steps; i++ {
		start := o.eng.delivered.Load()
		o.pull(o.scratch)
		o.pacerOwed += int64(o.stream.step)
		o.stream.Push(start, o.scratch)
	}
}

func (o *Output) watchDrop(now int64) {
	heard := o.stream.Attaches() > o.modeAttaches.Load()
	if o.Mode() != ModePhone || o.stream.Listeners() > 0 || !heard {
		o.lostSince = 0
		o.lost.Store(false)
		return
	}
	if o.lostSince == 0 {
		o.lostSince = now
		return
	}
	if now-o.lostSince >= int64(dropPause) && !o.lost.Load() {
		o.lost.Store(true)
		if o.eng.tr.Status().Playing {
			o.eng.Do(Action{Kind: "stop"})
		}
	}
}

func (o *Output) status() StreamStatus {
	st := StreamStatus{Listeners: o.stream.Listeners(), DelayMS: o.stream.FillMS(), State: "idle", Rate: o.stream.Rate()}
	switch {
	case o.lost.Load():
		st.State = "lost"
	case st.Listeners > 0 && o.Mode() != ModeJam:
		st.State = "playing"
	}
	return st
}
