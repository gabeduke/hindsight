package tape

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

// samples16 reads a 16-bit stereo WAV's samples, after its 44-byte header.
func samples16(t *testing.T, b []byte) []int16 {
	t.Helper()
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[36:40]) != "data" {
		t.Fatalf("not a plain WAV: % x", b[:min(len(b), 44)])
	}
	n := int(binary.LittleEndian.Uint32(b[40:44])) / 2
	if len(b) != 44+2*n {
		t.Fatalf("%d bytes for %d samples", len(b), n)
	}
	out := make([]int16, n)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(b[44+2*i:]))
	}
	return out
}

func TestTheLoopToListenToIsTheMixAsItPlaysRound(t *testing.T) {
	e, _, tp := newEngine(t)
	// A one-bar loop, the take filling it: 0.5 left, -0.5 right, with the
	// take carrying on past it, as a catch's overhang does.
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	l, err := e.Listen(tp.ID, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if !l.Loop || l.From != 0 || l.Frames != 96000 || l.SampleRate != 48000 {
		t.Fatalf("listen = %+v", l)
	}
	var buf bytes.Buffer
	n, err := l.WriteTo(&buf)
	if err != nil || n != l.Bytes() || int64(buf.Len()) != l.Bytes() {
		t.Fatalf("wrote %d of %d: %v", n, l.Bytes(), err)
	}
	s := samples16(t, buf.Bytes())
	// At the track's level in each side, opposite signs. And no fade at the
	// start or the end: the seam crossfades into the overhang, as the tape
	// does every time round, so the file loops without a gap.
	want := 0.5 * math.Pow(10, float64(DefaultTrackGainDB)/20) * 32767
	for _, i := range []int{0, 1000, 95999} {
		tol := 2.0
		if i == 0 {
			tol = want * 0.02 // inside the equal-power crossfade
		}
		if l, r := float64(s[2*i]), float64(s[2*i+1]); math.Abs(l-want) > tol || math.Abs(r+want) > tol {
			t.Fatalf("frame %d = %v %v, want ±%.0f", i, l, r, want)
		}
	}

	// Muted, it's silence; the whole tape, with the click, is the click.
	if err := e.Edit(tp.ID, "", func(_ *Tape, st *State) error { st.Tracks[0].Mute = true; return nil }); err != nil {
		t.Fatal(err)
	}
	l, err = e.Listen(tp.ID, true, true)
	if err != nil {
		t.Fatal(err)
	}
	if l.Loop || l.From != 0 || l.Frames != 96000 {
		t.Fatalf("whole tape = %+v", l)
	}
	buf.Reset()
	if _, err := l.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	s = samples16(t, buf.Bytes())
	var peakBeat, peakBetween int16
	for i := 0; i < 96000; i++ {
		v := s[2*i]
		if v < 0 {
			v = -v
		}
		if i%24000 < 1200 { // the 25 ms click on each of the four beats
			peakBeat = max(peakBeat, v)
		} else {
			peakBetween = max(peakBetween, v)
		}
	}
	if peakBeat < 1000 || peakBetween != 0 {
		t.Fatalf("click: %d on the beats, %d between, want a click on each beat and nothing else", peakBeat, peakBetween)
	}
	if _, err := e.Listen("other", false, false); !errors.Is(err, ErrWrongTape) {
		t.Fatalf("another tape: %v", err)
	}
}

func TestAPhonePartGoesBackWhereItWasPlayedWrappingAtTheLoop(t *testing.T) {
	e, _, tp := newEngine(t)
	base := takeWAV(t, 96000, func(i int) float64 { return 0.25 })
	if _, err := e.DropTake(tp.ID, base, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	// The phone's take: frame i holds i/1e6, so where each part came from
	// can be read back.
	phone := takeWAV(t, 200000, func(i int) float64 { return float64(i) / 1e6 })
	// A pass that began three quarters through the loop: 24000 frames to
	// Out, then 72000 from In.
	clips, err := e.PlaceTake(tp.ID, phone, 100000, 196000, 1, 72000, false, true, "phone", []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(clips) != 2 || clips[0].At != 72000 || clips[0].Frames != 24000 || clips[1].At != 0 || clips[1].Frames != 72000 {
		t.Fatalf("placed %+v", clips)
	}
	for _, c := range clips {
		if c.Layer != 1 || c.Source != "phone" || c.PeakDB == nil {
			t.Fatalf("clip %+v: want a layer over the base, from the phone, with its level", c)
		}
	}
	// The tail starts where the head left off in the take.
	data := readPool(t, e.store, clips[1].File)
	if got, want := float64(data[2*clips[1].Src])/2147483647, float64(100000+24000)/1e6; math.Abs(got-want) > 1e-6 {
		t.Fatalf("the tail starts at take frame %.0f, want %.0f", got*1e6, want*1e6)
	}
	// Played over the loop, a part goes inside it and no longer than it.
	if _, err := e.PlaceTake(tp.ID, phone, 0, 96001, 1, 0, false, true, "phone", []int{0, 1}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("longer than the loop: %v", err)
	}
	if _, err := e.PlaceTake(tp.ID, phone, 0, 1000, 1, 96000, false, true, "phone", []int{0, 1}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("outside the loop: %v", err)
	}
	if _, err := e.PlaceTake(tp.ID, phone, 0, 1000, 9, 0, false, true, "phone", []int{0, 1}); err == nil {
		t.Fatal("track 9 was accepted")
	}
	// Played over the whole tape, it goes straight where it was played,
	// past the loop, replacing what's there if asked.
	straight, err := e.PlaceTake(tp.ID, phone, 0, 48000, 3, 120000, true, false, "phone", []int{0, 1})
	if err != nil || len(straight) != 1 || straight[0].At != 120000 || straight[0].Layer != 0 {
		t.Fatalf("straight: %+v %v", straight, err)
	}
}
