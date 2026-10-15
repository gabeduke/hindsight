package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The Studio's buffer (docs/superpowers/specs/2026-10-15-studio-buffer-design.md):
// the clipboard, made visible. GRAB copies a span of the ring onto the
// clipboard at once -- the last N bars the tape played, by Catch's own
// arithmetic, or a span dragged across the feed -- from one source or
// several, each a clipboard track over the same span, with handles of at
// least a bar so the window can always widen. The window is then trimmed in
// place (the files never change), dropped on the tape as any clipboard is,
// kept as a take, or tossed. Nothing grabbed is lost without a toss: a grab
// that was never dropped or kept goes to the crate before anything replaces
// it.

// Grab is what the Studio's GRAB put on the clipboard: where its audio came
// from, the handles every lane's file has either side of it, and the window
// that plays. Frames count from the grab's start, its frame 0: the window is
// [In, Out), and may reach back into the handle before (In < 0) or on into
// the one after (Out > Frames).
type Grab struct {
	Sources []string `json:"sources"`
	Bars    int      `json:"bars,omitempty"`    // the last N bars
	Seconds float64  `json:"seconds,omitempty"` // or the last N seconds, with no tempo
	// Wall marks bars of wall-clock time at the tape's tempo, ending now:
	// the tape didn't play them, so there's no bar of the tape to take. Why
	// says why, in words.
	Wall    bool   `json:"wall,omitempty"`
	Why     string `json:"why,omitempty"`
	Clamped bool   `json:"clamped,omitempty"` // its start had left the ring: it starts later
	// RingFrom is the ring frame its frame 0 was heard at, and Frames how
	// long it was as grabbed.
	RingFrom int64 `json:"ring_from"`
	Frames   int64 `json:"frames"`
	// Before and After are the handles: every lane's file holds that much
	// more of the ring either side of [0, Frames).
	Before int64 `json:"before"`
	After  int64 `json:"after"`
	In     int64 `json:"in"`
	Out    int64 `json:"out"`
	// BarFrames is the tape's bar when it was grabbed (0: no tempo), and
	// Downbeat how far into the grab its first bar line is, where the tape
	// says so (it played them); nil when nobody knows.
	BarFrames float64 `json:"bar_frames,omitempty"`
	Downbeat  *int64  `json:"downbeat,omitempty"`
	Tape      string  `json:"tape,omitempty"` // the tape whose tempo it has
	// Reversed: every lane plays its audio backwards.
	Reversed bool `json:"reversed,omitempty"`
	// Used: it was dropped, or kept, so replacing it loses nothing.
	Used bool `json:"used,omitempty"`
	// Ring is the ring it was grabbed from (audio.Ring.ID): RingFrom means
	// something only in that one. Stale says, as it's read, that this isn't
	// that ring -- Hindsight has restarted since -- so its span can't be
	// copied again, nor shown on the feed. Never saved.
	Ring  string `json:"ring,omitempty"`
	Stale bool   `json:"stale,omitempty"`
	// Take is set on a grab of a take's span (GrabTake: the Listening
	// Room's "to the studio"), not the ring's: the take's file, and where in
	// it the grab starts. Its one lane is the take's own sound, so its
	// sources can't change; it was never in the ring, so it's never stale.
	Take     string `json:"take,omitempty"`
	TakeFrom int64  `json:"take_from,omitempty"`
}

// fileFrames is how long every lane's file is.
func (g *Grab) fileFrames() int64 { return g.Before + g.Frames + g.After }

// window lays a lane's clip over the grab's window: from frame In to Out of
// its file read forwards, or the same audio in a reversed file.
func (g *Grab) window(c *Clip) {
	c.Src = g.Before + g.In
	if g.Reversed {
		c.Src = g.fileFrames() - (g.Before + g.Out)
	}
	c.Frames = g.Out - g.In
	c.At = 0
}

// GrabRequest is what GRAB takes: the last Bars bars, the last Seconds
// seconds, or ring frames [RingFrom, RingTo) (RingTo nil: up to now), from
// Sources (none: MAIN, or the first there is). Again copies the buffer's
// own span once more, from other sources, and keeps its window.
type GrabRequest struct {
	Bars     int      `json:"bars"`
	Seconds  float64  `json:"seconds"`
	RingFrom *int64   `json:"ring_from"`
	RingTo   *int64   `json:"ring_to"`
	Sources  []string `json:"sources"`
	Again    bool     `json:"again"`
	// NoCrate: the buffer this replaces, if it was never dropped or kept, is
	// held as the one replaced grab and not put in the crate (GrabOpts).
	NoCrate bool `json:"-"`
}

// Grabbed is a grab, what it put in the crate (the unused buffer it replaced,
// when the crate is kept), and Replaced: that same unused buffer, which the Pi
// is now holding as its one replaced grab (replaced.go), for GRAB's Undo. Nil
// when the grab replaced nothing, or only a buffer that was dropped or kept.
type Grabbed struct {
	Board    *Clipboard  `json:"clipboard"`
	Crated   []CrateClip `json:"crated"`
	Replaced *Clipboard  `json:"replaced,omitempty"`
}

// GrabOpts changes what a grab does with the unused buffer it replaces.
// NoCrate: it is kept as the one replaced grab and nowhere else. The rooms
// send it, as the crate is no longer on their screens; without it a replaced
// grab goes to the crate first, as it always has.
type GrabOpts struct{ NoCrate bool }

// maxGrabSeconds bounds a grab of the last N seconds.
const maxGrabSeconds = 120

