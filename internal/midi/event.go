package midi

import (
	"sort"
	"sync"
)

// Event is one complete MIDI message, timestamped and tagged with the device
// it arrived from. It is a fixed 16 bytes so a million of them is 16 MB and a
// ring of them is one contiguous allocation.
//
// Status carries the channel for channel messages (0x90 | ch), and is the
// bare byte for system messages. D1 and D2 are the data bytes; a message with
// fewer than two leaves the rest zero. Clock pulses are never stored as
// Events -- see EventRing.
type Event struct {
	NS     int64  // mono.Now() at the read that delivered it
	Device uint16 // Watcher-assigned id, stable for the device's connection
	Status byte
	D1, D2 byte
	_      [3]byte // pad to 16; keeps the ring's memory arithmetic honest
}

// Channel message kinds, by upper nibble.
const (
	NoteOff         byte = 0x80
	NoteOn          byte = 0x90
	PolyAftertouch  byte = 0xA0
	ControlChange   byte = 0xB0
	ProgramChange   byte = 0xC0
	ChannelPressure byte = 0xD0
	PitchBend       byte = 0xE0
)

// System common bytes the parser has to know the length of.
const (
	SysExStart      byte = 0xF0
	MTCQuarterFrame byte = 0xF1
	SongPosition    byte = 0xF2
	SongSelect      byte = 0xF3
	TuneRequest     byte = 0xF6
	SysExEnd        byte = 0xF7
	ActiveSensing   byte = 0xFE
	SystemReset     byte = 0xFF
)

// IsChannel reports whether the event is a channel voice message.
func (e Event) IsChannel() bool { return e.Status >= 0x80 && e.Status < 0xF0 }

// Kind is the upper nibble for channel messages, or the whole status byte
// otherwise.
func (e Event) Kind() byte {
	if e.IsChannel() {
		return e.Status & 0xF0
	}
	return e.Status
}

// Channel is 0-15 for a channel message and -1 for anything else.
func (e Event) Channel() int {
	if !e.IsChannel() {
		return -1
	}
	return int(e.Status & 0x0F)
}

// IsNoteOn is a note-on with a non-zero velocity. Velocity zero is a note-off
// by the specification, and most keyboards send exactly that under running
// status, so the check has to live in one place.
func (e Event) IsNoteOn() bool { return e.Kind() == NoteOn && e.D2 != 0 }

// IsNoteOff is a note-off, or a note-on at velocity zero.
func (e Event) IsNoteOff() bool {
	return e.Kind() == NoteOff || (e.Kind() == NoteOn && e.D2 == 0)
}

// IsTransport is Start, Continue or Stop.
func (e Event) IsTransport() bool {
	return e.Status == StartByte || e.Status == ContinueByte || e.Status == StopByte
}

// dataLen reports how many data bytes follow a status byte, or -1 for a byte
// that is not a status byte at all. SysEx start is reported as -1 too: it has
// no fixed length and the parser handles it separately.
func dataLen(status byte) int {
	switch {
	case status < 0x80:
		return -1
	case status < 0xC0: // note off, note on, poly aftertouch, control change
		return 2
	case status < 0xE0: // program change, channel pressure
		return 1
	case status < 0xF0: // pitch bend
		return 2
	}
	switch status {
	case MTCQuarterFrame, SongSelect:
		return 1
	case SongPosition:
		return 2
	case TuneRequest, 0xF4, 0xF5:
		return 0
	}
	return -1 // SysEx start/end and realtime
}

// Parser assembles complete messages from a byte stream.
//
// The two rules it exists to get right, because both are easy to get wrong
// and both were seen on this rig:
//
//   - Realtime bytes (0xF8 and above) are single-byte messages that may arrive
//     inside another message. They are handled before anything else and never
//     disturb the message being assembled around them.
//   - Running status: a data byte with no preceding status byte belongs to the
//     last channel status seen. System common messages cancel running status;
//     realtime bytes do not touch it.
//
// SysEx is skipped byte by byte until 0xF7, and counted, because a
// variable-length message has no place in a fixed-size ring and nothing on
// this rig sends one anyone wants in a DAW.
type Parser struct {
	// OnMessage receives every complete channel or system common message.
	OnMessage func(status, d1, d2 byte)
	// OnRealtime receives every realtime byte, clock included, as it arrives.
	OnRealtime func(b byte)

	status  byte // running status, 0 when none
	need    int  // data bytes still wanted for the message in progress
	have    int
	data    [2]byte
	inSysEx bool

	// SysExDropped counts skipped SysEx messages, so a manifest can say so.
	SysExDropped uint64
}

