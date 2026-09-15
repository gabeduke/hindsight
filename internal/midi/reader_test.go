package midi

import (
	"math"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// fifoFixture builds a cards file plus an snd dir whose midiC2D0 is a FIFO.
// A FIFO behaves enough like a rawmidi character device for this -- a blocking
// read that returns as bytes are written -- so discovery, opening, timestamping
// and recovery are all exercised with no hardware and on a Mac.
func fifoFixture(t *testing.T) (cardsPath, sndDir, fifo string) {
	t.Helper()
	root := t.TempDir()
	cardsPath = filepath.Join(root, "cards")
	if err := os.WriteFile(cardsPath, []byte(realCards), 0o644); err != nil {
		t.Fatal(err)
	}
	sndDir = filepath.Join(root, "snd")
	if err := os.MkdirAll(sndDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fifo = mkfifo(t, sndDir, "midiC2D0")
	return cardsPath, sndDir, fifo
}

func mkfifo(t *testing.T, sndDir, name string) string {
	t.Helper()
	p := filepath.Join(sndDir, name)
	if err := syscall.Mkfifo(p, 0o666); err != nil {
		t.Fatalf("mkfifo: %v", err)
	}
	return p
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// newTestWatcher is a watcher on the fixture with fast timings and the EP as
// the clock device, capturing everything.
func newTestWatcher(cards, snd string, clock *Clock, events *EventRing) *Watcher {
	w := NewWatcher(Policy{Capture: true, ClockDevice: "EP-136"}, clock, events)
	w.CardsPath, w.SndDir = cards, snd
	w.Poll = 20 * time.Millisecond
	// Short, and stepped past below: writing the instant the reader connects is
	// exactly what the drain window is there to discard.
	w.DrainWindow = 20 * time.Millisecond
	return w
}

// openWriter opens the write end, which unblocks the reader's open.
func openWriter(t *testing.T, fifo string) *os.File {
	t.Helper()
	w, err := os.OpenFile(fifo, os.O_WRONLY, 0)
	if err != nil {
		t.Fatalf("open write end: %v", err)
	}
	return w
}

func TestWatcherFeedsPulsesFromTheClockDevice(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(1000))
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to connect", w.Connected)
	time.Sleep(60 * time.Millisecond) // past the drain window

	// Written one at a time so each is timestamped as it lands -- the same
	// shape a rawmidi device delivers.
	for i := 0; i < 200; i++ {
		if _, err := wr.Write([]byte{ClockByte}); err != nil {
			t.Fatalf("write pulse %d: %v", i, err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	waitFor(t, "200 pulses", func() bool { return clock.Pulses() >= 200 })
}

func TestWatcherTimestampsFinelyEnoughToEstimateTempo(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(1000))
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to connect", w.Connected)
	time.Sleep(60 * time.Millisecond)

	// 5ms apart is 500 BPM's worth of pulses, far faster than the EP, and it
	// keeps the test under a second. The point is only that the reader's
	// timestamps are per-arrival rather than per-batch: if they were batched,
	// BPM would refuse on its distinct-timestamp guard.
	start := time.Now()
	for i := 0; i < 120; i++ {
		wr.Write([]byte{ClockByte})
		time.Sleep(5 * time.Millisecond)
	}
	waitFor(t, "120 pulses", func() bool { return clock.Pulses() >= 120 })

	got, ok := clock.BPM(start.Add(-time.Second), time.Now())
	if !ok {
		t.Fatal("BPM refused; the reader is batching its timestamps")
	}
	if math.Abs(got-500) > 150 {
		t.Errorf("BPM = %.1f, want roughly 500", got)
	}
}

// Channel messages go to the event ring, tagged with the device, and a clock
// byte inside one is counted as a pulse without breaking the message.
func TestWatcherStoresMessagesAndCountsInterleavedClock(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	ring := NewEventRing(1000)
	w := newTestWatcher(cards, snd, clock, ring)
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to connect", w.Connected)
	time.Sleep(60 * time.Millisecond)

	// A note-on with a clock byte landing between its status and data bytes,
	// then a sysex, then a Start.
	wr.Write([]byte{0x90, ClockByte, 0x3C, 0x7F, 0xF0, 0x7E, 0x00, 0xF7, StartByte})
	waitFor(t, "the note and the start", func() bool { return ring.Len() == 2 })

	time.Sleep(50 * time.Millisecond)
	if n := clock.Pulses(); n != 1 {
		t.Errorf("Pulses = %d, want exactly 1", n)
	}
	evs := ring.Between(0, math.MaxInt64)
	if len(evs) != 2 || evs[0].Status != 0x90 || evs[0].D1 != 0x3C || evs[0].D2 != 0x7F {
		t.Fatalf("events = %+v", evs)
	}
	if evs[1].Status != StartByte {
		t.Fatalf("second event = %+v, want Start", evs[1])
	}
	devs := w.Devices()
	if len(devs) != 1 || evs[0].Device != devs[0].ID || devs[0].Name != "EP-136" || !devs[0].Clock {
		t.Fatalf("devices = %+v, events = %+v", devs, evs)
	}
}

// A second device gets its own reader and its own id; its clock bytes must not
// feed the tempo path, only the clock device's do.
func TestWatcherOpensEveryDeviceButClocksFromOne(t *testing.T) {
	cards, snd, ep := fifoFixture(t)
	// A third card with no cards-file entry: named from its node.
	other := mkfifo(t, snd, "midiC3D0")
	clock := NewClock(10000)
	ring := NewEventRing(1000)
	w := newTestWatcher(cards, snd, clock, ring)
	w.Start()
	defer w.Stop()

	epW := openWriter(t, ep)
	defer epW.Close()
	otherW := openWriter(t, other)
	defer otherW.Close()
	waitFor(t, "both devices", func() bool {
		n := 0
		for _, d := range w.Devices() {
			if d.Connected {
				n++
			}
		}
		return n == 2
	})
	time.Sleep(60 * time.Millisecond)

	otherW.Write([]byte{ClockByte, ClockByte, ClockByte, 0x91, 60, 100})
	waitFor(t, "the other device's note", func() bool { return ring.Len() == 1 })
	time.Sleep(30 * time.Millisecond)
	if clock.Pulses() != 0 {
		t.Errorf("the non-clock device's pulses reached the tempo path")
	}

	devs := w.Devices()
	if len(devs) != 2 {
		t.Fatalf("devices = %+v", devs)
	}
	byName := map[string]DeviceInfo{}
	for _, d := range devs {
		byName[d.Name] = d
	}
	if _, ok := byName["EP-136"]; !ok {
		t.Errorf("EP-136 missing from %+v", devs)
	}
	o, ok := byName["midiC3D0"]
	if !ok || o.Clock || o.Events != 1 {
		t.Errorf("other device wrong: %+v", o)
	}
	ev := ring.Between(0, math.MaxInt64)[0]
	if ev.Device != o.ID {
		t.Errorf("event tagged %d, want %d", ev.Device, o.ID)
	}
}

// The device disappearing is the unplug case. The watcher must notice, report
// it gone, and pick it up again when it comes back -- with a new id.
func TestWatcherSurvivesUnplugAndReplug(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	ring := NewEventRing(1000)
	w := newTestWatcher(cards, snd, clock, ring)
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	waitFor(t, "the watcher to connect", w.Connected)
	first := w.Devices()[0].ID

	// The node vanishes, then the read fails: closing the only writer gives
	// the reader EOF, which is what an unplugged interface looks like from
	// the read side.
	if err := os.Remove(fifo); err != nil {
		t.Fatal(err)
	}
	wr.Close()
	waitFor(t, "the device to be forgotten", func() bool { return len(w.Devices()) == 0 })
	if w.Connected() {
		t.Error("Connected = true after unplug")
	}
	// Its identity survives for naming events recorded under it.
	if d, ok := w.Device(first); !ok || d.Name != "EP-136" {
		t.Errorf("departed device not remembered: %+v %v", d, ok)
	}

	mkfifo(t, snd, "midiC2D0")
	wr = openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to reconnect", w.Connected)
	if again := w.Devices()[0].ID; again == first {
		t.Errorf("replugged device reused id %d", first)
	}
}

// A watcher with nothing to find is the normal state on a Mac and whenever
// everything is unplugged. It must not spin, panic, or stop trying.
func TestWatcherSurvivesNoDevicesAtAll(t *testing.T) {
	clock := NewClock(10000)
	w := NewWatcher(Policy{Capture: true, ClockDevice: "EP-136"}, clock, nil)
	w.CardsPath, w.SndDir = "/nonexistent/cards", "/nonexistent/snd"
	w.Poll = 10 * time.Millisecond
	w.Start()
	defer w.Stop()

	time.Sleep(80 * time.Millisecond)
	if w.Connected() || len(w.Devices()) != 0 {
		t.Error("a device appeared out of nothing")
	}
}

func TestWatcherStopIsIdempotent(t *testing.T) {
	w := NewWatcher(Policy{}, NewClock(10), nil)
	w.CardsPath, w.SndDir = "/nonexistent/cards", "/nonexistent/snd"
	w.Poll = 10 * time.Millisecond
	w.Start()
	w.Stop()
	w.Stop() // must not panic on a second close
}

// Backlog on open must not be counted.
//
// ALSA buffers incoming clock from the moment the device node appears, and the
// watcher can be up to a poll behind that. Everything that piled up is then
// delivered in the first read or two, so those pulses share a handful of
// timestamps, and the near-zero intervals between them drag the rolling median
// far above the real tempo.
//
// Seen on hardware: three seconds after a replug Hindsight reported 223.3 BPM
// against a true 120. scripts/midi-probe.py drains for exactly this reason.
func TestWatcherDropsTheBacklogItFindsOnOpen(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(1000))
	w.DrainWindow = 300 * time.Millisecond
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to connect", w.Connected)

	burst := make([]byte, 200)
	for i := range burst {
		burst[i] = ClockByte
	}
	if _, err := wr.Write(burst); err != nil {
		t.Fatalf("write burst: %v", err)
	}

	time.Sleep(500 * time.Millisecond) // past the drain window
	if n := clock.Pulses(); n != 0 {
		t.Errorf("Pulses = %d after a backlog burst, want 0 (it must be dropped)", n)
	}

	start := time.Now()
	for i := 0; i < 120; i++ {
		wr.Write([]byte{ClockByte})
		time.Sleep(5 * time.Millisecond)
	}
	waitFor(t, "live pulses", func() bool { return clock.Pulses() >= 120 })

	got, ok := clock.BPM(start.Add(-time.Second), time.Now())
	if !ok {
		t.Fatal("BPM refused after the drain window")
	}
	if math.Abs(got-500) > 150 {
		t.Errorf("BPM = %.1f, want roughly 500; the backlog is still being counted", got)
	}
}

// The drain must not swallow a device that is simply quiet at first.
func TestWatcherCountsPulsesArrivingAfterTheDrainWindow(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(1000))
	w.DrainWindow = 50 * time.Millisecond
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the watcher to connect", w.Connected)

	time.Sleep(120 * time.Millisecond)
	for i := 0; i < 60; i++ {
		wr.Write([]byte{ClockByte})
		time.Sleep(2 * time.Millisecond)
	}
	waitFor(t, "60 pulses", func() bool { return clock.Pulses() >= 60 })
}

// With capture off, only the clock device is opened and nothing is stored --
// the behaviour before MIDI capture existed.
func TestWatcherCaptureOffOpensOnlyTheClockDevice(t *testing.T) {
	cards, snd, ep := fifoFixture(t)
	other := mkfifo(t, snd, "midiC3D0")
	clock := NewClock(10000)
	ring := NewEventRing(1000)
	w := NewWatcher(Policy{Capture: false, ClockDevice: "EP-136"}, clock, ring)
	w.CardsPath, w.SndDir = cards, snd
	w.Poll, w.DrainWindow = 20*time.Millisecond, 20*time.Millisecond
	w.Start()
	defer w.Stop()

	epW := openWriter(t, ep)
	defer epW.Close()
	waitFor(t, "the clock device", w.Connected)
	time.Sleep(60 * time.Millisecond)

	// The other FIFO has no reader, so a non-blocking open of its write end
	// fails with ENXIO. That is the proof it was never opened.
	if f, err := os.OpenFile(other, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
		f.Close()
		t.Error("the non-clock device was opened with capture off")
	}

	epW.Write([]byte{0x90, 60, 100, StartByte})
	time.Sleep(60 * time.Millisecond)
	if ring.Len() != 0 {
		t.Errorf("events stored with capture off: %d", ring.Len())
	}
	if s, _, _ := clock.Transport(); s != 1 {
		t.Errorf("the clock still counts transport: starts = %d", s)
	}
}

func TestPolicyAllowsAndDenies(t *testing.T) {
	ep := Port{Node: "/dev/snd/midiC2D0", Name: "EP-136"}
	orchid := Port{Node: "/dev/snd/midiC3D0", Name: "Orchid"}
	mpc := Port{Node: "/dev/snd/midiC4D0", Name: "MPC One"}

	cases := []struct {
		name   string
		p      Policy
		want   map[string]bool
		reason string
	}{
		{"everything", Policy{Capture: true, ClockDevice: "EP-136"},
			map[string]bool{"ep": true, "orchid": true, "mpc": true}, "capture-all default"},
		{"deny", Policy{Capture: true, ClockDevice: "EP-136", Deny: []string{"ep-136"}},
			map[string]bool{"ep": false, "orchid": true, "mpc": true}, "deny is case-insensitive and beats the clock device"},
		{"allow", Policy{Capture: true, ClockDevice: "Orchid", Allow: []string{"orchid"}},
			map[string]bool{"ep": false, "orchid": true, "mpc": false}, "allowlist restricts"},
		{"allow keeps clock", Policy{Capture: true, ClockDevice: "EP-136", Allow: []string{"orchid"}},
			map[string]bool{"ep": true, "orchid": true, "mpc": false}, "the clock device is opened even off the allowlist"},
		{"by node", Policy{Capture: true, Allow: []string{"midiC4"}},
			map[string]bool{"ep": false, "orchid": false, "mpc": true}, "node paths match too"},
		{"off", Policy{Capture: false, ClockDevice: "EP-136"},
			map[string]bool{"ep": true, "orchid": false, "mpc": false}, "capture off is clock only"},
		{"off, no clock", Policy{Capture: false},
			map[string]bool{"ep": false, "orchid": false, "mpc": false}, "nothing at all"},
	}
	for _, c := range cases {
		got := map[string]bool{"ep": c.p.allows(ep), "orchid": c.p.allows(orchid), "mpc": c.p.allows(mpc)}
		for k, v := range c.want {
			if got[k] != v {
				t.Errorf("%s: allows(%s) = %v, want %v (%s)", c.name, k, got[k], v, c.reason)
			}
		}
	}
}

func TestParseList(t *testing.T) {
	got := ParseList(" EP-136, Orchid ,,MPC ")
	if len(got) != 3 || got[0] != "EP-136" || got[1] != "Orchid" || got[2] != "MPC" {
		t.Fatalf("got %q", got)
	}
	if ParseList("") != nil {
		t.Fatal("empty must be nil")
	}
}

func TestWatcherStopWithoutStartReturns(t *testing.T) {
	w := NewWatcher(Policy{}, NewClock(10), nil)
	done := make(chan struct{})
	go func() { w.Stop(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Stop blocked without Start")
	}
}

// A node that opens but delivers nothing and closes at once -- an output-only
// substream, a node another process holds -- is not reopened every poll: that
// would fill the journal and churn ids. It is left alone for a while, and it
// never gets an id at all.
func TestWatcherLeavesAnUnreadableNodeAlone(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	// A plain file reads EOF immediately: the unreadable case.
	if err := os.WriteFile(filepath.Join(snd, "midiC3D0"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(100))
	w.Start()
	defer w.Stop()

	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the EP", w.Connected)
	time.Sleep(150 * time.Millisecond) // several polls

	devs := w.Devices()
	if len(devs) != 1 || devs[0].Name != "EP-136" {
		t.Fatalf("devices = %+v, want just the EP", devs)
	}
	w.mu.Lock()
	_, parked := w.failed[filepath.Join(snd, "midiC3D0")]
	next := w.nextID
	w.mu.Unlock()
	if !parked {
		t.Error("the unreadable node is not parked")
	}
	// Seven or so polls happened. Reopening the bad node on each would have
	// pushed nextID well past two.
	if next > 2 {
		t.Errorf("nextID = %d; the unreadable node is churning ids", next)
	}
}

// Two ports matching MIDI_CLOCK_DEVICE would double the tempo if both fed the
// pulse ring. Only the first to open is the clock.
func TestWatcherOnlyOnePortIsTheClock(t *testing.T) {
	cards, snd, ep := fifoFixture(t)
	second := mkfifo(t, snd, "midiC2D1") // same card: "EP-136 #2"
	clock := NewClock(10000)
	w := newTestWatcher(cards, snd, clock, NewEventRing(100))
	w.Start()
	defer w.Stop()

	epW := openWriter(t, ep)
	defer epW.Close()
	secondW := openWriter(t, second)
	defer secondW.Close()
	waitFor(t, "both ports", func() bool { return len(w.Devices()) == 2 })
	time.Sleep(60 * time.Millisecond)

	clocks := 0
	for _, d := range w.Devices() {
		if d.Clock {
			clocks++
		}
	}
	if clocks != 1 {
		t.Fatalf("%d ports marked as the clock, want 1: %+v", clocks, w.Devices())
	}
	epW.Write([]byte{ClockByte, ClockByte})
	secondW.Write([]byte{ClockByte, ClockByte})
	time.Sleep(60 * time.Millisecond)
	if n := clock.Pulses(); n != 2 {
		t.Errorf("Pulses = %d, want 2: both ports fed the clock", n)
	}
}

// The match rule reaches the card's long name, as the single-device reader's
// did: DEVICE_MATCH=teenage worked before and must still find the clock.
func TestWatcherClockDeviceMatchesTheCardEntry(t *testing.T) {
	cards, snd, fifo := fifoFixture(t)
	clock := NewClock(10000)
	w := NewWatcher(Policy{Capture: true, ClockDevice: "teenage"}, clock, NewEventRing(100))
	w.CardsPath, w.SndDir = cards, snd
	w.Poll, w.DrainWindow = 20*time.Millisecond, 20*time.Millisecond
	w.Start()
	defer w.Stop()
	wr := openWriter(t, fifo)
	defer wr.Close()
	waitFor(t, "the clock device by its long name", w.Connected)
}
