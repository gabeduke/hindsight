package api

// The SMK-37 on Hindsight's own firmware (internal/surface;
// docs/plan/the-instrument.md, step 7). Its SysEx arrives with every
// controller's messages, from the MIDI watcher, and goes to the keyboard's
// client. When the keyboard first answers, Hindsight takes its screen, and
// with it the panel: while Hindsight has the screen, the pads, encoders,
// faders and buttons send plain MIDI that Play mode's bus binds like any
// controller's (controls.go, the SMK-37's profile). HOME on the keyboard
// gives the screen and the panel back, until the keyboard is plugged in
// again.

import (
	"log"
	"slices"
	"sync"

	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/mono"
	"github.com/gabeduke/hindsight/internal/surface"
)

// keyboardOut writes to the keyboard: an Out aimed at the controller's own
// name, made when the keyboard first opens as a controller, and made again
// if it comes back under another name. A keyboard MIDI_IGNORE keeps out,
// or one TAPE_CONTROLLER doesn't name, is never opened.
type keyboardOut struct {
	mu   sync.Mutex
	name string
	out  *midi.Out
}

// to is the Out for the keyboard called name.
func (k *keyboardOut) to(name string) *midi.Out {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.out == nil || k.name != name {
		if k.out != nil {
			k.out.Stop()
		}
		k.out = midi.NewOut([]midi.OutTarget{{Match: name}})
		k.out.Start()
		k.name = name
	}
	return k.out
}

// SetKeyboard gives the API the keyboard's client. Call it before the
// watcher's controllers reach the API (SetControlSink).
func (a *API) SetKeyboard(kb *surface.Keyboard) {
	a.keyboard = kb
	kb.OnPresent(a.keyboardPresent)
}

// keyboardPort is the name of an SMK-37 open as a controller.
func (a *API) keyboardPort() (string, bool) {
	for _, d := range a.controllerDevices() {
		if d.Controller && d.Connected && isKeyboard(d.Name) {
			return d.Name, true
		}
	}
	return "", false
}

// KeyboardConnected says whether an SMK-37 is open as a controller: the
// keyboard's client asks the keyboard only then.
func (a *API) KeyboardConnected() bool {
	_, ok := a.keyboardPort()
	return ok
}

// KeyboardSend writes a message to the keyboard open as a controller, if
// there is one. It doesn't block (midi.Out.Send).
func (a *API) KeyboardSend(msg []byte) {
	if name, ok := a.keyboardPort(); ok {
		a.kbOut.to(name).Send(mono.Now(), msg)
	}
}

// StopKeyboard gives the screen back, if Hindsight has it, and closes the
// keyboard's port. Call it once the client has stopped.
func (a *API) StopKeyboard() {
	a.kbOut.mu.Lock()
	out := a.kbOut.out
	a.kbOut.mu.Unlock()
	if out == nil {
		return
	}
	if a.keyboard != nil {
		if f := a.keyboard.Farewell(); f != nil {
			out.SendNow(f)
		}
	}
	out.Stop()
}

// isKeyboard is a port the SMK-37's profile answers for.
func isKeyboard(port string) bool {
	p := profileOf(port)
	return p != nil && slices.Contains(keyboardNames, p.Name)
}

// ControlSysEx is the watcher's SysEx from a controller
// (midi.ControlSysExSink): the keyboard's acks and its RELEASE.
func (a *API) ControlSysEx(port string, msg []byte) {
	if a.keyboard != nil && isKeyboard(port) {
		a.keyboard.Feed(msg)
	}
}

// keyboardPresent takes the screen, which gives Play mode's bus the panel,
// and says what the panel does there; not after its player pressed HOME,
// until the keyboard is plugged in again.
func (a *API) keyboardPresent() {
	kb := a.keyboard
	if kb.Status().Homed {
		log.Printf("[*] SMK-37: on Hindsight's firmware; its screen stays its own (HOME)")
		return
	}
	kb.Clear(surface.Black)
	kb.Text(8, 8, 3, surface.Accent, "HINDSIGHT")
	kb.Text(8, 48, 1, surface.Text, "PADS PLAY THE TAPE")
	kb.Text(8, 62, 1, surface.Text, "PLAY: TRANSPORT   REC: KEEP")
	kb.Text(8, 220, 1, surface.Dim, "HOME: THE KEYBOARD'S OWN SCREEN")
	log.Printf("[*] SMK-37: on Hindsight's firmware; took its screen and panel")
}
