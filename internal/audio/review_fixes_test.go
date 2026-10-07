package audio

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEnsureFlagIDsNeverHandsOutTheSameIDTwice(t *testing.T) {
	// A legacy flag that moved keeps "f100"; a new id-less flag lands on 100.
	got := EnsureFlagIDs(NormalizeFlags([]Flag{{ID: "f100", Frame: 200}, {Frame: 100}, {Frame: 100}}))
	ids := map[string]bool{}
	for _, f := range got {
		if ids[f.ID] {
			t.Fatalf("duplicate id %q in %+v", f.ID, got)
		}
		ids[f.ID] = true
	}
	// The two id-less flags at one frame are still one flag, as before ids.
	if len(got) != 2 || !ids["f100"] || !ids["f100_2"] {
		t.Errorf("got %+v, want f100 (moved) and f100_2", got)
	}
	// And the answer is the same on every read.
	again := EnsureFlagIDs(NormalizeFlags([]Flag{{ID: "f100", Frame: 200}, {Frame: 100}}))
	if again[0].ID != got[0].ID || again[1].ID != got[1].ID {
		t.Errorf("ids differ between reads: %+v vs %+v", again, got)
	}
}

func TestValidFlagID(t *testing.T) {
	for id, want := range map[string]bool{
		"r0123abcd": true, "f0": true, "f48000": true, "f48000_2": true,
		"": false, "r0123ABCD": false, "r0123abc": false, "f": false, "f-1": false,
		"f10_1": false, "f10_": false, "x123": false, "f1/2": false,
		"f" + strings.Repeat("9", 30): false,
	} {
		if got := ValidFlagID(id); got != want {
			t.Errorf("ValidFlagID(%q) = %v, want %v", id, got, want)
		}
	}
}

func TestTakesInTheSameSecondNeverShareAName(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local)
	var mu sync.Mutex
	seen := map[string]bool{}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			name, path, err := freeTakeName(dir, at)
			if err != nil {
				t.Error(err)
				return
			}
			if !exists(PartPath(path)) {
				t.Errorf("%s was not reserved", name)
			}
			mu.Lock()
			defer mu.Unlock()
			if seen[name] {
				t.Errorf("%s handed out twice", name)
			}
			seen[name] = true
		}()
	}
	wg.Wait()
	// A finished take holds its name too.
	os.WriteFile(filepath.Join(dir, "jam_2026-10-04_120000_21.wav"), nil, 0o644)
	if name, _, _ := freeTakeName(dir, at); name != "jam_2026-10-04_120000_22.wav" {
		t.Errorf("next name = %s", name)
	}
}

func TestPruneSparesTheTakesItIsTold(t *testing.T) {
	cfg, _, s := newSaveFixture(t)
	cfg.MaxSaves = 2
	for i, name := range []string{"jam_2026-09-01_100000.wav", "jam_2026-09-02_100000.wav", "jam_2026-09-03_100000.wav", "jam_2026-09-04_100000.wav"} {
		if _, err := WriteWAV(filepath.Join(cfg.OutputDir, name), make([]int32, 200), 2, []int{0, 1}, 48000); err != nil {
			t.Fatal(i, err)
		}
	}
	// A cut from the oldest take: the cut is new, the source is the oldest.
	s.Prune("jam_2026-09-01_100000.wav")
	takes, _ := ListTakes(cfg.OutputDir)
	var names []string
	for _, tk := range takes {
		names = append(names, tk.Name)
	}
	if got := strings.Join(names, " "); got != "jam_2026-09-04_100000.wav jam_2026-09-03_100000.wav jam_2026-09-01_100000.wav" {
		t.Errorf("after prune: %s", got)
	}
}

func TestTheTakesCacheSeesSameSizeEditsInOneClockTick(t *testing.T) {
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_2026-10-04_120000.wav")
	if _, err := WriteWAV(wav, make([]int32, 200), 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	l := NewTakeList(dir)
	tick := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	set := func(label string) {
		if err := WriteMeta(wav, Meta{Label: label}); err != nil {
			t.Fatal(err)
		}
		os.Chtimes(metaPath(wav), tick, tick) // a coarse clock: same mtime
	}
	set("abc")
	_, etag1, _ := l.List()
	set("abd")
	takes, etag2, _ := l.List()
	if takes[0].Label != "abd" || etag1 == etag2 {
		t.Errorf("label = %q, etags %s/%s: the second edit was missed", takes[0].Label, etag1, etag2)
	}
}

func TestSharesFallBackToTheSamePairAsSlices(t *testing.T) {
	info := WAVInfo{Channels: 4, SampleRate: 48000, BitsPerSample: 32}
	// SAVE_CHANNELS=7,8 on a take recorded with four channels.
	got := RenderArgs("/t.wav", info, []int{6, 7}, 0, 48000, 0)
	if pick := SlicePick(info, []int{6, 7}); !strings.HasSuffix(got[6], ",pan=stereo|c0=c0|c1=c1") || pick[0] != 0 || pick[1] != 1 {
		t.Errorf("render %q, slice %v: want both on channels 1 and 2", got[6], pick)
	}
}

func TestCutLabelBaseOnlyStripsWhatACutWrote(t *testing.T) {
	for in, want := range map[string]string{
		"riff · 0:01.0–0:05.0":  "riff",
		"riff · 1:02–3:04":      "riff",
		"verse · 1–2":           "verse · 1–2",
		"take · 12:00–":         "take · 12:00–",
		"a · b · 10:00–12:30.5": "a · b",
	} {
		if got := cutLabelBase(in); got != want {
			t.Errorf("cutLabelBase(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStartupSweepClearsCrashLeftovers(t *testing.T) {
	dir := t.TempDir()
	keep := writeTestTake(t, dir, "jam_2026-09-01_100000.wav", 48000)
	WriteMeta(keep, Meta{Label: "kept"})
	files := map[string]bool{ // name -> should survive
		".meta-123.tmp":                     false,
		".pyramid-456.tmp":                  false,
		"jam_2026-08-01_100000.meta.json":   false,
		"jam_2026-08-01_100000.peaks.json":  false,
		"jam_2026-08-01_100000.peaks.bin":   false,
		"jam_2026-08-01_100000.mid":         true, // an export someone may want
		"jam_2026-08-01_100000_preview.mp3": true,
		"notes.txt":                         true,
	}
	for n := range files {
		os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
	}
	SweepPartials(dir)
	for n, survive := range files {
		if exists(filepath.Join(dir, n)) != survive {
			t.Errorf("%s: survived = %v, want %v", n, !survive, survive)
		}
	}
	if ReadMeta(keep).Label != "kept" {
		t.Error("a live take's sidecar was swept")
	}
}

func TestBackfillSkips16BitTakesQuietly(t *testing.T) {
	dir := t.TempDir()
	src := writeTestTake(t, dir, "jam_2026-09-01_100000.wav", 48000)
	var b bytes.Buffer
	info, _ := ReadWAVInfo(src)
	if err := WriteSlice16(&b, src, 0, info.Frames(), nil); err != nil {
		t.Fatal(err)
	}
	os.Remove(src)
	p16 := filepath.Join(dir, "phone.wav")
	os.WriteFile(p16, b.Bytes(), 0o644)
	BackfillPyramids(dir)
	if exists(pyramidPath(p16)) {
		t.Error("a pyramid was made for a 16-bit take")
	}
}
