package api

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// firmwareV2 answers as protocol version 2's firmware: HELLO with 02 60,
// and every ack in the version its message came in.
type firmwareV2 struct {
	mu     sync.Mutex
	frames [][]byte
	acks   chan []byte
}

func (f *firmwareV2) send(b []byte) {
	f.mu.Lock()
	f.frames = append(f.frames, append([]byte(nil), b...))
	f.mu.Unlock()
	ack := []byte{0xF0, 0x7D, 'H', 'S', b[4], b[5], 0x7F, 0x00}
	switch b[6] {
	case 0x00:
		ack = append(ack, 0x02, 0x60)
	case 0x09:
		ack = append(ack, 0x00, 0x00) // done, unread when OK
	}
	f.acks <- append(ack, 0xF7)
}

func (f *firmwareV2) sent() [][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]byte(nil), f.frames...)
}

// batched is every text the BATCH frames drew, as "x y words".
func (f *firmwareV2) texts() string {
	var b strings.Builder
	for _, fr := range f.sent() {
		if fr[6] != 0x09 {
			continue
		}
		for p := fr[7 : len(fr)-1]; len(p) > 0; p = p[2+int(p[1]):] {
			if p[0] == 0x02 {
				b.WriteString(string(p[2+7:2+int(p[1])]) + "|")
			}
		}
	}
	return b.String()
}

func takenKeyboardV2(t *testing.T) (*API, *surface.Keyboard, *firmwareV2) {
	t.Helper()
	_, _, a, _ := controlsAPI(t, t.TempDir())
	a.SetControllers(listed{{Name: "SMK-37", Controller: true, Connected: true}})
	fw := &firmwareV2{acks: make(chan []byte, 64)}
	kb := surface.New(fw.send, func() bool { return true })
	kb.Probe, kb.AckTimeout = 10*time.Millisecond, time.Second
	a.SetKeyboard(kb)
	kb.Start()
	t.Cleanup(kb.Stop)
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || !strings.Contains(fw.texts(), "NO TAPE") {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never drawn: %+v, texts %q", kb.Status(), fw.texts())
		}
	}
	return a, kb, fw
}

func pump(a *API, fw *firmwareV2, d time.Duration) {
	end := time.After(d)
	for {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-end:
			return
		}
	}
}

// On protocol 2 Hindsight takes the screen and draws the designed one, in
// version 2 frames: no legend, no v1 TEXT.
func TestOnVersion2TheDesignedScreenIsDrawn(t *testing.T) {
	_, kb, fw := takenKeyboardV2(t)
	if v := kb.Status().Version; v != 2 {
		t.Fatalf("version %d", v)
	}
	for _, f := range fw.sent()[1:] {
		if f[4] != 2 || f[6] == 0x02 {
			t.Fatalf("sent % x: want version 2 frames, and the screen in BATCHes", f)
		}
	}
	if got := fw.texts(); !strings.Contains(got, "FX PADS") || strings.Contains(got, "PADS PLAY THE TAPE") {
		t.Fatalf("drew %q", got)
	}
}

// A press's banner on version 2 is a box in its colour: PLAY's green.
func TestOnVersion2ThePressesBannerIsABox(t *testing.T) {
	a, _, fw := takenKeyboardV2(t)
	before := len(fw.sent())
	a.keyboardSays("SMK-37", a.keyboardPressed("SMK-37"), says{words: "PLAY", colour: surface.Green})
	pump(a, fw, 100*time.Millisecond)
	found := false
	for _, f := range fw.sent()[before:] {
		if f[6] == 0x09 && strings.Contains(string(f), "PLAY") &&
			strings.Contains(string(f), string([]byte{0x06, 0x09, 0, 0, 0, 0, 0x70, 0x01, 28, 0, byte(surface.Green)})) {
			found = true
		}
	}
	if !found {
		t.Fatal("no green banner box with PLAY was sent")
	}
}

