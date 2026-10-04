package tape

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// at is what the tape plays at frame f on bus A's left, before the track's
// level.
func at(t *testing.T, e *Engine, f int64) float64 {
	t.Helper()
	buf := make([]float32, OutChannels)
	e.mix.Load().Render(buf, f, 1)
	return float64(buf[0]) / math.Pow(10, float64(DefaultTrackGainDB)/20)
}

func TestAReversedClipPlaysBackwardsAndTurnsBack(t *testing.T) {
	e, _, tp, orig := firstLoop(t)                                            // a ramp: frame i of the take is i/1e6
	ramp := func(fileFrame int64) float64 { return float64(fileFrame) / 1e6 } // the take's frame = the copy's file frame here (from 0)
	if v := at(t, e, 1000); math.Abs(v-ramp(orig.Src+1000)) > 1e-4 {
		t.Fatalf("forwards at 1000: %.5f, want %.5f", v, ramp(orig.Src+1000))
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clip: orig.ID}); err != nil {
		t.Fatal(err)
	}
	rev := track(e, 1)[0]
	if rev.Reversed == nil || rev.Reversed.File != orig.File || rev.File == orig.File || rev.Frames != orig.Frames || rev.At != orig.At {
		t.Fatalf("reversed = %+v", rev)
	}
	// Backwards: tape frame k plays the original's frame Src+Frames-1-k.
	for _, k := range []int64{1000, 48000, 90000} {
		want := ramp(orig.Src + orig.Frames - 1 - k)
		if v := at(t, e, k); math.Abs(v-want) > 1e-4 {
			t.Fatalf("reversed at %d: %.5f, want %.5f", k, v, want)
		}
	}
	// Split it, and turn its first half back: the end of the original,
	// forwards.
	pos := int64(30000)
	e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	head := track(e, 1)[0]
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clip: head.ID}); err != nil {
		t.Fatal(err)
	}
	back := findClip(t, e, head.ID)
	if back.Reversed != nil || back.File != orig.File || back.Src != orig.Src+orig.Frames-30000 || back.Frames != 30000 {
		t.Fatalf("the head turned back = %+v", back)
	}
	// Undo, undo, undo: as it was.
	for i := 0; i < 3; i++ {
		e.Undo(tp.ID, false)
	}
	if cl := track(e, 1); len(cl) != 1 || cl[0] != orig {
		t.Fatalf("after undoing: %+v", cl)
	}
}

func TestAClipSharesAsA16BitWAV(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	w, err := e.ShareClip(tp.ID, orig.ID)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if _, err := w.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	le := binary.LittleEndian
	if int64(len(b)) != w.Bytes() || len(b) != 44+96000*4 || le.Uint16(b[34:36]) != 16 || w.Name != "test track 1.wav" {
		t.Fatalf("%d bytes (want %d), %d bits, %q", len(b), w.Bytes(), le.Uint16(b[34:36]), w.Name)
	}
	sample := func(k int) float64 { return float64(int16(le.Uint16(b[44+k*4:]))) / 32767 }
	if v := sample(0); math.Abs(v) > 0.001 {
		t.Fatalf("first frame %.4f, want faded in", v)
	}
	if v, want := sample(50000), float64(orig.Src+50000)/1e6; math.Abs(v-want) > 0.0002 {
		t.Fatalf("frame 50000 = %.5f, want %.5f", v, want)
	}
	if _, err := e.ShareClip(tp.ID, "nope"); err == nil {
		t.Fatal("shared no clip")
	}
}
