package api

import (
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/surface"
)

// firmware answers the client's messages as the keyboard's firmware does,
// through the API's ControlSysEx: an ack for each, by its seq.
type firmware struct {
	mu     sync.Mutex
	cmds   []byte
	frames [][]byte
	acks   chan []byte
}

func (f *firmware) send(b []byte) {
	f.mu.Lock()
	f.cmds = append(f.cmds, b[6])
	f.frames = append(f.frames, append([]byte(nil), b...))
	f.mu.Unlock()
	f.acks <- []byte{0xF0, 0x7D, 'H', 'S', 0x01, b[5], 0x7F, 0x00, 0xF7}
}

func (f *firmware) sent() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.cmds...)
}

// When the keyboard answers HELLO, Hindsight takes its screen: CLEAR and the
// panel's legend. Another controller's SysEx isn't the keyboard's, and the
// keyboard's port going forgets it.
func TestTheKeyboardsScreenIsTakenWhenItAnswers(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	fw := &firmware{acks: make(chan []byte, 16)}
	kb := surface.New(fw.send, func() bool { return true })
	kb.Probe, kb.AckTimeout = 10*time.Millisecond, time.Second
	a.SetKeyboard(kb)
	kb.Start()
	defer kb.Stop()

	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || len(fw.sent()) < 6 {
		select {
		case ack := <-fw.acks:
			// Not the keyboard: its RELEASE would take the screen back if heard.
			a.ControlSysEx("Keystation 49", []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x03, 0xF7})
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("sent %v, status %+v: the screen was never taken", fw.sent(), kb.Status())
		}
	}
	if got, want := string(fw.sent()), string([]byte{0x00, 0x01, 0x02, 0x02, 0x02, 0x02}); got != want {
		t.Fatalf("commands % x, want HELLO, CLEAR and four TEXTs % x", got, want)
	}
	a.ControllerGone("SMK-37")
	if kb.Status().Present {
		t.Fatal("the keyboard's port went and it's still present")
	}
}

// listed is a DeviceLister with fixed devices.
type listed []midi.DeviceInfo

func (l listed) Devices() []midi.DeviceInfo { return l }

// The keyboard is asked only while an SMK-37 is open as a controller.
func TestKeyboardConnectedOnlyForAnOpenSMK37Controller(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	for _, c := range []struct {
		devices listed
		want    bool
	}{
		{nil, false},
		{listed{{Name: "Keystation 49", Controller: true, Connected: true}}, false},
		{listed{{Name: "SMK-37", Controller: false, Connected: true}}, false},
		{listed{{Name: "SMK-37", Controller: true, Connected: false}}, false},
		{listed{{Name: "SMK-37", Controller: true, Connected: true}}, true},
		// The Elite's own name on Hindsight's firmware (2026-10-27).
		{listed{{Name: "SMK37 Open   ", Controller: true, Connected: true}}, true},
	} {
		a.SetControllers(c.devices)
		if got := a.KeyboardConnected(); got != c.want {
			t.Errorf("%v: KeyboardConnected = %v, want %v", c.devices, got, c.want)
		}
	}
}

// The keyboard's port is opened only for an SMK-37 open as a controller,
// aimed at that controller's own node: never a keyboard MIDI_IGNORE keeps
// out or TAPE_CONTROLLER doesn't name, even one of the same name.
func TestKeyboardSendOpensOnlyAnOpenSMK37Controller(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	defer a.StopKeyboard()
	ignored := midi.DeviceInfo{Name: "SMK37 Open", Node: "/dev/snd/midiC3D0", Controller: false, Connected: true}
	a.SetControllers(listed{ignored})
	a.KeyboardSend([]byte{0xF0, 0xF7})
	if a.kbOut.out != nil {
		t.Fatal("opened an SMK-37 that isn't a controller")
	}
	a.SetControllers(listed{ignored, {Name: "SMK37 Open", Node: "/dev/snd/midiC2D0", Controller: true, Connected: true}})
	a.KeyboardSend([]byte{0xF0, 0xF7})
	if a.kbOut.out == nil || a.kbOut.node != "/dev/snd/midiC2D0" {
		t.Fatalf("port = %q, want one aimed at the controller's node alone", a.kbOut.node)
	}
}

