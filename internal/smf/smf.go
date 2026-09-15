// Package smf writes Standard MIDI Files.
//
// It is deliberately small: Format 1, one division, the handful of meta events
// a DAW needs to lay a jam on its grid. Nothing here knows about devices,
// timestamps or audio -- callers arrive with ticks already worked out. A
// matching decoder exists so the writer can be tested by reading its own
// output back, and so a tool can inspect a file without a third-party
// library.
package smf

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
)

// DefaultPPQ is the division the export uses. 960 divides every common tuplet
// and is fine enough that a 1-tick error at 120 BPM is half a millisecond.
const DefaultPPQ = 960

// Meta event types this package writes and reads by name.
const (
	MetaText          byte = 0x01
	MetaTrackName     byte = 0x03
	MetaMarker        byte = 0x06
	MetaEndOfTrack    byte = 0x2F
	MetaTempo         byte = 0x51
	MetaTimeSignature byte = 0x58
)

// Event is one event at an absolute tick. Exactly one of the two shapes is
// used: a channel message (Status in 0x80..0xEF, with data bytes), or a meta
// event (Status == 0xFF, Meta set, Data carrying the payload).
type Event struct {
	Tick   uint64
	Status byte
	D1, D2 byte
	Meta   byte
	Data   []byte
}

// IsMeta reports whether the event is a meta event.
func (e Event) IsMeta() bool { return e.Status == 0xFF }

// Tempo returns the tempo of a MetaTempo event in microseconds per quarter
// note, or 0 for any other event.
func (e Event) Tempo() uint32 {
	if !e.IsMeta() || e.Meta != MetaTempo || len(e.Data) != 3 {
		return 0
	}
	return uint32(e.Data[0])<<16 | uint32(e.Data[1])<<8 | uint32(e.Data[2])
}

// Text returns a text-carrying meta event's payload, or "".
func (e Event) Text() string {
	if !e.IsMeta() {
		return ""
	}
	switch e.Meta {
	case MetaText, MetaTrackName, MetaMarker:
		return string(e.Data)
	}
	return ""
}

// Channel builds a channel voice event.
func Channel(tick uint64, status, d1, d2 byte) Event {
	return Event{Tick: tick, Status: status, D1: d1, D2: d2}
}

// Tempo builds a set-tempo meta event. usPerQuarter is clamped to 24 bits.
func Tempo(tick uint64, usPerQuarter uint32) Event {
	if usPerQuarter > 0xFFFFFF {
		usPerQuarter = 0xFFFFFF
	}
	if usPerQuarter < 1 {
		usPerQuarter = 1
	}
	return Event{Tick: tick, Status: 0xFF, Meta: MetaTempo,
		Data: []byte{byte(usPerQuarter >> 16), byte(usPerQuarter >> 8), byte(usPerQuarter)}}
}

// USPerQuarter converts a tempo in BPM to the units a tempo event carries.
func USPerQuarter(bpm float64) uint32 {
	if bpm <= 0 {
		return 0xFFFFFF
	}
	us := 60e6 / bpm
	if us > 0xFFFFFF {
		return 0xFFFFFF
	}
	if us < 1 {
		return 1
	}
	return uint32(us + 0.5)
}

// TimeSignature builds a time-signature meta event. denom is the actual
// denominator (4 for 4/4), which the file stores as a power of two.
func TimeSignature(tick uint64, num, denom byte) Event {
	pow := byte(0)
	for d := denom; d > 1; d >>= 1 {
		pow++
	}
	// 24 MIDI clocks per metronome click, 8 32nd notes per quarter: the
	// values every sequencer writes, and every reader ignores.
	return Event{Tick: tick, Status: 0xFF, Meta: MetaTimeSignature, Data: []byte{num, pow, 24, 8}}
}

// TrackName builds an FF 03 name event.
func TrackName(tick uint64, name string) Event {
	return Event{Tick: tick, Status: 0xFF, Meta: MetaTrackName, Data: []byte(name)}
}

// Marker builds an FF 06 marker event.
func Marker(tick uint64, text string) Event {
	return Event{Tick: tick, Status: 0xFF, Meta: MetaMarker, Data: []byte(text)}
}

