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
