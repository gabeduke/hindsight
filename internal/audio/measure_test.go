package audio

import (
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

// beatTake writes a stereo 32-bit take of seconds at bpm: a decaying noise
// burst on every beat over a quiet floor. bpm 0 writes the floor alone.
func beatTake(t *testing.T, dir, name string, bpm, seconds float64) string {
	t.Helper()
	r := rand.New(rand.NewSource(1))
	n := int(seconds * 48000)
	data := make([]int32, 2*n)
	beat := 0.0
	if bpm > 0 {
		beat = 60 / bpm * 48000
	}
	for i := 0; i < n; i++ {
		v := 0.003 * (r.Float64()*2 - 1)
		if beat > 0 {
			k := math.Floor(float64(i) / beat)
			since := float64(i) - k*beat
			v += 0.5 * math.Exp(-since/960) * (r.Float64()*2 - 1)
		}
		x := int32(v * 2147483647)
		data[2*i], data[2*i+1] = x, x
	}
	p := filepath.Join(dir, name)
	if _, err := WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMeasureTempoKeepsTheMeasuredTempo(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_a.wav", 125.25, 30)
	clock := 125.32
	if err := WriteMeta(wav, Meta{BPM: &clock, TempoFrom: TempoFromClock, Label: "keep"}); err != nil {
		t.Fatal(err)
	}
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || math.Abs(*m.BPM-125.25) > 0.02 || m.TempoFrom != TempoFromAudio {
		t.Fatalf("BPM %v from %q, want 125.25 from audio", m.BPM, m.TempoFrom)
	}
	if *m.BPM != math.Round(*m.BPM*100)/100 {
		t.Errorf("BPM %v isn't two decimals", *m.BPM)
	}
	if m.Label != "keep" {
		t.Errorf("the label went: %+v", m)
	}
}

func TestMeasureTempoMeasuresATakeWithNoClock(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_phone.wav", 96, 20)
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || math.Abs(*m.BPM-96) > 0.02 || m.TempoFrom != TempoFromAudio {
		t.Fatalf("BPM %v from %q, want 96 from audio", m.BPM, m.TempoFrom)
	}
}

func TestMeasureTempoLeavesABeatlessTakeAlone(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_pad.wav", 0, 20)
	clock := 120.0
	if err := WriteMeta(wav, Meta{BPM: &clock, TempoFrom: TempoFromClock}); err != nil {
		t.Fatal(err)
	}
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || *m.BPM != 120 || m.TempoFrom != TempoFromClock {
		t.Fatalf("BPM %v from %q, want the clock's 120 kept", m.BPM, m.TempoFrom)
	}
}

// An edit between the save's stamp and the measurement wins.
func TestKeepMeasuredLosesToAnEdit(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_a.wav", 125.25, 10)
	stamped, edited := 125.32, 124.0
	if err := WriteMeta(wav, Meta{BPM: &edited, TempoFrom: TempoFromYou}); err != nil {
		t.Fatal(err)
	}
	keepMeasured(wav, tempoState{&stamped, TempoFromClock}, 125.25)
	m := ReadMeta(wav)
	if *m.BPM != 124 || m.TempoFrom != TempoFromYou {
		t.Fatalf("BPM %v from %q, want the edit kept", *m.BPM, m.TempoFrom)
	}
}

// Typing the tempo the clock gave still says it's yours, so the measurement
// backs off even though the BPM didn't change.
func TestKeepMeasuredLosesToTheSameTempoRetyped(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_a.wav", 125.25, 10)
	bpm := 125.32
	if err := WriteMeta(wav, Meta{BPM: &bpm, TempoFrom: TempoFromYou}); err != nil {
		t.Fatal(err)
	}
	keepMeasured(wav, tempoState{&bpm, TempoFromClock}, 125.25)
	m := ReadMeta(wav)
	if *m.BPM != 125.32 || m.TempoFrom != TempoFromYou {
		t.Fatalf("BPM %v from %q, want the retyped 125.32 from you kept", *m.BPM, m.TempoFrom)
	}
}

func TestMeasureTempoSurvivesAMissingFile(t *testing.T) {
	MeasureTempo(filepath.Join(t.TempDir(), "jam_gone.wav")) // no panic, no sidecar
}

func TestStampTempoSaysItCameFromTheClock(t *testing.T) {
	wav := writeFakeTake(t, t.TempDir(), "jam_a.wav", 0)
	stampTempo(wav, &fakeTempo{bpm: 100, ok: true}, time.Now(), 30e9)
	if m := ReadMeta(wav); m.TempoFrom != TempoFromClock {
		t.Errorf("tempo_from = %q, want clock", m.TempoFrom)
	}
}

func TestASaveMeasuresItsTakeInTheBackground(t *testing.T) {
	var got []string
	measureTempo = func(wav string) { got = append(got, filepath.Base(wav)) }
	t.Cleanup(func() { measureTempo = MeasureTempo })
	dir := t.TempDir()
	cap := NewCapture(testSaveConfig(dir), nil)
	cap.Ring().WriteFrames(make([]int32, 1000*2))
	saver := NewSaver(cap)
	t.Cleanup(saver.WaitBackground)
	name, err := saver.Save(0)
	if err != nil {
		t.Fatal(err)
	}
	saver.WaitBackground()
	if len(got) != 1 || got[0] != name {
		t.Fatalf("measured %v, want [%s]", got, name)
	}
}

// The 2026-10-04 stylophone take, by hand: too big for the repo.
//
//	HINDSIGHT_TEMPO_WAV=/path/copy_2026-10-04_095937.wav go test ./internal/audio -run RealTake -v
func TestMeasureARealTake(t *testing.T) {
	path := os.Getenv("HINDSIGHT_TEMPO_WAV")
	if path == "" {
		t.Skip("set HINDSIGHT_TEMPO_WAV to a take")
	}
	x, sr, err := readMiddle(path, measureWindowSeconds)
	if err != nil {
		t.Fatal(err)
	}
	bpm, ok := measure(x, sr, 125.32)
	t.Logf("%s: %.3f BPM (ok %v)", filepath.Base(path), bpm, ok)
	if !ok || bpm < 125.1 || bpm > 125.4 {
		t.Errorf("want 125.1–125.4")
	}
}

// testSaveConfig is the smallest config a save works with, into dir.
func testSaveConfig(dir string) *config.Config {
	return &config.Config{Channels: 2, SampleRate: 48000, RingSeconds: 10, SaveChannels: []int{0, 1}, OutputDir: dir}
}
