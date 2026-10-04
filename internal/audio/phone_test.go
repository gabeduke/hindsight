package audio

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

// tone is n stereo frames of a sine at freq Hz and rate, left and right at
// different levels so a swapped channel shows.
func tone(n, rate int, freq float64, from int) []float32 {
	out := make([]float32, 2*n)
	for i := 0; i < n; i++ {
		v := math.Sin(2 * math.Pi * freq * float64(from+i) / float64(rate))
		out[2*i] = float32(0.5 * v)
		out[2*i+1] = float32(-0.25 * v)
	}
	return out
}

// readTake returns a 32-bit stereo take's samples.
func readTake(t *testing.T, path string) (WAVInfo, []int32) {
	t.Helper()
	info, err := ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	var all []int32
	if _, err := ReadFrames(path, 0, info.Frames(), 1<<14, func(b []int32, _ int64) error {
		all = append(all, b...)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return info, all
}

func TestPhoneTakeWritesChunksInOrderWhateverOrderTheyArrive(t *testing.T) {
	dir := t.TempDir()
	started := time.Date(2026, 10, 4, 1, 2, 3, 0, time.Local)
	pt, err := StartPhoneTake(dir, 48000, started, 0)
	if err != nil {
		t.Fatal(err)
	}
	const chunk = 4800
	var want []float32
	chunks := make([][]float32, 10)
	for i := range chunks {
		chunks[i] = tone(chunk, 48000, 440, i*chunk)
		want = append(want, chunks[i]...)
	}
	// 0, 1, then 3 and 4 early, 2 fills the gap, 2 again (a resend), the rest.
	for _, i := range []int{0, 1, 3, 4, 2, 2, 5, 6, 7, 8, 9} {
		next, err := pt.Write(uint32(i), chunks[i])
		if err != nil {
			t.Fatal(err)
		}
		if i == 3 || i == 4 {
			if next != 2 {
				t.Errorf("after early chunk %d, next = %d, want 2", i, next)
			}
		}
	}
	if pt.Next() != 10 {
		t.Fatalf("next = %d, want 10", pt.Next())
	}
	// Nothing is listed while recording.
	if takes, _ := ListTakes(dir); len(takes) != 0 {
		t.Errorf("listed while recording: %+v", takes)
	}
	name, partial, err := pt.Finish(false)
	if err != nil || partial {
		t.Fatal(err, partial)
	}
	info, got := readTake(t, filepath.Join(dir, name))
	if info.Channels != 2 || info.SampleRate != 48000 || info.BitsPerSample != 32 {
		t.Fatalf("format = %+v", info)
	}
	if len(got) != len(want) {
		t.Fatalf("%d samples, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != floatToPCM32(want[i]) {
			t.Fatalf("sample %d = %d, want %d", i, got[i], floatToPCM32(want[i]))
		}
	}
	m := ReadMeta(filepath.Join(dir, name))
	if m.Label != "Phone" || m.Created == nil || !m.Created.Equal(started) {
		t.Errorf("meta = %+v", m)
	}
	for _, p := range []string{peaksPath(filepath.Join(dir, name)), pyramidPath(filepath.Join(dir, name))} {
		if !exists(p) {
			t.Errorf("missing %s", filepath.Base(p))
		}
	}
	if exists(PartPath(filepath.Join(dir, name))) || exists(phoneMarkerPath(filepath.Join(dir, name))) {
		t.Error("left the .part or the marker behind")
	}
	// The pyramid built while streaming matches one built from the file.
	inLoop, _ := os.ReadFile(pyramidPath(filepath.Join(dir, name)))
	os.Remove(pyramidPath(filepath.Join(dir, name)))
	if err := BuildPyramid(filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	rebuilt, _ := os.ReadFile(pyramidPath(filepath.Join(dir, name)))
	if string(inLoop) != string(rebuilt) {
		t.Error("the streamed pyramid differs from one built from the audio")
	}
	takes, _ := ListTakes(dir)
	if len(takes) != 1 || !takes[0].HasPeaks || takes[0].Duration != 1 {
		t.Errorf("listed = %+v", takes)
	}
}

func TestPhoneTakeResamples44100To48000(t *testing.T) {
	dir := t.TempDir()
	pt, err := StartPhoneTake(dir, 44100, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	// One second, in chunks of 4410.
	for i := 0; i < 10; i++ {
		if _, err := pt.Write(uint32(i), tone(4410, 44100, 1000, i*4410)); err != nil {
			t.Fatal(err)
		}
	}
	name, _, err := pt.Finish(false)
	if err != nil {
		t.Fatal(err)
	}
	info, got := readTake(t, filepath.Join(dir, name))
	if info.Frames() != 48000 {
		t.Fatalf("frames = %d, want 48000", info.Frames())
	}
	// Away from the edges, the take is the same 1 kHz tone sampled at 48 kHz.
	worst := 0.0
	for i := 200; i < 47800; i++ {
		want := 0.5 * math.Sin(2*math.Pi*1000*float64(i)/48000)
		if d := math.Abs(float64(got[2*i])/2147483648 - want); d > worst {
			worst = d
		}
	}
	if worst > 1e-3 {
		t.Errorf("worst error %.2g against the ideal tone, want under 1e-3 (-60 dB)", worst)
	}
}

func TestPhoneTakeWithNoAudioLeavesNothing(t *testing.T) {
	dir := t.TempDir()
	pt, err := StartPhoneTake(dir, 48000, time.Now(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if name, _, err := pt.Finish(true); err != nil || name != "" {
		t.Errorf("Finish = %q, %v; want nothing", name, err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("left %d file(s) behind", len(entries))
	}
}

func TestPhoneTakeMarksAPartialOne(t *testing.T) {
	dir := t.TempDir()
	pt, _ := StartPhoneTake(dir, 48000, time.Now(), 0)
	pt.Write(0, tone(4800, 48000, 440, 0))
	pt.Write(2, tone(4800, 48000, 440, 9600)) // chunk 1 never comes
	name, partial, err := pt.Finish(false)
	if err != nil || !partial {
		t.Fatal(err, partial)
	}
	if m := ReadMeta(filepath.Join(dir, name)); m.Label != "Phone (partial)" {
		t.Errorf("label = %q: a recording with a gap is partial", m.Label)
	}
	if _, err := pt.Write(3, tone(4800, 48000, 440, 0)); err != ErrPhoneFinished {
		t.Errorf("write after finish: %v", err)
	}
}

func TestARestartMidRecordingKeepsWhatReachedTheDisk(t *testing.T) {
	dir := t.TempDir()
	started := time.Date(2026, 10, 4, 1, 0, 0, 0, time.Local)
	pt, _ := StartPhoneTake(dir, 48000, started, 0)
	data := tone(48000, 48000, 440, 0)
	pt.Write(0, data)
	pt.bw.Flush() // what the OS had when the Pi went down
	// The process dies here: no Finish.

	SweepPartials(dir)
	takes, err := ListTakes(dir)
	if err != nil || len(takes) != 1 {
		t.Fatalf("takes = %+v, %v", takes, err)
	}
	tk := takes[0]
	if tk.Label != "Phone (partial)" || tk.Duration != 1 || !tk.HasPeaks || !tk.Created.Equal(started) {
		t.Errorf("recovered take = %+v", tk)
	}
	_, got := readTake(t, filepath.Join(dir, tk.Name))
	for i := range data {
		if got[i] != floatToPCM32(data[i]) {
			t.Fatalf("sample %d differs", i)
		}
	}
	if exists(phoneMarkerPath(filepath.Join(dir, tk.Name))) {
		t.Error("marker left behind")
	}
}

func TestPhoneTakeRefusesOddChunksAndRates(t *testing.T) {
	if _, err := StartPhoneTake(t.TempDir(), 1000, time.Now(), 0); err == nil {
		t.Error("a 1 kHz rate was accepted")
	}
	pt, _ := StartPhoneTake(t.TempDir(), 48000, time.Now(), 0)
	defer pt.Abort()
	if _, err := pt.Write(0, make([]float32, 3)); err == nil {
		t.Error("half a stereo frame was accepted")
	}
}

func TestFloatToPCM32Clips(t *testing.T) {
	if got := floatToPCM32(float32(math.NaN())); got != 0 {
		t.Errorf("NaN = %d, want silence", got)
	}
	for in, want := range map[float32]int32{0: 0, 1: math.MaxInt32, -1: math.MinInt32, 2: math.MaxInt32, -3: math.MinInt32, 0.5: 1 << 30} {
		if got := floatToPCM32(in); got != want {
			t.Errorf("floatToPCM32(%v) = %d, want %d", in, got, want)
		}
	}
}

func TestPhoneTakeContinuingALostRecordingStartsWhereThePhoneIs(t *testing.T) {
	dir := t.TempDir()
	pt, err := StartPhoneTake(dir, 48000, time.Now(), 5)
	if err != nil {
		t.Fatal(err)
	}
	if pt.Next() != 5 {
		t.Fatalf("next = %d, want 5", pt.Next())
	}
	for seq := 5; seq < 8; seq++ {
		if next, err := pt.Write(uint32(seq), tone(4800, 48000, 440, seq*4800)); err != nil || next != uint32(seq+1) {
			t.Fatalf("write %d: next %d, %v", seq, next, err)
		}
	}
	name, partial, err := pt.Finish(false)
	if err != nil || !partial {
		t.Fatalf("finish = %q %v %v; a continued recording is partial", name, partial, err)
	}
	if info, _ := ReadWAVInfo(filepath.Join(dir, name)); info.Frames() != 3*4800 {
		t.Errorf("frames = %d", info.Frames())
	}
}

func TestAFailedWriteKeepsWhatReachedTheDisk(t *testing.T) {
	dir := t.TempDir()
	pt, _ := StartPhoneTake(dir, 48000, time.Now(), 0)
	for seq := 0; seq < 20; seq++ {
		pt.Write(uint32(seq), tone(4800, 48000, 440, seq*4800))
	}
	pt.mu.Lock()
	pt.bw.Flush()
	pt.f.Close() // the next write fails, as on a dead disk
	pt.mu.Unlock()
	for seq := 20; seq < 40; seq++ {
		pt.Write(uint32(seq), tone(4800, 48000, 440, seq*4800))
	}
	name, partial, err := pt.Finish(false)
	if err != nil || name == "" || !partial {
		t.Fatalf("finish = %q %v %v; want the audio that reached the disk, as partial", name, partial, err)
	}
	info, err := ReadWAVInfo(filepath.Join(dir, name))
	if err != nil || info.Frames() < 20*4800 {
		t.Errorf("frames = %d, %v; want at least the 20 chunks written before the failure", info.Frames(), err)
	}
	if m := ReadMeta(filepath.Join(dir, name)); m.Label != "Phone (partial)" {
		t.Errorf("label = %q", m.Label)
	}
}

func TestEarlyChunksAreBoundedInBytes(t *testing.T) {
	pt, _ := StartPhoneTake(t.TempDir(), 48000, time.Now(), 0)
	defer pt.Abort()
	big := make([]float32, 2*48000) // a second: 384 KB
	var err error
	for seq := uint32(1); seq < 100 && err == nil; seq++ {
		_, err = pt.Write(seq, big)
	}
	if err == nil {
		t.Fatal("unbounded chunks were held waiting for chunk 0")
	}
	if pt.earlyBytes > phoneMaxEarlyBytes {
		t.Errorf("held %d bytes, cap is %d", pt.earlyBytes, phoneMaxEarlyBytes)
	}
}

func TestStartupRecoversAPhonePartEvenWithABrokenMarker(t *testing.T) {
	dir := t.TempDir()
	pt, _ := StartPhoneTake(dir, 48000, time.Now(), 0)
	pt.Write(0, tone(4800, 48000, 440, 0))
	pt.bw.Flush()
	wav := filepath.Join(dir, pt.Name())
	os.WriteFile(phoneMarkerPath(wav), []byte("{not json"), 0o644)

	// An orphan marker, with no .part, is swept.
	orphan := filepath.Join(dir, "jam_2026-10-04_020000.wav")
	os.WriteFile(phoneMarkerPath(orphan), []byte(`{}`), 0o644)

	SweepPartials(dir)
	if !exists(wav) || exists(PartPath(wav)) {
		t.Fatal("the recording was not recovered")
	}
	if m := ReadMeta(wav); m.Label != "Phone (partial)" || m.Created == nil {
		t.Errorf("meta = %+v", m)
	}
	if exists(phoneMarkerPath(orphan)) {
		t.Error("an orphan marker survived")
	}
}

func TestStartupEncodesMissingPreviews(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
	dir := t.TempDir()
	old := writeTestTake(t, dir, "jam_2026-09-01_100000.wav", 48000)
	BackfillPreviews(&config.Config{OutputDir: dir, SaveChannels: []int{0, 1}})
	if !exists(previewPath(old)) {
		t.Error("no preview was made for a take without one")
	}
}
