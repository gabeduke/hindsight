package tape

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// Launching the cue lane's clips (docs/architecture/tape.md): a clip starts on the
// next bar line and loops until it's tapped again; Shift starts it at once.
// It plays on the transport's clock, summed with the tape on bus A, and the
// Cue button (CueLane.Solo) leaves it alone in the output. What's playing is
// a performance, like Play mode's pads: outside the tape's State, so outside
// undo, and never in a mixdown.

// cueCmd is a launch or a stop on its way to the render goroutine.
type cueCmd struct {
	clip string
	op   string // launch, stop or toggle
}

// cueVoice is a clip playing: from output frame start, and fading out from
// stop once it's been stopped (0: it hasn't).
type cueVoice struct {
	clip  string
	start uint64
	stop  uint64
	pos   int64 // the tape frame it started at; -1 with the tape standing
}

// CueLive is the cue lane as it's playing, for the page.
type CueLive struct {
	Playing []string `json:"playing"` // clip ids, in launch order
	Queued  []string `json:"queued"`  // launched or stopped, waiting for their bar line
	// Starts is the tape frame each playing clip started at, -1 for one
	// launched with the tape standing.
	Starts map[string]int64 `json:"starts"`
}

// cuePlayer is the render goroutine's: only advance touches voices. view
// is what Live reads.
type cuePlayer struct {
	voices []cueVoice
	queued map[string]bool
	dirty  bool

	mu   sync.Mutex
	view CueLive
}

// mixCue is a cue clip with its audio resolved: each of its lanes, summed.
type mixCue struct {
	lanes           []mixCueLane
	frames          int64
	gain            float32
	fadeIn, fadeOut int64
	inShape         string
	outShape        string
	loop            bool
}

// mixCueLane is one lane's audio, from file frame src.
type mixCueLane struct {
	audio *ClipAudio
	src   int64
}

func newMixCue(c CueClip, lane float64, pool *Pool) *mixCue {
	m := &mixCue{frames: c.Frames, gain: dbToGain(c.GainDB + lane),
		fadeIn: c.FadeIn, fadeOut: c.FadeOut, inShape: c.FadeInShape, outShape: c.FadeOutShape, loop: c.Loop}
	if len(c.Lanes) == 0 {
		a, _ := pool.Audio(c.File)
		m.lanes = []mixCueLane{{audio: a, src: c.Src}}
		return m
	}
	for _, l := range c.Lanes {
		a, _ := pool.Audio(l.File)
		m.lanes = append(m.lanes, mixCueLane{audio: a, src: l.Src})
	}
	return m
}

// CueLaunch asks for a cue clip to start (op "launch"), stop ("stop") or
// the one it isn't doing ("toggle"), on the next bar line -- or at once,
// with now, or when the tape isn't playing.
func (e *Engine) CueLaunch(id, clip, op string, now bool) error {
	e.mu.Lock()
	t := e.tape
	found := false
	if t != nil && t.ID == id && t.State.Cue != nil {
		for _, c := range t.State.Cue.Clips {
			found = found || c.ID == clip
		}
	}
	if found && (op == "launch" || op == "toggle") {
		e.useCue(clip)
	}
	e.mu.Unlock()
	if t == nil {
		return ErrNoTape
	}
	if t.ID != id {
		return ErrWrongTape
	}
	if !found {
		return ErrNoSuchCueClip
	}
	switch op {
	case "launch", "stop", "toggle":
	default:
		return fmt.Errorf("%w: op is launch, stop or toggle", ErrBadParameter)
	}
	q := QuantumBar
	if now {
		q = QuantumNow
	}
	e.Do(Action{Kind: "cue", Quantum: q, cue: &cueCmd{clip: clip, op: op}})
	return nil
}

