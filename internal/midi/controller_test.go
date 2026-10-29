package midi

import (
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

// cardsWithSMK is realCards with a controller on card 3.
const cardsWithSMK = realCards + ` 3 [SMK37          ]: USB-Audio - SMK-37
                      M-VAVE SMK-37 at usb-xhci-hcd.0-2, full speed
`

// sink records what a controller played, and its going.
type sink struct {
	mu   sync.Mutex
	msgs [][4]any
	gone []string
}

func (s *sink) ControlMIDI(port string, status, d1, d2 byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = append(s.msgs, [4]any{port, status, d1, d2})
}

func (s *sink) ControllerGone(port string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gone = append(s.gone, port)
}

func (s *sink) count() (int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.msgs), len(s.gone)
}

func controllerFixture(t *testing.T) (cards, snd, ep, smk string) {
	t.Helper()
	root := t.TempDir()
	cards = filepath.Join(root, "cards")
	if err := os.WriteFile(cards, []byte(cardsWithSMK), 0o644); err != nil {
		t.Fatal(err)
	}
	snd = filepath.Join(root, "snd")
	if err := os.MkdirAll(snd, 0o755); err != nil {
		t.Fatal(err)
	}
	return cards, snd, mkfifo(t, snd, "midiC2D0"), mkfifo(t, snd, "midiC3D0")
}