// grabHandle is how much of the ring a grab keeps either side: a bar at the
// tape's tempo, or TAPE_HANDLE_S, whichever is longer, at most
// MaxHandleSeconds -- so IN and OUT can always widen by a bar.
func (e *Engine) grabHandle(sr int64, bar float64) int64 {
	h := max64(e.handle(sr), int64(math.Round(bar)))
	return min64(h, MaxHandleSeconds*sr)
}

// grabSources resolves the names a grab asked for, in the order the tape
// lists its sources (so the lanes always fall in the same order), once each.
func (e *Engine) grabSources(names []string) ([]Source, error) {
	if len(names) == 0 {
		name := "main"
		if _, ok := e.source(name); !ok && len(e.sources) > 0 {
			name = e.sources[0].Name
		}
		names = []string{name}
	}
	want := map[string]bool{}
	for _, n := range names {
		if _, ok := e.source(n); !ok {
			return nil, fmt.Errorf("%w: no source %q", ErrBadParameter, n)
		}
		want[n] = true
	}
	var out []Source
	for _, s := range e.sources {
		if want[s.Name] {
			out = append(out, s)
		}
	}
	return out, nil
}

// Grab copies a span of the ring onto the clipboard as the Studio's buffer
// (GrabRequest says which). The clipboard it replaces, if it was a grab
// never dropped or kept, goes to the crate first.
func (e *Engine) Grab(req GrabRequest) (Grabbed, error) {
	if e.capture == nil {
		return Grabbed{}, ErrNoCapture
	}
	srcs, err := e.grabSources(req.Sources)
	if err != nil {
		return Grabbed{}, err
	}
	sr := int64(e.store.SampleRate())
	r := e.capture.Ring()
	t := e.Loaded()
	g := Grab{}
	if t != nil && t.Grid != nil {
		g.BarFrames, g.Tape = t.Grid.BarFrames(), t.ID
	}
	var keep *Clipboard // Again: the buffer whose window and shape carry on
	var from, to int64  // ring frames
	switch {
	case req.Again:
		old, err := e.Clipboard()
		if err != nil {
			return Grabbed{}, err
		}
		if old.Empty() || old.Grab == nil {
			return Grabbed{}, fmt.Errorf("%w: there's no grab in the buffer to take again", ErrBadParameter)
		}
		if old.Grab.Take != "" {
			return Grabbed{}, fmt.Errorf("%w: this buffer is a take's own sound, from %s; its sources can't change", ErrBadParameter, old.Grab.Take)
		}
		keep = old
		g = *old.Grab
		g.Reversed = false // the new files read forwards; turned below if it was
		from, to = g.RingFrom, g.RingFrom+g.Frames
	case req.RingFrom != nil:
		from, to = *req.RingFrom, -1
		if req.RingTo != nil {
			to = *req.RingTo
		}
		if to < 0 {
			_, total := r.Window()
			to = int64(total)
		}
		if g.BarFrames > 0 {
			g.Downbeat = e.downbeatAt(t, from, to-from)
		}
	case req.Bars > 0:
		if t == nil {
			return Grabbed{}, ErrNoTape
		}
		if t.Grid == nil {
			return Grabbed{}, fmt.Errorf("%w: grab seconds until it has one", ErrNoGrid)
		}
		g.Bars = req.Bars
		from, to, g.Downbeat, g.Why = e.barsOnRing(t, req.Bars)
		g.Wall = g.Why != ""
	case req.Seconds > 0:
		if req.Seconds > maxGrabSeconds {
			return Grabbed{}, fmt.Errorf("%w: a grab of the last seconds is at most %d s; drag across the feed for more", ErrBadParameter, maxGrabSeconds)
		}
		g.Seconds = req.Seconds
		_, total := r.Window()
		to = int64(total)
		from = to - int64(math.Round(req.Seconds*float64(sr)))
	default:
		return Grabbed{}, fmt.Errorf("%w: grab some bars, some seconds, or a span of the ring", ErrBadParameter)
	}

	// Again needs the very ring it was grabbed from: the ring's frames count
	// from its start, and start over when Hindsight does.
	if req.Again && g.Ring != r.ID() {
		return Grabbed{}, fmt.Errorf("%w: the buffer was grabbed before Hindsight restarted, so the feed it came from is gone; grab it again from the feed", ErrGone)
	}
	g.Ring = r.ID()
	if to <= from {
		return Grabbed{}, fmt.Errorf("%w: that span is empty", ErrBadParameter)
	}
	if oldest, _ := r.Window(); oldest > 0 && to <= int64(oldest)+sr {
		return Grabbed{}, fmt.Errorf("%w: that span has left the buffer", ErrGone)
	}
	if err := e.tooLong(to - from); err != nil {
		return Grabbed{}, err
	}
	if err := e.diskOK(); err != nil {
		return Grabbed{}, err
	}
	// The end may not be heard quite yet (a catch's latency), so it's waited
	// for, as a catch waits; then the handle after: what's played next is a
	// bar away, so it's waited for too -- the panel opens meanwhile -- unless
	// the ring stops coming.
	if !e.waitForRing(to, 2*time.Second) {
		return Grabbed{}, ErrNotYet
	}
	h := e.grabHandle(sr, g.BarFrames)
	e.waitForRing(to+h, time.Duration(float64(h)/float64(sr)*float64(time.Second))+time.Second)

	// Only now, the waiting done, where the ring starts: it went on recording
	// meanwhile, and overwrote its oldest audio. A start that has left it
	// moves to the oldest it has, a second in, as a copy from the ribbon
	// does; before the ring has filled, a start before its first frame moves
	// to that frame. Either way the panel says it was clamped.
	oldest, total := r.Window()
	floor := int64(oldest)
	if oldest > 0 {
		floor += sr // the capture may overwrite that second while it's copied
	}
	if from < floor {
		if req.Again {
			return Grabbed{}, fmt.Errorf("%w: the buffer's audio has started to leave the ring; grab it again from the feed", ErrGone)
		}
		if to <= floor && oldest == 0 {
			return Grabbed{}, fmt.Errorf("%w: the ring has nothing there yet", ErrNotYet)
		}
		if to <= floor {
			return Grabbed{}, fmt.Errorf("%w: that span has left the buffer", ErrGone)
		}
		if g.Downbeat != nil { // its first bar line, counted from the new start
			db := firstLine(*g.Downbeat-(floor-from), g.BarFrames, 0)
			g.Downbeat = &db
		}
		from, g.Clamped = floor, true
	}

	// The span, the crossfades' overhang either side (inside the ring's
	// oldest second if need be, as a copy's is), then the handles, as far as
	// the ring has them (ringHandles).
	over := int64(OverhangSeconds * float64(sr))
	lo, hi := max64(int64(oldest), from-over), min64(int64(total), to+over)
	lo, hi = ringHandles(r, sr, lo, hi, h-over)
	g.RingFrom, g.Frames, g.Before, g.After = from, to-from, from-lo, hi-to
	if keep == nil {
		g.In, g.Out = 0, g.Frames
	} else {
		g.In = max64(g.In, -g.Before)
		g.Out = min64(g.Out, g.Frames+g.After)
	}
	g.Sources = nil
	for _, s := range srcs {
		g.Sources = append(g.Sources, s.Name)
	}

	c := &Clipboard{Frames: g.Out - g.In, Created: time.Now(), Grab: &g, From: grabFrom(&g)}
	if keep != nil {
		c.Created = keep.Created // the same buffer, with other lanes
	}
	if g.BarFrames > 0 {
		c.BPM = math.Round(float64(BeatsPerBar)*60*float64(sr)/g.BarFrames*100) / 100
	}
	var made []string
	forget := func() {
		for _, rel := range made {
			e.store.removePoolFile(rel)
		}
	}
	for _, s := range srcs {
		rel, path, err := e.store.NewPoolFile("grab", time.Now())
		if err != nil {
			forget()
			return Grabbed{}, err
		}
		made = append(made, rel)
		peak, err := audio.WriteSpanMeasured(r, uint64(lo), uint64(hi), s.Pair[:], path, int(sr), from-lo, to-lo)
		if err != nil {
			forget()
			return Grabbed{}, err
		}
		cl := Clip{File: rel, Source: s.Name, PeakDB: peakDB(peak)}
		if keep != nil { // its level and fades carry on
			if prev := firstClip(keep); prev != nil {
				cl.GainDB = prev.GainDB
				cl.FadeIn, cl.FadeOut = prev.FadeIn, prev.FadeOut
				cl.FadeInShape, cl.FadeOutShape = prev.FadeInShape, prev.FadeOutShape
			}
		}
		g.window(&cl)
		c.Tracks = append(c.Tracks, []Clip{cl})
	}
	if keep != nil && keep.Grab.Reversed {
		// Turned round as it was: its fades are already the reversed ones.
		if err := e.turnBoard(c, false); err != nil {
			forget()
			return Grabbed{}, err
		}
	}

	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	if keep != nil {
		// Unless another grab got there first, this is the same buffer.
		if cur, err := e.store.LoadClipboard(); err == nil && cur != nil && cur.Created.Equal(keep.Created) {
			return Grabbed{Board: c, Crated: []CrateClip{}}, e.store.SaveClipboard(c)
		}
	}
	crated, replaced, err := e.replaceBoardLocked(c, GrabOpts{NoCrate: req.NoCrate})
	if err != nil {
		forget()
		return Grabbed{}, err
	}
	return Grabbed{Board: c, Crated: crated, Replaced: replaced}, nil
}

