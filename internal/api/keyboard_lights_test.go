package api

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// lightsRig is a version 2 keyboard whose screen Hindsight has taken, on a
// fake clock and ticked by hand, its pads Play mode's fake engine, with the
// lights at rest already sent and forgotten.
type lightsRig struct {
	t     *testing.T
	a     *API
	kb    *surface.Keyboard
	fw    *firmwareV2
	clock *fakeClock
	pads  *fakeTricks
	seen  int // frames already read
}

func newLightsRig(t *testing.T) *lightsRig {
	t.Helper()
	f, _, a, _ := controlsAPI(t, t.TempDir())
	a.SetControllers(listed{{Name: "SMK-37", Controller: true, Connected: true}})
	fw := &firmwareV2{acks: make(chan []byte, 256)}
	kb := surface.New(fw.send, func() bool { return true })
	clock := &fakeClock{t: time.Unix(1000, 0)}
	kb.Clock = clock.now
	a.SetKeyboard(kb)
	r := &lightsRig{t: t, a: a, kb: kb, fw: fw, clock: clock, pads: f}
	kb.Tick() // HELLO; its answer takes the screen, on its own goroutine
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken: %+v", kb.Status())
		}
	}
	r.tick(kb.Refresh) // the first screen, and its lights
	if got := r.leds(); len(got) != surface.Pads+3 {
		t.Fatalf("the lights at rest: %v", got)
	}
	return r
}

// tick moves the clock on by d and ticks the keyboard, acking all it sends.
func (r *lightsRig) tick(d time.Duration) {
	r.clock.add(d)
	r.kb.Tick()
	r.pump()
}

func (r *lightsRig) pump() {
	for {
		select {
		case ack := <-r.fw.acks:
			r.a.ControlSysEx("SMK-37", ack)
		default:
			return
		}
	}
}

// leds are the LED commands sent since the last, as the firmware
// simulator's script writes them.
func (r *lightsRig) leds() []string {
	r.pump()
	frames := r.fw.sent()
	var out []string
	for _, fr := range frames[r.seen:] {
		if fr[6] != 0x09 {
			continue
		}
		for p := fr[7 : len(fr)-1]; len(p) > 0; p = p[2+int(p[1]):] {
			if p[0] != 0x08 {
				continue
			}
			b := p[2 : 2+int(p[1])]
			if b[0] < surface.Pads {
				out = append(out, fmt.Sprintf("led pad %d %d %d %d", b[0], b[1], b[2], b[3]))
			} else {
				out = append(out, fmt.Sprintf("led button %d %d", b[0]-surface.Pads, b[1]))
			}
		}
	}
	r.seen = len(frames)
	return out
}