// Track is a list of events. Order within a tick is preserved by Encode, and
// events are stably sorted by tick, so a caller may append in any order as
// long as same-tick events are appended in the order they should play.
type Track struct {
	Events []Event
}

// File is a Format 1 file: track 0 is the conductor, the rest carry notes.
type File struct {
	PPQ    uint16
	Tracks []Track
}

// Encode serialises the file.
func (f *File) Encode() []byte {
	ppq := f.PPQ
	if ppq == 0 {
		ppq = DefaultPPQ
	}
	var out bytes.Buffer
	out.WriteString("MThd")
	binary.Write(&out, binary.BigEndian, uint32(6))
	binary.Write(&out, binary.BigEndian, uint16(1))
	binary.Write(&out, binary.BigEndian, uint16(len(f.Tracks)))
	binary.Write(&out, binary.BigEndian, ppq)
	for i := range f.Tracks {
		body := encodeTrack(&f.Tracks[i])
		out.WriteString("MTrk")
		binary.Write(&out, binary.BigEndian, uint32(len(body)))
		out.Write(body)
	}
	return out.Bytes()
}

// Write encodes the file to w.
func Write(w io.Writer, f *File) error {
	_, err := w.Write(f.Encode())
	return err
}

func encodeTrack(t *Track) []byte {
	evs := make([]Event, len(t.Events))
	copy(evs, t.Events)
	sort.SliceStable(evs, func(i, j int) bool { return evs[i].Tick < evs[j].Tick })

	var out bytes.Buffer
	var last uint64
	for _, e := range evs {
		if e.IsMeta() && e.Meta == MetaEndOfTrack {
			continue // written once, below, at the end
		}
		writeVLQ(&out, e.Tick-last)
		last = e.Tick
		if e.IsMeta() {
			out.WriteByte(0xFF)
			out.WriteByte(e.Meta)
			writeVLQ(&out, uint64(len(e.Data)))
			out.Write(e.Data)
			continue
		}
		// Explicit status on every event. Running status would save a byte
		// in three and every DAW reads both; explicit is what a person
		// checking the file with a hex dump can follow.
		out.WriteByte(e.Status)
		out.WriteByte(e.D1 & 0x7F)
		if dataBytes(e.Status) == 2 {
			out.WriteByte(e.D2 & 0x7F)
		}
	}
	// End of track: delta 0 from the last event. A DAW places the track's end
	// here, so a conductor track's last tempo event decides its length.
	writeVLQ(&out, 0)
	out.Write([]byte{0xFF, MetaEndOfTrack, 0})
	return out.Bytes()
}

// dataBytes is the data length of a channel status byte.
func dataBytes(status byte) int {
	switch status & 0xF0 {
	case 0xC0, 0xD0:
		return 1
	}
	return 2
}

func writeVLQ(w *bytes.Buffer, v uint64) {
	var buf [10]byte
	i := len(buf) - 1
	buf[i] = byte(v & 0x7F)
	v >>= 7
	for v > 0 {
		i--
		buf[i] = byte(v&0x7F) | 0x80
		v >>= 7
	}
	w.Write(buf[i:])
}

// ErrMalformed reports a file the decoder could not follow.
var ErrMalformed = errors.New("malformed midi file")

// maxTick bounds an absolute tick the decoder accepts.
const maxTick = uint64(1) << 62

