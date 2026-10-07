package tape

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// steadyLoop is firstLoop with a take of steady 0.5: a clip of 96000 frames
// at 0 on track 1.
func steadyLoop(t *testing.T) (*Engine, *Tape, Clip) {
	t.Helper()
	e, _, tp := newEngine(t)
	take := takeWAV(t, 200000, func(int) float64 { return 0.5 })
	if _, err := e.CopyTake(take, "jam_take.wav", 0, 96000, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	d, err := e.DropClipboard(tp.ID, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	return e, tp, d.Clip
}

func fade(t *testing.T, e *Engine, id string, in, out int64) {
	t.Helper()
	if err := e.Edit(e.LoadedID(), "", func(_ *Tape, s *State) error {
		for ti := range s.Tracks {
			for i := range s.Tracks[ti].Clips {
				if c := &s.Tracks[ti].Clips[i]; c.ID == id {
					c.FadeIn, c.FadeOut = in, out
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAFadeRisesAndFallsOnAnEqualPowerCurve(t *testing.T) {
	e, _, c := steadyLoop(t)
	fade(t, e, c.ID, 4800, 9600)
	near := func(f int64, want float64) {
		t.Helper()
		if v := at(t, e, f); math.Abs(v-want) > 0.01 {
			t.Fatalf("frame %d plays %.4f, want %.4f", f, v, want)
		}
	}
	near(2400, 0.5*math.Sin(math.Pi/4)) // halfway in: -3 dB
	near(4800, 0.5)
	near(48000, 0.5)
	near(96000-4800, 0.5*math.Sin(math.Pi/4)) // halfway out
	if v := at(t, e, 0); math.Abs(v) > 0.01 {
		t.Fatalf("the first frame plays %.4f: a fade in starts from silence", v)
	}
	if v := at(t, e, 95999); math.Abs(v) > 0.01 {
		t.Fatalf("the last frame plays %.4f", v)
	}
}

func TestFadesLongerThanTheClipShareIt(t *testing.T) {
	c := Clip{Frames: 1000, FadeIn: 900, FadeOut: 900}
	in, out := c.fades()
	if in+out != 1000 || in != 500 {
		t.Fatalf("fades = %d, %d: they share the clip between them", in, out)
	}
	if in, out := (Clip{Frames: 1000, FadeIn: 2000}).fades(); in != 1000 || out != 0 {
		t.Fatalf("one fade longer than the clip = %d, %d", in, out)
	}
}

func TestFadesSurviveSplitJoinReverseAndLift(t *testing.T) {
	e, tp, c := steadyLoop(t)
	fade(t, e, c.ID, 4800, 9600)
	pos := int64(48000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); err != nil {
		t.Fatal(err)
	}
	head, tail := track(e, 1)[0], track(e, 1)[1]
	if head.FadeIn != 4800 || head.FadeOut != 0 || tail.FadeIn != 0 || tail.FadeOut != 9600 {
		t.Fatalf("split: head %d/%d, tail %d/%d: each keeps its outer fade", head.FadeIn, head.FadeOut, tail.FadeIn, tail.FadeOut)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "join", Clip: head.ID}); err != nil {
		t.Fatal(err)
	}
	if j := track(e, 1)[0]; j.FadeIn != 4800 || j.FadeOut != 9600 {
		t.Fatalf("joined: %d/%d", j.FadeIn, j.FadeOut)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clip: c.ID}); err != nil {
		t.Fatal(err)
	}
	if r := track(e, 1)[0]; r.FadeIn != 9600 || r.FadeOut != 4800 {
		t.Fatalf("reversed: %d/%d: its end is its start now", r.FadeIn, r.FadeOut)
	}
	e.Undo(tp.ID, false)
	// A lift of the middle: the clipboard's part has no fades, the ends
	// left on the tape keep theirs.
	setLoop(t, e, 24000, 72000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "lift", Track: 1})
	if err != nil {
		t.Fatal(err)
	}
	if p := res.Board.Tracks[0][0]; p.FadeIn != 0 || p.FadeOut != 0 {
		t.Fatalf("the lifted middle has fades %d/%d", p.FadeIn, p.FadeOut)
	}
	if l := track(e, 1); l[0].FadeIn != 4800 || l[0].FadeOut != 0 || l[1].FadeIn != 0 || l[1].FadeOut != 9600 {
		t.Fatalf("the ends left: %+v", l)
	}
}

func TestASharedClipIsFaded(t *testing.T) {
	e, tp, c := steadyLoop(t)
	fade(t, e, c.ID, 4800, 0)
	w, err := e.ShareClip(tp.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	if _, err := w.WriteTo(&b); err != nil {
		t.Fatal(err)
	}
	sample := func(k int) float64 { return float64(int16(binary.LittleEndian.Uint16(b.Bytes()[44+4*k:]))) / 32768 }
	if v := sample(2400); math.Abs(v-0.5*math.Sin(math.Pi/4)) > 0.01 {
		t.Fatalf("halfway into the shared fade: %.4f", v)
	}
	if v := sample(48000); math.Abs(v-0.5) > 0.01 {
		t.Fatalf("after the fade: %.4f", v)
	}
}

// A fade on the inner edge of a split -- the usual way to fade at a cut --
// crossfades there, with no step where the halves meet.
func TestAFadeAtASplitDoesntClick(t *testing.T) {
	for _, edge := range []string{"head out", "tail in"} {
		e, tp, c := steadyLoop(t)
		pos := int64(48000)
		if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); err != nil {
			t.Fatal(err)
		}
		head, tail := track(e, 1)[0], track(e, 1)[1]
		if edge == "head out" {
			fade(t, e, head.ID, 0, 4800)
		} else {
			fade(t, e, tail.ID, 4800, 0)
		}
		prev := at(t, e, 47990)
		for f := int64(47991); f < 48300; f++ {
			v := at(t, e, f)
			if math.Abs(v-prev) > 0.02 {
				t.Fatalf("%s: frame %d jumps %.4f → %.4f", edge, f, prev, v)
			}
			prev = v
		}
		_ = c
	}
}

func TestPastItsEndAFadedClipIsSilent(t *testing.T) {
	if g := fadeGain(1000, 1000, 0, 100); g != 0 {
		t.Fatalf("just past the end: %f", g)
	}
	if g := fadeGain(1100, 1000, 0, 100); g != 0 {
		t.Fatalf("well past the end: %f", g)
	}
	if g := fadeGain(-1, 1000, 100, 0); g != 0 {
		t.Fatalf("before the start: %f", g)
	}
	if g := fadeGain(1100, 1000, 0, 0); g != 1 {
		t.Fatalf("no fade, past the end: %f (the declick's business, not the fade's)", g)
	}
}

func TestTheClipboardAuditionIsFaded(t *testing.T) {
	e, tp, c := steadyLoop(t)
	fade(t, e, c.ID, 4800, 0)
	setLoop(t, e, 0, 96000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "copy", Track: 1}); err != nil {
		t.Fatal(err)
	}
	pcm, err := e.ClipboardAudio()
	if err != nil {
		t.Fatal(err)
	}
	if v := pcm[2*2400]; math.Abs(float64(v)-0.5*math.Sin(math.Pi/4)) > 0.01 {
		t.Fatalf("halfway into the fade the audition plays %.4f", v)
	}
}