// cueQueued notes a launch waiting for its frame, so the page can show it.
func (e *Engine) cueQueued(a Action) {
	if a.cue == nil {
		return
	}
	if e.cue.queued == nil {
		e.cue.queued = map[string]bool{}
	}
	e.cue.queued[a.cue.clip] = true
	e.cue.dirty = true
}

// cueApply carries out a launch or stop at output frame out.
func (e *Engine) cueApply(c cueCmd, out uint64) {
	p := &e.cue
	pos := int64(-1)
	if e.tr.playing {
		pos = e.tr.pos
	}
	delete(p.queued, c.clip)
	p.dirty = true
	i := slices.IndexFunc(p.voices, func(v cueVoice) bool { return v.clip == c.clip && v.stop == 0 })
	playing := i >= 0
	if c.op == "toggle" {
		c.op = "launch"
		if playing {
			c.op = "stop"
		}
	}
	switch {
	case c.op == "stop" && playing:
		p.voices[i].stop = out
	case c.op == "launch" && playing:
		// Again from its start, on the line it was launched for.
		p.voices[i].stop = out
		p.voices = append(p.voices, cueVoice{clip: c.clip, start: out, pos: pos})
	case c.op == "launch":
		p.voices = append(p.voices, cueVoice{clip: c.clip, start: out, pos: pos})
	}
}

// cueStopAll stops every clip at out: the transport stopped, or reset.
func (e *Engine) cueStopAll(out uint64) {
	p := &e.cue
	for i := range p.voices {
		if p.voices[i].stop == 0 {
			p.voices[i].stop = out
			p.dirty = true
		}
	}
	if len(p.queued) > 0 {
		clear(p.queued)
		p.dirty = true
	}
}

// renderCue adds the playing clips' output frames [out, out+n) into dst,
// and lets go of the ones that have finished.
func (e *Engine) renderCue(dst []float32, out uint64, n int, m *Mix) {
	p := &e.cue
	if len(p.voices) == 0 {
		return
	}
	d := max64(1, m.declick)
	end := out + uint64(n)
	keep := p.voices[:0]
	for _, v := range p.voices {
		c := m.cue[v.clip]
		if c == nil || c.frames <= 0 {
			p.dirty = true // removed from the lane, or its tape unloaded
			continue
		}
		last := end // the output frame after the last one it plays here
		if !c.loop {
			last = min(last, v.start+uint64(c.frames))
		}
		if v.stop > 0 {
			last = min(last, v.stop+uint64(d))
		}
		if dst != nil {
			for o := max(out, v.start); o < last; o++ {
				k := int64(o - v.start)
				if c.loop {
					k %= c.frames
				}
				// Each pass declicks at its ends, as a looped clip
				// joining itself would click there otherwise.
				fin, fout := max64(c.fadeIn, d), max64(c.fadeOut, d)
				g := c.gain * float32(fadeGain(k, c.frames, fin, fout, c.inShape, c.outShape))
				if v.stop > 0 && o >= v.stop {
					g *= 1 - float32(o-v.stop)/float32(d)
				}
				i := int(o-out) * OutChannels
				for _, ln := range c.lanes {
					if ln.audio == nil {
						continue
					}
					l, r := ln.audio.at(ln.src + k)
					dst[i] += l * g
					dst[i+1] += r * g
				}
			}
		}
		if last < end || (v.stop > 0 && v.stop+uint64(d) <= end) || (!c.loop && v.start+uint64(c.frames) <= end) {
			p.dirty = true
			continue
		}
		keep = append(keep, v)
	}
	p.voices = keep
}

// publishCue updates what Live reads, if anything changed, and says
// whether it did.
func (e *Engine) publishCue() bool {
	p := &e.cue
	if !p.dirty {
		return false
	}
	p.dirty = false
	v := CueLive{Playing: []string{}, Queued: []string{}, Starts: map[string]int64{}}
	for _, x := range p.voices {
		if x.stop == 0 {
			v.Playing = append(v.Playing, x.clip)
			v.Starts[x.clip] = x.pos
		}
	}
	for id := range p.queued {
		v.Queued = append(v.Queued, id)
	}
	slices.Sort(v.Queued)
	p.mu.Lock()
	p.view = v
	p.mu.Unlock()
	return true
}

