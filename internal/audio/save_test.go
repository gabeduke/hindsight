package audio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/mono"
)

// writeFakeTake creates a file that ListTakes will pick up. The WAV header is
// not valid, which is deliberate: ListTakes must degrade to filesystem facts
// when ReadWAVInfo fails, and these tests are about metadata, not audio.
func writeFakeTake(t *testing.T, dir, name string, modAgo time.Duration) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("not a real wav"), 0o644); err != nil {
		t.Fatal(err)
	}
	mod := time.Now().Add(-modAgo)
	if err := os.Chtimes(p, mod, mod); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestListTakesMergesSidecar(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	if err := WriteMeta(wav, Meta{Label: "the good one", Starred: true}); err != nil {
		t.Fatal(err)
	}

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatalf("ListTakes: %v", err)
	}
	if len(takes) != 1 {
		t.Fatalf("got %d takes, want 1", len(takes))
	}
	if takes[0].Label != "the good one" {
		t.Errorf("Label = %q, want %q", takes[0].Label, "the good one")
	}
	if !takes[0].Starred {
		t.Error("Starred = false, want true")
	}
}

func TestListTakesWithoutSidecarHasEmptyLabel(t *testing.T) {
	dir := t.TempDir()
	writeFakeTake(t, dir, "jam_a.wav", time.Minute)

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatalf("ListTakes: %v", err)
	}
	if len(takes) != 1 {
		t.Fatalf("got %d takes, want 1", len(takes))
	}
	if takes[0].Label != "" || takes[0].Starred {
		t.Errorf("want defaults for a take with no sidecar, got %+v", takes[0])
	}
	if takes[0].Name != "jam_a.wav" {
		t.Errorf("Name = %q, want the filename", takes[0].Name)
	}
}

func TestListTakesIgnoresSidecarsAsTakes(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	if err := WriteMeta(wav, Meta{Label: "x"}); err != nil {
		t.Fatal(err)
	}

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatalf("ListTakes: %v", err)
	}
	if len(takes) != 1 {
		t.Fatalf("got %d takes, want 1 — the .meta.json must not be listed", len(takes))
	}
}

func TestListTakesSortsStarredFirstThenNewest(t *testing.T) {
	dir := t.TempDir()
	// Oldest is starred, so ordering by date alone would put it last.
	oldStarred := writeFakeTake(t, dir, "jam_old_starred.wav", 3*time.Hour)
	writeFakeTake(t, dir, "jam_newest.wav", 1*time.Minute)
	writeFakeTake(t, dir, "jam_middle.wav", 1*time.Hour)

	if err := WriteMeta(oldStarred, Meta{Starred: true}); err != nil {
		t.Fatal(err)
	}

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatalf("ListTakes: %v", err)
	}

	var got []string
	for _, tk := range takes {
		got = append(got, tk.Name)
	}
	want := []string{"jam_old_starred.wav", "jam_newest.wav", "jam_middle.wav"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestRemoveTakeDeletesSidecar(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	if err := WriteMeta(wav, Meta{Label: "x", Starred: true}); err != nil {
		t.Fatal(err)
	}

	RemoveTake(dir, "jam_a.wav")

	if _, err := os.Stat(wav); !os.IsNotExist(err) {
		t.Error("wav still present after RemoveTake")
	}
	if _, err := os.Stat(metaPath(wav)); !os.IsNotExist(err) {
		t.Error("sidecar still present after RemoveTake — a new take reusing the name would inherit it")
	}
}

// fakeTempo is a TempoSource that answers from a fixed value and records the
// window it was asked about.
type fakeTempo struct {
	bpm      float64
	ok       bool
	panics   bool
	gotStart time.Time
	gotEnd   time.Time
}

func (f *fakeTempo) BPM(start, end time.Time) (float64, bool) {
	if f.panics {
		panic("a tempo source must never be able to break a save")
	}
	f.gotStart, f.gotEnd = start, end
	return f.bpm, f.ok
}

func TestStampTempoWritesTheSidecar(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)

	src := &fakeTempo{bpm: 129.874321, ok: true}
	stampTempo(wav, src, time.Now(), 30*time.Second)

	got := ReadMeta(wav)
	if got.BPM == nil {
		t.Fatal("BPM = nil, want 129.87")
	}
	// Rounded to two decimals: the estimator's precision is not meaningful
	// past that and a sidecar full of 129.87432100000001 helps nobody.
	if *got.BPM != 129.87 {
		t.Errorf("BPM = %v, want 129.87", *got.BPM)
	}
}

