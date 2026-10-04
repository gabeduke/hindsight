package audio

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// pyramidTake writes a noisy stereo take the way the saver does -- WAV and
// pyramid from the same pass -- and returns its path and samples. The length
// is deliberately not a multiple of the pyramid's base, so the last base
// bucket is partial.
func pyramidTake(t *testing.T, dir string, frames int) (string, []int32) {
	t.Helper()
	p := filepath.Join(dir, "jam_2026-10-04_120000.wav")
	data := make([]int32, frames*2)
	x := uint32(987654321)
	for i := range data {
		x = x*1664525 + 1013904223
		// Vary the level across the take so buckets differ.
		data[i] = int32(x) >> uint((i/2/5000)%8)
	}
	_, pyr, err := writeWAV(p, data, 2, []int{0, 1}, 48000)
	if err != nil {
		t.Fatal(err)
	}
	if err := pyr.write(p, 48000); err != nil {
		t.Fatal(err)
	}
	return p, data
}

// quantised is what the pyramid should say for frames [s, e) of channel c:
// min rounded down and max rounded up to int16, over the whole base buckets
// the span touches.
func quantised(data []int32, frames int, c int, s, e int64) (float32, float32) {
	lo := s / PyramidBase * PyramidBase
	hi := (e + PyramidBase - 1) / PyramidBase * PyramidBase
	if hi > int64(frames) {
		hi = int64(frames)
	}
	mn, mx := int64(math.MaxInt16), int64(math.MinInt16)
	for f := lo; f < hi; f++ {
		v := int64(data[f*2+int64(c)])
		q := v >> 16
		if q < mn {
			mn = q
		}
		u := (v + 0xFFFF) >> 16
		if u > math.MaxInt16 {
			u = math.MaxInt16
		}
		if u > mx {
			mx = u
		}
	}
	return float32(mn) / 32768, float32(mx) / 32768
}

func TestPyramidAnswersAlignedRangesLikeTheWAV(t *testing.T) {
	dir := t.TempDir()
	frames := PyramidBase*1200 + 77
	p, _ := pyramidTake(t, dir, frames)

	from, to, buckets := int64(PyramidBase*10), int64(PyramidBase*1010), 100 // 8 base buckets each
	fromPyr, err := RangePeaks(p, from, to, buckets)
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(pyramidPath(p))
	fromWAV, err := RangePeaks(p, from, to, buckets)
	if err != nil {
		t.Fatal(err)
	}
	const q = 1.0 / 32768
	for c := 0; c < 2; c++ {
		for i := 0; i < buckets; i++ {
			pm, px := fromPyr.Data[c][2*i], fromPyr.Data[c][2*i+1]
			wm, wx := fromWAV.Data[c][2*i], fromWAV.Data[c][2*i+1]
			// Never less than the audio reached, and no more than one int16
			// step beyond it -- except that a max within a step of full scale
			// is clamped to the largest int16.
			top := float32(math.MaxInt16) / 32768
			maxOK := (px >= wx && px-wx < q) || (px == top && wx > top)
			if pm > wm || wm-pm >= q || !maxOK {
				t.Fatalf("ch %d bucket %d: pyramid [%v, %v], wav [%v, %v]", c, i, pm, px, wm, wx)
			}
		}
	}
	if fromPyr.From != from || fromPyr.Buckets != buckets || fromPyr.Channels != 2 || fromPyr.SampleRate != 48000 {
		t.Errorf("header = %+v", fromPyr)
	}
	if want := float64(to-from) / 48000; math.Abs(fromPyr.Duration-want) > 1e-9 {
		t.Errorf("duration = %v, want %v", fromPyr.Duration, want)
	}
}

func TestPyramidAnswersUnalignedRangesWithinABaseBucket(t *testing.T) {
	dir := t.TempDir()
	frames := PyramidBase*1200 + 77
	p, data := pyramidTake(t, dir, frames)

	// Unaligned at both ends, a remainder in the last bucket, and the range
	// running to the take's partial last base bucket.
	from, to, buckets := int64(1001), int64(frames), 97
	got, err := RangePeaks(p, from, to, buckets)
	if err != nil {
		t.Fatal(err)
	}
	per := (to - from) / int64(buckets)
	for c := 0; c < 2; c++ {
		for i := 0; i < buckets; i++ {
			s := from + int64(i)*per
			e := s + per
			if i == buckets-1 {
				e = to
			}
			wm, wx := quantised(data, frames, c, s, e)
			if got.Data[c][2*i] != wm || got.Data[c][2*i+1] != wx {
				t.Fatalf("ch %d bucket %d = [%v, %v], want [%v, %v]",
					c, i, got.Data[c][2*i], got.Data[c][2*i+1], wm, wx)
			}
		}
	}
}

func TestDeepZoomsStillReadTheWAV(t *testing.T) {
	dir := t.TempDir()
	p, data := pyramidTake(t, dir, PyramidBase*100)
	// 100 frames per bucket: below the pyramid's resolution.
	got, err := RangePeaks(p, 0, 10000, 100)
	if err != nil {
		t.Fatal(err)
	}
	mn := float32(math.Inf(1))
	for f := 0; f < 100; f++ {
		if v := float32(float64(data[f*2]) / 2147483648.0); v < mn {
			mn = v
		}
	}
	if got.Data[0][0] != mn {
		t.Errorf("bucket 0 min = %v, want the exact %v", got.Data[0][0], mn)
	}
}

