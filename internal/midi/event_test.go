package midi

import (
	"reflect"
	"testing"
	"unsafe"
)

type msg struct{ s, d1, d2 byte }

func parseAll(t *testing.T, bytes []byte) (msgs []msg, rt []byte, p *Parser) {
	t.Helper()
	p = &Parser{
		OnMessage:  func(s, d1, d2 byte) { msgs = append(msgs, msg{s, d1, d2}) },
		OnRealtime: func(b byte) { rt = append(rt, b) },
	}
	for _, b := range bytes {
		p.Feed(b)
	}
	return msgs, rt, p
}

func TestEventIs16Bytes(t *testing.T) {
	if got := unsafe.Sizeof(Event{}); got != 16 {
		t.Fatalf("Event is %d bytes, want 16", got)
	}
}

func TestParserThreeByteMessages(t *testing.T) {
	msgs, _, _ := parseAll(t, []byte{0x90, 60, 100, 0x80, 60, 0, 0xB3, 7, 127, 0xE0, 0x00, 0x40})
	want := []msg{{0x90, 60, 100}, {0x80, 60, 0}, {0xB3, 7, 127}, {0xE0, 0, 0x40}}
	if !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
}

func TestParserTwoByteMessages(t *testing.T) {
	msgs, _, _ := parseAll(t, []byte{0xC1, 5, 0xD1, 99})
	want := []msg{{0xC1, 5, 0}, {0xD1, 99, 0}}
	if !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
}

func TestParserRunningStatus(t *testing.T) {
	// One status byte, three note-ons. The third is a velocity-zero note-off
	// in disguise, which is how most keyboards send note-off under running
	// status.
	msgs, _, _ := parseAll(t, []byte{0x90, 60, 100, 62, 90, 60, 0})
	want := []msg{{0x90, 60, 100}, {0x90, 62, 90}, {0x90, 60, 0}}
	if !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
	e := Event{Status: 0x90, D1: 60, D2: 0}
	if e.IsNoteOn() || !e.IsNoteOff() {
		t.Fatalf("velocity-zero note-on must read as a note-off")
	}
}

func TestParserRealtimeInsideMessage(t *testing.T) {
	// Clock pulses land inside a note-on. The note must survive intact and
	// both pulses must be reported.
	msgs, rt, _ := parseAll(t, []byte{0x90, 0xF8, 60, 0xF8, 100, 0xFA})
	if want := []msg{{0x90, 60, 100}}; !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
	if want := []byte{0xF8, 0xF8, 0xFA}; !reflect.DeepEqual(rt, want) {
		t.Fatalf("realtime got %v want %v", rt, want)
	}
}

func TestParserSysExSkippedAndCounted(t *testing.T) {
	msgs, rt, p := parseAll(t, []byte{
		0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF8, 0xF7, // sysex with a clock inside
		0x90, 60, 100,
		0xF0, 0x41, 0x10, 0x90, 61, 50, // sysex terminated by a status byte
	})
	want := []msg{{0x90, 60, 100}, {0x90, 61, 50}}
	if !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
	if want := []byte{0xF8}; !reflect.DeepEqual(rt, want) {
		t.Fatalf("realtime inside sysex must still be reported, got %v", rt)
	}
	if p.SysExDropped != 2 {
		t.Fatalf("SysExDropped = %d, want 2", p.SysExDropped)
	}
}

func TestParserSystemCommonCancelsRunningStatus(t *testing.T) {
	// Song position (2 data bytes) between two note-ons; the data after it
	// must not be read as a note under the old running status.
	msgs, _, _ := parseAll(t, []byte{0x90, 60, 100, 0xF2, 0x10, 0x20, 61, 50, 0x90, 62, 40})
	want := []msg{{0x90, 60, 100}, {0xF2, 0x10, 0x20}, {0x90, 62, 40}}
	if !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
}

func TestParserStrayDataDropped(t *testing.T) {
	msgs, _, _ := parseAll(t, []byte{60, 100, 0x90, 60, 100})
	if want := []msg{{0x90, 60, 100}}; !reflect.DeepEqual(msgs, want) {
		t.Fatalf("got %v want %v", msgs, want)
	}
}

func TestEventAccessors(t *testing.T) {
	e := Event{Status: 0x9A, D1: 1, D2: 2}
	if e.Channel() != 10 || e.Kind() != NoteOn || !e.IsChannel() {
		t.Fatalf("channel message accessors wrong: %+v", e)
	}
	s := Event{Status: StartByte}
	if s.Channel() != -1 || !s.IsTransport() || s.IsChannel() {
		t.Fatalf("system message accessors wrong: %+v", s)
	}
}

func TestEventRingBetweenSortsAndBounds(t *testing.T) {
	r := NewEventRing(8)
	// Out of order across "devices": 30 lands before 20.
	for _, ns := range []int64{10, 30, 20, 40, 50} {
		r.Push(Event{NS: ns, Status: 0x90})
	}
	got := r.Between(20, 50)
	var ns []int64
	for _, e := range got {
		ns = append(ns, e.NS)
	}
	if want := []int64{20, 30, 40}; !reflect.DeepEqual(ns, want) {
		t.Fatalf("got %v want %v", ns, want)
	}
}

func TestEventRingOverflowEvictsOldest(t *testing.T) {
	r := NewEventRing(3)
	for i := int64(1); i <= 5; i++ {
		r.Push(Event{NS: i})
	}
	if r.Len() != 3 || r.Overflow() != 2 || r.Total() != 5 {
		t.Fatalf("len=%d overflow=%d total=%d", r.Len(), r.Overflow(), r.Total())
	}
	got := r.Between(0, 100)
	if len(got) != 3 || got[0].NS != 3 || got[2].NS != 5 {
		t.Fatalf("got %+v", got)
	}
}

func TestEventRingBetweenStableForTies(t *testing.T) {
	r := NewEventRing(8)
	r.Push(Event{NS: 5, D1: 1})
	r.Push(Event{NS: 5, D1: 2})
	r.Push(Event{NS: 5, D1: 3})
	got := r.Between(0, 10)
	if got[0].D1 != 1 || got[1].D1 != 2 || got[2].D1 != 3 {
		t.Fatalf("ties must keep arrival order: %+v", got)
	}
}
