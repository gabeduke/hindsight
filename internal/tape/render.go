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

// Keep drops every loaded or failed file not in files: the pool holds what
// the tape plays (and its next undo or redo), not everything ever loaded. A
// mix already playing keeps its own references.
func (p *Pool) Keep(files map[string]bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for f := range p.files {
		if !files[f] {
			delete(p.files, f)
		}
	}
	for f := range p.failed {
		if !files[f] {
			delete(p.failed, f)
		}
	}
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

	// What the render goroutine needs of the tape, so it never takes the
	// engine's lock: an edit saving to a slow card can't make it late.
	tapeID string
	length int64
	grid   *Grid
	click  bool // the metronome on bus A while playing
	// straight is this mix with the loop off, for a pass straight through
	// Out (a mixdown's); nil in a mix that is one.
	straight *Mix
	sr       float64
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
	fadeIn  int64 // its fades, as they play (Clip.fades)
	fadeOut int64
	audio   *ClipAudio
	prev    *mixClip // the clip whose end this one's start crossfades from
	joined  bool     // audio follows this clip's end: no declick there
	cont    bool     // prev's own continuation in the same file: no fade in
	// Across the loop's ends, while looping: playback leaves the clip at Out
	// and enters it at In mid-way. At the wrap, what it would have played
	// after Out fades out as what's at In fades in.
	crossOut, crossIn bool
}

func dbToGain(db float64) float32 { return float32(math.Pow(10, db/20)) }

// NewMix builds a mix of a tape state, loading clip audio from the pool.
func NewMix(s State, pool *Pool, sampleRate int) *Mix {
	m := &Mix{
		loop:    s.Loop,
		xfade:   int64(xfadeSeconds * float64(sampleRate)),
		declick: int64(declickSeconds * float64(sampleRate)),
		sr:      float64(sampleRate),
	}
	if s.Grid != nil {
		g := *s.Grid
		m.grid = &g
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
			mc.fadeIn, mc.fadeOut = c.fades()
			if m.loop.On {
				mc.crossOut = mc.at < m.loop.Out && mc.end > m.loop.Out
				mc.crossIn = mc.at < m.loop.In && mc.end > m.loop.In
			}
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
						// A catch split at the seam: the tail is the head's
						// own audio carrying on, so it needs no fade.
						c.cont = o.audio != nil && o.audio == c.audio && o.src+(o.end-o.at) == c.src
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
func (m *Mix) Render(dst []float32, pos int64, n int) { m.render(dst, pos, n, false) }

// render is Render, told whether the tape got to pos by wrapping from the
// loop's Out and playing on since: the first xfade frames after In are then
// a crossfade from what would have followed Out.
func (m *Mix) render(dst []float32, pos int64, n int, afterWrap bool) {
	m.renderTape(dst, pos, n, afterWrap)
	m.renderClick(dst, pos, n)
}

// renderTape is render without the click: the tracks alone.
func (m *Mix) renderTape(dst []float32, pos int64, n int, afterWrap bool) {
	end := pos + int64(n)
	wrapFrom, wrapTo := int64(0), int64(0) // the crossfade's tape frames, if in this span
	if afterWrap {
		wrapFrom, wrapTo = max64(pos, m.loop.In), min64(end, m.loop.In+m.xfade)
	}
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
					l, r := m.sample(c, f, afterWrap)
					i := int(f-pos) * OutChannels
					dst[i+ch] += l * t.gainL
					dst[i+ch+1] += r * t.gainR
				}
				if c.crossOut {
					// Past Out it carries on, fading out, under what's at In.
					for f := wrapFrom; f < wrapTo; f++ {
						k := f - m.loop.In
						x := (float64(k) + 0.5) / float64(m.xfade)
						g := c.gain * c.fade(m.loop.Out+k-c.at) * float32(math.Cos(x*math.Pi/2))
						l, r := c.audio.at(c.src + (m.loop.Out + k - c.at))
						i := int(f-pos) * OutChannels
						dst[i+ch] += l * g * t.gainL
						dst[i+ch+1] += r * g * t.gainR
					}
				}
			}
		}
	}
}

