package api

// The SMK-37 on Hindsight's own firmware (internal/surface;
// docs/plan/the-instrument.md, step 7). Its SysEx arrives with every
// controller's messages, from the MIDI watcher, and goes to the keyboard's
// client. When the keyboard first answers, Hindsight takes its screen, and
// with it the panel: while Hindsight has the screen, the pads, encoders,
// faders and buttons send plain MIDI that Play mode's bus binds like any
// controller's (controls.go, the SMK-37's profile). HOME on the keyboard
// gives the screen and the panel back, until HOME held for a second and let
// go hands them over again (OFFER) or the keyboard is plugged in again.

import (
	"log"
	"slices"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/mono"
	"github.com/gabeduke/hindsight/internal/surface"
)

// The keyboard's SysEx reader loses a frame written at USB's full speed (a
// 512-byte BATCH two times in three) and takes every frame up to 996 bytes
// written keyboardChunk at a time, keyboardChunkGap apart: measured on the
// unit from the Pi, 2026-10-29 (docs/architecture/keyboard.md, *Learnt on
// the unit*). A 512-byte frame then takes about 4 ms to write.
const (
	keyboardChunk    = 240
	keyboardChunkGap = 2 * time.Millisecond
)

// keyboardOut writes to the keyboard: an Out aimed at the controller's own
// node, made when the keyboard first opens as a controller, and made again
// if it comes back at another. Its node, not its name: a second keyboard of
// the same name, or one MIDI_IGNORE keeps out by its node, is never opened.
// Nor is one TAPE_CONTROLLER doesn't name.
type keyboardOut struct {
	mu   sync.Mutex
	node string
	out  *midi.Out
}

// to is the Out for the keyboard at node.
func (k *keyboardOut) to(node string) *midi.Out {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.out == nil || k.node != node {
		if k.out != nil {
			k.out.Stop()
		}
		k.out = midi.NewOut([]midi.OutTarget{{Match: node, Chunk: keyboardChunk, ChunkGap: keyboardChunkGap}})
		k.out.Start()
		k.node = node
	}
	return k.out
}

// SetKeyboard gives the API the keyboard's client. Call it before the
// watcher's controllers reach the API (SetControlSink).
func (a *API) SetKeyboard(kb *surface.Keyboard) {
	a.keyboard = kb
	kb.OnPresent(a.keyboardPresent)
	kb.Follow(a.keyboardState)
	kb.Landings(a.keyboardLandings)
}

// keyboardPort is the SMK-37 open as a controller: the first, as Hindsight
// speaks to one at a time.
func (a *API) keyboardPort() (midi.DeviceInfo, bool) {
	for _, d := range a.controllerDevices() {
		if d.Controller && d.Connected && isKeyboard(d.Name) {
			return d, true
		}
	}
	return midi.DeviceInfo{}, false
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
	if d, ok := a.keyboardPort(); ok {
		a.kbOut.to(d.Node).Send(mono.Now(), msg)
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

// keyboardFirmware says whether port is the SMK-37 and runs Hindsight's
// firmware: it answered HELLO. Its PLAY is then a button to the Pi (note 16
// on channel 16), and the realtime Start and Stop it sends are its own
// sequencer's: a screen take made it send several Stops, which stopped the
// tape (docs/architecture/keyboard.md, *Learnt on the unit*), so they are
// not the transport's. The firmware's quiet clock sends none, but a unit on
// an older build still does.
func (a *API) keyboardFirmware(port string) bool {
	return a.keyboard != nil && isKeyboard(port) && a.keyboard.Status().Present
}

// keyboardStatus is /api/status's keyboard: whether it answered HELLO, has
// Hindsight's screen or was homed, its protocol and features, the last
// ack's round trip and the last pad press's answer (surface.Status), in
// milliseconds.
type keyboardStatus struct {
	Present   bool    `json:"present"`
	Screen    bool    `json:"screen"`
	Homed     bool    `json:"homed"`
	Version   int     `json:"version"`
	Features  int     `json:"features"`
	RTTMS     float64 `json:"rtt_ms"`
	ConfirmMS float64 `json:"confirm_ms"`
}

func (a *API) keyboardStatus() *keyboardStatus {
	if a.keyboard == nil {
		return nil
	}
	s := a.keyboard.Status()
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	return &keyboardStatus{Present: s.Present, Screen: s.Screen, Homed: s.Homed, Version: s.Version,
		Features: int(s.Features), RTTMS: ms(s.RTT), ConfirmMS: ms(s.Confirm)}
}

// isKeyboard is a port the SMK-37's profile answers for.
func isKeyboard(port string) bool {
	p := profileOf(port)
	return p != nil && slices.Contains(keyboardNames, p.Name)
}

// ControlSysEx is the watcher's SysEx from a controller
// (midi.ControlSysExSink): the keyboard's acks, its RELEASE and its OFFER.
func (a *API) ControlSysEx(port string, msg []byte) {
	if a.keyboard != nil && isKeyboard(port) {
		a.keyboard.Feed(msg)
	}
}

// keyboardPresent takes the screen, which gives Play mode's bus the panel,
// and says what the panel does there; not after its player pressed HOME,
// until they hold HOME or plug the keyboard in again.
func (a *API) keyboardPresent() {
	kb := a.keyboard
	if kb.Status().Homed {
		log.Printf("[*] SMK-37: on Hindsight's firmware; its screen stays its own (HOME)")
		return
	}
	kb.Clear(surface.Black)
	if kb.Status().Version >= 2 {
		// The designed screen (keyboard_screen.go): Follow draws it as soon
		// as the CLEAR is acked, and keeps it up to date.
		log.Printf("[*] SMK-37: on Hindsight's firmware, protocol 2; took its screen and panel")
		return
	}
	kb.Text(surface.TopX, surface.TopY, 3, surface.Accent, "HINDSIGHT") // the banner's place
	kb.Text(8, 48, 1, surface.Text, "PADS PLAY THE TAPE")
	kb.Text(8, 62, 1, surface.Text, "PLAY: TRANSPORT   REC: KEEP")
	kb.Text(8, 220, 1, surface.Dim, "HOME: THE KEYBOARD'S OWN SCREEN")
	log.Printf("[*] SMK-37: on Hindsight's firmware; took its screen and panel")
}
