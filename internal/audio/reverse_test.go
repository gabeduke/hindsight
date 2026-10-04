package audio

import (
	"path/filepath"
	"testing"
)

func TestASpanIsWrittenBackwards(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.wav")
	// 40000 stereo frames, left = i, right = -i: more than two blocks.
	data := make([]int32, 2*40000)
	for i := 0; i < 40000; i++ {
		data[2*i], data[2*i+1] = int32(i), -int32(i)
	}
	if _, err := WriteWAV(src, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "rev.wav")
	if err := ReverseWAVSpan(src, 100, 39000, dst); err != nil {
		t.Fatal(err)
	}
	var got []int32
	if _, err := ReadFrames(dst, 0, 38900, 0, func(b []int32, _ int64) error { got = append(got, b...); return nil }); err != nil {
		t.Fatal(err)
	}
	for _, k := range []int{0, 1, 16383, 16384, 20000, 38899} {
		want := int32(39000 - 1 - k)
		if got[2*k] != want || got[2*k+1] != -want {
			t.Fatalf("frame %d = %d,%d, want %d,%d", k, got[2*k], got[2*k+1], want, -want)
		}
	}
	if err := ReverseWAVSpan(src, 100, 50000, dst); err == nil {
		t.Fatal("a span past the end was written")
	}
}