// declickEdges fades what dst holds for tape frames [pos, pos+n) in over
// the declick's length after from, and out over it before to: a pass that
// starts or stops mid-clip, as a mixdown's does, doesn't click there.
func (m *Mix) declickEdges(dst []float32, pos int64, n int, from, to int64) {
	d := m.declick
	if d <= 0 {
		return
	}
	for f := max64(pos, from); f < min64(pos+int64(n), from+d); f++ {
		g := (float32(f-from) + 0.5) / float32(d)
		i := int(f-pos) * OutChannels
		for c := 0; c < OutChannels; c++ {
			dst[i+c] *= g
		}
	}
	for f := max64(pos, to-d); f < min64(pos+int64(n), to); f++ {
		g := (float32(to-f) - 0.5) / float32(d)
		i := int(f-pos) * OutChannels
		for c := 0; c < OutChannels; c++ {
			dst[i+c] *= g
		}
	}
}

// The click: a short sine blip on every beat, higher on the bar, on bus A.
const (
	clickSeconds = 0.025
	clickLevel   = 0.25
	clickHz      = 1000.0
	clickBarHz   = 1600.0
)

// clickAt is the click's sample k frames into a blip.
func (m *Mix) clickAt(k int64, accent bool) float32 {
	hz := clickHz
	if accent {
		hz = clickBarHz
	}
	t := float64(k) / m.sr
	env := math.Exp(-t / (clickSeconds / 4))
	if k < 48 {
		env *= float64(k) / 48 // no click of its own at the start
	}
	return float32(clickLevel * env * math.Sin(2*math.Pi*hz*t))
}

// renderClick adds the metronome for tape frames [pos, pos+n).
func (m *Mix) renderClick(dst []float32, pos int64, n int) {
	if !m.click || m.grid == nil {
		return
	}
	g := *m.grid
	length := int64(clickSeconds * m.sr)
	beat := g.BarFrames() / BeatsPerBar
	first := int64(math.Floor(float64(pos-length) / beat))
	for b := first; ; b++ {
		at := g.BeatStart(b)
		if at >= pos+int64(n) {
			break
		}
		from, to := max64(pos, at), min64(pos+int64(n), at+length)
		for f := from; f < to; f++ {
			v := m.clickAt(f-at, b%BeatsPerBar == 0)
			i := int(f-pos) * OutChannels
			dst[i] += v
			dst[i+1] += v
		}
	}
}

// renderCountIn adds n frames of a count-in, k frames into its bar: four
// beats of click, the first accented, whatever the click setting.
func (m *Mix) renderCountIn(dst []float32, k int64, n int) {
	if m.grid == nil {
		return
	}
	length := int64(clickSeconds * m.sr)
	beat := m.grid.BarFrames() / BeatsPerBar
	for b := int64(0); b < BeatsPerBar; b++ {
		at := int64(math.Round(float64(b) * beat))
		from, to := max64(k, at), min64(k+int64(n), at+length)
		for f := from; f < to; f++ {
			v := m.clickAt(f-at, b == 0)
			i := int(f-k) * OutChannels
			dst[i] += v
			dst[i+1] += v
		}
	}
}

// fade is a clip's own fades' gain local frames into it.
func (c *mixClip) fade(local int64) float32 {
	if c.fadeIn == 0 && c.fadeOut == 0 {
		return 1
	}
	return float32(fadeGain(local, c.end-c.at, c.fadeIn, c.fadeOut))
}

// sample is clip c's contribution at tape frame f, edges applied.
func (m *Mix) sample(c *mixClip, f int64, afterWrap bool) (float32, float32) {
	local := f - c.at
	l, r := c.audio.at(c.src + local)
	g := c.gain * c.fade(local)
	if c.crossIn && afterWrap && f >= m.loop.In {
		if k := f - m.loop.In; k < m.xfade {
			x := (float64(k) + 0.5) / float64(m.xfade)
			g *= float32(math.Sin(x * math.Pi / 2))
		}
	}
	if c.cont {
		// The head carrying on: no fade in, but its own end still declicks.
		if left := c.end - f; left <= m.declick && !c.joined {
			g *= float32(float64(left)-0.5) / float32(m.declick)
		}
		return l * g, r * g
	}
	if local < m.xfade && c.prev != nil {
		// Equal power: the incoming rises on a sine as the outgoing falls on
		// a cosine, read from where the outgoing would have continued.
		x := (float64(local) + 0.5) / float64(m.xfade)
		in := float32(math.Sin(x * math.Pi / 2))
		out := float32(math.Cos(x * math.Pi / 2))
		p := c.prev
		pl, pr := p.audio.at(p.src + (p.end - p.at) + local)
		// One that fades out has faded by its end: nothing carries on.
		pg := p.gain
		if p.fadeOut > 0 {
			pg = 0
		}
		return (l*in*g + pl*out*pg), (r*in*g + pr*out*pg)
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