func TestStampTempoAsksAboutTheCapturedWindow(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)

	end := time.Now()
	src := &fakeTempo{bpm: 120, ok: true}
	stampTempo(wav, src, end, 30*time.Second)

	if !src.gotEnd.Equal(end) {
		t.Errorf("end = %v, want %v", src.gotEnd, end)
	}
	if want := end.Add(-30 * time.Second); !src.gotStart.Equal(want) {
		t.Errorf("start = %v, want %v", src.gotStart, want)
	}
}

// No clock, no device, too short a window: all of these leave the take alone.
func TestStampTempoWritesNothingWhenThereIsNoReading(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)

	stampTempo(wav, &fakeTempo{ok: false}, time.Now(), 30*time.Second)

	if _, err := os.Stat(metaPath(wav)); !os.IsNotExist(err) {
		t.Errorf("a sidecar was written for a take with no reading (err = %v)", err)
	}
}

func TestStampTempoWithNoSourceIsANoOp(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)

	stampTempo(wav, nil, time.Now(), 30*time.Second)

	if _, err := os.Stat(metaPath(wav)); !os.IsNotExist(err) {
		t.Errorf("a sidecar was written with no tempo source (err = %v)", err)
	}
}

// The hard rule from the spec: a save must never fail because of MIDI. A tempo
// source that panics is the most hostile version of that.
func TestStampTempoSurvivesAPanickingSource(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)

	stampTempo(wav, &fakeTempo{panics: true}, time.Now(), 30*time.Second)
	// Reaching here without the process dying is the assertion.
}

// Stamping must not clobber a label a user set between the write and the stamp.
func TestStampTempoPreservesExistingSidecarFields(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", 0)
	if err := WriteMeta(wav, Meta{Label: "keep me", Starred: true}); err != nil {
		t.Fatal(err)
	}

	stampTempo(wav, &fakeTempo{bpm: 100, ok: true}, time.Now(), 30*time.Second)

	got := ReadMeta(wav)
	if got.Label != "keep me" || !got.Starred {
		t.Errorf("stamping lost sidecar fields: %+v", got)
	}
	if got.BPM == nil || *got.BPM != 100 {
		t.Errorf("BPM = %v, want 100", got.BPM)
	}
}

func TestListTakesReportsBPM(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	bpm := 92.5
	if err := WriteMeta(wav, Meta{BPM: &bpm}); err != nil {
		t.Fatal(err)
	}

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(takes) != 1 || takes[0].BPM == nil {
		t.Fatalf("BPM missing from the listing: %+v", takes)
	}
	if *takes[0].BPM != 92.5 {
		t.Errorf("BPM = %v, want 92.5", *takes[0].BPM)
	}
}

// The take list is what the waveform overlay reads flags from (GET
// /api/jams), a separate path from the sidecar PATCH stores them through, so
// this locks in that ListTakes actually carries them across.
func TestListTakesReportsFlags(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	if err := WriteMeta(wav, Meta{Flags: []Flag{{Frame: 100}, {Frame: 900}}}); err != nil {
		t.Fatal(err)
	}

	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(takes) != 1 || len(takes[0].Flags) != 2 {
		t.Fatalf("flags missing from the listing: %+v", takes)
	}
	if takes[0].Flags[0].Frame != 100 || takes[0].Flags[1].Frame != 900 {
		t.Errorf("frames = %+v, want 100 then 900", takes[0].Flags)
	}
}

func TestFlagsForWindowTranslatesToTakeRelativeFrames(t *testing.T) {
	// Window covers absolute frames [1000, 1400).
	got := flagsForWindow([]uint64{1000, 1200, 1399}, 1000, 1400)
	want := []int64{0, 200, 399}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %d flags", got, len(want))
	}
	for i := range want {
		if got[i].Frame != want[i] {
			t.Errorf("flag[%d].Frame = %d, want %d", i, got[i].Frame, want[i])
		}
	}
}

func TestFlagsForWindowExcludesMarksOutsideIt(t *testing.T) {
	got := flagsForWindow([]uint64{999, 1400, 5000}, 1000, 1400)
	if len(got) != 0 {
		t.Errorf("got %+v, want none: 999 predates the window and 1400 is past its last frame", got)
	}
}