// CueLive is what's playing on the cue lane; nil when nothing is or waits.
func (e *Engine) CueLive() *CueLive {
	p := &e.cue
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.view.Playing) == 0 && len(p.view.Queued) == 0 {
		return nil
	}
	v := CueLive{Playing: slices.Clone(p.view.Playing), Queued: slices.Clone(p.view.Queued), Starts: maps.Clone(p.view.Starts)}
	return &v
}

// CueFromClipboard puts the buffer (or the clipboard) on the cue lane,
// looping. A grab keeps its lanes and handles (cuegrab.go), sharing their
// pool files; anything else is summed to stereo in a pool file of its own.
func (e *Engine) CueFromClipboard(id string) (CueClip, error) {
	e.boardMu.Lock()
	c, err := e.Clipboard()
	if err == nil && c.Empty() {
		err = ErrEmptyClipboard
	}
	if err != nil {
		e.boardMu.Unlock()
		return CueClip{}, err
	}
	if c.Grab != nil {
		e.boardMu.Unlock()
		var added CueClip
		err := e.Edit(id, "cue:add", func(_ *Tape, s *State) error {
			cl := CueClip{Name: boardLabel(c), Loop: true, Source: "buffer"}
			cl.take(c)
			var err error
			added, err = s.cueAdd(cl)
			return err
		})
		if err != nil {
			return CueClip{}, err
		}
		e.markUsed(c)
		return added, nil
	}
	if err := e.diskOK(); err != nil {
		e.boardMu.Unlock()
		return CueClip{}, err
	}
	rel, path, err := e.store.NewPoolFile("cue", time.Now())
	if err != nil {
		e.boardMu.Unlock()
		return CueClip{}, err
	}
	data := make([]int32, 0, 2*c.Frames)
	err = e.renderBoard(c, func(b []int32) error {
		data = append(data, b...)
		return nil
	})
	if err == nil {
		// With its peaks beside it, as every pool file has: the lanes draw
		// from them once the clip is dragged onto a track.
		var pd *audio.PeakData
		if pd, err = audio.WriteWAV(path, data, 2, []int{0, 1}, e.store.SampleRate()); err == nil {
			err = audio.WritePeaks(strings.TrimSuffix(path, ".wav")+".peaks.json", pd)
		}
	}
	name := boardLabel(c)
	e.boardMu.Unlock()
	if err != nil {
		e.store.removePoolFile(rel)
		return CueClip{}, err
	}
	var added CueClip
	err = e.Edit(id, "cue:add", func(_ *Tape, s *State) error {
		var err error
		added, err = s.cueAdd(CueClip{File: rel, Name: name, Frames: c.Frames, Loop: true, Source: "buffer"})
		return err
	})
	if err != nil {
		e.store.removePoolFile(rel)
		return CueClip{}, err
	}
	e.markUsed(c)
	return added, nil
}

// CueFromTake puts a span of a take on the cue lane, looping, as a grab of
// it (GrabTake): with handles of the take's own audio, so its drawer trims
// it as it does a GRAB. Always added, never in another clip's place.
func (e *Engine) CueFromTake(id, take, title string, from, to int64, pick []int) (CueClip, error) {
	b, rel, err := e.grabTake(take, filepath.Base(take), title, from, to, pick)
	if err != nil {
		return CueClip{}, err
	}
	var added CueClip
	err = e.Edit(id, "cue:add", func(_ *Tape, s *State) error {
		c := CueClip{Name: title, Loop: true, Source: "take"}
		c.take(b)
		var err error
		added, err = s.cueAdd(c)
		return err
	})
	if err != nil {
		e.store.removePoolFile(rel)
	}
	return added, err
}
