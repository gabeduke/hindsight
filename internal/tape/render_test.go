package tape

import (
	"math"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// poolWAV writes a stereo pool file whose left channel at frame i is
// val(i) and right is -val(i), and returns its relative name.
func poolWAV(t *testing.T, s *Store, frames int, val func(i int) float64) string {
	t.Helper()
	rel, path, err := s.NewPoolFile("test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	data := make([]int32, frames*2)
	for i := 0; i < frames; i++ {
		v := int32(val(i) * 2147483647)
		data[2*i], data[2*i+1] = v, -v
	}
	if _, err := audio.WriteWAV(path, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	return rel
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func approx(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-4 }

func TestTheRendererPlacesClipsToTheSampleOnTheirBus(t *testing.T) {
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, 2000, func(int) float64 { return 0.5 })
	st := State{Tracks: []Track{
		{N: 1, Bus: BusA, Clips: []Clip{{ID: "a", File: rel, Src: 100, Frames: 1000, At: 300}}},
		{N: 2, Bus: BusB, GainDB: -6.0206, Clips: []Clip{{ID: "b", File: rel, Src: 0, Frames: 500, At: 0}}},
	}}
	m := NewMix(st, pool, 48000)
	dst := make([]float32, 2000*OutChannels)
	m.Render(dst, 0, 2000)
	frame := func(f int) []float32 { return dst[f*OutChannels : f*OutChannels+4] }
	if fr := frame(299); fr[0] != 0 || fr[1] != 0 {
		t.Fatalf("before the clip: %v", fr)
	}
	// Past the 3 ms declick (144 frames) the clip plays at full level.
	if fr := frame(300 + 500); !approx(fr[0], 0.5) || !approx(fr[1], -0.5) || fr[2] != 0 {
		t.Fatalf("inside the clip, bus A: %v", fr)
	}
	// Its first frame is faded in from (almost) nothing, its last out.
	if fr := frame(300); fr[0] <= 0 || fr[0] > 0.01 {
		t.Fatalf("first frame should be declicked: %v", fr)
	}
	if fr := frame(1299); fr[0] <= 0 || fr[0] > 0.01 {
		t.Fatalf("last frame should be declicked: %v", fr)
	}
	if fr := frame(1300); fr[0] != 0 {
		t.Fatalf("after the clip: %v", fr)
	}
	// Track 2 on bus B, at half gain.
	if fr := frame(250); fr[0] != 0 || !approx(fr[2], 0.25) || !approx(fr[3], -0.25) {
		t.Fatalf("bus B: %v", fr)
	}
}

func TestAudioMeetingAudioCrossfadesAndSilenceDeclicks(t *testing.T) {
	s := newTestStore(t)
	pool := NewPool(s)
	// A ramp, so where each sample came from is visible.
	rel := poolWAV(t, s, 48000, func(i int) float64 { return float64(i) / 48000 })
	// Two clips end to end: the second starts where the first ends, and
	// the first has overhang to give.
	st := State{Tracks: []Track{{N: 1, Bus: BusA, Clips: []Clip{
		{ID: "a", File: rel, Src: 1000, Frames: 1000, At: 0},
		{ID: "b", File: rel, Src: 20000, Frames: 1000, At: 1000},
	}}}}
	m := NewMix(st, pool, 48000)
	dst := make([]float32, 2000*OutChannels)
	m.Render(dst, 0, 2000)
	// The last frame of a: no declick, because audio follows.
	if v := dst[999*OutChannels]; !approx(v, float32(1999)/48000) {
		t.Fatalf("a's last frame = %v, want its full value", v)
	}
	// The first frame of b is almost all of a's continuation (a's frame
	// 2000), and a little of b.
	x := 0.5 / 240.0
	want := float32(math.Sin(x*math.Pi/2)*20000/48000 + math.Cos(x*math.Pi/2)*2000/48000)
	if v := dst[1000*OutChannels]; !approx(v, want) {
		t.Fatalf("seam = %v, want %v", v, want)
	}
	// After the 5 ms crossfade, only b.
	if v := dst[1300*OutChannels]; !approx(v, float32(20300)/48000) {
		t.Fatalf("after the crossfade = %v", v)
	}
}

func TestALoopWrapsIntoItselfWithACrossfade(t *testing.T) {
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, 4000, func(i int) float64 { return 0.25 })
	st := State{Loop: Loop{In: 0, Out: 2000, On: true}, Tracks: []Track{{N: 1, Bus: BusA, Clips: []Clip{
		{ID: "a", File: rel, Src: 480, Frames: 2000, At: 0},
	}}}}
	m := NewMix(st, pool, 48000)
	dst := make([]float32, 2000*OutChannels)
	m.Render(dst, 0, 2000)
	// Constant audio, so an equal-power crossfade of it with itself is
	// within a few percent of constant, and nothing is declicked to zero.
	for _, f := range []int{0, 1, 100, 239, 1999} {
		if v := dst[f*OutChannels]; v < 0.25 || v > 0.36 {
			t.Fatalf("frame %d = %v: a looped clip must not dip at its seam", f, v)
		}
	}
}

func TestMuteSoloPanAndSaturation(t *testing.T) {
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, 1000, func(int) float64 { return 0.8 })
	mk := func(n int, mute, solo bool, pan float64) Track {
		return Track{N: n, Bus: BusA, Mute: mute, Solo: solo, Pan: pan, Clips: []Clip{{ID: "x", File: rel, Frames: 1000}}}
	}
	render := func(tracks ...Track) []float32 {
		m := NewMix(State{Tracks: tracks}, pool, 48000)
		dst := make([]float32, 1000*OutChannels)
		m.Render(dst, 0, 1000)
		return dst[500*OutChannels : 500*OutChannels+2]
	}
	if fr := render(mk(1, true, false, 0)); fr[0] != 0 {
		t.Fatal("a muted track sounded")
	}
	if fr := render(mk(1, false, false, 0), mk(2, false, true, 0)); !approx(fr[0], 0.8) {
		t.Fatalf("solo: %v, want only the soloed track", fr)
	}
	if fr := render(mk(1, false, false, 0.5)); !approx(fr[0], 0.4) || !approx(fr[1], -0.8) {
		t.Fatalf("pan right: %v", fr)
	}
	// Two at 0.8 sum past full scale and saturate rather than wrap.
	fr := render(mk(1, false, false, 0), mk(2, false, false, 0))
	out := make([]int32, 2)
	ToInt32(out, fr)
	if out[0] != math.MaxInt32 || out[1] != math.MinInt32 {
		t.Fatalf("saturation: %v", out)
	}
}

func TestAMissingFileIsSilentNotFatal(t *testing.T) {
	s := newTestStore(t)
	pool := NewPool(s)
	st := State{Tracks: []Track{{N: 1, Bus: BusA, Clips: []Clip{{ID: "x", File: "audio/gone.wav", Frames: 100}}}}}
	m := NewMix(st, pool, 48000)
	dst := make([]float32, 100*OutChannels)
	m.Render(dst, 0, 100)
	if dst[50*OutChannels] != 0 || len(pool.Failed()) != 1 {
		t.Fatal("a missing file should play silence and be reported")
	}
}