// openWriterSoon opens a FIFO's write end once the watcher has opened its
// read end, or fails the test: a blocking open would hang it instead when
// the watcher never opens the node.
func openWriterSoon(t *testing.T, fifo string) *os.File {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		f, err := os.OpenFile(fifo, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			return f
		}
		if time.Now().After(deadline) {
			t.Fatalf("the watcher never opened %s: %v", fifo, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func controllerOpen(w *Watcher) bool {
	for _, d := range w.Devices() {
		if d.Name == "SMK-37" && d.Controller && d.Connected {
			return true
		}
	}
	return false
}

func controllerWatcher(cards, snd string, p Policy, ring *EventRing) *Watcher {
	w := NewWatcher(p, NewClock(10000), ring)
	w.CardsPath, w.SndDir = cards, snd
	w.Poll, w.DrainWindow = 20*time.Millisecond, 20*time.Millisecond
	return w
}

// With MIDI_CAPTURE off only the clock device used to be opened. A
// controller is opened too, and its notes go to the bus, not into takes.
func TestWatcherOpensAControllerWithCaptureOff(t *testing.T) {
	cards, snd, _, smk := controllerFixture(t)
	ring := NewEventRing(100)
	s := &sink{}
	w := controllerWatcher(cards, snd, Policy{Capture: false, ClockDevice: "EP-136", Controllers: []string{"smk"}}, ring)
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()

	wr := openWriterSoon(t, smk)
	defer wr.Close()
	waitFor(t, "the controller to open", func() bool { return controllerOpen(w) })
	time.Sleep(60 * time.Millisecond) // past the drain window
	// A note, by running status its note-off, and Start.
	if _, err := wr.Write([]byte{0x90, 40, 100, 40, 0, StartByte}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "three messages on the bus", func() bool { n, _ := s.count(); return n == 3 })
	s.mu.Lock()
	got := s.msgs
	s.mu.Unlock()
	want := [][4]any{{"SMK-37", byte(0x90), byte(40), byte(100)}, {"SMK-37", byte(0x90), byte(40), byte(0)}, {"SMK-37", StartByte, byte(0), byte(0)}}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("message %d = %v, want %v", i, got[i], want[i])
		}
	}
	if ring.Len() != 0 {
		t.Errorf("a controller's notes were stored with capture off: %d", ring.Len())
	}
}

// sysexSink is a sink that hears SysEx too, as internal/api's does.
type sysexSink struct {
	sink
	sysex [][]byte
}

func (s *sysexSink) ControlSysEx(port string, msg []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sysex = append(s.sysex, append([]byte(port+":"), msg...))
}

// A controller's SysEx reaches a sink that hears it -- the keyboard's acks
// and its RELEASE (internal/surface) -- and its notes go on as before. The
// ring stays free of both.
func TestAControllersSysExReachesTheSink(t *testing.T) {
	cards, snd, _, smk := controllerFixture(t)
	ring := NewEventRing(100)
	s := &sysexSink{}
	w := controllerWatcher(cards, snd, Policy{Capture: true, Controllers: []string{"smk"}}, ring)
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()

	wr := openWriterSoon(t, smk)
	defer wr.Close()
	waitFor(t, "the controller to open", func() bool { return controllerOpen(w) })
	time.Sleep(60 * time.Millisecond) // past the drain window
	if _, err := wr.Write([]byte{0xF0, 0x7D, 0x48, 0x53, 0x01, 0x00, 0x03, 0xF7, 0x99, 39, 100}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "a SysEx and a note on the bus", func() bool {
		n, _ := s.count()
		s.mu.Lock()
		defer s.mu.Unlock()
		return n == 1 && len(s.sysex) == 1
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	if want := append([]byte("SMK-37:"), 0xF0, 0x7D, 0x48, 0x53, 0x01, 0x00, 0x03, 0xF7); string(s.sysex[0]) != string(want) {
		t.Errorf("SysEx = % x, want % x", s.sysex[0], want)
	}
	if want := [4]any{"SMK-37", byte(0x99), byte(39), byte(100)}; s.msgs[0] != want {
		t.Errorf("note = %v, want %v", s.msgs[0], want)
	}
	if ring.Len() != 1 {
		t.Errorf("the ring holds %d events, want the note alone", ring.Len())
	}
}

// MIDI_IGNORE wins over everything, TAPE_CONTROLLER too: an ignored device
// is never opened, so a broad controller name can't make it play the tape.
func TestAnIgnoredControllerIsNeverOpened(t *testing.T) {
	cards, snd, _, smk := controllerFixture(t)
	s := &sink{}
	w := controllerWatcher(cards, snd, Policy{Capture: true, Deny: []string{"SMK"}, Controllers: []string{"SMK-37"}}, NewEventRing(100))
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()
	time.Sleep(100 * time.Millisecond) // a few scans
	// No reader: a non-blocking open of the write end fails. That is the
	// proof it was never opened.
	if f, err := os.OpenFile(smk, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
		f.Close()
		t.Fatal("an ignored controller was opened")
	}
	if controllerOpen(w) {
		t.Error("an ignored controller is listed as open")
	}
}

// MIDI_DEVICES keeps a controller out of takes: left off the list, it
// still plays the tape, and nothing it plays is stored.
func TestAControllerLeftOffMIDIDevicesPlaysButIsntKept(t *testing.T) {
	cards, snd, _, smk := controllerFixture(t)
	ring := NewEventRing(100)
	s := &sink{}
	w := controllerWatcher(cards, snd, Policy{Capture: true, Allow: []string{"EP-136"}, Controllers: []string{"SMK-37"}}, ring)
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()
	wr := openWriterSoon(t, smk)
	defer wr.Close()
	waitFor(t, "the controller to open", func() bool { return controllerOpen(w) })
	time.Sleep(60 * time.Millisecond)
	wr.Write([]byte{0x90, 36, 90})
	waitFor(t, "the note on the bus", func() bool { n, _ := s.count(); return n == 1 })
	if ring.Len() != 0 {
		t.Errorf("a controller left off MIDI_DEVICES was stored: %d", ring.Len())
	}
}

// A controller that goes says so, so the pads it held are let go.
func TestWatcherSaysWhenAControllerGoes(t *testing.T) {
	cards, snd, _, smk := controllerFixture(t)
	s := &sink{}
	w := controllerWatcher(cards, snd, Policy{Capture: true, Controllers: []string{"SMK"}}, NewEventRing(100))
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()
	wr := openWriterSoon(t, smk)
	waitFor(t, "the controller to open", func() bool { return controllerOpen(w) })
	time.Sleep(60 * time.Millisecond)
	wr.Write([]byte{0x90, 40, 100})
	waitFor(t, "the note", func() bool { n, _ := s.count(); return n == 1 })
	// Unplugged: the node goes, the read ends.
	os.Remove(smk)
	wr.Close()
	waitFor(t, "the going", func() bool { _, g := s.count(); return g == 1 })
	if s.gone[0] != "SMK-37" {
		t.Errorf("gone = %v", s.gone)
	}
}

// A device that isn't a controller never reaches the bus.
func TestOnlyControllersReachTheBus(t *testing.T) {
	cards, snd, ep, _ := controllerFixture(t)
	s := &sink{}
	ring := NewEventRing(100)
	w := controllerWatcher(cards, snd, Policy{Capture: true, ClockDevice: "EP-136", Controllers: []string{"SMK"}}, ring)
	w.SetControlSink(s)
	w.Start()
	defer w.Stop()
	wr := openWriterSoon(t, ep)
	defer wr.Close()
	waitFor(t, "the EP", w.Connected)
	time.Sleep(60 * time.Millisecond)
	wr.Write([]byte{0x90, 40, 100})
	waitFor(t, "the note stored", func() bool { return ring.Len() == 1 })
	if n, _ := s.count(); n != 0 {
		t.Errorf("the EP-136's note reached the bus: %d", n)
	}
}