// Decode parses a file written by Encode, or any Format 0/1 file using the
// events this package knows. Unknown meta events are kept with their raw
// type; SysEx is skipped.
func Decode(b []byte) (*File, error) {
	r := bytes.NewReader(b)
	var magic [4]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil || string(magic[:]) != "MThd" {
		return nil, fmt.Errorf("%w: no MThd", ErrMalformed)
	}
	var hlen uint32
	var format, ntracks, division uint16
	if err := binary.Read(r, binary.BigEndian, &hlen); err != nil || hlen < 6 {
		return nil, fmt.Errorf("%w: header", ErrMalformed)
	}
	binary.Read(r, binary.BigEndian, &format)
	binary.Read(r, binary.BigEndian, &ntracks)
	binary.Read(r, binary.BigEndian, &division)
	if hlen > 6 {
		r.Seek(int64(hlen-6), io.SeekCurrent)
	}
	if division&0x8000 != 0 {
		return nil, fmt.Errorf("%w: SMPTE division unsupported", ErrMalformed)
	}
	f := &File{PPQ: division}
	for i := 0; i < int(ntracks); i++ {
		if _, err := io.ReadFull(r, magic[:]); err != nil || string(magic[:]) != "MTrk" {
			return nil, fmt.Errorf("%w: track %d has no MTrk", ErrMalformed, i)
		}
		var tlen uint32
		if err := binary.Read(r, binary.BigEndian, &tlen); err != nil {
			return nil, fmt.Errorf("%w: track %d length", ErrMalformed, i)
		}
		// Slice the input rather than allocate: a corrupt length field would
		// otherwise ask for up to 4 GB before the read failed.
		if int64(tlen) > int64(r.Len()) {
			return nil, fmt.Errorf("%w: track %d claims %d bytes, %d remain", ErrMalformed, i, tlen, r.Len())
		}
		pos := len(b) - r.Len()
		body := b[pos : pos+int(tlen)]
		r.Seek(int64(tlen), io.SeekCurrent)
		t, err := decodeTrack(body)
		if err != nil {
			return nil, fmt.Errorf("track %d: %w", i, err)
		}
		f.Tracks = append(f.Tracks, t)
	}
	return f, nil
}

func decodeTrack(b []byte) (Track, error) {
	var t Track
	var tick uint64
	var running byte
	pos := 0
	for pos < len(b) {
		delta, n, ok := readVLQ(b[pos:])
		if !ok {
			return t, fmt.Errorf("%w: delta at %d", ErrMalformed, pos)
		}
		pos += n
		tick += delta
		// A tick past 2^62 is centuries at any PPQ: a corrupt file, and one
		// whose arithmetic would wrap on re-encoding.
		if tick > maxTick {
			return t, fmt.Errorf("%w: tick overflow at %d", ErrMalformed, pos)
		}
		if pos >= len(b) {
			return t, fmt.Errorf("%w: truncated after delta", ErrMalformed)
		}
		status := b[pos]
		switch {
		case status == 0xFF:
			if pos+2 > len(b) {
				return t, fmt.Errorf("%w: meta at %d", ErrMalformed, pos)
			}
			meta := b[pos+1]
			l, n, ok := readVLQ(b[pos+2:])
			// The length is checked as uint64 before it becomes an int: a
			// corrupt VLQ can encode 2^63 and more, which int() turns
			// negative and a bounds check would wave through.
			if !ok || l > uint64(len(b)) || pos+2+n+int(l) > len(b) {
				return t, fmt.Errorf("%w: meta length at %d", ErrMalformed, pos)
			}
			data := append([]byte(nil), b[pos+2+n:pos+2+n+int(l)]...)
			pos += 2 + n + int(l)
			t.Events = append(t.Events, Event{Tick: tick, Status: 0xFF, Meta: meta, Data: data})
			if meta == MetaEndOfTrack {
				return t, nil
			}
		case status == 0xF0 || status == 0xF7:
			l, n, ok := readVLQ(b[pos+1:])
			if !ok || l > uint64(len(b)) || pos+1+n+int(l) > len(b) {
				return t, fmt.Errorf("%w: sysex at %d", ErrMalformed, pos)
			}
			pos += 1 + n + int(l)
		default:
			if status >= 0x80 {
				running = status
				pos++
			} else if running == 0 {
				return t, fmt.Errorf("%w: data byte with no status at %d", ErrMalformed, pos)
			}
			need := dataBytes(running)
			if pos+need > len(b) {
				return t, fmt.Errorf("%w: truncated message at %d", ErrMalformed, pos)
			}
			e := Event{Tick: tick, Status: running, D1: b[pos]}
			if need == 2 {
				e.D2 = b[pos+1]
			}
			pos += need
			t.Events = append(t.Events, e)
		}
	}
	return t, nil
}

func readVLQ(b []byte) (v uint64, n int, ok bool) {
	for n < len(b) && n < 10 {
		c := b[n]
		n++
		v = v<<7 | uint64(c&0x7F)
		if c&0x80 == 0 {
			return v, n, true
		}
	}
	return 0, n, false
}