// An encoder turned on the keyboard is lit, named by what it's bound to,
// with the value it sent; an unbound one is its panel name and a dash.
func TestAnEncoderTurnedIsLitWithItsBinding(t *testing.T) {
	a, _, _ := takenKeyboardV2(t)
	a.ControlMIDI("SMK-37", 0xBF, 23, 90) // CC 23 on channel 16: DRIVE
	s := a.keyboardState()
	if s.LitKnob != 2 || s.Knobs[2].Name != "DRIVE" || s.Knobs[2].Value != "90" || s.Knobs[2].Amount != 90 {
		t.Fatalf("lit %d, knob %+v", s.LitKnob, s.Knobs[2])
	}
	if k := s.Knobs[4]; k.Name != "SELECT" || k.Value != "-" || k.Amount != -1 {
		t.Fatalf("an unbound encoder shows %+v", k)
	}
	if s.Knobs[0].Name != "WOW" || s.Knobs[0].Value != "0" {
		t.Fatalf("K1 shows %+v, want WOW at the clean tape's 0", s.Knobs[0])
	}
}

// The tape's part of the screen: its name, tempo, the armed track, mutes,
// solos and levels.
func TestTheTapesScreen(t *testing.T) {
	tp := &tape.Tape{ID: "t3", Name: "Tape 3", SampleRate: 48000, RecTracks: []int{2}}
	tp.Grid = &tape.Grid{Frames: 48000 * 60 * 4 / 132 * 4, Bars: 4}
	tp.Tracks = []tape.Track{{N: 1}, {N: 2, GainDB: -6, Mute: true}, {N: 3, Solo: true}, {N: 4}}
	s := tapeScreen(tp)
	if s.Tape != "Tape 3" || s.Tempo < 131.9 || s.Tempo > 132.1 || s.Armed != 2 || !s.Mute[1] || !s.Solo[2] || s.Fader[1] != 50 || s.Fader[0] != 100 {
		t.Fatalf("tapeScreen = %+v", s)
	}
	if s := tapeScreen(nil); s.Tape != "NO TAPE" || s.Tempo != 0 {
		t.Fatalf("no tape: %+v", s)
	}
}

func TestMeterOf(t *testing.T) {
	for level, want := range map[float64]int{0: 0, 1: 127, 2: 127, 0.5: 111, 0.001: 0} {
		if got := meterOf(level); got != want {
			t.Errorf("meterOf(%v) = %d, want %d", level, got, want)
		}
	}
}

// A punch armed with the tape standing waits for the bar: the transport
// says STOP, not REC, until it records.
func TestArmedWithTheTapeStoppedIsNotREC(t *testing.T) {
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	eng := tape.NewEngine(tape.Options{Store: store, Capture: ringCapture{audio.NewRing(48000, 8)}})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	tp, err := store.Create("t", 120, 4, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := eng.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	a := New(&config.Config{OutputDir: t.TempDir(), SampleRate: 48000}, nil, nil, nil, nil)
	a.SetTape(eng)
	r, err := eng.Record(tp.ID, 1, eng.Sources()[0].Name, false)
	if err != nil || r.State != "armed" {
		t.Fatalf("Record standing = %+v, %v: want armed", r, err)
	}
	if s := a.keyboardState(); s.Recording || s.Playing {
		t.Fatalf("armed and standing shows recording %v, playing %v", s.Recording, s.Playing)
	}
}

// An encoder bound anew is named anew, with no change to the tape.
func TestAnEncoderReboundIsNamedAnew(t *testing.T) {
	a, _, _ := takenKeyboardV2(t)
	if k := a.keyboardState().Knobs[4]; k.Name != "SELECT" {
		t.Fatalf("K5 before = %+v", k)
	}
	a.controls.mu.Lock()
	bs, _, _ := a.bindingsLocked("SMK-37")
	bs = bs.bind("mod.wow", Binding{CC: ptr(25), Ch: 16, As: "amount"})
	a.controlsLocked().Controllers["SMK-37"] = bs
	if err := a.saveControlsLocked(); err != nil {
		t.Fatal(err)
	}
	a.controls.mu.Unlock()
	if k := a.keyboardState().Knobs[4]; k.Name != "WOW" {
		t.Fatalf("K5 after binding CC 25 to WOW = %+v", k)
	}
}

func ptr(n int) *int { return &n }