// GrabTake copies frames [from, to) of a take onto the clipboard as the
// Studio's buffer: the Listening Room's "to the studio", a note's span. The
// take's pair is written into the pool with handles from the take's own
// audio -- a bar at the take's tempo, or TAPE_HANDLE_S, whichever is longer,
// at most 10 s, as far as the take goes -- so the window can be trimmed as a
// grab from the feed is. title names the take in words (its label); file is
// its name. Like any grab, it puts an unused buffer it replaces in the crate.
func (e *Engine) GrabTake(take, file, title string, from, to int64, pick []int) (Grabbed, error) {
	return e.GrabTakeOpt(take, file, title, from, to, pick, GrabOpts{})
}

// GrabTakeOpt is GrabTake with GrabOpts.
func (e *Engine) GrabTakeOpt(take, file, title string, from, to int64, pick []int, opts GrabOpts) (Grabbed, error) {
	info, err := audio.ReadWAVInfo(take)
	if err != nil {
		return Grabbed{}, err
	}
	if info.SampleRate != e.store.SampleRate() {
		return Grabbed{}, fmt.Errorf("%w: the take is at %d Hz, tapes at %d", ErrBadParameter, info.SampleRate, e.store.SampleRate())
	}
	if from < 0 || to <= from || to > info.Frames() {
		return Grabbed{}, fmt.Errorf("%w: that span isn't in the take", ErrBadParameter)
	}
	if err := e.tooLong(to - from); err != nil {
		return Grabbed{}, err
	}
	if err := e.diskOK(); err != nil {
		return Grabbed{}, err
	}
	sr := int64(info.SampleRate)
	m := audio.ReadMeta(take)
	g := Grab{Take: file, TakeFrom: from, Sources: []string{title}, Frames: to - from}
	if m.BPM != nil && validBPM(*m.BPM) {
		g.BarFrames = float64(BeatsPerBar) * 60 * float64(sr) / *m.BPM
		if m.DownbeatFrame != nil { // its first bar line, counted from the grab's start
			db := firstLine(*m.DownbeatFrame-from, g.BarFrames, 0)
			g.Downbeat = &db
		}
	}
	h := e.grabHandle(sr, g.BarFrames)
	fileFrom, fileTo := max64(0, from-h), min64(info.Frames(), to+h)
	g.Before, g.After = from-fileFrom, fileTo-to
	g.In, g.Out = 0, g.Frames
	over := int64(OverhangSeconds * float64(sr))
	rel, path, err := e.store.NewPoolFile("grab", time.Now())
	if err != nil {
		return Grabbed{}, err
	}
	peak, err := audio.CopyWAVSpanMeasured(take, fileFrom, fileTo, pick, path,
		max64(0, from-over)-fileFrom, min64(info.Frames(), to+over)-fileFrom)
	if err != nil {
		e.store.removePoolFile(rel)
		return Grabbed{}, err
	}
	cl := Clip{File: rel, Source: "take", PeakDB: peakDB(peak)}
	g.window(&cl)
	c := &Clipboard{Tracks: [][]Clip{{cl}}, Frames: g.Frames, Created: time.Now(), Grab: &g,
		From: fmt.Sprintf("%s, %s–%s", title, clock(from, int(sr)), clock(to, int(sr)))}
	if m.BPM != nil {
		c.BPM = *m.BPM
	}
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	crated, replaced, err := e.replaceBoardLocked(c, opts)
	if err != nil {
		e.store.removePoolFile(rel)
		return Grabbed{}, err
	}
	return Grabbed{Board: c, Crated: crated, Replaced: replaced}, nil
}