func TestFlagsForWindowOnAnEmptyWindow(t *testing.T) {
	if got := flagsForWindow([]uint64{5}, 0, 0); got != nil {
		t.Errorf("got %+v, want nil", got)
	}
}

func TestFlagsForWindowWithNoMarks(t *testing.T) {
	if got := flagsForWindow(nil, 1000, 2000); got != nil {
		t.Errorf("got %+v, want nil", got)
	}
}

func TestMarkNowOnAnEmptyRingReportsFalse(t *testing.T) {
	c := NewCapture(&config.Config{Channels: 2, SampleRate: 48000, RingSeconds: 10, SaveChannels: []int{0, 1}}, nil)
	if _, ok := c.MarkNow(); ok {
		t.Error("MarkNow on an empty ring = true, want false")
	}
}

// The regression this pins: a mark placed at TotalFrames() rather than
// TotalFrames()-1 lands one past the last frame of the very take that should
// contain it, and flagsForWindow's half-open window drops it. Marking and then
// capturing is the feature's core path.
func TestAMarkPlacedNowSurvivesAnImmediateCapture(t *testing.T) {
	c := NewCapture(&config.Config{Channels: 2, SampleRate: 48000, RingSeconds: 10, SaveChannels: []int{0, 1}}, nil)
	c.Ring().WriteFrames(make([]int32, 1000*2))

	frame, ok := c.MarkNow()
	if !ok {
		t.Fatal("MarkNow reported no audio")
	}

	_, got, end := c.Ring().SnapshotAt(0) // the whole ring, as Save(0) does
	flags := flagsForWindow(c.Flags().Active(end, 480000), end-uint64(got), end)
	if len(flags) != 1 {
		t.Fatalf("flags in the captured window = %+v, want the mark at %d to survive", flags, frame)
	}
	if flags[0].Frame != int64(got-1) {
		t.Errorf("flag frame = %d, want %d (the take's last frame)", flags[0].Frame, got-1)
	}
}

func TestStampFlagsWritesSidecarAndCues(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_stamp.wav")
	data := make([]int32, 1000*2)
	if _, err := WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatalf("WriteWAV: %v", err)
	}

	stampFlags(p, []Flag{{Frame: 100}, {Frame: 900}})

	m := ReadMeta(p)
	if len(m.Flags) != 2 || m.Flags[0].Frame != 100 || m.Flags[1].Frame != 900 {
		t.Errorf("sidecar flags = %+v, want frames 100 and 900", m.Flags)
	}
	cues, err := ReadCues(p)
	if err != nil {
		t.Fatalf("ReadCues: %v", err)
	}
	if len(cues) != 2 || cues[0] != 100 || cues[1] != 900 {
		t.Errorf("cues = %v, want [100 900]", cues)
	}
}

func TestStampFlagsWithNoneWritesNothing(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_none.wav")
	data := make([]int32, 100*2)
	if _, err := WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatalf("WriteWAV: %v", err)
	}
	before, _ := os.Stat(p)

	stampFlags(p, nil)

	if m := ReadMeta(p); m.Flags != nil {
		t.Errorf("Flags = %+v, want nil", m.Flags)
	}
	if _, err := os.Stat(strings.TrimSuffix(p, ".wav") + ".meta.json"); err == nil {
		t.Error("a sidecar was written for a take with no flags")
	}
	after, _ := os.Stat(p)
	if after.Size() != before.Size() {
		t.Errorf("file size changed from %d to %d", before.Size(), after.Size())
	}
}

// Save calls stampFlags then stampTempo, and each does its own
// ReadMeta -> mutate -> WriteMeta. Correctness depends on that running
// synchronously in this order: making either call asynchronous lets the two
// read-modify-writes interleave, so one's read predates the other's write and
// silently loses it. This goes through the real Saver rather than calling
// stampFlags/stampTempo directly, so that a regression in Save's own call
// order or synchronicity -- not just in the helpers themselves -- shows up
// here. Nothing else in this file exercises both fields on one take.
func TestSaveWritesFlagsAndTempoOnTheSameTake(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		Channels:     2,
		SampleRate:   48000,
		RingSeconds:  10,
		SaveChannels: []int{0, 1},
		OutputDir:    dir,
	}
	cap := NewCapture(cfg, nil)
	cap.Ring().WriteFrames(make([]int32, 1000*2))
	if _, ok := cap.MarkNow(); !ok {
		t.Fatal("MarkNow reported no audio")
	}

	saver := NewSaver(cap)
	saver.SetTempoSource(&fakeTempo{bpm: 120, ok: true})

	name, err := saver.Save(0)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}

	m := ReadMeta(filepath.Join(dir, name))
	if len(m.Flags) != 1 {
		t.Errorf("Flags = %+v, want the mark placed before Save to survive it", m.Flags)
	}
	if m.BPM == nil || *m.BPM != 120 {
		t.Errorf("BPM = %v, want 120", m.BPM)
	}
}

