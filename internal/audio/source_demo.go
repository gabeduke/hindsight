package audio

import (
	"math"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/mono"
)

// DemoBPM is the tempo of the synthetic loop. It is exported because the demo
// also stands in for the MIDI clock, and the two must agree.
const DemoBPM = 96.0

// demoSource generates a loop that looks like music: a screenshot of a flat
// sine tells a reader nothing about what the meters, the ribbon or a take
// actually look like.
//
// Everything is derived from a monotonic sample counter rather than the clock,
// so the waveform is identical run to run and screenshots are reproducible.
type demoSource struct {
	cfg *config.Config

	// saved is a precomputed membership set built once from cfg.SaveChannels,
	// so fill does not rebuild it on every block. It is a pure lookup, never
	// iterated for order, so building it once changes nothing about the
	// output.
	saved map[int]bool

	// noise backs the per-block hat bursts. It is allocated once and reseeded
	// per block in fill (via Seed), rather than replaced, since fill runs on
	// a single goroutine at a time and reseeding to n produces the same
	// sequence a fresh rand.New(rand.NewSource(n)) would.
	noise *rand.Rand

	// midi, if set, receives the loop's MIDI -- clock, a Start, and the
	// kick, hat and bass as notes -- stamped with the mono time each event
	// would have arrived at from a real instrument playing along.
	midi func(ns int64, status, d1, d2 byte)

	// Guards the channel pair rather than a sync.Once: Open must be able to
	// arm a fresh generator after Close, and re-assigning a sync.Once copies
	// a lock, which go vet rejects.
	mu   sync.Mutex
	stop chan struct{}
	done chan struct{}

	// loop is the demo's stand-in for the Sidekick's returns: what a tape
	// plays through the demo sink comes back in the capture, as the real
	// strips bring it back (see demoLoop).
	loop demoLoop
}

// demoLoop carries the demo sink's output into the demo source's input, the
// way the Sidekick does: bus A (playback 1/2) into strip 1 -- the CH1 tap,
// 3/4, and MAIN -- and bus B (3/4) into strip 2 -- the CH2 tap, 5/6, and
// MAIN. With it open, AUX (7/8) carries the synthetic loop, standing in for
// the instrument being layered, and the taps carry only the returns.
//
// Each block pulled is played into the next input block, so where the output
// lands in the ring is known exactly: the demo's version of the Pi hearing
// itself. It's counted against the frames the capture has actually handed to
// the ring, so a dropped block or a reopened source doesn't throw it off.
type demoLoop struct {
	mu       sync.Mutex
	pull     func([]int32) // the sink's consumer; nil when closed
	channels int
	held     []int32 // the block pulled last time, played into this one
	pulled   int64   // output frames pulled since Open
	delta    int64   // ring frame = output frame + delta
	known    bool
	// handed is the capture's count of frames handed to the ring: the ring
	// frame the block being delivered will start at. Read only on the
	// source's delivery goroutine, where the capture writes it.
	handed func() uint64
	// bridge, when set, records when each output frame is heard, as a
	// device's output would, for the aligner to measure Δ from.
	bridge *ClockBridge
}

// MIDISink is the optional capability of a Source that can also say what a
// sequencer playing along would have sent. Only the demo has it; a real
// interface's MIDI arrives through the watcher.
type MIDISink interface {
	SetMIDISink(func(ns int64, status, d1, d2 byte))
}

// SetMIDISink attaches the demo's MIDI consumer. Call before Open.
func (s *demoSource) SetMIDISink(f func(ns int64, status, d1, d2 byte)) { s.midi = f }

func NewDemoSource(cfg *config.Config) Source {
	saved := make(map[int]bool, len(cfg.SaveChannels))
	for _, c := range cfg.SaveChannels {
		saved[c] = true
	}
	return &demoSource{
		cfg:   cfg,
		saved: saved,
		noise: rand.New(rand.NewSource(0)),
	}
}

