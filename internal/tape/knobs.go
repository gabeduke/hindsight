package tape

import (
	"math"
	"sync"
	"time"
)

// A controller's knob on a tape mod, committed once it's still.

// knobQuiet is how long a controller's mod knob must be still before its
// value is written to the tape: one undo step per gesture, not per value.
const knobQuiet = time.Second

// ModKnobs turns tape mods from a controller's knobs: each move previews at
// once (Engine.Set, nothing saved), and a knob still for a second commits
// its value to the tape as one step of undo. For P3's controller on the Pi;
// a page commits on the finger's lift instead.
type ModKnobs struct {
	e     *Engine
	quiet time.Duration

	mu     sync.Mutex
	timers map[string]*time.Timer
}

// NewModKnobs makes the knobs for an engine.
func NewModKnobs(e *Engine) *ModKnobs {
	return &ModKnobs{e: e, quiet: knobQuiet, timers: map[string]*time.Timer{}}
}

// Turn moves mod (mod.wow and the rest) to v on the tape id, and commits it
// once the knob has been still for a second.
func (k *ModKnobs) Turn(id, mod string, v float64) error {
	i := modIndex(mod)
	if i < 0 {
		return ErrNoSuchPad
	}
	if err := k.e.Set(mod, v); err != nil {
		return err
	}
	v = math.Max(0, math.Min(1, v))
	k.mu.Lock()
	defer k.mu.Unlock()
	if t := k.timers[mod]; t != nil {
		t.Stop()
	}
	k.timers[mod] = time.AfterFunc(k.quiet, func() {
		k.mu.Lock()
		delete(k.timers, mod)
		k.mu.Unlock()
		var c StyleChange
		f := v
		switch i {
		case modWow:
			c.Wow = &f
		case modFlutter:
			c.Flutter = &f
		case modDrive:
			c.Drive = &f
		case modAge:
			c.Age = &f
		}
		if err := k.e.SetStyle(id, c); err != nil {
			// Nothing to commit it to: the preview goes, back to the tape.
			_ = k.e.Release(mod)
		}
	})
	return nil
}

// Stop drops the knobs' pending commits.
func (k *ModKnobs) Stop() {
	k.mu.Lock()
	defer k.mu.Unlock()
	for m, t := range k.timers {
		t.Stop()
		delete(k.timers, m)
	}
}