// A cue-write failure must leave the sidecar intact: metadata is the source of
// truth and the WAV's cue chunk is a derived export.
func TestStampFlagsKeepsTheSidecarWhenTheCueWriteFails(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "jam_bad.wav")
	// Not a WAV at all, so WriteCues must fail.
	if err := os.WriteFile(p, []byte("not a riff file"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	stampFlags(p, []Flag{{Frame: 5}})

	m := ReadMeta(p)
	if len(m.Flags) != 1 || m.Flags[0].Frame != 5 {
		t.Errorf("sidecar flags = %+v, want the flag kept despite the cue failure", m.Flags)
	}
}

// fakeExporter records what Save asked it to export, or panics, or fails.
type fakeExporter struct {
	got    []MIDIExportRequest
	panics bool
	err    error
}

func (f *fakeExporter) Export(req MIDIExportRequest) error {
	if f.panics {
		panic("an exporter must never be able to break a save")
	}
	f.got = append(f.got, req)
	if f.err == nil {
		// Write the sidecar a real exporter would, so ListTakes sees it.
		os.WriteFile(MIDIPath(req.WavPath), []byte("MThd"), 0o644)
	}
	return f.err
}

func newSaveFixture(t *testing.T) (*config.Config, *Capture, *Saver) {
	t.Helper()
	cfg := &config.Config{
		Channels:     2,
		SampleRate:   48000,
		FramesPerBuf: 256,
		RingSeconds:  10,
		SaveChannels: []int{0, 1},
		OutputDir:    t.TempDir(),
	}
	cap := NewCapture(cfg, nil)
	return cfg, cap, NewSaver(cap)
}

// The exporter is handed the window Save actually snapshotted, in absolute
// ring frames, and the bridge, so it can place MIDI against those frames.
func TestSaveHandsTheExporterTheCapturedWindow(t *testing.T) {
	cfg, cap, saver := newSaveFixture(t)
	cap.Ring().WriteFrames(make([]int32, 3000*2))
	cap.Ring().WriteFrames(make([]int32, 3000*2))
	ex := &fakeExporter{}
	saver.SetMIDIExporter(ex)

	name, err := saver.Save(0.1) // 4800 frames of the 6000
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if len(ex.got) != 1 {
		t.Fatalf("exporter called %d times, want 1", len(ex.got))
	}
	req := ex.got[0]
	if req.Frames != 4800 || req.StartFrame != 1200 || req.SampleRate != cfg.SampleRate {
		t.Errorf("request = %+v, want frames 4800 from 1200", req)
	}
	if req.Bridge != cap.Bridge() || req.WavPath != filepath.Join(cfg.OutputDir, name) {
		t.Errorf("request bridge/path wrong: %+v", req)
	}
	if req.SavedAt.IsZero() {
		t.Error("SavedAt not set")
	}

	takes, _ := ListTakes(cfg.OutputDir)
	if !takes[0].HasMIDI || takes[0].MIDI != strings.TrimSuffix(name, ".wav")+".mid" {
		t.Errorf("take = %+v, want has_midi with the .mid name", takes[0])
	}
}

// An exporter that panics or errors is the most hostile version of the rule
// that a save never fails because of MIDI.
func TestSaveSurvivesAHostileExporter(t *testing.T) {
	for _, ex := range []*fakeExporter{{panics: true}, {err: os.ErrPermission}} {
		cfg, cap, saver := newSaveFixture(t)
		cap.Ring().WriteFrames(make([]int32, 1000*2))
		saver.SetMIDIExporter(ex)
		name, err := saver.Save(0)
		if err != nil {
			t.Fatalf("Save with exporter %+v: %v", ex, err)
		}
		if _, err := os.Stat(filepath.Join(cfg.OutputDir, name)); err != nil {
			t.Errorf("take missing after a hostile exporter: %v", err)
		}
	}
}

func TestRemoveTakeDeletesMIDISidecars(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Minute)
	os.WriteFile(MIDIPath(wav), []byte("x"), 0o644)
	os.WriteFile(ManifestPath(wav), []byte("{}"), 0o644)
	RemoveTake(dir, "jam_a.wav")
	for _, p := range []string{wav, MIDIPath(wav), ManifestPath(wav)} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s survived RemoveTake", filepath.Base(p))
		}
	}
}