func (r *lightsRig) expect(step string, want ...string) {
	r.t.Helper()
	if got := r.leds(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		r.t.Fatalf("%s: lit\n%s\nwant\n%s", step, strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// land logs a trick event as the engine does when it renders it: heard
// out ms from now (the fake's HeardIn).
func (r *lightsRig) land(pad string, on bool, out uint64) {
	f := r.pads
	f.mu.Lock()
	f.seq++
	f.events = append(f.events, tape.TrickEvent{Seq: f.seq, Pad: pad, On: on, Out: out})
	f.mu.Unlock()
}

// A pad pressed on the keyboard is half at once, full when Play mode's
// landing for it is heard (its output frame through the lead, HeardIn), and
// dim when its release is heard.
func TestAKeyboardPadsLightFollowsItsLanding(t *testing.T) {
	r := newLightsRig(t)
	r.a.ControlMIDI("SMK-37", padOn, 40, 100) // BREAK
	r.expect("pressed", "led pad 4 70 34 11")
	r.land("break", true, 120) // rendered: heard in 120 ms
	r.tick(r.kb.Refresh)       // the feed reads it
	r.expect("its landing read")
	r.tick(100 * time.Millisecond)
	r.expect("before it is heard")
	r.tick(20 * time.Millisecond)
	r.expect("heard", "led pad 4 127 62 20")
	r.a.ControlMIDI("SMK-37", 0x89, 40, 0) // let go
	r.tick(r.kb.Refresh)
	r.expect("let go, still heard")
	r.land("break", false, 60)
	r.tick(r.kb.Refresh)
	r.expect("its release read")
	r.tick(60 * time.Millisecond)
	r.expect("its release heard", "led pad 4 23 11 4")
}

// A press refused lights nothing: the banner says why.
func TestARefusedPadStaysDim(t *testing.T) {
	r := newLightsRig(t)
	r.pads.refuse = map[string]error{"stop": tape.ErrNoTape}
	r.a.ControlMIDI("SMK-37", padOn, 43, 100) // STOP
	r.tick(r.kb.Refresh)
	r.expect("refused")
}

// A tape loaded under a held pad lets it go with no release logged: the
// pad goes dim rather than stay lit.
func TestAPadLetGoByTheTapeGoesDim(t *testing.T) {
	r := newLightsRig(t)
	r.land("chop", true, 0) // a phone's
	r.tick(r.kb.Refresh)
	r.expect("heard", "led pad 6 127 62 20")
	r.pads.mu.Lock()
	r.pads.events = nil // the tape holds nothing now, and logged nothing
	r.pads.mu.Unlock()
	r.tick(r.kb.Refresh)
	r.expect("let go by the tape", "led pad 6 23 11 4")
}

// CATCH from the keyboard is half until it is done, then flashes full once;
// refused, it goes back to dim.
func TestAKeyboardCommandPadFlashesWhenDone(t *testing.T) {
	r := newLightsRig(t)
	done := make(chan error)
	r.a.controls.verbs = cannedVerbs(func(id, rt string) (verbDone, error) {
		if err := <-done; err != nil {
			return verbDone{}, err
		}
		return verbDone{"caught", caughtWords(8)}, nil
	})
	r.a.ControlMIDI("SMK-37", padOn, 50, 100) // CATCH
	r.expect("pressed", "led pad 14 70 70 70")
	done <- nil
	r.waitLit(t, "done", "led pad 14 127 127 127")
	r.tick(surface.FlashFor)
	r.expect("the flash over", "led pad 14 23 23 23")
	r.a.ControlMIDI("SMK-37", padOn, 50, 100)
	r.expect("pressed again", "led pad 14 70 70 70")
	done <- errors.New("no pass")
	r.waitLit(t, "refused", "led pad 14 23 23 23")
}

// waitLit waits for the verb's goroutine to light what it should.
func (r *lightsRig) waitLit(t *testing.T, step string, want ...string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var got []string
	for time.Now().Before(deadline) {
		got = append(got, r.leds()...)
		if len(got) >= len(want) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%s: lit %v, want %v", step, got, want)
	}
}

// SHIFT is lit while held on the keyboard.
func TestShiftIsLitWhileHeld(t *testing.T) {
	r := newLightsRig(t)
	r.a.ControlMIDI("SMK-37", 0x9F, 0, 127)
	r.tick(r.kb.Refresh)
	r.expect("held", "led button 0 1")
	r.a.ControlMIDI("SMK-37", 0x8F, 0, 0)
	r.tick(r.kb.Refresh)
	r.expect("let go", "led button 0 0")
}

// homeAndBack is HOME on the keyboard, then HOME held and let go, which
// hands the screen back: taken again, as when it first answered.
func (r *lightsRig) homeAndBack(away func()) {
	r.t.Helper()
	r.a.ControlSysEx("SMK-37", []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x03, 0xF7}) // RELEASE
	if r.kb.Status().Screen {
		r.t.Fatal("HOME left the screen Hindsight's")
	}
	r.tick(r.kb.Refresh)
	if got := r.leds(); len(got) != 0 {
		r.t.Fatalf("lit while the screen was the keyboard's: %v", got)
	}
	away()
	r.a.ControlSysEx("SMK-37", []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x05, 0xF7}) // OFFER
	deadline := time.After(3 * time.Second)
	for !r.kb.Status().Screen {
		select {
		case ack := <-r.fw.acks:
			r.a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			r.t.Fatalf("the screen was never taken again: %+v", r.kb.Status())
		}
	}
	r.tick(r.kb.Refresh)
}

// HOME gives the lights back; taken again, every light is sent again, from
// what the tape holds then: CHOP, pressed again while the screen was away
// and then let go by a tape loaded under it (its press in the log, no
// release), is not replayed, and STOP, pressed by a phone meanwhile and
// still held, is full.
func TestTheLightsAreSentAgainAfterHomeFromTheTape(t *testing.T) {
	r := newLightsRig(t)
	r.land("chop", true, 0)
	r.tick(r.kb.Refresh)
	r.expect("CHOP heard", "led pad 6 127 62 20")
	r.homeAndBack(func() {
		r.land("chop", true, 0) // pressed again, then a tape loaded under it
		r.land("stop", true, 0)
		r.pads.mu.Lock()
		r.pads.held = []string{"stop"} // the tape holds STOP alone
		r.pads.mu.Unlock()
	})
	want := []string{"led pad 0 5 13 20", "led pad 1 4 16 15", "led pad 2 20 15 1", "led pad 3 21 8 14",
		"led pad 4 23 11 4", "led pad 5 23 11 4", "led pad 6 23 11 4", "led pad 7 127 62 20",
		"led pad 8 15 10 22", "led pad 9 15 10 22", "led pad 10 0 23 23", "led pad 11 0 23 23",
		"led pad 12 0 23 23", "led pad 13 0 23 23", "led pad 14 23 23 23", "led pad 15 23 23 23",
		"led button 0 0", "led button 16 0", "led button 17 0"}
	r.expect("taken again", want...)
	r.tick(r.kb.Refresh)
	r.expect("and then")
}

// SHIFT held when the keyboard's port goes, its release lost with it, is
// not lit when the keyboard comes back.
func TestShiftIsLetGoWhenTheKeyboardGoes(t *testing.T) {
	r := newLightsRig(t)
	r.a.ControlMIDI("SMK-37", 0x9F, 0, 127)
	r.tick(r.kb.Refresh)
	r.expect("held", "led button 0 1")
	r.a.ControllerGone("SMK-37") // unplugged; its SHIFT release never came
	r.tick(r.kb.Probe)           // HELLO again
	deadline := time.After(3 * time.Second)
	for !r.kb.Status().Screen {
		select {
		case ack := <-r.fw.acks:
			r.a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken again: %+v", r.kb.Status())
		}
	}
	r.tick(r.kb.Refresh)
	got := r.leds()
	if len(got) != surface.Pads+3 || got[surface.Pads] != "led button 0 0" {
		t.Fatalf("plugged in again, lit %v: want every light again, SHIFT off", got)
	}
}
