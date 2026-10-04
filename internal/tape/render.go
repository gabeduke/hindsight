package tape

import (
	"fmt"
	"log"
	"math"
	"sync"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The renderer turns a tape's clips into the two buses: for each block, every
// clip overlapping the block's span of the tape is summed into its track's
// bus at the track's gain and pan. Mixing is float32; the player converts to
// int32 with saturation at the end.
//
// Edges follow the spec's rule, decided by what's beside them:
//   - where audio meets audio on a layer -- two clips end to end, or a clip
//     looping into itself or its neighbour at the loop's seam -- a 5 ms
//     equal-power crossfade runs from the outgoing clip's overhang into the
//     incoming clip's start;
//   - an edge with silence beside it gets the 3 ms declick fade cuts use.

const (
	xfadeSeconds   = 0.005
	declickSeconds = 0.003
	// OverhangSeconds is how much audio every pool file carries beyond the
	// clip either side, for the crossfades.
	OverhangSeconds = 0.010
)

// OutChannels is what the renderer produces: bus A left, right, bus B left,
// right -- the Sidekick's playback 1/2 and 3/4.
const OutChannels = 4

// ClipAudio is a pool file in memory: interleaved stereo float32.
type ClipAudio struct {
	Frames int64
	Data   []float32
}

func (a *ClipAudio) at(frame int64) (float32, float32) {
	if a == nil || frame < 0 || frame >= a.Frames {
		return 0, 0
	}
	return a.Data[2*frame], a.Data[2*frame+1]
}

// Pool loads pool files into memory and keeps them, shared by every mix.
// Nothing is memory-mapped: a mapped file on a bumped SSD faults and takes
// the whole process -- the ring with it -- down.
type Pool struct {
	store *Store

	mu     sync.Mutex
	files  map[string]*ClipAudio
	failed map[string]error
}

func NewPool(s *Store) *Pool {
	return &Pool{store: s, files: map[string]*ClipAudio{}, failed: map[string]error{}}
}

// Audio returns a pool file, loading it on first use. A file that can't be
// read is remembered as failed (its clips play silent) until Forget.
func (p *Pool) Audio(rel string) (*ClipAudio, error) {
	p.mu.Lock()
	if a, ok := p.files[rel]; ok {
		p.mu.Unlock()
		return a, nil
	}
	if err, ok := p.failed[rel]; ok {
		p.mu.Unlock()
		return nil, err
	}
	p.mu.Unlock()

	a, err := loadClipAudio(p.store.AudioPath(rel))
	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil {
		p.failed[rel] = err
		log.Printf("[!] tape: %s can't be read, its clips play silent: %v", rel, err)
		return nil, err
	}
	p.files[rel] = a
	return a, nil
}

// Forget drops a failed load, so the next use tries again.
func (p *Pool) Forget(rel string) {
	p.mu.Lock()
	delete(p.failed, rel)
	p.mu.Unlock()
}

// Failed lists the pool files that couldn't be read.
func (p *Pool) Failed() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []string
	for f := range p.failed {
		out = append(out, f)
	}
	return out
}

