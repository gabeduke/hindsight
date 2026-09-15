package smf

import (
	"bytes"
	"testing"
)

func TestVLQ(t *testing.T) {
	// The four examples from the SMF specification, plus the edges.
	cases := map[uint64][]byte{
		0x00:       {0x00},
		0x40:       {0x40},
		0x7F:       {0x7F},
		0x80:       {0x81, 0x00},
		0x2000:     {0xC0, 0x00},
		0x3FFF:     {0xFF, 0x7F},
		0x4000:     {0x81, 0x80, 0x00},
		0x0FFFFFFF: {0xFF, 0xFF, 0xFF, 0x7F},
	}
	for v, want := range cases {
		var b bytes.Buffer
		writeVLQ(&b, v)
		if !bytes.Equal(b.Bytes(), want) {
			t.Errorf("writeVLQ(%#x) = % x, want % x", v, b.Bytes(), want)
		}
		got, n, ok := readVLQ(want)
		if !ok || got != v || n != len(want) {
			t.Errorf("readVLQ(% x) = %#x,%d,%v", want, got, n, ok)
		}
	}
}

func TestHeaderIsFormat1WithPPQ(t *testing.T) {
	f := &File{Tracks: []Track{{}, {}}}
	b := f.Encode()
	want := []byte{'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 1, 0, 2, 0x03, 0xC0}
	if !bytes.Equal(b[:14], want) {
		t.Fatalf("header = % x, want % x", b[:14], want)
	}
}

func TestEmptyTrackIsJustEndOfTrack(t *testing.T) {
	b := encodeTrack(&Track{})
	if want := []byte{0x00, 0xFF, 0x2F, 0x00}; !bytes.Equal(b, want) {
		t.Fatalf("empty track = % x, want % x", b, want)
	}
}

func TestDeltasAndExplicitStatus(t *testing.T) {
	tr := Track{Events: []Event{
		Channel(0, 0x90, 60, 100),
		Channel(480, 0x90, 60, 0),
		Channel(480, 0xC0, 5, 0), // one data byte, same tick
		Channel(1000, 0xE0, 0, 64),
	}}
	got := encodeTrack(&tr)
	want := []byte{
		0x00, 0x90, 60, 100,
		0x83, 0x60, 0x90, 60, 0, // delta 480
		0x00, 0xC0, 5,
		0x84, 0x08, 0xE0, 0, 64, // delta 520
		0x00, 0xFF, 0x2F, 0x00,
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("track = % x\nwant    % x", got, want)
	}
}

func TestEventsAreSortedStablyByTick(t *testing.T) {
	// Appended out of order; a note-off and a note-on on the same tick keep
	// their appended order (off first), which is what a caller relies on for
	// a repeated note.
	tr := Track{Events: []Event{
		Channel(960, 0x90, 60, 100),
		Channel(0, 0x90, 60, 100),
		Channel(960, 0x90, 60, 0),
	}}
	f, err := Decode((&File{Tracks: []Track{tr}}).Encode())
	if err != nil {
		t.Fatal(err)
	}
	ev := f.Tracks[0].Events
	if ev[0].Tick != 0 || ev[1].Tick != 960 || ev[1].D2 != 100 || ev[2].D2 != 0 {
		t.Fatalf("order wrong: %+v", ev)
	}
}

func TestMetaEventsRoundTrip(t *testing.T) {
	cond := Track{Events: []Event{
		TrackName(0, "conductor"),
		TimeSignature(0, 4, 4),
		Tempo(0, USPerQuarter(120)),
		Tempo(3840, 600000), // 100 BPM at bar 2
		Marker(3840, "Clock start"),
	}}
	notes := Track{Events: []Event{
		TrackName(0, "Orchid ch1"),
		Channel(10, 0x90, 64, 90),
		Channel(500, 0x80, 64, 0),
	}}
	f := &File{Tracks: []Track{cond, notes}}
	b := f.Encode()

	got, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	if got.PPQ != DefaultPPQ || len(got.Tracks) != 2 {
		t.Fatalf("ppq=%d tracks=%d", got.PPQ, len(got.Tracks))
	}
	c := got.Tracks[0].Events
	if c[0].Text() != "conductor" {
		t.Errorf("name = %q", c[0].Text())
	}
	if c[1].Meta != MetaTimeSignature || !bytes.Equal(c[1].Data, []byte{4, 2, 24, 8}) {
		t.Errorf("time sig = %+v", c[1])
	}
	if c[2].Tempo() != 500000 {
		t.Errorf("tempo = %d, want 500000", c[2].Tempo())
	}
	if c[3].Tick != 3840 || c[3].Tempo() != 600000 {
		t.Errorf("second tempo = %+v", c[3])
	}
	if c[4].Text() != "Clock start" || c[4].Meta != MetaMarker {
		t.Errorf("marker = %+v", c[4])
	}
	if last := c[len(c)-1]; last.Meta != MetaEndOfTrack || last.Tick != 3840 {
		t.Errorf("end of track = %+v, want tick 3840", last)
	}
	n := got.Tracks[1].Events
	if n[0].Text() != "Orchid ch1" || n[1].Status != 0x90 || n[1].Tick != 10 || n[2].Tick != 500 {
		t.Errorf("notes = %+v", n)
	}
}

func TestUSPerQuarter(t *testing.T) {
	if got := USPerQuarter(120); got != 500000 {
		t.Errorf("120 BPM = %d us, want 500000", got)
	}
	if got := USPerQuarter(96); got != 625000 {
		t.Errorf("96 BPM = %d us, want 625000", got)
	}
	if got := USPerQuarter(0); got != 0xFFFFFF {
		t.Errorf("0 BPM must clamp, got %d", got)
	}
	if got := USPerQuarter(1e9); got != 1 {
		t.Errorf("absurd BPM must clamp to 1, got %d", got)
	}
}

func TestTimeSignatureDenominatorIsPowerOfTwo(t *testing.T) {
	for denom, pow := range map[byte]byte{1: 0, 2: 1, 4: 2, 8: 3, 16: 4} {
		if got := TimeSignature(0, 3, denom).Data[1]; got != pow {
			t.Errorf("denom %d encoded as %d, want %d", denom, got, pow)
		}
	}
}

func TestDataBytesAreMaskedTo7Bits(t *testing.T) {
	tr := Track{Events: []Event{Channel(0, 0x90, 0xFF, 0xFF)}}
	b := encodeTrack(&tr)
	if b[2] != 0x7F || b[3] != 0x7F {
		t.Fatalf("data bytes not masked: % x", b)
	}
}

func TestDecodeRunningStatus(t *testing.T) {
	// A hand-built track using running status, as another program might
	// write it.
	body := []byte{
		0x00, 0x90, 60, 100,
		0x10, 62, 100, // running status
		0x10, 0x80, 60, 0,
		0x00, 0xFF, 0x2F, 0x00,
	}
	var b bytes.Buffer
	b.WriteString("MThd")
	b.Write([]byte{0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xE0})
	b.WriteString("MTrk")
	b.Write([]byte{0, 0, 0, byte(len(body))})
	b.Write(body)
	f, err := Decode(b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	ev := f.Tracks[0].Events
	if len(ev) != 4 || ev[1].Status != 0x90 || ev[1].D1 != 62 || ev[1].Tick != 16 || ev[2].Tick != 32 {
		t.Fatalf("events = %+v", ev)
	}
}

func TestDecodeRejectsGarbage(t *testing.T) {
	for _, b := range [][]byte{nil, []byte("MThx"), []byte("MThd\x00\x00\x00\x06\x00\x01\x00\x01\x03\xc0MTrk\x00\x00\x00\x02\x00")} {
		if _, err := Decode(b); err == nil {
			t.Errorf("Decode(% x) succeeded", b)
		}
	}
}
