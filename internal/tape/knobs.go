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
	// Owner is who the knobs preview as (Engine.PreviewMod): a page that
	// previewed a mod before them can't clear theirs. "controller" unless
	// set before the first turn.
	Owner string

	mu     sync.Mutex
	timers map[string]*time.Timer
	gen    map[string]uint64 // each mod's turns, so a commit can tell it's the newest
}

// NewModKnobs makes the knobs for an engine.
func NewModKnobs(e *Engine) *ModKnobs {
	return &ModKnobs{e: e, quiet: knobQuiet, Owner: "controller", timers: map[string]*time.Timer{}, gen: map[string]uint64{}}
}

// Turn moves mod (mod.wow and the rest) to v on the tape id, and commits it
// once the knob has been still for a second.
func (k *ModKnobs) Turn(id, mod string, v float64) error {
	if modIndex(mod) < 0 {
		return ErrNoSuchPad
	}
	if err := k.e.PreviewMod(mod, v, k.Owner); err != nil {
		return err
	}
	v = math.Max(0, math.Min(1, v))
	k.mu.Lock()
	defer k.mu.Unlock()
	if t := k.timers[mod]; t != nil {
		t.Stop()
	}
	k.gen[mod]++
	g := k.gen[mod]
	k.timers[mod] = time.AfterFunc(k.quiet, func() { k.fire(id, mod, v, g) })
	return nil
}

// fire commits turn g of mod, at v, if no turn has come since. A turn
// landing as this fires has armed its own commit: that one is left alone,
// and this one is dropped.
func (k *ModKnobs) fire(id, mod string, v float64, g uint64) {
	k.mu.Lock()
	if k.gen[mod] != g {
		k.mu.Unlock()
		return
	}
	delete(k.timers, mod)
	k.mu.Unlock()
	f := v
	var c StyleChange
	switch modIndex(mod) {
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
		_ = k.e.EndPreview(mod, k.Owner)
	}
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
