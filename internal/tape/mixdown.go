package tape

import (
	"errors"
	"fmt"
	"log"
	"math"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The OP-1 makes a mixdown by recording its own output in real time.
// Hindsight is recording MAIN all the time, so a mixdown plays the tape from
// In to Out once -- the loop ignored, the click silent -- runs a tail on for
// the strips' reverb and delay, and saves that span of the ring as an
// ordinary take: the Sidekick's FX and anything played live over it, all in.
// Nothing is rendered offline.

// TakeSaver saves a span of the ring as a take: the app's saver.
type TakeSaver interface {
	SaveRange(from, to uint64, opts ...audio.SaveOption) (audio.SavedRange, error)
}

// maxMixdownTail bounds TAPE_MIXDOWN_TAIL_S.
const maxMixdownTail = 30.0 // seconds

// mixdownMargin is how much ring a mixdown leaves spare: the span must still
// be there once the tail is in.
const mixdownMargin = 5.0 // seconds

// alignSettle is how long a mixdown waits after its tail is in for the
// aligner's next step (every 500 ms), to know if anything slipped.
const alignSettle = 600 * time.Millisecond

var (
	ErrNoOutput   = errors.New("nothing plays the tape: the output isn't open")
	ErrMixingDown = errors.New("a mixdown is playing; wait for it, or press ■ to cancel it")
	ErrNoSaver    = errors.New("there's no recorder to save a mixdown with")
)

// Mixdown is a mixdown's progress, for the page.
type Mixdown struct {
	ID    uint64 `json:"id"`
	Tape  string `json:"tape"`
	State string `json:"state"` // playing, tail (ringing out), saving, done, failed
	From  int64  `json:"from"`  // tape frames: what plays, [From, To)
	To    int64  `json:"to"`
	Tail  int64  `json:"tail"` // frames run on past To
	Take  string `json:"take,omitempty"`
	Error string `json:"error,omitempty"`
}

var mixdownIDs atomic.Uint64

// StartMixdown mixes down the loaded tape: the loop's In to Out, or with
// all, the whole tape from its start to the end of its last clip. It
// answers at once; Live's mixdown follows it.
func (e *Engine) StartMixdown(id string, all bool) (Mixdown, error) {
	if err := e.jamOnly(); err != nil {
		return Mixdown{}, err
	}
	t := e.Loaded()
	if t == nil {
		return Mixdown{}, ErrNoTape
	}
	if t.ID != id {
		return Mixdown{}, ErrWrongTape
	}
	switch {
	case e.saver == nil:
		return Mixdown{}, ErrNoSaver
	case e.capture == nil:
		return Mixdown{}, ErrNoCapture
	case e.sink == nil:
		return Mixdown{}, ErrNoOutput
	case t.Empty():
		return Mixdown{}, fmt.Errorf("%w: there's nothing on the tape to mix down", ErrBadParameter)
	}
	if _, how := e.delta(); how == "none" {
		return Mixdown{}, ErrNotLined
	}
	// The take will need the room: better said now than after the music.
	if e.minFreeGB > 0 && e.takesDir != "" {
		if free, _ := audio.FreeGB(e.takesDir); free < e.minFreeGB {
			return Mixdown{}, fmt.Errorf("%w: %.2f GB free where takes go, need %.2f GB", audio.ErrLowDisk, free, e.minFreeGB)
		}
	}
	from, to := t.Loop.In, t.Loop.Out
	if all || to <= from {
		from, to = 0, e.mix.Load().end
	}
	if to > t.Length {
		to = t.Length
	}
	if to <= from {
		return Mixdown{}, fmt.Errorf("%w: there's nothing on the tape to mix down", ErrBadParameter)
	}
	sr := float64(e.store.SampleRate())
	tail := int64(math.Round(e.tailSeconds * sr))
	room := float64(e.capture.Ring().Capacity()) - mixdownMargin*sr - float64(tail)
	if float64(to-from) > room {
		if room <= 0 {
			return Mixdown{}, fmt.Errorf("%w: the recording buffer (RING_SECONDS) is too short for a mixdown", ErrBadParameter)
		}
		return Mixdown{}, fmt.Errorf("%w: this is %.0f s, and the recording buffer has room for a mixdown of %.0f s",
			ErrBadParameter, float64(to-from)/sr, room/sr)
	}

	// Under the recording's lock, then the mixdown's -- the order Record
	// takes them in -- so a punch and a mixdown can't both start.
	e.recMu.Lock()
	e.mixMu.Lock()
	if err := e.jamOnly(); err != nil { // a switch to a phone may have come in since
		e.mixMu.Unlock()
		e.recMu.Unlock()
		return Mixdown{}, err
	}
	if e.mixdown != nil && e.mixdown.busy() {
		e.mixMu.Unlock()
		e.recMu.Unlock()
		return Mixdown{}, ErrMixingDown
	}
	// A punch or an armed track would fight it for the transport.
	if e.rec != nil || e.tap != nil && time.Since(e.tap.at) <= tapExpiry {
		e.mixMu.Unlock()
		e.recMu.Unlock()
		return Mixdown{}, ErrRecording
	}
	m := &Mixdown{ID: mixdownIDs.Add(1), Tape: t.ID, State: "playing", From: from, To: to, Tail: tail}
	e.mixdown = m
	snapshot := *m
	e.mixMu.Unlock()
	e.recMu.Unlock()

	e.Do(Action{Kind: "once", Pos: from, End: to, job: m.ID})
	go e.runMixdown(m.ID, t.Name, t.Grid, from, to-from)
	return snapshot, nil
}

// MixdownStatus is the last mixdown, if there's been one.
func (e *Engine) MixdownStatus() *Mixdown {
	e.mixMu.Lock()
	defer e.mixMu.Unlock()
	if e.mixdown == nil {
		return nil
	}
	m := *e.mixdown
	return &m
}

// busy is a mixdown whose pass or tail is still being recorded, or saved.
func (m *Mixdown) busy() bool {
	return m.State == "playing" || m.State == "tail" || m.State == "saving"
}

// mixdownBusy reports a mixdown still using the transport: playing its
// pass, or recording its tail.
func (e *Engine) mixdownBusy() bool {
	e.mixMu.Lock()
	defer e.mixMu.Unlock()
	return e.mixdown != nil && (e.mixdown.State == "playing" || e.mixdown.State == "tail")
}

func (e *Engine) setMixdown(id uint64, fn func(m *Mixdown)) {
	e.mixMu.Lock()
	defer e.mixMu.Unlock()
	if e.mixdown != nil && e.mixdown.ID == id {
		fn(e.mixdown)
	}
}

// runMixdown follows a mixdown's pass, then saves it.
func (e *Engine) runMixdown(id uint64, name string, grid *Grid, passFrom, frames int64) {
	fail := func(err error) {
		log.Printf("[!] tape: mixdown: %v", err)
		e.setMixdown(id, func(m *Mixdown) { m.State, m.Error = "failed", err.Error() })
	}
	defer func() {
		if p := recover(); p != nil {
			fail(fmt.Errorf("it went wrong: %v", p))
		}
	}()
	sr := float64(e.store.SampleRate())
	var tail int64
	e.mixMu.Lock()
	if e.mixdown != nil && e.mixdown.ID == id {
		tail = e.mixdown.Tail
	}
	e.mixMu.Unlock()

	// The pass: until it ends, or is cut short.
	deadline := time.Now().Add(time.Duration(float64(frames)/sr*float64(time.Second)) + 20*time.Second)
	var run onceRun
	for {
		run = e.tr.Once()
		if run.Job == id && run.Done {
			break
		}
		if run.Job == id && run.Broken || run.Job > id {
			fail(errors.New("it was stopped before the end; nothing was saved"))
			return
		}
		if time.Now().After(deadline) {
			e.Do(Action{Kind: "stop"})
			fail(errors.New("the tape didn't play it through; nothing was saved"))
			return
		}
		select {
		case <-e.stop:
			return
		case <-time.After(20 * time.Millisecond):
		}
	}

	e.setMixdown(id, func(m *Mixdown) { m.State = "tail" })

	// Where it is in the ring: through the Δ that held while it played --
	// and not TAPE_LATENCY_MS, which is for a player hearing the tape late:
	// the tape itself reaches the ring at Δ.
	delta, aligned := e.deltaAt(run.StartOut)
	if aligned == "none" {
		fail(ErrNotLined)
		return
	}
	from, to := int64(run.StartOut)+delta, int64(run.EndOut)+tail+delta
	if from < 0 {
		fail(ErrGone)
		return
	}
	// The tail is still to come, behind real time by the pipelines; and the
	// aligner, a step behind that, to say if anything slipped meanwhile.
	ring := e.capture.Ring()
	deadline = time.Now().Add(time.Duration(float64(tail)/sr*float64(time.Second)) + 10*time.Second)
	cancelled := errors.New("it was stopped before the tail was in; nothing was saved")
	for {
		if _, total := ring.Window(); int64(total) >= to {
			break
		}
		if r := e.tr.Once(); r.Job != id || r.Broken {
			fail(cancelled) // at once: the page shouldn't wait out the tail to hear it
			return
		}
		if time.Now().After(deadline) {
			fail(ErrNotYet)
			return
		}
		select {
		case <-e.stop:
			return
		case <-time.After(20 * time.Millisecond):
		}
	}
	select {
	case <-e.stop:
		return
	case <-time.After(alignSettle):
	}
	run = e.tr.closeOnce(id)
	switch {
	case run.Job != id || run.Broken:
		fail(cancelled)
		return
	case run.Late:
		fail(errors.New("the tape fell behind while it played, so the take would have a gap in it; nothing was saved -- try again"))
		return
	case e.segAt(run.StartOut) != e.segAt(run.EndOut+uint64(tail)-1):
		fail(ErrSlipped)
		return
	}

	e.setMixdown(id, func(m *Mixdown) { m.State = "saving" })
	// The mixdown takes the tape's tempo below, so the save doesn't measure it.
	saved, err := e.saver.SaveRange(uint64(from), uint64(to), audio.DontMeasureTempo())
	if err != nil {
		fail(err)
		return
	}
	if saved.Clamped {
		log.Printf("[!] tape: mixdown %s lost its start to the ring", saved.Name)
	}
	// Labelled with the tape, on its tempo, with bar 1 where the tape's
	// first bar line in it fell.
	if e.takesDir != "" {
		_, err := audio.UpdateMeta(filepath.Join(e.takesDir, saved.Name), func(m *audio.Meta) error {
			m.Label = name
			m.Origin = audio.OriginTape
			if grid != nil {
				bpm := math.Round(grid.BPM(int(sr))*100) / 100
				m.BPM = &bpm
				// The tape's tempo is the owner's and exact; measuring leaves it be.
				m.TempoFrom = audio.TempoFromYou
				if !saved.Clamped {
					db := grid.NextBar(passFrom) - passFrom
					m.DownbeatFrame = &db
				}
			}
			return nil
		})
		if err != nil {
			log.Printf("[!] tape: mixdown %s: %v", saved.Name, err)
		}
	}
	log.Printf("[*] tape: mixed down %q as %s, %.1f s", name, saved.Name, saved.Seconds)
	e.setMixdown(id, func(m *Mixdown) { m.State, m.Take = "done", saved.Name })
}