// The bridge records a pair for every block the delivery path hands over,
// and none for a block it drops, so the pairs stay a true account of the
// ring's contents.
func TestProcessAudioRecordsBridgePairsOnlyForHandedBlocks(t *testing.T) {
	_, c, _ := newSaveFixture(t)
	block := make([]int32, 256*2)
	for i := 0; i < 5; i++ {
		c.processAudio(block)
	}
	if c.Bridge().Len() != 5 {
		t.Fatalf("bridge holds %d pairs after 5 blocks, want 5", c.Bridge().Len())
	}
	// Fill the filled channel so the next hand-off is dropped as an xrun.
	for len(c.filled) < cap(c.filled) {
		c.filled <- block
	}
	before := c.XRuns()
	c.processAudio(block)
	if c.XRuns() != before+1 {
		t.Fatalf("expected an xrun, got %d -> %d", before, c.XRuns())
	}
	if c.Bridge().Len() != 5 {
		t.Errorf("a dropped block recorded a pair: %d", c.Bridge().Len())
	}
	f, ok := c.Bridge().FrameAt(mono.Now())
	if !ok || f < 5*256-1 {
		t.Errorf("FrameAt(now) = %.0f, %v; want about %d", f, ok, 5*256)
	}
}

// fakeSnapper is an exporter that also snaps windows to a fixed frame.
type fakeSnapper struct {
	fakeExporter
	to    uint64
	ok    bool
	asked []uint64 // start frames it was asked about
}

func (f *fakeSnapper) SnapStart(_ *ClockBridge, start, _, _ uint64) (uint64, bool) {
	f.asked = append(f.asked, start)
	return f.to, f.ok
}

// A snapper that points earlier extends the window back to that frame; one
// that points later trims the window's front; one with no opinion changes
// nothing. In every case the exporter sees the window that was written.
func TestSaveSnapsTheWindowToTheDownbeat(t *testing.T) {
	cases := []struct {
		name      string
		to        uint64
		ok        bool
		seconds   float64
		wantStart uint64
	}{
		{"earlier", 1000, true, 0.05, 1000}, // asked from 3600, snapped back to 1000
		{"later", 4000, true, 0.05, 4000},   // asked from 3600, snapped forward
		{"none", 1000, false, 0.05, 3600},   // no opinion
		{"whole ring forward", 500, true, 0, 500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg, cap, saver := newSaveFixture(t)
			cfg.MIDISnapBars = true
			cap.Ring().WriteFrames(make([]int32, 6000*2))
			fs := &fakeSnapper{to: c.to, ok: c.ok}
			saver.SetMIDIExporter(fs)
			name, err := saver.Save(c.seconds)
			if err != nil {
				t.Fatalf("Save: %v", err)
			}
			req := fs.got[0]
			if req.StartFrame != c.wantStart || req.StartFrame+uint64(req.Frames) != 6000 {
				t.Errorf("window = [%d, %d), want [%d, 6000)", req.StartFrame, req.StartFrame+uint64(req.Frames), c.wantStart)
			}
			wi, err := ReadWAVInfo(filepath.Join(cfg.OutputDir, name))
			if err != nil {
				t.Fatal(err)
			}
			if got := uint64(wi.Frames()); got != 6000-c.wantStart {
				t.Errorf("wav holds %d frames, want %d", got, 6000-c.wantStart)
			}
		})
	}
}

func TestSaveDoesNotSnapWhenDisabled(t *testing.T) {
	cfg, cap, saver := newSaveFixture(t)
	cfg.MIDISnapBars = false
	cap.Ring().WriteFrames(make([]int32, 6000*2))
	fs := &fakeSnapper{to: 1000, ok: true}
	saver.SetMIDIExporter(fs)
	if _, err := saver.Save(0.05); err != nil {
		t.Fatal(err)
	}
	if len(fs.asked) != 0 || fs.got[0].StartFrame != 3600 {
		t.Errorf("snapper consulted with MIDI_SNAP_BARS=false: asked=%v start=%d", fs.asked, fs.got[0].StartFrame)
	}
}
