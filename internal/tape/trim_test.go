package tape

import (
	"errors"
	"math"
	"testing"
)

// trimLoop is firstLoop with one-second handles: a ramp take's frames
// [100000, 196000) copied and dropped as the first loop, so its pool file is
// the take's [52000, 244000) and the clip starts 48000 into it. The clip is
// then slid to 192000, leaving room before it.
func trimLoop(t *testing.T) (*Engine, *Tape, Clip) {
	t.Helper()
	e, _, tp := newEngine(t)
	e.handleS = 1
	take := takeWAV(t, 400000, func(i int) float64 { return float64(i) / 1e6 })
	if _, err := e.CopyTake(take, "jam_take.wav", 100000, 196000, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	d, err := e.DropClipboard(tp.ID, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	if d.Clip.Src != 48000 || d.Clip.Frames != 96000 {
		t.Fatalf("the copy's clip = %+v: a second of handle before it", d.Clip)
	}
	at := int64(192000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: d.Clip.ID, At: &at}); err != nil {
		t.Fatal(err)
	}
	return e, tp, findClip(t, e, d.Clip.ID)
}

func trim(t *testing.T, e *Engine, id, edge string, at int64) Clip {
	t.Helper()
	res, err := e.EditOp(e.LoadedID(), EditRequest{Op: "trim", Clip: id, Edge: edge, At: &at})
	if err != nil {
		t.Fatalf("trim %s to %d: %v", edge, at, err)
	}
	if res.Clip == nil || res.Clip.ID != id {
		t.Fatalf("trim answered %+v", res)
	}
	if got := findClip(t, e, id); got != *res.Clip {
		t.Fatalf("trim answered %+v, the tape has %+v", *res.Clip, got)
	}
	return *res.Clip
}

func TestPoolFilesCarryHandlesWhereTheSourceHasThem(t *testing.T) {
	e, _, _ := newEngine(t)
	e.handleS = 1
	take := takeWAV(t, 400000, func(i int) float64 { return float64(i) / 1e6 })
	// In the middle: a second either side.
	c, err := e.copyTake(take, 100000, 196000, []int{0, 1}, "send")
	if err != nil {
		t.Fatal(err)
	}
	if n := int64(len(readPool(t, e.store, c.File)) / 2); c.Src != 48000 || n != 96000+2*48000 {
		t.Fatalf("mid-take: src %d, file %d frames", c.Src, n)
	}
	// At the take's start and end: what there is.
	c, _ = e.copyTake(take, 10000, 106000, []int{0, 1}, "send")
	if n := int64(len(readPool(t, e.store, c.File)) / 2); c.Src != 10000 || n != 10000+96000+48000 {
		t.Fatalf("near the start: src %d, file %d frames", c.Src, n)
	}
	c, _ = e.copyTake(take, 300000, 400000, []int{0, 1}, "send")
	if n := int64(len(readPool(t, e.store, c.File)) / 2); c.Src != 48000 || n != 48000+100000 {
		t.Fatalf("to the end: src %d, file %d frames", c.Src, n)
	}
	// With no handle set, only the crossfades' overhang, as before.
	e.handleS = 0
	c, _ = e.copyTake(take, 100000, 196000, []int{0, 1}, "send")
	if c.Src != 480 {
		t.Fatalf("no handle: src %d, want the 480-frame overhang", c.Src)
	}
}

func TestAClipsPeakIsItsOwnNotItsHandles(t *testing.T) {
	e, _, _ := newEngine(t)
	e.handleS = 1
	// Loud for the first and last second, quiet between (and through the
	// overhang, which a clip's peak counts, as a catch's always has).
	take := takeWAV(t, 192000, func(i int) float64 {
		if i < 47000 || i >= 145000 {
			return 0.9
		}
		return 0.001
	})
	c, err := e.copyTake(take, 48000, 144000, []int{0, 1}, "send")
	if err != nil {
		t.Fatal(err)
	}
	if c.PeakDB == nil || *c.PeakDB > -50 {
		t.Fatalf("peak %v dB: the handles' 0.9 counted", *c.PeakDB)
	}
}

func TestACatchKeepsTheHandlesTheRingHas(t *testing.T) {
	e, sink, tp := newEngine(t)
	e.handleS = 1
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 96000*3+2000)
	clip, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Pass: 1})
	if err != nil {
		t.Fatal(err)
	}
	// The pass began at ring frame 192000: a second before it is there, and
	// after it only what the ring had heard when it was caught.
	if clip.Src != 48000 {
		t.Fatalf("catch src = %d, want a second of handle", clip.Src)
	}
	data := readPool(t, e.store, clip.File)
	if data[2*clip.Src] != auxAt(192000) || data[0] != auxAt(192000-48000) {
		t.Fatalf("the catch's file starts at ring frame %d, want %d", data[0]/1000, 192000-48000)
	}
	if after := int64(len(data)/2) - clip.Src - clip.Frames; after < 480 || after > 48000 {
		t.Fatalf("%d frames after the clip: the overhang at least, a second at most", after)
	}
}