func TestAStalePyramidIsIgnored(t *testing.T) {
	dir := t.TempDir()
	p, _ := pyramidTake(t, dir, PyramidBase*400)
	stale, err := os.ReadFile(pyramidPath(p))
	if err != nil {
		t.Fatal(err)
	}
	// The take is replaced by a shorter one; its old pyramid is put back.
	p2, _ := pyramidTake(t, dir, PyramidBase*300)
	if p2 != p {
		t.Fatal("expected the same path")
	}
	os.WriteFile(pyramidPath(p), stale, 0o644)

	got, err := RangePeaks(p, 0, PyramidBase*300, 30)
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(pyramidPath(p))
	want, err := RangePeaks(p, 0, PyramidBase*300, 30)
	if err != nil {
		t.Fatal(err)
	}
	for c := range want.Data {
		for i := range want.Data[c] {
			if got.Data[c][i] != want.Data[c][i] {
				t.Fatalf("a mismatched pyramid was used: ch %d [%d] = %v, want %v", c, i, got.Data[c][i], want.Data[c][i])
			}
		}
	}

	// A truncated or garbage file is no pyramid either.
	os.WriteFile(pyramidPath(p), []byte("HPKB"), 0o644)
	if _, err := RangePeaks(p, 0, PyramidBase*300, 30); err != nil {
		t.Errorf("garbage pyramid: %v", err)
	}
}

func TestRangesPastTheEndStillFailWithAPyramid(t *testing.T) {
	dir := t.TempDir()
	p, _ := pyramidTake(t, dir, PyramidBase*100)
	if _, err := RangePeaks(p, 0, PyramidBase*200, 10); err == nil {
		t.Error("a range past the end was answered")
	}
}

func TestBuildPyramidMatchesTheOneWrittenAtSave(t *testing.T) {
	dir := t.TempDir()
	p, _ := pyramidTake(t, dir, PyramidBase*500+3)
	atSave, err := os.ReadFile(pyramidPath(p))
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(pyramidPath(p))
	if err := BuildPyramid(p); err != nil {
		t.Fatal(err)
	}
	built, err := os.ReadFile(pyramidPath(p))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(atSave, built) {
		t.Error("a backfilled pyramid differs from the one written at save")
	}
	// 2 channels × 2 int16 per base bucket, plus the header.
	buckets := (PyramidBase*500 + 3 + PyramidBase - 1) / PyramidBase
	if want := pyramidHeaderBytes + buckets*2*2*2; len(built) != want {
		t.Errorf("size = %d, want %d", len(built), want)
	}
	if fi, _ := os.Stat(pyramidPath(p)); fi.Mode().Perm() != 0o644 {
		t.Errorf("mode = %v, want 0644 like the other sidecars", fi.Mode().Perm())
	}
}

func TestPyramidClampsFullScale(t *testing.T) {
	acc := newPyramidAcc(1, 2)
	acc.add(0, 0, math.MaxInt32)
	acc.add(0, 1, math.MinInt32)
	if acc.data[0] != math.MinInt16 || acc.data[1] != math.MaxInt16 {
		t.Errorf("full scale = [%d, %d]", acc.data[0], acc.data[1])
	}
}

func TestCutsGetAPyramidAndRemoveTakeDeletesIt(t *testing.T) {
	dir := t.TempDir()
	writeTestTake(t, dir, "jam_2026-09-10_221441.wav", 48000)
	name, err := Cut(dir, CutRequest{Source: "jam_2026-09-10_221441.wav", StartFrame: 1000, EndFrame: 40000},
		time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}
	cut := filepath.Join(dir, name)
	info, err := ReadWAVInfo(cut)
	if err != nil {
		t.Fatal(err)
	}
	f, h, err := openPyramid(cut, info)
	if err != nil {
		t.Fatalf("the cut has no usable pyramid: %v", err)
	}
	f.Close()
	if h.frames != 39000 {
		t.Errorf("pyramid frames = %d, want 39000", h.frames)
	}
	// And it agrees with the cut's audio, fades included.
	if err := BuildPyramid(cut); err != nil { // a no-op: it already has one
		t.Fatal(err)
	}
	inLoop, _ := os.ReadFile(pyramidPath(cut))
	os.Remove(pyramidPath(cut))
	if err := BuildPyramid(cut); err != nil {
		t.Fatal(err)
	}
	rebuilt, _ := os.ReadFile(pyramidPath(cut))
	if !bytes.Equal(inLoop, rebuilt) {
		t.Error("the cut's pyramid differs from one built from its audio")
	}

	RemoveTake(dir, name)
	if exists(pyramidPath(cut)) {
		t.Error("RemoveTake left the pyramid behind")
	}
}

func TestBackfillBuildsMissingPyramidsAndSweepRemovesOrphans(t *testing.T) {
	dir := t.TempDir()
	old := writeTestTake(t, dir, "jam_2026-09-01_100000.wav", 48000) // WriteWAV: no pyramid
	if exists(pyramidPath(old)) {
		t.Fatal("WriteWAV wrote a pyramid")
	}
	orphan := filepath.Join(dir, "jam_2026-08-01_100000.peaks.bin")
	os.WriteFile(orphan, []byte("x"), 0o644)
	part := filepath.Join(dir, ".jam_2026-09-02_100000.wav.part")
	os.WriteFile(part, []byte("x"), 0o644)

	SweepPartials(dir)
	if exists(orphan) {
		t.Error("an orphan pyramid survived the startup sweep")
	}

	BackfillPyramids(dir)
	if !exists(pyramidPath(old)) {
		t.Error("the old take got no pyramid")
	}
	if exists(filepath.Join(dir, ".jam_2026-09-02_100000.peaks.bin")) {
		t.Error("a hidden file was treated as a take")
	}
	// Running again changes nothing.
	before, _ := os.Stat(pyramidPath(old))
	BackfillPyramids(dir)
	after, _ := os.Stat(pyramidPath(old))
	if !before.ModTime().Equal(after.ModTime()) {
		t.Error("an existing pyramid was rebuilt")
	}
}