// firstClip is a board's first clip, or nil.
func firstClip(c *Clipboard) *Clip {
	for _, tr := range c.Tracks {
		if len(tr) > 0 {
			return &tr[0]
		}
	}
	return nil
}

// grabFrom says where a grab came from, for the clipboard's from: "the feed,
// last 4 bars (ch1 + ch2)".
func grabFrom(g *Grab) string {
	what := "the feed"
	switch {
	case g.Bars > 0:
		what += fmt.Sprintf(", last %d bar%s", g.Bars, plural(g.Bars))
	case g.Seconds > 0:
		what += fmt.Sprintf(", last %s s", strings.TrimSuffix(fmt.Sprintf("%.1f", g.Seconds), ".0"))
	}
	return what + " (" + strings.Join(g.Sources, " + ") + ")"
}

// waitForRing waits, at most for wait, for the ring to have heard frame
// want, and says whether it has. It gives up early if the ring stops
// coming in, or the engine stops.
func (e *Engine) waitForRing(want int64, wait time.Duration) bool {
	r := e.capture.Ring()
	deadline := time.Now().Add(wait)
	if e.grabWait > 0 {
		deadline = time.Now().Add(min(wait, e.grabWait))
	}
	_, last := r.Window()
	moved := time.Now()
	for {
		_, total := r.Window()
		if int64(total) >= want {
			return true
		}
		if total != last {
			last, moved = total, time.Now()
		}
		if time.Now().After(deadline) || time.Since(moved) > 500*time.Millisecond {
			return false
		}
		select {
		case <-e.stop:
			return false
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// barsOnRing is where the ring heard the last n bars the tape played, as
// Catch finds them (lastBars, ringSpan), and how far into them the first bar
// line is. When the tape didn't play them -- stopped, moved, on a phone, not
// lined up -- it's the last n bars of wall-clock time at the tape's tempo,
// ending now, and why says why.
func (e *Engine) barsOnRing(t *Tape, n int) (from, to int64, downbeat *int64, why string) {
	err := e.jamOnly()
	if err == nil && !e.tr.Status().Playing {
		err = errStopped
	}
	if err == nil {
		delta, aligned := e.delta()
		if aligned == "none" {
			err = ErrNotLined
		} else {
			var outFrom uint64
			var frames, at int64
			outFrom, frames, at, err = e.lastBars(t, n, delta)
			if err == nil {
				var heard int64
				heard, _, err = e.ringSpan(outFrom, frames)
				if err == nil {
					db := t.Grid.NextBar(at) - at
					return heard, heard + frames, &db, ""
				}
			}
		}
	}
	_, total := e.capture.Ring().Window()
	frames := int64(math.Round(float64(n) * t.Grid.BarFrames()))
	return int64(total) - frames, int64(total), nil, wallWhy(err)
}

// errStopped is a grab of bars while the tape stands still.
var errStopped = errors.New("the tape isn't playing")

// wallWhy says, in words, why a grab of bars took wall-clock time.
func wallWhy(err error) string {
	switch {
	case errors.Is(err, errStopped):
		return "the tape isn't playing"
	case errors.Is(err, ErrNeedsJamRoom):
		return "the tape is playing on a phone"
	case errors.Is(err, ErrNotLined):
		return "the tape isn't lined up with the capture yet"
	case errors.Is(err, ErrNotPlayed):
		return "the tape didn't play them straight through"
	case errors.Is(err, ErrSlipped):
		return "the output slipped against the recording"
	case err != nil:
		return strings.TrimPrefix(err.Error(), ErrBadParameter.Error()+": ")
	}
	return "the tape didn't play them"
}

// downbeatAt is how far into ring frames [from, from+frames) the tape's
// first bar line was heard, if the tape played straight through them; nil if
// it didn't, or nobody knows.
func (e *Engine) downbeatAt(t *Tape, from, frames int64) *int64 {
	if t == nil || t.Grid == nil || frames <= 0 || e.jamOnly() != nil {
		return nil
	}
	delta, aligned := e.delta()
	if aligned == "none" {
		return nil
	}
	delta += int64(math.Round(e.latencyMS * float64(e.store.SampleRate()) / 1000))
	out := from - delta
	if out < 0 {
		return nil
	}
	pos, ok := e.tr.continuous(uint64(out), uint64(out+frames), t.Loop)
	if !ok {
		return nil
	}
	db := t.Grid.NextBar(pos) - pos
	return &db
}

// --- one buffer at a time -------------------------------------------------------

// setBoard replaces the clipboard. A grab it replaces that was never
// dropped or kept goes to the crate first, one kept clip per lane, so
// nothing grabbed is lost without a toss; it answers what it kept.
func (e *Engine) setBoard(c *Clipboard) ([]CrateClip, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	return e.setBoardLocked(c)
}

func (e *Engine) setBoardLocked(c *Clipboard) ([]CrateClip, error) {
	kept, _, err := e.replaceBoardLocked(c, GrabOpts{})
	return kept, err
}

// setBoardOpt is setBoard with GrabOpts, answering the buffer it replaced
// (held for Undo) as well: a range's Cut and Copy use it.
func (e *Engine) setBoardOpt(c *Clipboard, opts GrabOpts) (*Clipboard, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	_, replaced, err := e.replaceBoardLocked(c, opts)
	return replaced, err
}

// replaceBoardLocked replaces the clipboard with c. A buffer it replaces that
// was never dropped, inserted or kept -- a grab, or a cut or copy -- is held as
// the one replaced grab (replaced.go), for Undo. A *grab* is also put in the
// crate, so nothing grabbed is lost without a toss, unless opts says not. It
// answers what it put in the crate and the buffer it replaced, if it was one
// of those. If a write after the slot's fails, the slot is put back as it was,
// so the Undo that was there is not lost to a replacement that did not happen.
func (e *Engine) replaceBoardLocked(c *Clipboard, opts GrabOpts) ([]CrateClip, *Clipboard, error) {
	kept := []CrateClip{}
	var replaced *Clipboard
	var rollback func()
	if old, err := e.store.LoadClipboard(); err == nil && !old.Empty() && !old.used() &&
		(c == nil || !c.Created.Equal(old.Created)) {
		if c != nil {
			prev, _ := e.store.loadReplaced()
			if err := e.store.saveReplaced(old, c.Created); err != nil {
				return nil, nil, fmt.Errorf("the buffer it would replace couldn't be held for Undo first: %w", err)
			}
			replaced = old
			rollback = func() { e.store.putReplaced(prev) }
		}
		if old.Grab != nil && !opts.NoCrate {
			ks, err := e.keepBoard(old)
			if err != nil {
				if rollback != nil {
					rollback()
				}
				return nil, nil, fmt.Errorf("the buffer it would replace couldn't be kept in the crate first: %w", err)
			}
			kept = ks
		}
	}
	if err := e.store.SaveClipboard(c); err != nil {
		if rollback != nil {
			rollback()
		}
		return nil, nil, err
	}
	return kept, replaced, nil
}

// markUsed notes that the buffer c was dropped, inserted or kept, if it's
// still the one on the clipboard.
func (e *Engine) markUsed(c *Clipboard) {
	if c == nil || c.used() {
		return
	}
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	cur, err := e.store.LoadClipboard()
	if err != nil || cur == nil || cur.used() || !cur.Created.Equal(c.Created) {
		return
	}
	if cur.Grab != nil {
		cur.Grab.Used = true
	} else {
		cur.Used = true
	}
	if err := e.store.SaveClipboard(cur); err != nil {
		log.Printf("[!] tape: the buffer was used, but couldn't be marked so: %v", err)
	}
}

// keepBoard keeps a board in the crate by reference, one clip per lane: a
// lane must be one clip, the board's whole length.
func (e *Engine) keepBoard(b *Clipboard) ([]CrateClip, error) {
	type lane struct {
		c Clip
		n int
	}
	var lanes []lane
	for i, tr := range b.Tracks {
		switch {
		case len(tr) == 0:
			continue
		case len(tr) != 1 || tr[0].At != 0 || tr[0].Frames != b.Frames:
			return nil, fmt.Errorf("%w: the clipboard holds %d clips on track %d; keep them one at a time, from the tape", ErrBadParameter, len(tr), i+1)
		}
		lanes = append(lanes, lane{tr[0], i + 1})
	}
	if len(lanes) == 0 {
		return nil, ErrEmptyClipboard
	}
	sr := e.store.SampleRate()
	now := time.Now()
	var ks []CrateClip
	for i, l := range lanes {
		from := b.From
		switch {
		case b.Grab != nil && b.Grab.Take != "":
			from = b.From
		case b.Grab != nil:
			from = "The feed (" + l.c.Source + ")"
		case len(lanes) > 1:
			from = fmt.Sprintf("%s · track %d", b.From, l.n)
		}
		k := CrateClip{ID: newCrateID(), File: l.c.File, Src: l.c.Src, Frames: l.c.Frames, Reversed: l.c.Reversed, BPM: b.BPM,
			Name:    fmt.Sprintf("%s · %s", from, clock(l.c.Frames, sr)),
			Source:  CrateSource{Kind: "clipboard", What: b.From},
			Created: now.Add(time.Duration(len(lanes)-i) * time.Millisecond), // newest first: the first lane first
		}
		ks = append(ks, k)
	}
	err := e.changeCrate(func(c *Crate) error {
		c.Clips = append(c.Clips, ks...)
		return nil
	})
	return ks, err
}

// --- the window, and its shape ----------------------------------------------------

// TrimClipboard moves the buffer's window to [in, out), in frames from the
// grab's start: the files stay as they are, and every lane's clip reads the
// new window, as edge trim moves a tape clip's edges. It never leaves the
// handles: each edge stops the crossfades' overhang short of its file's end
// (or where it already is, if that's nearer), and the window keeps at least
// the overhang's length.
func (e *Engine) TrimClipboard(in, out int64) (*Clipboard, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	c, g, err := e.grabBoard()
	if err != nil {
		return nil, err
	}
	over := int64(OverhangSeconds * float64(e.store.SampleRate()))
	minLen := max64(1, over)
	lo := min64(g.In, -g.Before+over)
	hi := max64(g.Out, g.Frames+g.After-over)
	if hi-lo < minLen {
		return nil, fmt.Errorf("%w: there's no room to trim it", ErrBadParameter)
	}
	in = min64(max64(in, lo), hi-minLen)
	out = min64(max64(out, in+minLen), hi)
	g.In, g.Out = in, out
	for i := range c.Tracks {
		for j := range c.Tracks[i] {
			g.window(&c.Tracks[i][j])
		}
	}
	c.Frames = out - in
	return e.markStale(c), e.store.SaveClipboard(c)
}

// markStale says, on a board as it's read, whether its grab came from
// another ring than the capture's now (Grab.Stale).
func (e *Engine) markStale(c *Clipboard) *Clipboard {
	if c != nil && c.Grab != nil {
		c.Grab.Stale = c.Grab.Take == "" && (e.capture == nil || c.Grab.Ring != e.capture.Ring().ID())
	}
	return c
}

// grabBoard is the clipboard, if it holds a grab.
func (e *Engine) grabBoard() (*Clipboard, *Grab, error) {
	c, err := e.store.LoadClipboard()
	if err != nil {
		return nil, nil, err
	}
	if c.Empty() {
		return nil, nil, ErrEmptyClipboard
	}
	if c.Grab == nil {
		return nil, nil, fmt.Errorf("%w: only a grab is trimmed in the buffer; this was copied, so trim it on the tape", ErrBadParameter)
	}
	return c, c.Grab, nil
}

// BoardShape is what the buffer's keys change on every lane: the level, the
// fades (frames, and their curves), Normalize, and Reverse.
type BoardShape struct {
	GainDB       *float64 `json:"gain_db"`
	FadeIn       *int64   `json:"fade_in"`
	FadeOut      *int64   `json:"fade_out"`
	FadeInShape  *string  `json:"fade_in_shape"`
	FadeOutShape *string  `json:"fade_out_shape"`
	Normalize    bool     `json:"normalize"`
	Reverse      bool     `json:"reverse"`
}

// Empty says it changes nothing.
func (s BoardShape) Empty() bool {
	return s.GainDB == nil && s.FadeIn == nil && s.FadeOut == nil && s.FadeInShape == nil && s.FadeOutShape == nil && !s.Normalize && !s.Reverse
}

// ShapeClipboard changes the buffer's lanes, all alike: their level, their
// fades, Normalize (the loudest lane's peak to audio.NormalizePeakDB, at most
// audio.MaxNormalizeGainDB up), and Reverse (each lane's audio turned round,
// as a tape clip's is: its file and handles written backwards once, and
// played forwards again from the original). Outside undo, like the rest of
// the buffer.
func (e *Engine) ShapeClipboard(s BoardShape) (*Clipboard, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	c, _, err := e.grabBoard()
	if err != nil {
		return nil, err
	}
	if s.FadeInShape != nil && !ValidFadeShape(*s.FadeInShape) || s.FadeOutShape != nil && !ValidFadeShape(*s.FadeOutShape) {
		return nil, fmt.Errorf("%w: a fade's curve is equal power (\"\"), linear, s or exp", ErrBadParameter)
	}
	gain := s.GainDB
	if s.Normalize {
		db, err := e.normalizeGain(c)
		if err != nil {
			return nil, err
		}
		gain = &db
	}
	for i := range c.Tracks {
		for j := range c.Tracks[i] {
			cl := &c.Tracks[i][j]
			if gain != nil {
				cl.GainDB = math.Round(math.Max(-60, math.Min(audio.MaxNormalizeGainDB, *gain))*10) / 10
			}
			if s.FadeIn != nil {
				cl.FadeIn = min64(max64(0, *s.FadeIn), c.Frames)
			}
			if s.FadeOut != nil {
				cl.FadeOut = min64(max64(0, *s.FadeOut), c.Frames)
			}
			if s.FadeInShape != nil {
				cl.FadeInShape = *s.FadeInShape
			}
			if s.FadeOutShape != nil {
				cl.FadeOutShape = *s.FadeOutShape
			}
		}
	}
	if s.Reverse {
		if err := e.turnBoard(c, true); err != nil {
			return nil, err
		}
	}
	return e.markStale(c), e.store.SaveClipboard(c)
}

// normalizeGain is the gain that brings the buffer's lanes, summed as KEEP
// AS TAKE and AUDITION sum them, to audio.NormalizePeakDB at their loudest,
// at most audio.MaxNormalizeGainDB up: the lanes keep their balance, and the
// sum never goes over the top. Silence gets none.
func (e *Engine) normalizeGain(c *Clipboard) (float64, error) {
	unity := *c
	unity.Tracks = make([][]Clip, len(c.Tracks))
	for i, tr := range c.Tracks {
		unity.Tracks[i] = append([]Clip(nil), tr...)
		for j := range unity.Tracks[i] {
			unity.Tracks[i][j].GainDB = 0
		}
	}
	peak, err := e.boardPeak(&unity)
	if err != nil {
		return 0, fmt.Errorf("the buffer's level can't be read: %w", err)
	}
	if peak <= 0 {
		return 0, nil
	}
	gain := math.Min(audio.NormalizePeakDB-20*math.Log10(peak), audio.MaxNormalizeGainDB)
	return math.Round(gain*10) / 10, nil
}

// turnBoard turns every lane of a grabbed board round: a lane playing
// forwards plays a reversed copy of its whole file (written once, handles
// and all, so the window still has them), one already reversed plays its
// original again. With swap, the fades go with the audio, as a tape clip's
// do: backwards, its end is its start.
func (e *Engine) turnBoard(c *Clipboard, swap bool) error {
	g := c.Grab
	var made []string
	forget := func() {
		for _, rel := range made {
			e.store.removePoolFile(rel)
		}
	}
	for i := range c.Tracks {
		for j := range c.Tracks[i] {
			cl := &c.Tracks[i][j]
			if g.Reversed {
				if cl.Reversed == nil {
					forget()
					return fmt.Errorf("%w: a lane of the buffer lost the audio it was reversed from", ErrBadParameter)
				}
				cl.File, cl.Reversed = cl.Reversed.File, nil
			} else {
				if err := e.diskOK(); err != nil {
					forget()
					return err
				}
				rel, dst, err := e.store.NewPoolFile("rev", time.Now())
				if err != nil {
					forget()
					return err
				}
				made = append(made, rel)
				if err := audio.ReverseWAVSpan(e.store.AudioPath(cl.File), 0, g.fileFrames(), dst); err != nil {
					forget()
					return err
				}
				cl.Reversed = &Reversal{File: cl.File, End: g.fileFrames()}
				cl.File = rel
			}
			if swap {
				cl.FadeIn, cl.FadeOut = cl.FadeOut, cl.FadeIn
				cl.FadeInShape, cl.FadeOutShape = cl.FadeOutShape, cl.FadeInShape
			}
		}
	}
	g.Reversed = !g.Reversed
	for i := range c.Tracks {
		for j := range c.Tracks[i] {
			g.window(&c.Tracks[i][j])
		}
	}
	return nil
}

// --- KEEP AS TAKE ---------------------------------------------------------------

// KeptTake is a take kept from the buffer.
type KeptTake struct {
	Name    string  `json:"name"`
	Label   string  `json:"label"`
	Seconds float64 `json:"seconds"`
}

// KeepClipboardTake saves the clipboard -- the buffer's window -- as a take
// in dir, from its own audio, so it works after the ring has moved on: its
// lanes summed to stereo with their levels and fades, as MAIN sums the
// strips, and a 3 ms declick at either end, as a cut has. Its label names
// its sources, its origin is the buffer, and a grab's tempo and downbeat
// are the tape's.
func (e *Engine) KeepClipboardTake(dir string, now time.Time) (KeptTake, error) {
	c, err := e.Clipboard()
	if err != nil {
		return KeptTake{}, err
	}
	if c.Empty() {
		return KeptTake{}, ErrEmptyClipboard
	}
	sr := e.store.SampleRate()
	m := audio.Meta{Label: boardLabel(c), Origin: audio.OriginBuffer}
	if g := c.Grab; g != nil && g.BarFrames > 0 {
		bpm := math.Round(float64(BeatsPerBar)*60*float64(sr)/g.BarFrames*100) / 100
		m.BPM, m.TempoFrom = &bpm, audio.TempoFromYou
		if g.Downbeat != nil && !g.Reversed {
			db := firstLine(*g.Downbeat, g.BarFrames, g.In) - g.In
			m.DownbeatFrame = &db
		}
	} else if c.BPM > 0 {
		bpm := c.BPM
		m.BPM = &bpm
	}
	name, err := audio.WriteTake(dir, now, c.Frames, 2, sr, func(write func([]int32) error) error {
		return e.renderBoard(c, write)
	}, m)
	if err != nil {
		return KeptTake{}, err
	}
	e.markUsed(c)
	return KeptTake{Name: name, Label: m.Label, Seconds: float64(c.Frames) / float64(sr)}, nil
}

// firstLine is the first bar line at or after frame at, the bar lines
// falling at downbeat + round(n × bar).
func firstLine(downbeat int64, bar float64, at int64) int64 {
	line := func(n int64) int64 { return downbeat + int64(math.Round(float64(n)*bar)) }
	n := int64(math.Ceil(float64(at-downbeat) / bar))
	for line(n) < at {
		n++
	}
	for line(n-1) >= at {
		n--
	}
	return line(n)
}

// boardLabel names a take kept from the clipboard: its sources, for a grab.
func boardLabel(c *Clipboard) string {
	if c.Grab != nil {
		return "Buffer · " + strings.Join(c.Grab.Sources, " + ")
	}
	return "Clipboard · " + c.From
}

// sumCeiling is as loud as a buffer's lanes summed may be (about −0.3
// dBFS): a sum that would go over is brought down as a whole, never clipped.
const sumCeiling = 0.966

// mixBoard sums the clipboard's tracks to stereo, chunk by chunk, with each
// clip's level and fades, and hands each chunk -- n frames, interleaved -- to
// emit.
func (e *Engine) mixBoard(c *Clipboard, emit func(buf []float64, b0, n int64) error) error {
	const chunk = 1 << 15
	buf := make([]float64, 2*chunk)
	for b0 := int64(0); b0 < c.Frames; b0 += chunk {
		b1 := min64(c.Frames, b0+chunk)
		n := b1 - b0
		clear(buf[:2*n])
		for _, tr := range c.Tracks {
			for _, cl := range tr {
				from, to := max64(b0, cl.At), min64(b1, cl.End())
				if to <= from {
					continue
				}
				path := e.store.AudioPath(cl.File)
				g := math.Pow(10, cl.GainDB/20)
				fin, fout := cl.fades()
				start := cl.Src + (from - cl.At)
				info, err := audio.ReadWAVInfo(path)
				if err != nil {
					return err
				}
				nc := info.Channels
				_, err = audio.ReadFrames(path, start, start+(to-from), 1<<14, func(b []int32, first int64) error {
					for i := 0; i < len(b)/nc; i++ {
						l := float64(b[i*nc]) / 2147483648.0
						r := l
						if nc > 1 {
							r = float64(b[i*nc+1]) / 2147483648.0
						}
						k := from + (first - start) + int64(i) // the board's frame
						fg := g
						if fin > 0 || fout > 0 {
							fg *= fadeGain(k-cl.At, cl.Frames, fin, fout, cl.FadeInShape, cl.FadeOutShape)
						}
						buf[2*(k-b0)] += l * fg
						buf[2*(k-b0)+1] += r * fg
					}
					return nil
				})
				if err != nil {
					return err
				}
			}
		}
		if err := emit(buf[:2*n], b0, n); err != nil {
			return err
		}
	}
	return nil
}

// boardPeak is the loudest sample of the clipboard's tracks summed.
func (e *Engine) boardPeak(c *Clipboard) (float64, error) {
	peak := 0.0
	err := e.mixBoard(c, func(buf []float64, _, _ int64) error {
		for _, v := range buf {
			peak = math.Max(peak, math.Abs(v))
		}
		return nil
	})
	return peak, err
}

// sumScale is what a sum peaking at peak is multiplied by to stay under
// sumCeiling: 1 when it already does.
func sumScale(peak float64) float64 {
	if peak > sumCeiling {
		return sumCeiling / peak
	}
	return 1
}

// renderBoard sums the clipboard's tracks to stereo (mixBoard), brought
// under full scale as a whole if the sum would go over, with a 3 ms declick
// at either end, as 32-bit frames.
func (e *Engine) renderBoard(c *Clipboard, write func([]int32) error) error {
	peak, err := e.boardPeak(c)
	if err != nil {
		return err
	}
	scale := sumScale(peak)
	declick := audio.FadeFrames(e.store.SampleRate())
	out := make([]int32, 2*(1<<15))
	return e.mixBoard(c, func(buf []float64, b0, n int64) error {
		for i := int64(0); i < n; i++ {
			k := b0 + i
			d := scale
			if k < declick {
				d *= float64(k) / float64(declick)
			} else if left := c.Frames - 1 - k; left < declick {
				d *= float64(left) / float64(declick)
			}
			for ch := int64(0); ch < 2; ch++ {
				v := math.Round(buf[2*i+ch] * d * 2147483647)
				out[2*i+ch] = int32(math.Max(-2147483648, math.Min(2147483647, v)))
			}
		}
		return write(out[:2*n])
	})
}

// --- TOSS, and its Undo -------------------------------------------------------------

func (s *Store) tossedPath() string { return filepath.Join(s.dir, "clipboard-tossed.json") }

// loadTossed reads the buffer last tossed, or nil.
func (s *Store) loadTossed() (*Clipboard, error) {
	b, err := os.ReadFile(s.tossedPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var c Clipboard
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("the tossed buffer: %w", err)
	}
	return &c, nil
}

// TossClipboard empties the clipboard, keeping what it held aside -- a root
// for the clean-up -- until the next toss, so a toss can be undone
// (RestoreClipboard). Plain ClearClipboard keeps nothing.
func (e *Engine) TossClipboard() error {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	if c, err := e.store.LoadClipboard(); err == nil && !c.Empty() {
		b, err := json.MarshalIndent(c, "", "  ")
		if err != nil {
			return err
		}
		e.store.mu.Lock()
		err = writeSynced(e.store.tossedPath(), b)
		e.store.mu.Unlock()
		if err != nil {
			return err
		}
	}
	if err := e.store.SaveClipboard(nil); err != nil {
		return err
	}
	// What a grab replaced is not undoable once the buffer that replaced it
	// is tossed: its Undo ends here, and the toss keeps that buffer instead.
	e.store.clearReplaced()
	return nil
}

// RestoreClipboard brings the last tossed buffer back onto the clipboard:
// a toss's Undo. What it replaces is replaced as a grab replaces it.
func (e *Engine) RestoreClipboard() (*Clipboard, []CrateClip, error) {
	c, kept, _, err := e.RestoreClipboardOpt(GrabOpts{})
	return c, kept, err
}

// RestoreClipboardOpt is RestoreClipboard with GrabOpts, answering the
// buffer it replaced, if it was one nobody had used (held for Undo).
func (e *Engine) RestoreClipboardOpt(opts GrabOpts) (*Clipboard, []CrateClip, *Clipboard, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	c, err := e.store.loadTossed()
	if err != nil {
		return nil, nil, nil, err
	}
	if c.Empty() {
		return nil, nil, nil, fmt.Errorf("%w: nothing was tossed to bring back", ErrNothingToDo)
	}
	kept, replaced, err := e.replaceBoardLocked(c, opts)
	if err != nil {
		return nil, nil, nil, err
	}
	e.store.mu.Lock()
	os.Remove(e.store.tossedPath())
	e.store.mu.Unlock()
	return e.markStale(c), kept, replaced, nil
}
