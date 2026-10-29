package api

// The SMK-37's screen on its firmware's protocol version 2 (internal/
// surface's Layout; docs/plan/the-instrument.md, step 7, *The surface,
// designed*): the tape's state as the keyboard's client asks for it, every
// Refresh (Keyboard.Follow). What the tape has changes only with its
// revision (Engine.Changes), so it is read again only then; where it is,
// what plays, the pads held and the levels are read every time.
//
// Some of the design isn't built yet, so the screen says only what is:
// the pads and encoders have one page, FX (the Mixer page under SHIFT is
// K6); the faders aren't bound (K8), so a track's tick is its level as the
// tape has it; the master knob plays the keyboard's synth, whose volume the
// Pi doesn't know (scrub is K7); and an encoder shows what its CC is bound
// to, by name, with a dash for one bound to nothing.

import (
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The encoders' CCs and channel on Hindsight's firmware, K1 first, and the
// panel's names for them.
const (
	encoderCC      = 21
	encoderChannel = 16
)

var encoderNames = [7]string{"K1", "K2", "K3", "K4", "SELECT", "PAGE", "PRESET"}

// keyboardTurn is the encoder the keyboard last turned, its value and when.
type keyboardTurn struct {
	knob, value int
	at          time.Time
}

// keyboardScreen is what the screen's feed keeps between asks: the tape's
// part as of rev, and the last turn.
type keyboardScreen struct {
	mu    sync.Mutex
	rev   uint64
	ctl   uint64 // the controls' revision the mods were read at
	read  bool
	base  surface.State
	mods  [7]string // each encoder's action, "" for none
	style tape.Style
	beat  float64 // frames a beat, 0 with no grid
	turn  *keyboardTurn
}

// fxPadIndex is each Play mode pad's place in the FX page's map.
var fxPadIndex = func() map[string]int {
	out := map[string]int{}
	for i, id := range []string{"track1", "track2", "track3", "track4", "break", "reverse", "chop", "stop",
		"half", "double", "roll", "filter", "echo", "crush"} {
		out[id] = i
	}
	return out
}()

// keyboardTurned notes an encoder turned on the keyboard, to light it.
func (a *API) keyboardTurned(port string, m midiMsg) {
	if a.keyboard == nil || m.typ != "cc" || m.ch != encoderChannel || m.cc < encoderCC || m.cc >= encoderCC+7 || !isKeyboard(port) {
		return
	}
	ks := &a.kbScreen
	ks.mu.Lock()
	ks.turn = &keyboardTurn{knob: m.cc - encoderCC, value: m.value, at: a.keyboard.Now()}
	ks.mu.Unlock()
}

// keyboardState is the screen now (Keyboard.Follow's source).
func (a *API) keyboardState() surface.State {
	ks := &a.kbScreen
	ks.mu.Lock()
	defer ks.mu.Unlock()
	eng := a.tape
	if eng == nil {
		s := surface.State{Tape: "NO TAPE ENGINE", LitKnob: -1, LitFader: -1}
		s.Knobs, s.LitKnob = a.keyboardKnobs(ks)
		return s
	}
	if rev := eng.Changes().Rev(); !ks.read || rev != ks.rev {
		t := eng.Loaded() // a copy: once a revision, not every ask
		ks.rev, ks.read = rev, true
		ks.base, ks.style, ks.beat = tapeScreen(t), tape.Style{}, 0
		if t != nil && t.Style != nil {
			ks.style = *t.Style
		}
		if t != nil && t.Grid != nil && t.Grid.Bars > 0 {
			ks.beat = t.Grid.BarFrames() / tape.BeatsPerBar
		}
		ks.mods, ks.ctl = a.keyboardMods()
	} else if ctl := a.controlsRev(); ctl != ks.ctl {
		ks.mods, ks.ctl = a.keyboardMods() // an encoder rebound
	}
	s := ks.base
	pos, playing := eng.Heard()
	s.Playing = playing
	// Recording, not armed to start at the next bar (a punch's "armed").
	r := eng.Recording()
	s.Recording = r != nil && r.State == "on"
	if ks.beat > 0 {
		s.Beats = float64(pos) / ks.beat
	}
	for _, p := range eng.HeldPads() {
		if i, ok := fxPadIndex[p]; ok {
			s.Held[i] = true
		}
	}
	levels := eng.TrackLevels()
	for i := range s.Meter {
		s.Meter[i] = meterOf(levels[i])
	}
	s.Knobs, s.LitKnob = a.keyboardKnobs(ks)
	return s
}

// tapeScreen is the part of the screen the tape's revision changes.
func tapeScreen(t *tape.Tape) surface.State {
	s := surface.State{LitKnob: -1, LitFader: -1, Selected: 1}
	if t == nil {
		s.Tape = "NO TAPE"
		return s
	}
	s.Tape = t.Name
	if s.Tape == "" {
		s.Tape = t.ID
	}
	if t.Grid != nil && t.Grid.Bars > 0 && t.Grid.Frames > 0 {
		s.Tempo = t.Grid.BPM(t.SampleRate)
	}
	if armed := t.Armed(); len(armed) > 0 {
		s.Armed = armed[0]
	}
	for i := range min(4, len(t.Tracks)) {
		tr := t.Tracks[i]
		s.Mute[i], s.Solo[i] = tr.Mute, tr.Solo
		s.Fader[i] = surface.FaderOf(tr.GainDB)
	}
	return s
}

// controlsRev is the controls' revision.
func (a *API) controlsRev() uint64 {
	a.controls.mu.Lock()
	defer a.controls.mu.Unlock()
	return a.controls.rev
}

// keyboardMods is the action each encoder's CC is bound to on the
// keyboard, "" for none, and the controls' revision it read.
func (a *API) keyboardMods() ([7]string, uint64) {
	var out [7]string
	a.controls.mu.Lock()
	rev := a.controls.rev
	a.controls.mu.Unlock()
	d, ok := a.keyboardPort()
	if !ok {
		return out, rev
	}
	a.controls.mu.Lock()
	bs, _, _ := a.bindingsLocked(d.Name)
	a.controls.mu.Unlock()
	for k := range out {
		if id, ok := bs.amountFor(midiMsg{typ: "cc", ch: encoderChannel, cc: encoderCC + k}); ok {
			out[k] = id
		}
	}
	return out, rev
}

// keyboardKnobs is the knob rows, each encoder's action and its amount,
// and the master knob's; and the one last turned, lit for BannerFor, or -1.
func (a *API) keyboardKnobs(ks *keyboardScreen) ([8]surface.Knob, int) {
	var out [8]surface.Knob
	amounts := map[string]float64{"mod.wow": ks.style.Wow, "mod.flutter": ks.style.Flutter,
		"mod.drive": ks.style.Drive, "mod.age": ks.style.Age}
	var turn *keyboardTurn
	if t := ks.turn; t != nil && a.keyboard != nil && a.keyboard.Now().Sub(t.at) < surface.BannerFor {
		turn = t
	}
	for k, id := range ks.mods {
		kn := surface.Knob{Name: encoderNames[k], Value: "-", Amount: -1, Lit: surface.Accent}
		if id != "" {
			kn.Name = strings.ToUpper(strings.TrimPrefix(id, "mod."))
			if v, ok := amounts[id]; ok {
				n := int(math.Round(v * 127))
				if turn != nil && turn.knob == k {
					n = turn.value // previewed now, saved once still
				}
				kn.Value, kn.Amount = strconv.Itoa(n), n
			}
		}
		out[k] = kn
	}
	out[7] = surface.Knob{Name: "SYNTH VOL", Value: "-", Amount: -1, Lit: surface.White}
	if turn == nil {
		return out, -1
	}
	return out, turn.knob
}

// meterOf is a track's level as its meter shows it: 48 dB to full scale,
// in sixteen steps, so a level's flicker inside a step sends nothing.
func meterOf(level float64) int {
	if level <= 0 {
		return 0
	}
	x := min(1, max(0, (20*math.Log10(level)+48)/48))
	return int(math.Round(math.Round(x*16) * 127 / 16))
}
