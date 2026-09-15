package midi

import (
	"math"
	"testing"

	"github.com/gabeduke/hindsight/internal/smf"
)

// secondsFromNS is the trivial placement for tests: one ns is one ns.
func secondsFromNS(ns int64) (float64, bool) { return float64(ns) / 1e9, true }

func names(m map[uint16]string) func(uint16) string {
	return func(d uint16) string {
		if n, ok := m[d]; ok {
			return n
		}
		return "?"
	}
}

func TestFixedTempoMapTicks(t *testing.T) {
	m := FixedTempoMap(120)
	// 120 BPM: a quarter note is 0.5 s = 960 ticks.
	if got := m.Tick(0.5); got != 960 {
		t.Errorf("Tick(0.5s) = %d, want 960", got)
	}
	if got := m.Tick(60); got != 115200 {
		t.Errorf("Tick(60s) = %d, want 115200", got)
	}
	if got := m.Tick(-1); got != 0 {
		t.Errorf("negative must clamp, got %d", got)
	}
	if got := m.Seconds(960); math.Abs(got-0.5) > 1e-9 {
		t.Errorf("Seconds(960) = %v", got)
	}
	if m.BPMAt(10) != 120 || m.Source != SourceFallback {
		t.Errorf("BPMAt=%v Source=%q", m.BPMAt(10), m.Source)
	}
}

func TestTempoMapSegmentsAreContinuous(t *testing.T) {
	// 120 BPM for 2 s (3840 ticks), then 60 BPM.
	m := &TempoMap{Segments: []Segment{
		{0, 0, smf.USPerQuarter(120)},
		{2, 3840, smf.USPerQuarter(60)},
	}, Source: SourceClock}
	if got := m.Tick(2); got != 3840 {
		t.Errorf("Tick at the boundary = %d, want 3840", got)
	}
	// One second into the 60 BPM segment is one quarter = 960 more ticks.
	if got := m.Tick(3); got != 4800 {
		t.Errorf("Tick(3) = %d, want 4800", got)
	}
	if got := m.Seconds(4800); math.Abs(got-3) > 1e-9 {
		t.Errorf("Seconds(4800) = %v, want 3", got)
	}
	if m.BPMAt(1) != 120 || m.BPMAt(2) != 60 {
		t.Errorf("BPMAt wrong: %v %v", m.BPMAt(1), m.BPMAt(2))
	}
	c := m.Conductor()
	// name, time sig, two tempo events
	if len(c) != 4 || c[2].Tempo() != 500000 || c[3].Tempo() != 1000000 || c[3].Tick != 3840 {
		t.Fatalf("conductor = %+v", c)
	}
}

func TestConductorSkipsUnchangedTempo(t *testing.T) {
	us := smf.USPerQuarter(100)
	m := &TempoMap{Segments: []Segment{{0, 0, us}, {5, 8000, us}, {9, 14400, smf.USPerQuarter(101)}}}
	c := m.Conductor()
	tempos := 0
	for _, e := range c {
		if e.Tempo() != 0 {
			tempos++
		}
	}
	if tempos != 2 {
		t.Fatalf("got %d tempo events, want 2: %+v", tempos, c)
	}
}

