package api

import (
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/surface"
)

// firmware answers the client's messages as the keyboard's firmware does,
// through the API's ControlSysEx: an ack for each, by its seq.
type firmware struct {
	mu   sync.Mutex
	cmds []byte
	acks chan []byte
}

func (f *firmware) send(b []byte) {
	f.mu.Lock()
	f.cmds = append(f.cmds, b[6])
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
		{listed{{Name: "SMK37 Elite Open", Controller: true, Connected: true}}, true},
	} {
		a.SetControllers(c.devices)
		if got := a.KeyboardConnected(); got != c.want {
			t.Errorf("%v: KeyboardConnected = %v, want %v", c.devices, got, c.want)
		}
	}
}

// The keyboard's port is opened only for an SMK-37 open as a controller,
// aimed at that controller's own name: never a keyboard MIDI_IGNORE keeps
// out or TAPE_CONTROLLER doesn't name.
func TestKeyboardSendOpensOnlyAnOpenSMK37Controller(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	defer a.StopKeyboard()
	a.SetControllers(listed{{Name: "SMK-37+VA", Controller: false, Connected: true}})
	a.KeyboardSend([]byte{0xF0, 0xF7})
	if a.kbOut.out != nil {
		t.Fatal("opened an SMK-37 that isn't a controller")
	}
	a.SetControllers(listed{{Name: "SMK-37+VA", Controller: true, Connected: true}})
	a.KeyboardSend([]byte{0xF0, 0xF7})
	if a.kbOut.out == nil || a.kbOut.name != "SMK-37+VA" {
		t.Fatalf("port = %q, want one aimed at SMK-37+VA", a.kbOut.name)
	}
}

// After HOME, the keyboard answering again doesn't take its screen back.
func TestHomeKeepsTheScreenOnAnAnswerAgain(t *testing.T) {
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
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken: %+v", kb.Status())
		}
	}
	// Answer what's still in flight, so a message sent now would go at once.
	for drained := false; !drained; {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-time.After(50 * time.Millisecond):
			drained = true
		}
	}
	a.ControlSysEx("SMK-37", []byte{0xF0, 0x7D, 'H', 'S', 0x01, 0x00, 0x03, 0xF7}) // HOME
	before := len(fw.sent())
	a.keyboardPresent()
	time.Sleep(30 * time.Millisecond)
	if after := len(fw.sent()); after != before || kb.Status().Screen {
		t.Fatalf("after HOME, an answer again sent %d messages and the screen is %v", after-before, kb.Status().Screen)
	}
}