func TestTrimMovesAnEdgeAndKeepsTheAudioWhereItWasPlayed(t *testing.T) {
	e, tp, c := trimLoop(t)
	ramp := func(fileFrame int64) float64 { return float64(52000+fileFrame) / 1e6 }
	before := at(t, e, 250000)
	// In: later. At moves with Src, so tape frame 250000 still plays the same.
	got := trim(t, e, c.ID, "in", 210000)
	if got.At != 210000 || got.Src != 48000+18000 || got.End() != c.End() {
		t.Fatalf("trimmed in = %+v", got)
	}
	if v := at(t, e, 250000); math.Abs(v-before) > 1e-6 {
		t.Fatalf("frame 250000 plays %.6f, played %.6f", v, before)
	}
	// In: back out past where it started, into the handle, to the file's
	// start less the overhang (kept for a reverse, whose start becomes an
	// end), and no further.
	got = trim(t, e, c.ID, "in", 0)
	if got.At != 192000-48000+480 || got.Src != 480 || got.End() != c.End() {
		t.Fatalf("trimmed in to the file's start = %+v", got)
	}
	if v := at(t, e, 150000); math.Abs(v-ramp(150000-144000)) > 1e-4 {
		t.Fatalf("the handle plays %.5f, want %.5f", v, ramp(6000))
	}
	// Out: past the file, to where it still has the crossfade's overhang.
	got = trim(t, e, c.ID, "out", 1<<40)
	if got.Src+got.Frames != 192000-480 {
		t.Fatalf("trimmed out to the file's end = %+v (file 192000 frames)", got)
	}
	// Out: shorter than 10 ms is as short as it goes.
	got = trim(t, e, c.ID, "out", 0)
	if got.Frames != 480 {
		t.Fatalf("trimmed out to nothing = %+v", got)
	}
	// Each drag is one undo.
	for i := 0; i < 4; i++ {
		if err := e.Undo(tp.ID, false); err != nil {
			t.Fatal(err)
		}
	}
	if got := findClip(t, e, c.ID); got != c {
		t.Fatalf("after four undos %+v, want %+v", got, c)
	}
}

func TestTrimStopsAtTheClipsBesideIt(t *testing.T) {
	e, tp, c := trimLoop(t)
	pos := int64(240000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); err != nil {
		t.Fatal(err)
	}
	cl := track(e, 1)
	head, tail := cl[0], cl[1]
	// The head's end can't run into the tail, nor the tail's start into the head.
	if got := trim(t, e, head.ID, "out", 280000); got.End() != 240000 {
		t.Fatalf("head out = %+v", got)
	}
	if got := trim(t, e, tail.ID, "in", 200000); got.At != 240000 {
		t.Fatalf("tail in = %+v", got)
	}
	// Shorten the head; the tail's start then grows back to meet it, the
	// halves sharing one file.
	trim(t, e, head.ID, "out", 220000)
	if got := trim(t, e, tail.ID, "in", 0); got.At != 220000 || got.File != c.File || got.Src != c.Src+(220000-c.At) {
		t.Fatalf("tail grown back = %+v", got)
	}
	// A clip on another layer doesn't stand in the way.
	other := Clip{File: c.File, Src: 0, Frames: 1000, At: 300000, Layer: 1}
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		s.Tracks[0].Clips = append(s.Tracks[0].Clips, other)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if got := trim(t, e, tail.ID, "out", 1<<40); got.End() <= 300000 {
		t.Fatalf("tail out stopped at another layer's clip: %+v", got)
	}
}

func TestTrimIsRefusedWithoutAnEdgeOrAPlace(t *testing.T) {
	e, tp, c := trimLoop(t)
	at := int64(200000)
	for _, req := range []EditRequest{
		{Op: "trim", Clip: c.ID, Edge: "in"},
		{Op: "trim", Clip: c.ID, Edge: "middle", At: &at},
	} {
		if _, err := e.EditOp(tp.ID, req); !errors.Is(err, ErrBadParameter) {
			t.Fatalf("%+v = %v", req, err)
		}
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "trim", Clip: "nope", Edge: "in", At: &at}); !errors.Is(err, ErrNoSuchClip) {
		t.Fatalf("no such clip = %v", err)
	}
}

// A trimmed edge that meets audio crossfades into it; one beside silence
// declicks.
func TestATrimmedEdgeCrossfadesOrDeclicks(t *testing.T) {
	e, tp, c := trimLoop(t)
	// A second clip, of steady 0.5, half a bar after the first ends.
	steady := takeWAV(t, 200000, func(int) float64 { return 0.5 })
	b, err := e.copyTake(steady, 50000, 146000, []int{0, 1}, "send")
	if err != nil {
		t.Fatal(err)
	}
	b.At = c.End() + 24000
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		_, err := s.Place(1, b, false)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	b = track(e, 1)[1]
	// Beside silence, the trimmed end fades to nothing over 3 ms.
	end := trim(t, e, c.ID, "out", c.End()+12000).End()
	if v := at(t, e, end-1); math.Abs(v) > 0.01 {
		t.Fatalf("the last frame before silence plays %.4f, want ~0 (declicked)", v)
	}
	if v := at(t, e, end-400); v < 0.2 {
		t.Fatalf("well before the end it plays %.4f, want the ramp", v)
	}
	// Grown to meet the next clip: no declick, a crossfade into it.
	end = trim(t, e, c.ID, "out", 1<<40).End()
	if end != b.At {
		t.Fatalf("trimmed out to %d, want it stopped at the next clip, %d", end, b.At)
	}
	last := at(t, e, end-1)
	if last < 0.2 {
		t.Fatalf("the last frame plays %.4f: declicked, but audio follows", last)
	}
	mid := at(t, e, end+120) // halfway through the 5 ms crossfade
	if mid < 0.2 || mid > 0.9 {
		t.Fatalf("halfway into the crossfade %.4f, want both clips sounding", mid)
	}
}