func TestBuildSMFDemuxesPerDeviceAndChannel(t *testing.T) {
	evs := []Event{
		{NS: 0, Device: 1, Status: 0x90, D1: 60, D2: 100},
		{NS: 500_000_000, Device: 1, Status: 0x80, D1: 60, D2: 0},
		{NS: 100_000_000, Device: 1, Status: 0x99, D1: 36, D2: 120}, // ch10
		{NS: 200_000_000, Device: 2, Status: 0x90, D1: 64, D2: 90},
		{NS: 250_000_000, Device: 2, Status: 0xB0, D1: 1, D2: 64},
	}
	f, st := BuildSMF(ExportInput{
		Events:   evs,
		Seconds:  secondsFromNS,
		Duration: 2,
		Tempo:    FixedTempoMap(120),
		Name:     names(map[uint16]string{1: "MPC", 2: "Orchid"}),
	})
	if len(f.Tracks) != 4 {
		t.Fatalf("got %d tracks, want conductor + 3", len(f.Tracks))
	}
	want := []string{"MPC ch1", "MPC ch10", "Orchid ch1"}
	for i, w := range want {
		if got := f.Tracks[i+1].Events[0].Text(); got != w {
			t.Errorf("track %d named %q, want %q", i+1, got, w)
		}
	}
	// The note on MPC ch1: on at tick 0, off at 0.5 s = 960 ticks.
	mpc := f.Tracks[1].Events
	if mpc[1].Tick != 0 || mpc[2].Tick != 960 || mpc[2].Status != 0x80 {
		t.Errorf("MPC ch1 = %+v", mpc)
	}
	if st.Tracks[0].Notes != 1 || st.Tracks[2].Events != 2 || st.Placed != 5 {
		t.Errorf("stats = %+v", st)
	}

	// And it survives a round trip through the encoder.
	dec, err := smf.Decode(f.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if len(dec.Tracks) != 4 || dec.Tracks[2].Events[1].D1 != 36 {
		t.Fatalf("decoded = %+v", dec.Tracks[2].Events)
	}
}

func TestBuildSMFClosesHangingNotesAndDropsOrphanOffs(t *testing.T) {
	evs := []Event{
		{NS: 0, Device: 1, Status: 0x80, D1: 50, D2: 0}, // off for a note that began before the window
		{NS: 100_000_000, Device: 1, Status: 0x90, D1: 60, D2: 100},
		{NS: 200_000_000, Device: 1, Status: 0x90, D1: 62, D2: 100},
		{NS: 300_000_000, Device: 1, Status: 0x90, D1: 62, D2: 0}, // velocity-zero off
	}
	f, st := BuildSMF(ExportInput{
		Events: evs, Seconds: secondsFromNS, Duration: 1, Tempo: FixedTempoMap(120),
		Name: names(map[uint16]string{1: "Key"}),
	})
	tr := f.Tracks[1].Events
	// name, on 60, on 62, off 62, and a synthetic off 60 at the end tick
	if len(tr) != 5 {
		t.Fatalf("events = %+v", tr)
	}
	last := tr[4]
	if last.Status != 0x80 || last.D1 != 60 || last.Tick != 1920 {
		t.Errorf("hanging note not closed at the end: %+v", last)
	}
	if st.OrphanNoteOffs != 1 || st.Tracks[0].Hanging != 1 || st.Tracks[0].Notes != 2 {
		t.Errorf("stats = %+v", st)
	}
}

func TestBuildSMFDropsWhatCannotBePlaced(t *testing.T) {
	evs := []Event{
		{NS: -1, Device: 1, Status: 0x90, D1: 60, D2: 1},            // before the window
		{NS: 5_000_000_000, Device: 1, Status: 0x90, D1: 60, D2: 1}, // after it
		{NS: 7, Device: 1, Status: 0x90, D1: 60, D2: 1},             // unplaceable
		{NS: 100, Device: 1, Status: 0xF2, D1: 0, D2: 0},            // song position: not a track event
		{NS: 200, Device: 1, Status: 0x90, D1: 61, D2: 1},
	}
	f, st := BuildSMF(ExportInput{
		Events: evs,
		Seconds: func(ns int64) (float64, bool) {
			if ns == 7 {
				return 0, false
			}
			return float64(ns) / 1e9, true
		},
		Duration: 1, Tempo: FixedTempoMap(120), Name: names(nil),
	})
	if st.OutOfWindow != 2 || st.Unplaceable != 1 || st.NonChannel != 1 || st.Placed != 1 {
		t.Errorf("stats = %+v", st)
	}
	if len(f.Tracks) != 2 || f.Tracks[1].Events[0].Text() != "? ch1" {
		t.Errorf("tracks = %+v", f.Tracks)
	}
}

func TestBuildSMFTransportBecomesMarkers(t *testing.T) {
	evs := []Event{
		{NS: 0, Device: 3, Status: StartByte},
		{NS: 900_000_000, Device: 3, Status: StopByte},
		{NS: 100, Device: 3, Status: 0x90, D1: 1, D2: 1},
	}
	f, _ := BuildSMF(ExportInput{
		Events: evs, Seconds: secondsFromNS, Duration: 1, Tempo: FixedTempoMap(120),
		Name: names(map[uint16]string{3: "Bento"}),
	})
	var markers []string
	for _, e := range f.Tracks[0].Events {
		if e.Meta == smf.MetaMarker {
			markers = append(markers, e.Text())
		}
	}
	if len(markers) != 2 || markers[0] != "Bento: Start" || markers[1] != "Bento: Stop" {
		t.Fatalf("markers = %q", markers)
	}
}

func TestBuildSMFDisambiguatesSameNamedDevices(t *testing.T) {
	evs := []Event{
		{NS: 0, Device: 1, Status: 0x90, D1: 1, D2: 1},
		{NS: 0, Device: 2, Status: 0x90, D1: 1, D2: 1},
		{NS: 0, Device: 3, Status: 0x90, D1: 1, D2: 1},
	}
	f, _ := BuildSMF(ExportInput{
		Events: evs, Seconds: secondsFromNS, Duration: 1, Tempo: FixedTempoMap(120),
		Name: names(map[uint16]string{1: "Orchid", 2: "Orchid", 3: "MPC"}),
	})
	got := []string{f.Tracks[1].Events[0].Text(), f.Tracks[2].Events[0].Text(), f.Tracks[3].Events[0].Text()}
	want := []string{"Orchid (1) ch1", "Orchid (2) ch1", "MPC ch1"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("track %d = %q, want %q", i+1, got[i], want[i])
		}
	}
}

func TestBuildSMFWithNoEventsIsJustAConductor(t *testing.T) {
	f, st := BuildSMF(ExportInput{Seconds: secondsFromNS, Duration: 1, Name: names(nil)})
	if len(f.Tracks) != 1 || st.Placed != 0 {
		t.Fatalf("tracks=%d stats=%+v", len(f.Tracks), st)
	}
}