// takenKeyboard is a keyboard whose screen Hindsight has taken, with
// nothing in flight, so a message sent now goes at once.
func takenKeyboard(t *testing.T) (*API, *surface.Keyboard, *firmware) {
	t.Helper()
	_, _, a, _ := controlsAPI(t, t.TempDir())
	fw := &firmware{acks: make(chan []byte, 16)}
	kb := surface.New(fw.send, func() bool { return true })
	kb.Probe, kb.AckTimeout = 10*time.Millisecond, time.Second
	a.SetKeyboard(kb)
	kb.Start()
	t.Cleanup(kb.Stop)
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || len(fw.sent()) < 6 {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken: %+v", kb.Status())
		}
	}
	answer(a, fw)
	return a, kb, fw
}

// answer acks what the keyboard has been sent until it is sent nothing more.
func answer(a *API, fw *firmware) {
	for {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-time.After(50 * time.Millisecond):
			return
		}
	}
}

var (
	keyboardHome  = []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x03, 0xF7}
	keyboardOffer = []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x05, 0xF7}
)

// After HOME, the keyboard answering again doesn't take its screen back.
func TestHomeKeepsTheScreenOnAnAnswerAgain(t *testing.T) {
	a, kb, fw := takenKeyboard(t)
	a.ControlSysEx("SMK-37", keyboardHome)
	before := len(fw.sent())
	a.keyboardPresent()
	time.Sleep(30 * time.Millisecond)
	if after := len(fw.sent()); after != before || kb.Status().Screen {
		t.Fatalf("after HOME, an answer again sent %d messages and the screen is %v", after-before, kb.Status().Screen)
	}
}

// HOME held on the keyboard hands the screen back, and Hindsight takes it:
// CLEAR and the panel's legend again.
func TestHomeHeldHandsTheScreenBack(t *testing.T) {
	a, kb, fw := takenKeyboard(t)
	a.ControlSysEx("SMK-37", keyboardHome)
	before := len(fw.sent())
	a.ControlSysEx("SMK-37", keyboardOffer)
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || len(fw.sent()) < before+5 {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("sent % x after the offer, status %+v: the screen was never taken", fw.sent()[before:], kb.Status())
		}
	}
	if got, want := string(fw.sent()[before:]), string([]byte{0x01, 0x02, 0x02, 0x02, 0x02}); got != want {
		t.Fatalf("after the offer % x, want CLEAR and four TEXTs % x", got, want)
	}
	if kb.Status().Homed {
		t.Fatal("the offer left the HOME remembered")
	}
}

// A screen take made the keyboard send several MIDI Stops, its own
// sequencer's, which stopped the tape (docs/architecture/keyboard.md,
// *Learnt on the unit*). On Hindsight's firmware its PLAY is a button to the
// Pi, so its realtime Start and Stop move nothing; another controller's
// still do.
func TestTheKeyboardsOwnStartAndStopDontMoveTheTape(t *testing.T) {
	a, _, _ := takenKeyboard(t)
	v := &fakeVerbs{}
	a.controls.verbs = v
	a.ControlMIDI("SMK-37", 0xFC, 0, 0)
	a.ControlMIDI("SMK-37", 0xFA, 0, 0)
	a.ControlMIDI("SMK-37", 0x9F, 16, 127) // PLAY, on channel 16
	a.ControlMIDI("SMK-37", 0x8F, 16, 0)
	v.wait(t, "transport")
	a.ControlMIDI("Keystation 49", 0xFC, 0, 0)
	v.wait(t, "transport", "transport stop")
}

// /api/status says what the keyboard's client knows of it.
func TestTheStatusSaysTheKeyboards(t *testing.T) {
	a, _, _ := takenKeyboard(t)
	ks := a.keyboardStatus()
	if ks == nil || !ks.Present || !ks.Screen || ks.Homed || ks.Version != 1 || ks.RTTMS <= 0 {
		t.Fatalf("keyboard status %+v, want present with the screen on version 1, and a round trip", ks)
	}
	if b := New(&config.Config{}, nil, nil, nil, nil); b.keyboardStatus() != nil {
		t.Fatal("a status with no keyboard's client, want null")
	}
}