func (s *demoSource) Open(sink func([]int32)) (string, error) {
	// A second Open without an intervening Close would orphan the previous
	// generator goroutine -- which would then be sharing this source's RNG
	// with the new one, and rand.Rand is not safe for concurrent use. The
	// production caller always closes first; this is belt and braces.
	s.Close()

	s.mu.Lock()
	s.stop = make(chan struct{})
	s.done = make(chan struct{})
	stop, done := s.stop, s.done
	s.mu.Unlock()

	block := make([]int32, s.cfg.FramesPerBuf*s.cfg.Channels)
	period := time.Duration(float64(s.cfg.FramesPerBuf) / float64(s.cfg.SampleRate) * float64(time.Second))

	go func() {
		defer close(done)
		t := time.NewTicker(period)
		defer t.Stop()

		var n int64 // frames generated so far
		for {
			select {
			case <-stop:
				return
			case tick := <-t.C:
				s.fill(block, n)
				s.loopback(block, n)
				n += int64(s.cfg.FramesPerBuf)
				sink(block)
				if s.midi != nil {
					// The bridge records this block's delivery against its
					// last frame, and places a moment by interpolating
					// between deliveries. An event f frames before the
					// block's end therefore "arrived" that many frames
					// before the tick, on the same clock the bridge reads.
					//
					// The tick's own time, not time.Now(): a real
					// instrument's clock does not wait for this goroutine
					// to be scheduled, and the bridge's fit already
					// removes the delivery jitter from the audio side.
					at := mono.Of(tick)
					rate := float64(s.cfg.SampleRate)
					for _, ev := range DemoMIDI(n-int64(s.cfg.FramesPerBuf), s.cfg.FramesPerBuf, s.cfg.SampleRate) {
						ns := at - int64(float64(int64(s.cfg.FramesPerBuf)-ev.Frame)/rate*1e9)
						s.midi(ns, ev.Status, ev.D1, ev.D2)
					}
				}
			}
		}
	}()

	return "Demo signal generator (synthetic, 96 BPM)", nil
}

// Close stops the generator and waits for it, so no sink call is in flight
// when it returns. Calling it twice, or without Open, is a no-op.
func (s *demoSource) Close() {
	s.mu.Lock()
	stop, done := s.stop, s.done
	s.stop, s.done = nil, nil
	s.mu.Unlock()

	if stop == nil {
		return
	}
	close(stop)
	<-done
}

func (s *demoSource) Reset() error    { return nil }
func (s *demoSource) Shutdown() error { return nil }

// fill writes one interleaved block starting at absolute frame n.
func (s *demoSource) fill(block []int32, n int64) {
	const fullScale = 2147483648.0

	rate := float64(s.cfg.SampleRate)

	// Reseeding to n keeps the hats from being identical every bar while
	// staying deterministic for a given n -- the same sequence a fresh
	// rand.New(rand.NewSource(n)) would produce, without reallocating one
	// every block.
	s.noise.Seed(n)

	for i := 0; i < s.cfg.FramesPerBuf; i++ {
		t := float64(n+int64(i)) / rate
		beat := t * DemoBPM / 60.0

		// An 8-bar arc (32 beats) so the ribbon shows structure rather than a
		// uniform band.
		arc := 0.55 + 0.45*math.Sin(2*math.Pi*beat/32.0)

		// Kick on every beat: a decaying low sine.
		kb := beat - math.Floor(beat)
		kick := math.Exp(-9*kb) * math.Sin(2*math.Pi*55*t)

		// Hats on eighths: a short noise burst.
		hb := beat*2 - math.Floor(beat*2)
		hat := math.Exp(-45*hb) * (s.noise.Float64()*2 - 1) * 0.35

		// Bass: one note per bar, walking a minor pentatonic.
		bar := int(math.Floor(beat / 4))
		bassHz := []float64{82.41, 98.00, 110.00, 73.42}[bar%4]
		bass := 0.45 * math.Sin(2*math.Pi*bassHz*t)

		// Pad: a triad two octaves up, quiet enough to sit under everything.
		pad := 0.12 * (math.Sin(2*math.Pi*bassHz*4*t) +
			math.Sin(2*math.Pi*bassHz*4.75*t) +
			math.Sin(2*math.Pi*bassHz*6*t))

		mix := arc * (0.55*kick + hat + bass + pad)
		// Soft clip, then leave ~6 dB of headroom so nothing reads as pinned.
		mix = math.Tanh(mix) * 0.5

		for c := 0; c < s.cfg.Channels; c++ {
			v := mix
			if !s.saved[c] {
				// Bleed, as the real interface has on its unused pairs.
				v *= 0.03
			}
			block[i*s.cfg.Channels+c] = int32(v * (fullScale - 1))
		}
	}
}