func loadClipAudio(path string) (*ClipAudio, error) {
	if path == "" {
		return nil, fmt.Errorf("not a pool file")
	}
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		return nil, err
	}
	if info.Channels < 1 {
		return nil, fmt.Errorf("no channels")
	}
	n := info.Frames()
	a := &ClipAudio{Frames: n, Data: make([]float32, 2*n)}
	ch := info.Channels
	_, err = audio.ReadFrames(path, 0, n, 1<<14, func(b []int32, first int64) error {
		frames := len(b) / ch
		for i := 0; i < frames; i++ {
			l := float32(float64(b[i*ch]) / 2147483648.0)
			r := l
			if ch > 1 {
				r = float32(float64(b[i*ch+1]) / 2147483648.0)
			}
			a.Data[2*(first+int64(i))] = l
			a.Data[2*(first+int64(i))+1] = r
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return a, nil
}

// Mix is what the renderer plays: an immutable snapshot of a tape's state,
// with the audio resolved, rebuilt whenever the tape changes.
type Mix struct {
	loop    Loop
	end     int64 // the tape frame after the last clip
	tracks  []mixTrack
	xfade   int64
	declick int64
}

type mixTrack struct {
	bus          int // 0 = A, 1 = B
	gainL, gainR float32
	layers       [][]*mixClip
	silent       bool // muted, or another track is soloed
}

type mixClip struct {
	at, end int64 // on the tape, nudge applied
	src     int64
	gain    float32
	audio   *ClipAudio
	prev    *mixClip // the clip whose end this one's start crossfades from
	joined  bool     // audio follows this clip's end: no declick there
}

func dbToGain(db float64) float32 { return float32(math.Pow(10, db/20)) }

// NewMix builds a mix of a tape state, loading clip audio from the pool.
func NewMix(s State, pool *Pool, sampleRate int) *Mix {
	m := &Mix{
		loop:    s.Loop,
		xfade:   int64(xfadeSeconds * float64(sampleRate)),
		declick: int64(declickSeconds * float64(sampleRate)),
	}
	solo := false
	for _, t := range s.Tracks {
		solo = solo || t.Solo
	}
	for _, t := range s.Tracks {
		mt := mixTrack{silent: t.Mute || (solo && !t.Solo)}
		if t.Bus == BusB {
			mt.bus = 1
		}
		g := dbToGain(t.GainDB)
		// Balance for a stereo source: one side comes down as the other
		// stays at full level.
		mt.gainL, mt.gainR = g, g
		if t.Pan > 0 {
			mt.gainL *= float32(1 - t.Pan)
		} else if t.Pan < 0 {
			mt.gainR *= float32(1 + t.Pan)
		}
		layers := map[int][]*mixClip{}
		maxLayer := -1
		for _, c := range t.Clips {
			a, _ := pool.Audio(c.File)
			nudge := int64(math.Round(c.NudgeMS / 1000 * float64(sampleRate)))
			mc := &mixClip{at: c.At + nudge, end: c.End() + nudge, src: c.Src, gain: dbToGain(c.GainDB), audio: a}
			if mc.end > m.end {
				m.end = mc.end
			}
			layers[c.Layer] = append(layers[c.Layer], mc)
			if c.Layer > maxLayer {
				maxLayer = c.Layer
			}
		}
		for l := 0; l <= maxLayer; l++ {
			clips := layers[l]
			for _, c := range clips {
				for _, o := range clips {
					if o == c {
						continue
					}
					seam := m.loop.On && c.at == m.loop.In && o.end == m.loop.Out
					if o.end == c.at || seam {
						c.prev = o
						o.joined = true
					}
				}
				// A clip filling the whole loop wraps into itself.
				if m.loop.On && c.at == m.loop.In && c.end == m.loop.Out && c.prev == nil {
					c.prev = c
					c.joined = true
				}
			}
			mt.layers = append(mt.layers, clips)
		}
		m.tracks = append(m.tracks, mt)
	}
	return m
}

// Render adds n frames of the tape from position pos into dst (interleaved,
// OutChannels wide, n frames). It doesn't wrap: the transport splits a block
// at the loop's end.
func (m *Mix) Render(dst []float32, pos int64, n int) {
	end := pos + int64(n)
	for ti := range m.tracks {
		t := &m.tracks[ti]
		if t.silent {
			continue
		}
		ch := t.bus * 2
		for _, layer := range t.layers {
			for _, c := range layer {
				from, to := max64(pos, c.at), min64(end, c.end)
				// The crossfade into c reads its predecessor's overhang
				// even where c itself has already started.
				for f := from; f < to; f++ {
					l, r := m.sample(c, f)
					i := int(f-pos) * OutChannels
					dst[i+ch] += l * t.gainL
					dst[i+ch+1] += r * t.gainR
				}
			}
		}
	}
}

// sample is clip c's contribution at tape frame f, edges applied.
func (m *Mix) sample(c *mixClip, f int64) (float32, float32) {
	local := f - c.at
	l, r := c.audio.at(c.src + local)
	g := c.gain
	if local < m.xfade && c.prev != nil {
		// Equal power: the incoming rises on a sine as the outgoing falls on
		// a cosine, read from where the outgoing would have continued.
		x := (float64(local) + 0.5) / float64(m.xfade)
		in := float32(math.Sin(x * math.Pi / 2))
		out := float32(math.Cos(x * math.Pi / 2))
		p := c.prev
		pl, pr := p.audio.at(p.src + (p.end - p.at) + local)
		return (l*in*g + pl*out*p.gain), (r*in*g + pr*out*p.gain)
	}
	if local < m.declick && c.prev == nil {
		g *= float32(float64(local)+0.5) / float32(m.declick)
	}
	if left := c.end - f; left <= m.declick && !c.joined {
		g *= float32(float64(left)-0.5) / float32(m.declick)
	}
	return l * g, r * g
}

// ToInt32 converts a float block to int32 with saturation.
func ToInt32(dst []int32, src []float32) {
	for i, v := range src {
		x := float64(v) * 2147483647.0
		switch {
		case x >= 2147483647:
			dst[i] = math.MaxInt32
		case x <= -2147483648:
			dst[i] = math.MinInt32
		default:
			dst[i] = int32(x)
		}
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