// Feed offers one byte.
func (p *Parser) Feed(b byte) {
	// Realtime first, always. A clock pulse inside a note-on is legal and
	// common: 24 pulses a beat from a device that is also sending notes will
	// land inside a three-byte message routinely.
	if b >= 0xF8 {
		if p.OnRealtime != nil {
			p.OnRealtime(b)
		}
		return
	}

	if p.inSysEx {
		if b == SysExEnd {
			p.inSysEx = false
			p.SysExDropped++
		} else if b >= 0x80 {
			// A status byte inside SysEx terminates it implicitly. Fall through
			// and treat the byte as the start of a new message.
			p.inSysEx = false
			p.SysExDropped++
			p.Feed(b)
		}
		return
	}

	if b >= 0x80 {
		if b == SysExStart {
			p.inSysEx = true
			p.status = 0
			p.have = 0
			return
		}
		n := dataLen(b)
		if n < 0 { // SysExEnd with nothing open, or undefined
			p.status = 0
			p.have = 0
			return
		}
		if b >= 0xF0 {
			// System common: cancels running status and is not itself
			// retained as running status.
			p.status = 0
			if n == 0 {
				p.emit(b, 0, 0)
				return
			}
			p.status = b
			p.need = n
			p.have = 0
			p.data = [2]byte{}
			return
		}
		p.status = b
		p.need = n
		p.have = 0
		p.data = [2]byte{}
		return
	}

	// Data byte.
	if p.status == 0 {
		return // no running status: stray data, drop it
	}
	p.data[p.have] = b
	p.have++
	if p.have == p.need {
		p.emit(p.status, p.data[0], p.data[1])
		p.have = 0
		p.data = [2]byte{}
		if p.status >= 0xF0 {
			// System common does not persist as running status.
			p.status = 0
		}
	}
}

func (p *Parser) emit(status, d1, d2 byte) {
	if p.OnMessage != nil {
		p.OnMessage(status, d1, d2)
	}
}

// EventRing is a bounded ring of Events, written by every device reader and
// read by a save.
//
// Clock pulses are deliberately not stored here. At 24 a beat from every
// device that sends them they would be most of the traffic and none of the
// content; the tempo path has its own ring for the one device whose clock
// matters.
//
// Events from different devices are pushed by different goroutines, so two
// events can be stored slightly out of timestamp order. Between sorts, which
// is where the order actually has to hold.
type EventRing struct {
	mu       sync.Mutex
	buf      []Event
	w        int
	count    int    // occupied slots, saturates at len(buf)
	total    uint64 // pushed ever
	overflow uint64 // evicted before being read out by anyone
}

// NewEventRing sizes the ring in events. A capacity below 1 is raised to 1.
func NewEventRing(capEvents int) *EventRing {
	if capEvents < 1 {
		capEvents = 1
	}
	return &EventRing{buf: make([]Event, capEvents)}
}

// Push stores an event, evicting the oldest when full.
func (r *EventRing) Push(e Event) {
	r.mu.Lock()
	r.buf[r.w] = e
	r.w = (r.w + 1) % len(r.buf)
	if r.count < len(r.buf) {
		r.count++
	} else {
		r.overflow++
	}
	r.total++
	r.mu.Unlock()
}

// Total is the lifetime push count; Overflow is how many were evicted unread.
func (r *EventRing) Total() uint64    { r.mu.Lock(); defer r.mu.Unlock(); return r.total }
func (r *EventRing) Overflow() uint64 { r.mu.Lock(); defer r.mu.Unlock(); return r.overflow }

// Len is the number of events currently held.
func (r *EventRing) Len() int { r.mu.Lock(); defer r.mu.Unlock(); return r.count }

// Between copies out every event with startNS <= NS < endNS, sorted by
// timestamp, ties kept in arrival order.
//
// It walks the whole occupied ring rather than stopping early, because
// cross-goroutine pushes mean the ring is not strictly ordered; a save
// happens a few times a night and a million-element scan is milliseconds.
func (r *EventRing) Between(startNS, endNS int64) []Event {
	r.mu.Lock()
	out := make([]Event, 0, 1024)
	n := len(r.buf)
	start := ((r.w-r.count)%n + n) % n
	for k := 0; k < r.count; k++ {
		e := r.buf[(start+k)%n]
		if e.NS >= startNS && e.NS < endNS {
			out = append(out, e)
		}
	}
	r.mu.Unlock()

	sort.SliceStable(out, func(i, j int) bool { return out[i].NS < out[j].NS })
	return out
}