// DemoEvent is one MIDI message the demo loop implies, at a frame offset
// into a block.
type DemoEvent struct {
	Frame  int64 // offset within the block
	Status byte
	D1, D2 byte
}

// Demo MIDI layout: what a sequencer playing the loop would send.
const (
	demoDrumChannel = 9 // channel 10, the General MIDI drum channel
	demoBassChannel = 0
	demoKick        = 36  // GM acoustic bass drum
	demoHat         = 42  // GM closed hi-hat
	demoNoteLen     = 0.1 // seconds a drum note is held
)

// demoBassNotes mirrors fill's bass walk: E2, G2, A2, D2.
var demoBassNotes = [4]byte{40, 43, 45, 38}

// DemoMIDI lists the messages the loop implies in the block of `frames`
// frames starting at absolute frame n, in frame order: 24 clock pulses per
// beat, a Start at the very first frame, a kick on every beat and a hat on
// every eighth (channel 10), and one bass note per bar (channel 1). It is a
// pure function of the frame counter, like fill, so the MIDI matches the
// audio sample for sample and is the same run to run.
func DemoMIDI(n int64, frames int, sampleRate int) []DemoEvent {
	rate := float64(sampleRate)
	var out []DemoEvent
	add := func(frame int64, status, d1, d2 byte) {
		out = append(out, DemoEvent{Frame: frame, Status: status, D1: d1, D2: d2})
	}
	if n == 0 {
		add(0, 0xFA, 0, 0)
	}
	// Anything that happens at an exact beat fraction: walk every pulse
	// (24 per beat) whose frame falls in [n, n+frames).
	pulseFrames := rate * 60 / DemoBPM / 24
	first := int64(math.Ceil(float64(n) / pulseFrames))
	for p := first; ; p++ {
		frame := int64(math.Round(float64(p) * pulseFrames))
		if frame >= n+int64(frames) {
			break
		}
		off := frame - n
		add(off, 0xF8, 0, 0)
		if p%24 == 0 {
			add(off, 0x90|demoDrumChannel, demoKick, 120)
		}
		if p%12 == 0 {
			add(off, 0x90|demoDrumChannel, demoHat, 80)
		}
		if p%96 == 0 {
			bar := int(p / 96)
			if bar > 0 {
				add(off, 0x80|demoBassChannel, demoBassNotes[(bar-1)%4], 0)
			}
			add(off, 0x90|demoBassChannel, demoBassNotes[bar%4], 100)
		}
	}
	// Drum note-offs, demoNoteLen after each hit. Walked separately so the
	// list stays in frame order regardless of block boundaries.
	holdFrames := int64(demoNoteLen * rate)
	firstOff := int64(math.Ceil((float64(n) - float64(holdFrames)) / pulseFrames))
	if firstOff < 0 {
		firstOff = 0
	}
	var offs []DemoEvent
	for p := firstOff; ; p++ {
		frame := int64(math.Round(float64(p)*pulseFrames)) + holdFrames
		if frame >= n+int64(frames) {
			break
		}
		if frame < n {
			continue
		}
		off := frame - n
		if p%24 == 0 {
			offs = append(offs, DemoEvent{Frame: off, Status: 0x80 | demoDrumChannel, D1: demoKick})
		}
		if p%12 == 0 {
			offs = append(offs, DemoEvent{Frame: off, Status: 0x80 | demoDrumChannel, D1: demoHat})
		}
	}
	out = append(out, offs...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Frame < out[j].Frame })
	return out
}

// loopback mixes the output block the sink pulled last time into this input
// block, then pulls the next one. Output frame o thus comes back at input
// frame o + delta, delta fixed from the first pull.
func (s *demoSource) loopback(block []int32, n int64) {
	l := &s.loop
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.pull == nil {
		return
	}
	fpb := s.cfg.FramesPerBuf
	ch := s.cfg.Channels
	if l.held != nil {
		for i := 0; i < fpb; i++ {
			o := l.held[i*l.channels:]
			aL, aR := int64(o[0]), int64(o[1])
			var bL, bR int64
			if l.channels >= 4 {
				bL, bR = int64(o[2]), int64(o[3])
			}
			in := block[i*ch:]
			synthL, synthR := int64(in[0]), int64(in[1%ch])
			set := func(c int, v int64) {
				if c < ch {
					in[c] = sat32(v)
				}
			}
			set(0, synthL+aL+bL) // MAIN: everything
			set(1, synthR+aR+bR)
			set(2, aL) // CH1 tap: bus A (nothing in jack 1)
			set(3, aR)
			set(4, bL) // CH2 tap: bus B (nothing in jack 2)
			set(5, bR)
			set(6, synthL) // AUX: the instrument being layered
			set(7, synthR)
		}
		// The held block, output frames [pulled-fpb, pulled), is in this
		// one, which the ring will hold from the frame handed counts to.
		if l.handed != nil {
			l.delta = int64(l.handed()) - (l.pulled - int64(fpb))
		}
		// The capture records this block as handed now; its last frame
		// came from output frame pulled.
		if l.bridge != nil {
			l.bridge.Record(mono.Now(), uint64(l.pulled))
		}
	}
	if l.held == nil {
		l.held = make([]int32, fpb*l.channels)
		// What's pulled now plays into the next block.
		if l.handed != nil {
			l.delta = int64(l.handed()) + int64(fpb) - l.pulled
		} else {
			l.delta = n + int64(fpb) - l.pulled
		}
		l.known = true
	}
	l.pull(l.held)
	l.pulled += int64(fpb)
}

func sat32(v int64) int32 {
	if v > 2147483647 {
		return 2147483647
	}
	if v < -2147483648 {
		return -2147483648
	}
	return int32(v)
}

// demoSink is the demo's tape output: it plays into the demo source.
type demoSink struct {
	src    *demoSource
	cap    *Capture
	bridge *ClockBridge // set for the aligning kind
}

// demoAligningSink is the demo's output keeping where it lands to itself, so
// the tape's aligner has to measure it from the clock bridges and the
// correlation, as on the Sidekick (TAPE_DEMO_ALIGN).
type demoAligningSink struct{ demoSink }

// NewDemoSink returns a Sink that plays into the demo source -- the tape
// heard in the ribbon and the takes, as the Sidekick would make it -- or nil
// for a source that isn't the demo. cap is the capture the source feeds
// (nil: count by the source's own frames). An aligning sink doesn't say
// where its output lands; the tape measures it.
func NewDemoSink(src Source, cap *Capture, aligning bool) Sink {
	d, ok := src.(*demoSource)
	if !ok {
		return nil
	}
	if aligning {
		return &demoAligningSink{demoSink{src: d, cap: cap, bridge: NewClockBridge(256, d.cfg.SampleRate)}}
	}
	return &demoSink{src: d, cap: cap}
}

// Delta isn't told: the aligner finds it.
func (d *demoAligningSink) Delta() (int64, bool) { return 0, false }

// OutputBridge maps the monotonic clock to the output frame being heard.
func (d *demoAligningSink) OutputBridge() *ClockBridge { return d.bridge }

// Restarts: the demo's output never slips.
func (d *demoAligningSink) Restarts() uint64 { return 0 }

func (d *demoSink) Open(channels int, pull func([]int32)) (string, error) {
	l := &d.src.loop
	l.mu.Lock()
	defer l.mu.Unlock()
	l.pull, l.channels, l.held, l.pulled, l.known = pull, channels, nil, 0, false
	l.handed, l.bridge = nil, d.bridge
	if c := d.cap; c != nil {
		l.handed = func() uint64 { return c.handed }
	}
	return "Demo loopback (the demo source hears it)", nil
}

func (d *demoSink) Close() {
	l := &d.src.loop
	l.mu.Lock()
	l.pull, l.held, l.known = nil, nil, false
	l.mu.Unlock()
}

// Delta is exact in the demo: where output frame 0 lands in the ring.
func (d *demoSink) Delta() (int64, bool) {
	l := &d.src.loop
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.delta, l.known
}
