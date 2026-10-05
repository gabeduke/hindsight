# Tape on this phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play the loaded tape's mix in a browser as a backing track, with the tape's normal controls, and switch the output between the jam room (Sidekick), this phone, or both (#28, designed in #29).

**Architecture:** A new `tape.Output` sink wraps the device sink and routes each pulled block: to the device, to a stream hub, or both, playing silence on the device in phone mode. The device's callback stays the tape's clock whenever it pulls; a pacer on the Pi's monotonic clock takes over only while the device is quiet. A hub cuts the mix into stamped 20 ms PCM16 packets for one WebSocket listener; the page plays them through an AudioWorklet holding about 0.8 s and shows the heard position from the stamps.

**Tech Stack:** Go 1.23 (gorilla/mux, gorilla/websocket), vanilla ES modules, AudioWorklet, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-tape-on-this-phone-design.md` (canvas: https://claude.ai/artifact/VMQPEjAuaAWtCVykeKoy8J)

## Global Constraints

- Stream format: PCM16 little-endian, stereo, the tape's sample rate (48 kHz), packets of `rate/50` frames (960 = 20 ms).
- Packet header: 24 bytes — `HSTR`, version `1`, flags (bit 0 = playing), 2 reserved, output frame `uint64` LE, tape position `int64` LE (the position at the packet's first frame; when stopped, where it stands).
- Stereo mix: left = bus A left + bus B left, right = bus A right + bus B right (`OutChannels` = 4: A.L, A.R, B.L, B.R), clipped to int16.
- Output modes: `jam`, `phone`, `both`; Hindsight starts in `jam`.
- In `phone` mode, Record/punch, Catch, Tap and StartMixdown return `ErrNeedsJamRoom` ("that needs the jam room: the tape is playing on a phone"), HTTP 409. `both` refuses nothing.
- Switching to `phone` is refused while a track is armed or recording (`ErrRecording`) or a mixdown runs (`ErrMixingDown`).
- One listener at a time; a new one takes the stream and the old one is told `{"type":"moved"}`.
- No listener for 2 s while playing in `phone` mode stops the transport where it is.
- The device sink's callback must never block or allocate on the stream's account (the device thread only copies into a ring).
- Page buffer target 0.8 s, trim band ±50 ms, at most one frame trimmed per 2048 output frames.
- Copy on screen is exactly the canvas's (see the spec's "What the owner sees").
- Go must build without cgo (`CGO_ENABLED=0 go build ./cmd/hindsight`); `go vet ./...` and `go test -race ./...` pass.
- JS tests run with `node --test 'web/static/lib/tape/*.test.js' 'web/static/lib/help/*.test.js'` (CI runs more globs; they must still pass).
- Every new `data-tip` gets a row in `web/static/lib/help/tips.js` and the same row, in the same order, in `docs/guide.md` §9's table.

## Review Focus

- **A listener that stops reading** (phone asleep mid-send): the device thread must never wait on it, and the hub must keep running. → test in Task 5 (`TestAStalledListenerNeverHoldsUpTheTape`).
- **The Sidekick comes back while the pacer is playing** (plugged in mid-song): no frame pulled twice, none skipped, and the engine's frame stays the device's frame plus what the pacer played. → test in Task 3 (`TestThePacerHandsBackToTheDeviceWithoutLosingAFrame`).
- **Switching to This phone with a track armed, or in a count-in:** refused, nothing changes. → test in Task 4 (`TestSwitchingToPhoneIsRefusedWhileATrackIsArmed`).
- **A second phone chooses This phone:** the first is told it moved and stops cleanly; the second plays. → test in Task 5 (`TestASecondListenerTakesTheStream`).
- **A packet that straddles a loop wrap:** the page's heard position wraps to In rather than running past Out. → test in Task 6 (`heard position wraps at the loop's Out`).

---

## File structure

| File | Responsibility |
|---|---|
| `internal/tape/streamwire.go` (new) | Mix to stereo, packet encode/decode |
| `internal/tape/stream.go` (new) | The hub: ring, packets, the one listener, fill |
| `internal/tape/output.go` (new) | The router sink: modes, device callback, pacer, drop-pause, forwarding |
| `internal/tape/engine.go` | Bind the router at Start; `OutputMode`, `SetOutputMode`, `Stream`; `Live` fields; guard helper |
| `internal/tape/align.go` | No lock attempts while the device plays silence |
| `internal/tape/record.go`, `tap.go`, `mixdown.go` | Guards |
| `internal/api/stream.go` (new) | `GET /api/tapes/stream` WebSocket, `PUT /api/tapes/output` |
| `internal/api/api.go`, `internal/api/tape.go` | Routes; 409 mapping |
| `cmd/hindsight/main.go` | Wrap the sink in `tape.NewOutput` |
| `web/static/lib/tape/stream-buffer.js` (new) | Pure: packet parsing, stamp log, heard position, backoff |
| `web/static/lib/tape/stream-worklet.js` (new) | AudioWorklet ring player with drift trim |
| `web/static/lib/tape/stream-player.js` (new) | WebSocket, AudioContext, reconnect, fill reports, wake lock, Media Session |
| `web/static/lib/tape/pending.js` (new) | Pure: mutes/solos asked for but not heard yet |
| `web/static/lib/tape/output-ui.js` (new) | OUT pill, Output sheet, strip, banner, jam-only sheet |
| `web/static/tape.html`, `web/static/styles.css`, `web/static/lib/tape/page.js` | Markup, look, wiring |
| `web/static/lib/help/tips.js`, `docs/guide.md` | Tips and the guide |

---

### Task 1: Mix to stereo and the packet format

**Files:**
- Create: `internal/tape/streamwire.go`
- Test: `internal/tape/streamwire_test.go`

**Interfaces:**
- Produces: `MixStereo(dst []int16, src []int32)`; `EncodePacket(dst []byte, frame uint64, pos int64, playing bool, pcm []int16) []byte`; `DecodePacket(b []byte) (Packet, error)`; `type Packet struct { Frame uint64; Pos int64; Playing bool; PCM []int16 }`; `const PacketHeader = 24`; `ErrBadPacket`.

- [ ] **Step 1: Write the failing tests**

```go
package tape

import (
	"math"
	"testing"
)

func TestMixStereoSumsTheBusesAndClips(t *testing.T) {
	half := int32(math.MaxInt32 / 2)
	src := []int32{
		half, -half, half, -half, // A and B both at half: sums to full scale, clipped
		1 << 16, 2 << 16, 3 << 16, 4 << 16, // small: A.L+B.L = 4, A.R+B.R = 6 (in int16 steps)
	}
	dst := make([]int16, 4)
	MixStereo(dst, src)
	if dst[0] != math.MaxInt16 || dst[1] != math.MinInt16 {
		t.Fatalf("full scale should clip: %v", dst[:2])
	}
	if dst[2] != 4 || dst[3] != 6 {
		t.Fatalf("left = A.L + B.L, right = A.R + B.R: %v", dst[2:])
	}
}

func TestAPacketRoundTrips(t *testing.T) {
	pcm := []int16{1, -1, 300, -300}
	b := EncodePacket(nil, 123456789, 4242, true, pcm)
	if len(b) != PacketHeader+len(pcm)*2 || string(b[:4]) != "HSTR" || b[4] != 1 || b[5] != 1 {
		t.Fatalf("header: % x", b[:8])
	}
	p, err := DecodePacket(b)
	if err != nil {
		t.Fatal(err)
	}
	if p.Frame != 123456789 || p.Pos != 4242 || !p.Playing || len(p.PCM) != 4 || p.PCM[3] != -300 {
		t.Fatalf("%+v", p)
	}
	stopped, _ := DecodePacket(EncodePacket(nil, 1, -1, false, nil))
	if stopped.Playing || stopped.Pos != -1 {
		t.Fatalf("stopped: %+v", stopped)
	}
}

func TestABadPacketIsRefused(t *testing.T) {
	for _, b := range [][]byte{nil, []byte("HSTR"), append([]byte("XXXX"), make([]byte, 20)...)} {
		if _, err := DecodePacket(b); err == nil {
			t.Fatalf("% x should be refused", b)
		}
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/tape -run 'MixStereo|Packet' -v`
Expected: FAIL, `undefined: MixStereo`.

- [ ] **Step 3: Implement**

```go
package tape

import (
	"encoding/binary"
	"errors"
	"math"
)

// The stream to a browser: the tape's mix as stereo PCM16, a packet at a
// time, each stamped with where it is on the tape.

// PacketHeader is the bytes before a packet's samples: "HSTR", the version,
// flags (bit 0: playing), two reserved, the output frame of its first sample
// and the tape position there.
const PacketHeader = 24

const (
	packetVersion = 1
	flagPlaying   = 1
)

var ErrBadPacket = errors.New("not a stream packet")

// Packet is one decoded packet.
type Packet struct {
	Frame   uint64
	Pos     int64
	Playing bool
	PCM     []int16 // stereo, interleaved
}

// MixStereo sums the two buses to stereo, as the Sidekick's faders at unity
// would: left is A.L + B.L, right A.R + B.R, clipped. src is OutChannels
// wide; dst takes two samples a frame. It doesn't allocate: the device's
// thread calls it.
func MixStereo(dst []int16, src []int32) {
	n := len(src) / OutChannels
	for i := 0; i < n; i++ {
		s := src[i*OutChannels : i*OutChannels+4]
		dst[2*i] = clip16((int64(s[0]) + int64(s[2])) >> 16)
		dst[2*i+1] = clip16((int64(s[1]) + int64(s[3])) >> 16)
	}
}

func clip16(v int64) int16 {
	switch {
	case v > math.MaxInt16:
		return math.MaxInt16
	case v < math.MinInt16:
		return math.MinInt16
	}
	return int16(v)
}

// EncodePacket appends a packet to dst.
func EncodePacket(dst []byte, frame uint64, pos int64, playing bool, pcm []int16) []byte {
	var h [PacketHeader]byte
	copy(h[0:4], "HSTR")
	h[4] = packetVersion
	if playing {
		h[5] = flagPlaying
	}
	binary.LittleEndian.PutUint64(h[8:16], frame)
	binary.LittleEndian.PutUint64(h[16:24], uint64(pos))
	dst = append(dst, h[:]...)
	for _, v := range pcm {
		dst = binary.LittleEndian.AppendUint16(dst, uint16(v))
	}
	return dst
}

// DecodePacket reads a packet (tests, and anything that listens in Go).
func DecodePacket(b []byte) (Packet, error) {
	if len(b) < PacketHeader || string(b[0:4]) != "HSTR" || b[4] != packetVersion || (len(b)-PacketHeader)%4 != 0 {
		return Packet{}, ErrBadPacket
	}
	p := Packet{
		Frame:   binary.LittleEndian.Uint64(b[8:16]),
		Pos:     int64(binary.LittleEndian.Uint64(b[16:24])),
		Playing: b[5]&flagPlaying != 0,
	}
	body := b[PacketHeader:]
	p.PCM = make([]int16, len(body)/2)
	for i := range p.PCM {
		p.PCM[i] = int16(binary.LittleEndian.Uint16(body[2*i:]))
	}
	return p, nil
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `go test ./internal/tape -run 'MixStereo|Packet' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/tape/streamwire.go internal/tape/streamwire_test.go
git commit -m "Tape stream: mix the buses to stereo and stamp 20 ms packets"
```

---

### Task 2: The stream hub

**Files:**
- Create: `internal/tape/stream.go`
- Test: `internal/tape/stream_test.go`

**Interfaces:**
- Consumes: `MixStereo`, `EncodePacket`, `DecodePacket` (Task 1).
- Produces:
  - `type Listener interface { Send(pkt []byte) bool; Moved() }`: Send must not block; it reports false once the listener is gone.
  - `NewStream(rate int, posAt func(uint64) (int64, bool)) *Stream`
  - `(*Stream).Push(frame uint64, block []int32)`: the device thread; never blocks.
  - `(*Stream).Attach(l Listener) (detach func())`
  - `(*Stream).Listeners() int`, `(*Stream).Attaches() uint64`, `(*Stream).Rate() int`
  - `(*Stream).SetFill(ms int)`, `(*Stream).FillMS() int`
  - `(*Stream).run(stop <-chan struct{})` and `(*Stream).flush()`: package-internal; `Output` starts `run`, tests call `flush`.

- [ ] **Step 1: Write the failing tests**

```go
package tape

import (
	"sync"
	"testing"
)

// recorder is a listener that keeps what it's sent.
type recorder struct {
	mu    sync.Mutex
	pkts  []Packet
	moved bool
}

func (r *recorder) Send(b []byte) bool {
	p, err := DecodePacket(b)
	if err != nil {
		panic(err)
	}
	r.mu.Lock()
	r.pkts = append(r.pkts, p)
	r.mu.Unlock()
	return true
}
func (r *recorder) Moved() { r.mu.Lock(); r.moved = true; r.mu.Unlock() }
func (r *recorder) got() []Packet {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Packet(nil), r.pkts...)
}

// block is n frames on four channels: bus A left carries the frame number.
func block(from uint64, n int) []int32 {
	b := make([]int32, n*OutChannels)
	for i := 0; i < n; i++ {
		b[i*OutChannels] = int32((from+uint64(i))%30000) << 16
	}
	return b
}

func TestTheHubCutsWhatItsPushedIntoStampedPackets(t *testing.T) {
	s := NewStream(48000, func(o uint64) (int64, bool) { return int64(o) + 1000, true })
	r := &recorder{}
	s.Attach(r)
	for f := uint64(5000); f < 5000+4096; f += 512 {
		s.Push(f, block(f, 512))
	}
	s.flush()
	p := r.got()
	if len(p) != 4 { // 4096 frames make four whole packets of 960
		t.Fatalf("%d packets", len(p))
	}
	for i, k := range p {
		if k.Frame != 5000+uint64(i)*960 || k.Pos != int64(k.Frame)+1000 || !k.Playing || len(k.PCM) != 960*2 {
			t.Fatalf("packet %d: frame %d pos %d", i, k.Frame, k.Pos)
		}
		if got := int(k.PCM[2*10]); got != int((k.Frame+10)%30000) {
			t.Fatalf("packet %d sample 10 = %d", i, got)
		}
	}
	s.Push(9096, block(9096, 1000))
	s.flush()
	if p := r.got(); len(p) != 5 || p[4].Frame != 5000+4*960 {
		t.Fatalf("the remainder should go out next: %d packets", len(p))
	}
}

func TestWithNobodyListeningTheHubKeepsTimeAndSendsNothing(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	s.Push(0, block(0, 4800))
	s.flush()
	r := &recorder{}
	s.Attach(r)
	s.Push(4800, block(4800, 960))
	s.flush() // starts from now, not from what nobody heard
	s.Push(5760, block(5760, 960))
	s.flush()
	p := r.got()
	if len(p) == 0 || p[0].Frame < 4800 {
		t.Fatalf("a new listener starts at the newest audio: %+v", p)
	}
}

func TestANewListenerTakesTheStreamAndTheOldOneIsMoved(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	a, b := &recorder{}, &recorder{}
	detachA := s.Attach(a)
	s.Attach(b)
	if !a.moved || b.moved || s.Listeners() != 1 || s.Attaches() != 2 {
		t.Fatalf("moved %v %v, listeners %d", a.moved, b.moved, s.Listeners())
	}
	detachA() // the old one's handler leaving must not detach the new one
	if s.Listeners() != 1 {
		t.Fatal("detaching the moved listener dropped the new one")
	}
}

func TestTheFillIsForgottenWithItsListener(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	detach := s.Attach(&recorder{})
	s.SetFill(812)
	if s.FillMS() != 812 {
		t.Fatal(s.FillMS())
	}
	detach()
	if s.FillMS() != 0 || s.Listeners() != 0 {
		t.Fatal("a gone listener leaves no fill")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/tape -run 'Hub|Listener|Fill' -v`
Expected: FAIL, `undefined: NewStream`.

- [ ] **Step 3: Implement**

```go
package tape

import (
	"sync"
	"sync/atomic"
	"time"
)

// Listener is where the stream goes: a browser's WebSocket now, a Sonos
// room later. Send must not block, and reports false once it's gone; Moved
// tells it another listener has taken the stream.
type Listener interface {
	Send(pkt []byte) bool
	Moved()
}

// streamRingFrames is how much mixed audio the hub holds: 1.4 s at 48 kHz.
const streamRingFrames = 1 << 16

// Stream is the hub. The device's thread only mixes into the ring (Push);
// the hub's goroutine cuts it into packets, stamps them and sends them on.
type Stream struct {
	rate, step int
	posAt      func(uint64) (int64, bool)

	// ring holds a stereo frame per slot (left in the high 16 bits), indexed
	// by output frame & mask. Atomic, so a reader racing a writer that has
	// lapped it reads a whole frame, never a torn one.
	ring []atomic.Uint32
	head atomic.Uint64 // the output frame after the newest pushed

	mu        sync.Mutex
	l         Listener
	listeners atomic.Int32
	attaches  atomic.Uint64
	fill      atomic.Int32
	pushed    atomic.Bool   // audio has been pushed since the listener attached
	first     atomic.Uint64 // the first frame pushed since then

	// the hub's own, under flushMu (its goroutine, or a test calling flush)
	flushMu sync.Mutex
	started bool
	seen    uint64 // attaches when it started
	next    uint64
	pcm     []int16
}

// NewStream makes a hub for a tape at rate; posAt is the engine's
// transport: the tape position at an output frame, and whether it played.
func NewStream(rate int, posAt func(uint64) (int64, bool)) *Stream {
	step := rate / 50
	return &Stream{rate: rate, step: step, posAt: posAt,
		ring: make([]atomic.Uint32, streamRingFrames), pcm: make([]int16, 2*step)}
}

func (s *Stream) Rate() int        { return s.rate }
func (s *Stream) Listeners() int   { return int(s.listeners.Load()) }
func (s *Stream) Attaches() uint64 { return s.attaches.Load() }
func (s *Stream) SetFill(ms int)   { s.fill.Store(int32(ms)) }
func (s *Stream) FillMS() int      { return int(s.fill.Load()) }

// Push mixes a pulled block, starting at output frame frame, into the ring.
// It runs on the device's thread: no locks, no allocation.
func (s *Stream) Push(frame uint64, block []int32) {
	n := len(block) / OutChannels
	if s.listeners.Load() > 0 {
		if !s.pushed.Load() {
			s.first.Store(frame)
			s.pushed.Store(true)
		}
		var lr [2]int16
		for i := 0; i < n; i++ {
			MixStereo(lr[:], block[i*OutChannels:(i+1)*OutChannels])
			k := (frame + uint64(i)) & (streamRingFrames - 1)
			s.ring[k].Store(uint32(uint16(lr[0]))<<16 | uint32(uint16(lr[1])))
		}
	}
	s.head.Store(frame + uint64(n))
}

// Attach makes l the listener; the one before it is told it moved. detach
// removes l, if it is still the listener.
func (s *Stream) Attach(l Listener) (detach func()) {
	s.mu.Lock()
	old := s.l
	s.l = l
	s.mu.Unlock()
	s.pushed.Store(false)
	s.listeners.Store(1)
	s.attaches.Add(1)
	s.fill.Store(0)
	if old != nil {
		old.Moved()
	}
	return func() {
		s.mu.Lock()
		if s.l == l {
			s.l = nil
			s.listeners.Store(0)
			s.fill.Store(0)
		}
		s.mu.Unlock()
	}
}

func (s *Stream) run(stop <-chan struct{}) {
	t := time.NewTicker(10 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.flush()
		}
	}
}

// flush sends every whole packet the ring holds past the last one sent.
func (s *Stream) flush() {
	s.flushMu.Lock()
	defer s.flushMu.Unlock()
	h := s.head.Load()
	s.mu.Lock()
	l := s.l
	s.mu.Unlock()
	if l == nil {
		s.started = false
		return
	}
	if a := s.attaches.Load(); !s.started || a != s.seen {
		// A new listener: from the first audio pushed since it attached.
		if !s.pushed.Load() {
			return
		}
		s.started, s.seen, s.next = true, a, s.first.Load()
	}
	if h < s.next || h-s.next > streamRingFrames/2 {
		// The hub fell behind the ring: from the newest whole packet.
		s.next = h - min(h, uint64(s.step))
	}
	for h-s.next >= uint64(s.step) {
		for i := 0; i < s.step; i++ {
			v := s.ring[(s.next+uint64(i))&(streamRingFrames-1)].Load()
			s.pcm[2*i], s.pcm[2*i+1] = int16(v>>16), int16(uint16(v))
		}
		pos, playing := s.posAt(s.next)
		l.Send(EncodePacket(nil, s.next, pos, playing, s.pcm))
		s.next += uint64(s.step)
	}
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `go test -race ./internal/tape -run 'Hub|Listener|Fill' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/tape/stream.go internal/tape/stream_test.go
git commit -m "Tape stream: a hub that stamps packets for one listener"
```

---

### Task 3: The output router and the pacer

**Files:**
- Create: `internal/tape/output.go`
- Modify: `internal/tape/engine.go` (`NewEngine` binds the router; a `router()` helper)
- Modify: `internal/tape/align.go` (`alignStep`: no lock attempts while silent)
- Test: `internal/tape/output_test.go`

**Interfaces:**
- Consumes: `Stream` (Task 2); the engine's `delivered`, `sinkBase`, `tr`, `store`, `Do`.
- Produces:
  - `type OutputMode string`; `ModeJam`, `ModePhone`, `ModeBoth`.
  - `NewOutput(dev audio.Sink) audio.Sink`: returns `*Output`, or a `bridgedOutput` that also implements `OutputBridge`, `Restarts` and `LastSlip` when `dev` does.
  - `(*Output).Mode() OutputMode`, `(*Output).setMode(m OutputMode)`, `(*Output).Stream() *Stream`, `(*Output).Silent() bool`, `(*Output).status() StreamStatus`, `(*Output).paceStep()`.
  - `type StreamStatus struct { Listeners int \`json:"listeners"\`; DelayMS int \`json:"delay_ms"\`; State string \`json:"state"\`; Rate int \`json:"rate"\` }` with `State` = `idle` | `playing` | `lost`.
  - `(*Engine).router() *Output`: nil when the sink isn't one.

- [ ] **Step 1: Write the failing tests**

```go
package tape

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// newOutputEngine is newEngine with the loop sink behind an Output, and a
// tape with half-scale audio on bus A looping from bar 1.
func newOutputEngine(t *testing.T) (*Engine, *loopSink, *Output, *Tape) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: NewOutput(sink)})
	tp, err := s.Create("test", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	take := takeWAV(t, 200000, func(int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 96000, 192000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	return e, sink, e.router(), tp
}

func allZero(b []int32) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}

func TestPhoneModeStreamsTheMixAndTheDevicePlaysSilence(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	o.setMode(ModePhone)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 48000); !allZero(out) {
		t.Fatal("the jam room should be silent in phone mode")
	}
	o.Stream().flush()
	p := r.got()
	if len(p) < 45 {
		t.Fatalf("%d packets for a second", len(p))
	}
	for i := 1; i < len(p); i++ {
		if p[i].Frame != p[i-1].Frame+960 {
			t.Fatalf("packet %d at %d after %d", i, p[i].Frame, p[i-1].Frame)
		}
	}
	// 0.5 at -6 dB on bus A: about 0.25 of full scale, 8192 in int16.
	if v := p[len(p)-1].PCM[0]; v < 7800 || v > 8600 || !p[len(p)-1].Playing {
		t.Fatalf("left = %d, playing %v", v, p[len(p)-1].Playing)
	}
}

func TestJamModePlaysTheDeviceAndStreamsNothing(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 9600); allZero(out) {
		t.Fatal("the jam room should play")
	}
	o.Stream().flush()
	if n := len(r.got()); n != 0 {
		t.Fatalf("%d packets in jam mode", n)
	}
}

func TestBothModePlaysTheDeviceAndStreams(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	o.setMode(ModeBoth)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 9600); allZero(out) {
		t.Fatal("the jam room should play in both")
	}
	o.Stream().flush()
	if len(r.got()) < 8 {
		t.Fatal("and the stream should carry it")
	}
}

func TestThePacerPlaysOnlyWhileTheDeviceIsQuiet(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 512) // the device is pulling
	o.paceStep()
	now.Add(int64(100 * time.Millisecond))
	o.paceStep()
	if d := e.delivered.Load(); d != 512 {
		t.Fatalf("the pacer pulled %d frames while the device was pulling", d-512)
	}
}

func TestThePacerHandsBackToTheDeviceWithoutLosingAFrame(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	base := e.sinkBase.Load()
	o.paceStep() // the device has never pulled: the pacer starts its clock
	now.Add(int64(100 * time.Millisecond))
	o.paceStep() // five 20 ms steps
	if d := e.delivered.Load(); d != 4800 {
		t.Fatalf("the pacer delivered %d, want 4800", d)
	}
	if e.sinkBase.Load() != base {
		t.Fatal("sinkBase moves at the handback, not before")
	}
	sink.play(t, 512) // the Sidekick is back
	if d := e.delivered.Load(); d != 4800+512 {
		t.Fatalf("delivered %d after the handback", d)
	}
	if got := e.sinkBase.Load(); got != base+4800 {
		t.Fatalf("sinkBase %d, want %d: engine frame = sinkBase + device frame", got, base+4800)
	}
	if o.handbacks.Load() != 1 || o.lastHandback.Load() != 0 {
		t.Fatalf("one handback, at device frame 0: %d at %d", o.handbacks.Load(), o.lastHandback.Load())
	}
}

func TestAListenerGoneForTwoSecondsStopsThePhonesTape(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	detach := o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	detach()
	o.paceStep()
	now.Add(int64(1900 * time.Millisecond))
	o.paceStep()
	sink.play(t, 4096)
	if !e.tr.Status().Playing {
		t.Fatal("stopped before 2 s")
	}
	now.Add(int64(200 * time.Millisecond))
	o.paceStep()
	sink.play(t, 8192)
	if e.tr.Status().Playing || o.status().State != "lost" {
		t.Fatalf("playing %v, state %q", e.tr.Status().Playing, o.status().State)
	}
	o.Stream().Attach(&recorder{})
	o.paceStep()
	if o.status().State == "lost" {
		t.Fatal("a listener back clears lost")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/tape -run 'PhoneMode|JamMode|BothMode|Pacer|GoneForTwo' -v`
Expected: FAIL, `undefined: NewOutput`.

- [ ] **Step 3: Implement `output.go`**

```go
package tape

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
)

// OutputMode is where the tape plays: the jam room's Sidekick, a phone
// (a browser listening to the stream), or both.
type OutputMode string

const (
	ModeJam   OutputMode = "jam"
	ModePhone OutputMode = "phone"
	ModeBoth  OutputMode = "both"
)

const (
	paceStep    = 20 * time.Millisecond
	deviceQuiet = 200 * time.Millisecond
	dropPause   = 2 * time.Second
	maxCatchUp  = 10 // pacer steps at most per tick: a stalled Pi drops time rather than racing
)

// StreamStatus is the stream as the page shows it.
type StreamStatus struct {
	Listeners int    `json:"listeners"`
	DelayMS   int    `json:"delay_ms"`
	State     string `json:"state"` // idle, playing, lost
	Rate      int    `json:"rate"`
}

// Output stands between the engine and the device. Whenever the device
// pulls, it is the tape's clock, in every mode: its block goes to the
// device, the stream, or both, and in phone mode the device plays silence.
// While the device is quiet (the Sidekick off) and someone listens, a pacer
// on the Pi's clock pulls instead; the frames it pulled move where the
// device's count begins, and its handback counts as a slip.
type Output struct {
	dev    audio.Sink
	eng    *Engine
	stream *Stream
	now    func() int64

	mode  atomic.Value // OutputMode
	drive sync.Mutex   // one puller at a time: the device or the pacer
	pull  func([]int32)
	name  string

	devFrames    atomic.Uint64 // frames the device pulled through us: its own count
	lastDevCall  atomic.Int64  // mono ns of its last callback (0: never)
	pacerOwed    int64         // under drive: frames the pacer pulled since the device last did
	handbacks    atomic.Uint64
	lastHandback atomic.Uint64 // devFrames at the latest handback

	lost         atomic.Bool
	modeAttaches atomic.Uint64 // the stream's attaches when the mode last changed, less any listening then

	// the pacer's own, under paceMu (its goroutine, or a test calling paceStep)
	paceMu    sync.Mutex
	paceAt    int64
	lostSince int64
	scratch   []int32

	stop, done chan struct{}
}

// bridgedOutput is an Output over a device that knows when its output is
// heard and where it slipped: the aligner and the MIDI clock read those
// through it.
type bridgedOutput struct {
	*Output
	b outputSink
}

// NewOutput wraps the tape's device sink.
func NewOutput(dev audio.Sink) audio.Sink {
	o := &Output{dev: dev, now: mono.Now}
	o.mode.Store(ModeJam)
	if b, ok := dev.(outputSink); ok {
		return bridgedOutput{Output: o, b: b}
	}
	return o
}

func (o *Output) router() *Output { return o }

// bind is called by NewEngine: the stream needs the tape's rate and
// transport.
func (o *Output) bind(e *Engine) {
	o.eng = e
	if e.store == nil {
		return // no tapes: no stream
	}
	o.stream = NewStream(e.store.SampleRate(), e.tr.PosAt)
	o.scratch = make([]int32, o.stream.step*OutChannels)
}

func (o *Output) Mode() OutputMode { return o.mode.Load().(OutputMode) }
func (o *Output) Stream() *Stream  { return o.stream }

// Silent says the device is playing silence: nothing to align against.
func (o *Output) Silent() bool { return o.Mode() == ModePhone }

// setMode moves the output. A listener already there when the mode
// changes counts as heard, so its leaving can stop the tape.
func (o *Output) setMode(m OutputMode) {
	o.mode.Store(m)
	o.modeAttaches.Store(o.stream.Attaches() - uint64(o.stream.Listeners()))
	o.lost.Store(false)
}

func (o *Output) Open(channels int, pull func([]int32)) (string, error) {
	o.pull = pull
	name, err := o.dev.Open(channels, o.devPull)
	if err != nil {
		return "", err
	}
	o.name = name
	if o.stream == nil {
		return name, nil // no tapes: the device alone
	}
	o.stop, o.done = make(chan struct{}), make(chan struct{})
	go o.stream.run(o.stop)
	go o.paceLoop()
	return name, nil
}

func (o *Output) Close() {
	if o.stop != nil {
		close(o.stop)
		<-o.done
		o.stop = nil
	}
	o.dev.Close()
}

// Name is the device's name while it plays, else the one Open got; "stream"
// while only the stream plays.
func (o *Output) Name() string {
	n := o.name
	if d, ok := o.dev.(interface{ Name() string }); ok {
		n = d.Name()
	}
	if n == "" && o.Mode() != ModeJam && o.stream != nil && o.stream.Listeners() > 0 {
		return "stream"
	}
	return n
}

// Delta passes on a device that knows its own Δ (the demo's).
func (o *Output) Delta() (int64, bool) {
	if kd, ok := o.dev.(audio.KnownDelta); ok {
		return kd.Delta()
	}
	return 0, false
}

func (b bridgedOutput) OutputBridge() *audio.ClockBridge { return b.b.OutputBridge() }
func (b bridgedOutput) Restarts() uint64                 { return b.b.Restarts() + b.handbacks.Load() }

// LastSlip is the latest of the device's own slips and the pacer's handbacks.
func (b bridgedOutput) LastSlip() uint64 {
	s := b.lastHandback.Load()
	if sp, ok := b.b.(slipPlacer); ok {
		s = max(s, sp.LastSlip())
	}
	return s
}

// devPull is the device's callback.
func (o *Output) devPull(out []int32) {
	o.lastDevCall.Store(o.now())
	n := uint64(len(out) / OutChannels)
	if !o.drive.TryLock() {
		// The pacer is mid-pull: this period plays silence, and the engine
		// didn't deliver it, so the device's count runs ahead of the engine's.
		clear(out)
		o.devFrames.Add(n)
		o.eng.sinkBase.Add(-int64(n))
		o.lastHandback.Store(o.devFrames.Load())
		o.handbacks.Add(1)
		return
	}
	defer o.drive.Unlock()
	if o.pacerOwed != 0 {
		o.eng.sinkBase.Add(o.pacerOwed) // engine frame = sinkBase + device frame, again
		o.pacerOwed = 0
		o.lastHandback.Store(o.devFrames.Load())
		o.handbacks.Add(1)
	}
	start := o.eng.delivered.Load()
	o.pull(out)
	o.devFrames.Add(n)
	if o.stream == nil {
		return
	}
	switch o.Mode() {
	case ModePhone:
		o.stream.Push(start, out)
		clear(out)
	case ModeBoth:
		o.stream.Push(start, out)
	}
}

func (o *Output) paceLoop() {
	defer close(o.done)
	t := time.NewTicker(paceStep)
	defer t.Stop()
	for {
		select {
		case <-o.stop:
			return
		case <-t.C:
			o.eng.safely(o.paceStep)
		}
	}
}

// paceStep pulls the 20 ms steps that have passed while the device is quiet
// and someone listens, and stops a phone's tape whose listener has gone.
func (o *Output) paceStep() {
	o.paceMu.Lock()
	defer o.paceMu.Unlock()
	now := o.now()
	o.watchDrop(now)
	quiet := now-o.lastDevCall.Load() >= int64(deviceQuiet)
	if o.Mode() == ModeJam || o.stream.Listeners() == 0 || !quiet {
		o.paceAt = 0
		return
	}
	if o.paceAt == 0 {
		o.paceAt = now
		return
	}
	steps := (now - o.paceAt) / int64(paceStep)
	if steps <= 0 {
		return
	}
	o.paceAt += steps * int64(paceStep)
	steps = min(steps, maxCatchUp)
	if !o.drive.TryLock() {
		return
	}
	defer o.drive.Unlock()
	for i := int64(0); i < steps; i++ {
		start := o.eng.delivered.Load()
		o.pull(o.scratch)
		o.pacerOwed += int64(o.stream.step)
		o.stream.Push(start, o.scratch)
	}
}

func (o *Output) watchDrop(now int64) {
	heard := o.stream.Attaches() > o.modeAttaches.Load()
	if o.Mode() != ModePhone || o.stream.Listeners() > 0 || !heard {
		o.lostSince = 0
		o.lost.Store(false)
		return
	}
	if o.lostSince == 0 {
		o.lostSince = now
		return
	}
	if now-o.lostSince >= int64(dropPause) && !o.lost.Load() {
		o.lost.Store(true)
		if o.eng.tr.Status().Playing {
			o.eng.Do(Action{Kind: "stop"})
		}
	}
}

func (o *Output) status() StreamStatus {
	st := StreamStatus{Listeners: o.stream.Listeners(), DelayMS: o.stream.FillMS(), State: "idle", Rate: o.stream.Rate()}
	switch {
	case o.lost.Load():
		st.State = "lost"
	case st.Listeners > 0 && o.Mode() != ModeJam:
		st.State = "playing"
	}
	return st
}
```

`paceLoop` runs `paceStep` through `e.safely` because the pacer pulls the engine; `safely` already exists on the engine. A test may call `paceStep` while the goroutine runs: `paceMu` keeps them apart, and the totals come out the same whoever takes a step.

- [ ] **Step 4: Bind the router in the engine, and add `router()`**

In `internal/tape/engine.go`, `NewEngine`, after `e.mix.Store(&Mix{})` (the tests attach listeners and set modes before `Start`, and `bind` needs only `e.store` and `e.tr`):

```go
	if b, ok := e.sink.(interface{ bind(*Engine) }); ok {
		b.bind(e)
	}
```

Add after `HasOutput`:

```go
// router is the tape's Output, if its sink is one.
func (e *Engine) router() *Output {
	if r, ok := e.sink.(interface{ router() *Output }); ok {
		return r.router()
	}
	return nil
}
```

- [ ] **Step 5: No lock attempts while the device plays silence**

In `internal/tape/align.go`, `alignStep`, change the `due :=` statement to:

```go
	due := (how == "estimated" && time.Since(a.lastTry) > 2*time.Second ||
		how == "locked" && time.Since(a.lastTry) > 10*time.Second) && !e.outputSilent()
```

and add:

```go
// outputSilent says the device is playing silence (the tape is on a phone):
// there's nothing of the tape's in the capture to lock on to.
func (e *Engine) outputSilent() bool {
	r := e.router()
	return r != nil && r.Silent()
}
```

- [ ] **Step 6: Run the tests**

Run: `go test -race ./internal/tape -v -run 'PhoneMode|JamMode|BothMode|Pacer|GoneForTwo'` then `go test -race ./internal/tape`
Expected: PASS, and every existing tape test still passes.

- [ ] **Step 7: Commit**

```bash
git add internal/tape/output.go internal/tape/output_test.go internal/tape/engine.go internal/tape/align.go
git commit -m "Tape output: route to the jam room, a phone or both; pace while the Sidekick is away"
```

---

### Task 4: Output mode on the engine, the guards, and `Live`

**Files:**
- Modify: `internal/tape/engine.go` (errors, `OutputMode`, `SetOutputMode`, `Stream`, `jamOnly`, `Live`)
- Modify: `internal/tape/record.go` (`Record`), `internal/tape/tap.go` (`Tap`), `internal/tape/mixdown.go` (`StartMixdown`), `internal/tape/engine.go` (`Catch`)
- Test: `internal/tape/output_test.go`

**Interfaces:**
- Consumes: `Output`, `StreamStatus`, `router()` (Task 3).
- Produces:
  - `var ErrNeedsJamRoom = errors.New("that needs the jam room: the tape is playing on a phone")`
  - `var ErrNoStream = errors.New("this tape's output can't stream")`
  - `(*Engine).OutputMode() OutputMode` (`ModeJam` without a router)
  - `(*Engine).SetOutputMode(m OutputMode) error`: `ErrBadParameter` for an unknown mode, `ErrNoStream`, `ErrRecording`, `ErrMixingDown`
  - `(*Engine).Stream() *Stream` (nil without a router)
  - `Live.OutputMode string \`json:"output_mode,omitempty"\``, `Live.Stream *StreamStatus \`json:"stream,omitempty"\``

- [ ] **Step 1: Write the failing tests** (append to `output_test.go`)

```go
func TestPhoneModeRefusesWhatNeedsTheJamRoom(t *testing.T) {
	e, _, _, tp := newOutputEngine(t)
	if err := e.SetOutputMode(ModePhone); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Record(tp.ID, 2, "main", false); !errors.Is(err, ErrNeedsJamRoom) {
		t.Fatalf("Record: %v", err)
	}
	if _, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "main", Pass: 1}); !errors.Is(err, ErrNeedsJamRoom) {
		t.Fatalf("Catch: %v", err)
	}
	if _, err := e.Tap(tp.ID, 2, "main", 0); !errors.Is(err, ErrNeedsJamRoom) {
		t.Fatalf("Tap: %v", err)
	}
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrNeedsJamRoom) {
		t.Fatalf("StartMixdown: %v", err)
	}
	if err := e.SetOutputMode(ModeBoth); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "main", Pass: 1}); errors.Is(err, ErrNeedsJamRoom) {
		t.Fatal("both refuses nothing")
	}
}

func TestSwitchingToPhoneIsRefusedWhileATrackIsArmed(t *testing.T) {
	e, _, _, tp := newOutputEngine(t)
	if _, err := e.Record(tp.ID, 2, "main", false); err != nil {
		t.Fatal(err)
	}
	if err := e.SetOutputMode(ModePhone); !errors.Is(err, ErrRecording) {
		t.Fatalf("switching with a track armed: %v", err)
	}
	if e.OutputMode() != ModeJam {
		t.Fatal("a refused switch changes nothing")
	}
	if err := e.SetOutputMode("radio"); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("unknown mode: %v", err)
	}
}

func TestLiveSaysWhereTheTapePlays(t *testing.T) {
	e, _, _, _ := newOutputEngine(t)
	l := e.Live()
	if l.OutputMode != "jam" || l.Stream == nil || l.Stream.State != "idle" || l.Stream.Rate != 48000 {
		t.Fatalf("%+v %+v", l.OutputMode, l.Stream)
	}
	if err := e.SetOutputMode(ModePhone); err != nil {
		t.Fatal(err)
	}
	e.Stream().Attach(&recorder{})
	e.Stream().SetFill(790)
	l = e.Live()
	if l.OutputMode != "phone" || l.Stream.Listeners != 1 || l.Stream.DelayMS != 790 || l.Stream.State != "playing" {
		t.Fatalf("%+v %+v", l.OutputMode, l.Stream)
	}
}

func TestWithoutARouterTheOutputIsTheJamRoom(t *testing.T) {
	e, _, _ := newEngine(t) // a plain sink
	if e.OutputMode() != ModeJam || e.Stream() != nil || e.Live().Stream != nil {
		t.Fatal("no router: jam, no stream")
	}
	if err := e.SetOutputMode(ModePhone); !errors.Is(err, ErrNoStream) {
		t.Fatalf("%v", err)
	}
}
```

Add `"errors"` to the test file's imports.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/tape -run 'RefusesWhatNeeds|SwitchingToPhone|LiveSays|WithoutARouter' -v`
Expected: FAIL, `undefined: ErrNeedsJamRoom`.

- [ ] **Step 3: Implement**

In `engine.go`, add to the `var (...)` block of errors:

```go
	ErrNeedsJamRoom = errors.New("that needs the jam room: the tape is playing on a phone")
	ErrNoStream     = errors.New("this tape's output can't stream")
```

Add after `router()`:

```go
// OutputMode is where the tape plays.
func (e *Engine) OutputMode() OutputMode {
	if r := e.router(); r != nil {
		return r.Mode()
	}
	return ModeJam
}

// Stream is the tape's stream hub, or nil.
func (e *Engine) Stream() *Stream {
	if r := e.router(); r != nil {
		return r.Stream()
	}
	return nil
}

// SetOutputMode moves the tape's output. The transport plays on from where
// it is. A phone can't take the tape while a track is armed or recording, or
// a mixdown plays: those are the jam room's.
func (e *Engine) SetOutputMode(m OutputMode) error {
	switch m {
	case ModeJam, ModePhone, ModeBoth:
	default:
		return fmt.Errorf("%w: no output %q", ErrBadParameter, m)
	}
	r := e.router()
	if r == nil || r.Stream() == nil {
		return ErrNoStream
	}
	if m == ModePhone {
		if e.Recording() != nil {
			return ErrRecording
		}
		if e.mixdownBusy() {
			return ErrMixingDown
		}
	}
	r.setMode(m)
	return nil
}

// jamOnly refuses what needs the jam room while the tape plays on a phone.
func (e *Engine) jamOnly() error {
	if e.OutputMode() == ModePhone {
		return ErrNeedsJamRoom
	}
	return nil
}
```

In `Live()`, after `l.Clock = e.ClockStatus()`:

```go
	if r := e.router(); r != nil && r.Stream() != nil {
		l.OutputMode = string(r.Mode())
		st := r.status()
		l.Stream = &st
	}
```

and add the two fields to `Live`:

```go
	OutputMode string        `json:"output_mode,omitempty"` // jam, phone or both
	Stream     *StreamStatus `json:"stream,omitempty"`      // the stream to a phone
```

Guards, each as the first statement of the method:

```go
	if err := e.jamOnly(); err != nil {
		return Recording{}, err // record.go, Record
	}
```

```go
	if err := e.jamOnly(); err != nil {
		return Clip{}, err // engine.go, Catch
	}
```

```go
	if err := e.jamOnly(); err != nil {
		return TapResult{}, err // tap.go, Tap
	}
```

```go
	if err := e.jamOnly(); err != nil {
		return Mixdown{}, err // mixdown.go, StartMixdown
	}
```

- [ ] **Step 4: Run the tests**

Run: `go test -race ./internal/tape`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/tape
git commit -m "Tape output: the engine's output mode, the jam room's guards, and live state"
```

---

### Task 5: The stream endpoint, the output endpoint, and wiring

**Files:**
- Create: `internal/api/stream.go`
- Modify: `internal/api/api.go` (routes, after `/api/tapes/listen`)
- Modify: `internal/api/tape.go` (`tapeErr`: 409 for `ErrNeedsJamRoom`, `ErrNoStream`)
- Modify: `cmd/hindsight/main.go` (`startTape`)
- Test: `internal/api/stream_test.go`

**Interfaces:**
- Consumes: `Engine.Stream`, `Engine.SetOutputMode`, `Engine.OutputMode`, `Listener`, `NewOutput` (Tasks 2–4).
- Produces: `GET /api/tapes/stream` (WebSocket) and `PUT /api/tapes/output`.
  - Server → page, text: `{"type":"hello","rate":48000,"mode":"phone"}` on connect; `{"type":"mode","mode":"jam"}` when it changes; `{"type":"moved"}` before closing a moved listener.
  - Server → page, binary: packets (Task 1).
  - Page → server, text: `{"type":"fill","ms":812}`.
  - `PUT /api/tapes/output` body `{"mode":"phone"}` → 200 `{"mode":"phone"}`; 400 for an unknown mode; 409 with `{"error": …}` when refused.

- [ ] **Step 1: Write the failing tests**

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// pullSink is a device the test pulls by hand.
type pullSink struct {
	mu   sync.Mutex
	pull func([]int32)
}

func (s *pullSink) Open(_ int, p func([]int32)) (string, error) {
	s.mu.Lock()
	s.pull = p
	s.mu.Unlock()
	return "test", nil
}
func (s *pullSink) Close() {}
func (s *pullSink) play(frames int) {
	for i := 0; i < frames; i += 960 {
		s.mu.Lock()
		p := s.pull
		s.mu.Unlock()
		p(make([]int32, 960*tape.OutChannels))
	}
}

func newStreamServer(t *testing.T) (*httptest.Server, *tape.Engine, *pullSink) {
	t.Helper()
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	dev := &pullSink{}
	eng := tape.NewEngine(tape.Options{Store: store, Sink: tape.NewOutput(dev)})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	a := New(&config.Config{OutputDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}, nil, nil, nil, nil)
	a.SetTape(eng)
	t.Cleanup(a.WaitBackground)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, eng, dev
}

func dialStream(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/tapes/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	t.Cleanup(func() { c.Close() })
	return c
}

func putOutput(t *testing.T, srv *httptest.Server, mode string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/tapes/output", strings.NewReader(`{"mode":"`+mode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func readJSON(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	for {
		mt, b, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if mt == websocket.TextMessage {
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			return m
		}
	}
}

func TestTheStreamSaysHelloAndCarriesPackets(t *testing.T) {
	srv, _, dev := newStreamServer(t)
	if code := putOutput(t, srv, "phone"); code != 200 {
		t.Fatalf("PUT output: %d", code)
	}
	c := dialStream(t, srv)
	if m := readJSON(t, c); m["type"] != "hello" || m["rate"] != float64(48000) || m["mode"] != "phone" {
		t.Fatalf("hello: %v", m)
	}
	dev.play(9600)
	for {
		mt, b, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if mt == websocket.BinaryMessage {
			if _, err := tape.DecodePacket(b); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
}

func TestTheFillReportIsTheDelay(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	putOutput(t, srv, "phone")
	c := dialStream(t, srv)
	readJSON(t, c)
	if err := c.WriteMessage(websocket.TextMessage, []byte(`{"type":"fill","ms":805}`)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for eng.Live().Stream.DelayMS != 805 {
		if time.Now().After(deadline) {
			t.Fatalf("delay %d", eng.Live().Stream.DelayMS)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestASecondListenerTakesTheStream(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	putOutput(t, srv, "phone")
	first := dialStream(t, srv)
	readJSON(t, first)
	second := dialStream(t, srv)
	readJSON(t, second)
	if m := readJSON(t, first); m["type"] != "moved" {
		t.Fatalf("first got %v", m)
	}
	if n := eng.Live().Stream.Listeners; n != 1 {
		t.Fatalf("%d listeners", n)
	}
}

func TestAStalledListenerNeverHoldsUpTheTape(t *testing.T) {
	srv, _, dev := newStreamServer(t)
	putOutput(t, srv, "phone")
	c := dialStream(t, srv)
	readJSON(t, c) // then never read again
	done := make(chan struct{})
	go func() { dev.play(48000 * 30); close(done) }() // 30 s of audio, pulled as fast as it goes
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the device's pulls waited on a listener that stopped reading")
	}
}

func TestTheOutputEndpointRefusesAndExplains(t *testing.T) {
	srv, _, _ := newStreamServer(t)
	if code := putOutput(t, srv, "radio"); code != 400 {
		t.Fatalf("unknown mode: %d", code)
	}
	r, _ := newTapeAPI(t) // no output at all
	w := send(t, r, http.MethodPut, "/api/tapes/output", `{"mode":"phone"}`)
	want(t, w, http.StatusConflict, "no stream")
}
```

If `send`'s signature in `flags_test.go` differs from `(t, r, method, url, body string)`, adapt the last test's call to it.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./internal/api -run 'Stream|Fill|SecondListener|Stalled|OutputEndpoint' -v`
Expected: FAIL, 404 or 405 from the missing routes.

- [ ] **Step 3: Implement `internal/api/stream.go`**

```go
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/websocket"
)

// The tape's mix to a browser: GET /api/tapes/stream is a WebSocket of
// stamped PCM16 packets (tape.EncodePacket), with JSON text messages for
// hello, mode and moved; the page reports its buffer as {"type":"fill"}.
// PUT /api/tapes/output moves the tape between the jam room, a phone, both.

// wsListener queues packets for the connection's writer. Send never blocks:
// a full queue loses its oldest packet.
type wsListener struct {
	out   chan []byte
	moved chan struct{}
	once  sync.Once
}

func newWSListener() *wsListener {
	return &wsListener{out: make(chan []byte, 64), moved: make(chan struct{})}
}

func (l *wsListener) Send(p []byte) bool {
	for {
		select {
		case l.out <- p:
			return true
		default:
		}
		select {
		case <-l.out:
		default:
		}
	}
}

func (l *wsListener) Moved() { l.once.Do(func() { close(l.moved) }) }

func (a *API) handleTapeStream(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	st := a.tape.Stream()
	if st == nil {
		tapeErr(w, tape.ErrNoStream)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[!] stream websocket upgrade: %v", err)
		return
	}
	defer conn.Close()
	l := newWSListener()
	detach := st.Attach(l)
	defer detach()

	write := func(mt int, b []byte) error {
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteMessage(mt, b)
	}
	sendJSON := func(v any) error {
		b, _ := json.Marshal(v)
		return write(websocket.TextMessage, b)
	}
	mode := a.tape.OutputMode()
	if err := sendJSON(map[string]any{"type": "hello", "rate": st.Rate(), "mode": mode}); err != nil {
		return
	}

	gone := make(chan struct{})
	go func() {
		defer close(gone)
		conn.SetReadLimit(1024)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })
		for {
			_, b, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(pongWait))
			var m struct {
				Type string `json:"type"`
				MS   int    `json:"ms"`
			}
			if json.Unmarshal(b, &m) == nil && m.Type == "fill" && m.MS >= 0 && m.MS < 60000 {
				st.SetFill(m.MS)
			}
		}
	}()

	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()
	modeCheck := time.NewTicker(500 * time.Millisecond)
	defer modeCheck.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-gone:
			return
		case <-l.moved:
			_ = sendJSON(map[string]string{"type": "moved"})
			return
		case p := <-l.out:
			if err := write(websocket.BinaryMessage, p); err != nil {
				return
			}
		case <-modeCheck.C:
			if m := a.tape.OutputMode(); m != mode {
				mode = m
				if err := sendJSON(map[string]any{"type": "mode", "mode": m}); err != nil {
					return
				}
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (a *API) handleTapeOutput(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "send {\"mode\": \"jam\", \"phone\" or \"both\"}")
		return
	}
	if err := a.tape.SetOutputMode(tape.OutputMode(body.Mode)); err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mode": body.Mode})
}
```

Routes in `api.go`, after the `/api/tapes/listen` line:

```go
	r.HandleFunc("/api/tapes/stream", a.handleTapeStream).Methods(http.MethodGet)
	r.HandleFunc("/api/tapes/output", a.handleTapeOutput).Methods(http.MethodPut)
```

In `tape.go`'s `tapeErr`, add `errors.Is(err, tape.ErrNeedsJamRoom), errors.Is(err, tape.ErrNoStream)` to the 409 case.

- [ ] **Step 4: Wire the router in `cmd/hindsight/main.go`**

In `startTape`, after the `if demo { … } else { … }` that picks `sink`:

```go
	if sink != nil {
		// Between the engine and the device: the output can move to a phone.
		sink = tape.NewOutput(sink)
	}
```

- [ ] **Step 5: Run everything**

Run: `go vet ./... && go test -race ./... && CGO_ENABLED=0 go build ./cmd/hindsight`
Expected: all pass, and the build without cgo succeeds.

- [ ] **Step 6: Try it on the demo**

Run: `go run ./cmd/hindsight -demo` (with the env a demo normally uses), then:

```bash
curl -s -X PUT localhost:8080/api/tapes/output -H 'Content-Type: application/json' -d '{"mode":"phone"}'
```

Expected: `{"mode":"phone"}`, and `GET /api/tapes/state` shows `"output_mode":"phone"` and a `stream` object. (The port is whatever the demo listens on.)

- [ ] **Step 7: Commit**

```bash
git add internal/api/stream.go internal/api/stream_test.go internal/api/api.go internal/api/tape.go cmd/hindsight/main.go
git commit -m "Tape stream: a WebSocket to the page, and PUT /api/tapes/output"
```

---

### Task 6: The page's stream bookkeeping

**Files:**
- Create: `web/static/lib/tape/stream-buffer.js`
- Test: `web/static/lib/tape/stream-buffer.test.js`

**Interfaces:**
- Produces:
  - `parsePacket(buf: ArrayBuffer) → { frame, pos, playing, pcm: Int16Array } | null`
  - `class StampLog { add(index, pkt); at(index, loop) → { frame, pos, playing } | null }`: `index` counts stream frames queued to the worklet; `loop` is `{ in, out, on }` from the tape.
  - `heardIndex({ rd, at }, now, rate, latencyS) → number`: `rd` is the worklet's read index, `at` its `currentTime` at the report.
  - `nextBackoff(ms) → number`: 0 → 500, doubling to 5000.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePacket, StampLog, heardIndex, nextBackoff } from './stream-buffer.js';

function packet(frame, pos, playing, frames = 4) {
  const b = new ArrayBuffer(24 + frames * 4);
  const v = new DataView(b);
  'HSTR'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint8(4, 1);
  v.setUint8(5, playing ? 1 : 0);
  v.setBigUint64(8, BigInt(frame), true);
  v.setBigInt64(16, BigInt(pos), true);
  v.setInt16(24, 1234, true);
  return b;
}

test('a packet parses', () => {
  const p = parsePacket(packet(96000, 4800, true));
  assert.deepEqual([p.frame, p.pos, p.playing, p.pcm.length, p.pcm[0]], [96000, 4800, true, 8, 1234]);
  assert.equal(parsePacket(new ArrayBuffer(10)), null);
});

test('the heard position runs on from the last stamp', () => {
  const log = new StampLog();
  log.add(0, { frame: 1000, pos: 5000, playing: true });
  log.add(960, { frame: 1960, pos: 5960, playing: true });
  assert.deepEqual(log.at(1000, null), { frame: 2000, pos: 6000, playing: true });
  assert.equal(log.at(-5, null), null);
});

test('heard position wraps at the loop\'s Out', () => {
  const log = new StampLog();
  log.add(0, { frame: 0, pos: 95500, playing: true });
  const loop = { in: 0, out: 96000, on: true };
  assert.equal(log.at(400, loop).pos, 95900);
  assert.equal(log.at(700, loop).pos, 200);
});

test('stopped, the position stands', () => {
  const log = new StampLog();
  log.add(0, { frame: 0, pos: 777, playing: false });
  assert.equal(log.at(500, null).pos, 777);
});

test('the heard index is the read index, plus time since, less the output latency', () => {
  assert.equal(heardIndex({ rd: 48000, at: 10 }, 10.5, 48000, 0.02), 48000 + 24000 - 960);
});

test('reconnects back off to five seconds', () => {
  assert.deepEqual([0, 500, 1000, 2000, 4000].map(nextBackoff), [500, 1000, 2000, 4000, 5000]);
  assert.equal(nextBackoff(5000), 5000);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test web/static/lib/tape/stream-buffer.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// The stream's bookkeeping on the page: which output frame and tape
// position the speaker is playing, from the packets' stamps. The worklet
// plays the audio; this knows what it is.

const HEADER = 24;

export function parsePacket(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER || (buf.byteLength - HEADER) % 4) return null;
  const v = new DataView(buf);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'HSTR' || v.getUint8(4) !== 1) return null;
  return {
    frame: Number(v.getBigUint64(8, true)),
    pos: Number(v.getBigInt64(16, true)),
    playing: (v.getUint8(5) & 1) === 1,
    pcm: new Int16Array(buf, HEADER),
  };
}

// StampLog keeps each packet's stamp against the stream index of its first
// frame: how many frames had been queued to the worklet before it.
export class StampLog {
  constructor(max = 512) { this.max = max; this.marks = []; }

  add(index, { frame, pos, playing }) {
    this.marks.push({ index, frame, pos, playing });
    if (this.marks.length > this.max) this.marks.splice(0, this.marks.length - this.max);
  }

  clear() { this.marks = []; }

  // at is the stamp for stream index i, run on from the packet it's in.
  at(i, loop) {
    let m = null;
    for (let k = this.marks.length - 1; k >= 0; k--) if (this.marks[k].index <= i) { m = this.marks[k]; break; }
    if (!m) return null;
    const d = i - m.index;
    if (!m.playing) return { frame: m.frame + d, pos: m.pos, playing: false };
    let pos = m.pos + d;
    if (loop && loop.on && m.pos < loop.out && pos >= loop.out) pos = loop.in + (pos - loop.out);
    return { frame: m.frame + d, pos, playing: true };
  }
}

export function heardIndex({ rd, at }, now, rate, latencyS) {
  return rd + Math.round((now - at) * rate) - Math.round(latencyS * rate);
}

export function nextBackoff(ms) { return Math.min(5000, ms ? ms * 2 : 500); }
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test web/static/lib/tape/stream-buffer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/tape/stream-buffer.js web/static/lib/tape/stream-buffer.test.js
git commit -m "Tape stream: the page's stamp log and heard position"
```

---

### Task 7: The worklet and the player

**Files:**
- Create: `web/static/lib/tape/stream-worklet.js`
- Create: `web/static/lib/tape/stream-player.js`
- Modify: `web/static/sw.js` only if it lists module files to precache (add the two new files beside `lib/tape/away-sheet.js` if it does)

**Interfaces:**
- Consumes: `parsePacket`, `StampLog`, `heardIndex`, `nextBackoff` (Task 6); `holdScreen` from `../wakelock.js`.
- Produces: `class StreamPlayer`:
  - `new StreamPlayer({ onState, onTransport, onReconnect, getLoop, title })`. `onState(state)` gets `'buffering'|'playing'|'lost'|'moved'|'locked'|'off'`; `onTransport(kind)` gets `'play'|'stop'` from the Media Session; `onReconnect()` runs when a lost stream says hello again; `getLoop()` returns the tape's `{ in, out, on }`.
  - `start()`: call from a tap (it makes the AudioContext).
  - `stop()`, `heard() → { pos, playing, frame } | null`, `delayMs() → number`, `get active`, `get state`.

- [ ] **Step 1: Write the worklet**

```js
// Plays the tape's stream: stereo PCM16 fed over the port into a ring, held
// at about 0.8 s, trimmed a frame at a time to follow the Pi's clock. It
// reports its read index so the page knows what is being heard.
const TARGET_S = 0.8, BAND_S = 0.05, EVERY = 2048, SIZE = 1 << 17, MASK = SIZE - 1;

class HindsightStream extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(SIZE);
    this.r = new Float32Array(SIZE);
    this.w = 0; this.rd = 0; this.since = 0; this.started = false; this.lastReport = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cmd === 'reset') { this.w = this.rd = 0; this.started = false; return; }
      const pcm = d.pcm;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        this.l[this.w & MASK] = pcm[i] / 32768;
        this.r[this.w & MASK] = pcm[i + 1] / 32768;
        this.w++;
      }
      if (this.w - this.rd > SIZE - 4096) this.rd = this.w - Math.round(TARGET_S * sampleRate); // overrun: keep the newest
    };
  }

  process(_in, outputs) {
    const [L, R] = outputs[0];
    const n = L.length, target = TARGET_S * sampleRate, band = BAND_S * sampleRate;
    let fill = this.w - this.rd;
    if (!this.started && fill >= target) this.started = true;
    if (!this.started || fill < n) {
      L.fill(0); if (R) R.fill(0);
      if (this.started) { this.started = false; this.port.postMessage({ underrun: true }); }
    } else {
      this.since += n;
      if (this.since >= EVERY) {
        this.since = 0;
        if (fill > target + band) this.rd++;          // the Pi runs fast: skip a frame
        else if (fill < target - band) this.rd--;     // slow: play one twice
      }
      for (let i = 0; i < n; i++) {
        L[i] = this.l[this.rd & MASK];
        if (R) R[i] = this.r[this.rd & MASK];
        this.rd++;
      }
      fill = this.w - this.rd;
    }
    if (currentTime - this.lastReport >= 0.05) {
      this.lastReport = currentTime;
      this.port.postMessage({ rd: this.rd, at: currentTime, fill, started: this.started });
    }
    return true;
  }
}

registerProcessor('hindsight-stream', HindsightStream);
```

- [ ] **Step 2: Write the player**

```js
// The tape, played here: the stream's WebSocket into an AudioWorklet, with
// reconnects, the fill reported to the Pi, the screen held on and the lock
// screen's play and pause.
import { parsePacket, StampLog, heardIndex, nextBackoff } from './stream-buffer.js';
import { holdScreen } from '../wakelock.js';

export class StreamPlayer {
  constructor({ onState = () => {}, onTransport = () => {}, onReconnect = () => {}, getLoop = () => null, title = 'Tape' } = {}) {
    Object.assign(this, { onState, onTransport, onReconnect, getLoop, title });
    this.wasLost = false;
    this.log = new StampLog();
    this.queued = 0; this.report = null; this.ws = null; this.ctx = null; this.node = null;
    this._state = 'off'; this.backoff = 0; this.wake = null; this.stopped = true;
  }

  get active() { return !this.stopped; }
  get state() { return this._state; }

  setState(s) { if (s !== this._state) { this._state = s; this.onState(s); } }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    this.ctx.onstatechange = () => {
      if (!this.stopped && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) this.setState('locked');
    };
    await this.ctx.audioWorklet.addModule('/lib/tape/stream-worklet.js');
    this.node = new AudioWorkletNode(this.ctx, 'hindsight-stream', { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => {
      const d = e.data;
      if (d.underrun) { this.setState('buffering'); return; }
      this.report = d;
      if (d.started && this._state === 'buffering') this.setState('playing');
    };
    this.node.connect(this.ctx.destination);
    this.wake = holdScreen({});
    this.mediaSession();
    this.fillTimer = setInterval(() => this.sendFill(), 500);
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.setState('buffering');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/tapes/stream`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        if (m.type === 'hello') {
          this.backoff = 0; this.reset();
          if (this.wasLost) { this.wasLost = false; this.onReconnect(); }
        }
        if (m.type === 'moved') { this.stop('moved'); }
        if (m.type === 'mode' && m.mode === 'jam') this.stop('off');
        return;
      }
      const p = parsePacket(e.data);
      if (!p) return;
      this.log.add(this.queued, p);
      this.queued += p.pcm.length / 2;
      this.node.port.postMessage({ pcm: p.pcm }, [p.pcm.buffer]);
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.setState('lost');
      this.wasLost = true;
      this.backoff = nextBackoff(this.backoff);
      setTimeout(() => this.connect(), this.backoff);
    };
  }

  reset() {
    this.log.clear(); this.queued = 0; this.report = null;
    this.node.port.postMessage({ cmd: 'reset' });
  }

  sendFill() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'fill', ms: this.delayMs() }));
  }

  // What the speaker is playing now.
  heard() {
    if (!this.report || !this.ctx) return null;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.log.at(heardIndex(this.report, this.ctx.currentTime, this.ctx.sampleRate, lat), this.getLoop());
  }

  delayMs() {
    if (!this.report || !this.ctx) return 0;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.round((this.report.fill / this.ctx.sampleRate + lat) * 1000);
  }

  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.title, artist: 'Hindsight' });
    navigator.mediaSession.setActionHandler('play', () => this.onTransport('play'));
    navigator.mediaSession.setActionHandler('pause', () => this.onTransport('stop'));
  }

  stop(state = 'off') {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.fillTimer);
    const ws = this.ws; this.ws = null;
    if (ws) ws.close();
    if (this.ctx) this.ctx.close();
    this.ctx = this.node = null;
    if (this.wake) this.wake.release();
    this.wake = null;
    this.setState(state);
  }
}
```

Note: `p.pcm` is a view into the message's `ArrayBuffer` at byte offset 24; transferring `p.pcm.buffer` moves the whole message, which is fine, because the stamp was copied first. `holdScreen({})` returns `{ release }` (`lib/wakelock.js`).

- [ ] **Step 3: Check it on the demo by hand**

Run the demo (Task 5, Step 6). In a browser console on `/tape.html`, run:

```js
const { StreamPlayer } = await import('/lib/tape/stream-player.js');
await fetch('/api/tapes/output', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"phone"}' });
const p = new StreamPlayer({ onState: console.log });
await p.start(); // from a click, if the browser insists
```

Expected: `buffering`, then `playing` about 0.8 s later; press ▶ on the page and the tape is heard in the browser; `p.heard()` advances; `p.delayMs()` is about 800.

- [ ] **Step 4: Commit**

```bash
git add web/static/lib/tape/stream-worklet.js web/static/lib/tape/stream-player.js web/static/sw.js
git commit -m "Tape stream: the page's player, an AudioWorklet holding 0.8 s"
```

---

### Task 8: The OUT menu, the Output sheet, and the downstairs banner

**Files:**
- Create: `web/static/lib/tape/output-ui.js`
- Modify: `web/static/tape.html` (pill, sheet, strip, banner)
- Modify: `web/static/styles.css`
- Modify: `web/static/lib/tape/page.js` (create and render it)
- Modify: `web/static/lib/help/tips.js`, `docs/guide.md` (§8.10 and §9)

**Interfaces:**
- Consumes: `StreamPlayer` (Task 7); `api`, `toast`, `poll`, `transport` in `page.js`; live `output_mode`, `stream` (Task 4).
- Produces: `initOutput({ api, toast, poll, transport, getTape, getGhost }) → { render(live), player, streamingHere() }` (`getGhost` returns Task 9's pending locate, `{ pos, until }`, or null; until Task 9, pass `() => null`).

- [ ] **Step 1: Markup.** In `tape.html`, inside `.tape-title`, after the tempo pill's `menu-anchor`:

```html
      <span class="menu-anchor">
        <button id="tape-out" class="tape-pill tape-out" type="button" aria-haspopup="dialog" data-tip="tape-out"><span class="pill-ico pill-out" aria-hidden="true">OUT</span><span id="tape-out-text" class="pill-text">Jam room</span><span class="pill-chev" aria-hidden="true">▾</span></button>
      </span>
```

After `</header>`:

```html
<div id="out-banner" class="out-banner" role="status" hidden>
  <span class="out-led on"></span>
  <span class="out-banner-text"><b id="out-banner-what">Tape 1 is playing on a phone</b>, <span id="out-banner-delay">0.8 s</span> behind. The jam room is silent, so Rec and Catch are off.</span>
  <button id="out-jam" class="icon-btn primary" type="button" data-tip="out-jam">Play in the jam room</button>
</div>
```

Directly after the element `#tape-machine`:

```html
<div id="out-strip" class="out-strip" role="status" hidden>
  <span id="out-strip-led" class="out-led"></span>
  <span id="out-strip-text">Ready on this phone</span>
  <span id="out-strip-right" class="mono"></span>
</div>
```

Beside `#away-sheet`:

```html
<dialog class="sheet" id="out-sheet" aria-labelledby="out-title">
  <div class="sheet-inner out-inner">
    <h3 id="out-title">Output</h3>
    <p class="sheet-hint">Where <span id="out-tape-name">this tape</span> plays. Switching keeps the tape rolling from the same spot.</p>
    <div class="out-choices" role="group" aria-label="Output">
      <button type="button" class="out-choice" data-mode="jam" aria-pressed="true" data-tip="out-choice"><b>Jam room</b><span>Through the Sidekick downstairs. Rec, Catch and mixdown work.</span><span class="out-led"></span></button>
      <button type="button" class="out-choice" data-mode="phone" aria-pressed="false" data-tip="out-choice"><b>This phone</b><span>A backing track here, about 0.8 s behind. The jam room stays silent.</span><span class="out-led"></span></button>
      <button type="button" class="out-choice" data-mode="both" aria-pressed="false" data-tip="out-choice"><b>Both</b><span>The jam room plays and records as usual; this phone hears it 0.8 s late.</span><span class="out-led"></span></button>
    </div>
    <p id="out-measured" class="out-measured" hidden><span id="out-delay" class="lcd mono">0.8 s</span> late, measured. The playhead and meters here move back by this much, so what you see is what you hear.</p>
    <p class="sheet-hint">One phone at a time: choosing This phone on another device moves the tape there.</p>
    <div class="sheet-actions"><button class="icon-btn" id="out-close" type="button">Done</button></div>
  </div>
</dialog>
```

The banner's key reads **Play in the jam room**, not the canvas's "Play it here": the page can't tell the jam-room laptop from a laptop upstairs, and "here" would mean the stream on the latter.

- [ ] **Step 2: `output-ui.js`**

```js
// Where the tape plays: the OUT pill, the Output sheet, the status strip
// under the deck, and the banner other devices show while a phone has it.
import { StreamPlayer } from './stream-player.js';
import { barBeat } from './geometry.js';

const NAMES = { jam: 'Jam room', phone: 'Phone', both: 'Both' };
const $ = (id) => document.getElementById(id);

export function initOutput({ api, toast, poll, transport, getTape, getGhost = () => null }) {
  const sheet = $('out-sheet');
  let live = null;
  let wasPlaying = false; // the tape was playing here when the stream was last fine
  const player = new StreamPlayer({
    onState: (s) => {
      if (s === 'moved') toast(`${(getTape() && getTape().name) || 'The tape'} moved to another device`, 'warn');
      render(live);
    },
    onTransport: (kind) => transport(kind),
    // The Pi stopped the tape when the stream dropped (2 s): play on from there.
    onReconnect: () => { if (wasPlaying) transport('play'); },
    getLoop: () => { const t = getTape(); return t && t.loop; },
    title: (getTape() && getTape().name) || 'Tape',
  });

  async function setMode(mode) {
    // The audio starts inside the tap that chose it, before any await: a
    // phone's browser only lets a tap start sound.
    const starting = mode !== 'jam' && !player.active ? player.start() : null;
    try {
      await api('/api/tapes/output', { method: 'PUT', body: { mode } });
      await starting;
      if (mode === 'jam') player.stop();
      setTimeout(poll, 100);
    } catch (e) {
      if (starting) player.stop();
      toast(e.message, 'bad');
    }
  }

  $('tape-out').addEventListener('click', () => {
    const t = getTape();
    $('out-tape-name').textContent = (t && t.name) || 'this tape';
    sheet.showModal();
  });
  $('out-close').addEventListener('click', () => sheet.close());
  for (const b of sheet.querySelectorAll('.out-choice')) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('out-jam').addEventListener('click', () => setMode('jam'));

  const ghostNow = () => { const g = getGhost(); return g && performance.now() < g.until && getTape() && getTape().grid ? g : null; };

  function render(l) {
    live = l;
    if (player.state === 'playing') wasPlaying = !!(l && l.playing);
    const mode = (l && l.output_mode) || 'jam';
    const st = (l && l.stream) || {};
    const here = player.active;
    const delay = `${((here ? player.delayMs() : st.delay_ms) / 1000 || 0.8).toFixed(1)} s`;
    $('tape-out').hidden = !(l && l.output_mode);
    $('tape-out-text').textContent = NAMES[mode];
    for (const b of sheet.querySelectorAll('.out-choice')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    $('out-measured').hidden = mode === 'jam';
    $('out-delay').textContent = delay;
    // Another device has the tape: say so, and offer it back.
    const elsewhere = mode === 'phone' && !here;
    $('out-banner').hidden = !elsewhere;
    $('out-banner-delay').textContent = delay;
    // This device has it: the strip.
    const strip = $('out-strip');
    strip.hidden = !(here && mode !== 'jam');
    if (!strip.hidden) {
      const s = player.state;
      const wait = s === 'buffering' || s === 'lost' || s === 'locked';
      $('out-strip-led').className = `out-led ${wait ? 'wait' : 'on'}`;
      $('out-strip-text').textContent =
        s === 'buffering' ? 'Starting on this phone…'
        : s === 'lost' ? `Stream lost · paused at ${(l && getTape() && barBeat(l.heard, getTape().grid)) || 'the same spot'}`
        : s === 'locked' ? 'Paused when the screen locked'
        : ghostNow() ? `Moving to bar ${barBeat(ghostNow().pos, getTape().grid) || ''}…`
        : l && l.playing ? 'Playing on this phone' : 'Ready on this phone';
      $('out-strip-right').textContent = s === 'buffering' ? 'buffering' : s === 'lost' ? 'reconnecting'
        : ghostNow() ? `in ${delay}` : `${delay} behind`;
    }
  }

  return { render, player, streamingHere: () => player.active && !!live && live.output_mode !== 'jam' };
}
```

`barBeat` (from `geometry.js`) is what the deck's position readout already uses.

- [ ] **Step 3: Wire it in `page.js`.** Import it at the top:

```js
import { initOutput } from './output-ui.js';
```

In `wire()`, after the other `initAway(...)` call:

```js
  output = initOutput({ api, toast, poll, transport, getTape: () => state.tape, getGhost: () => ghost });
```

declare `let output = null;` and `let ghost = null; // a locate seen but not yet heard (Task 9)` beside `let machine = null;`, and at the end of `render()`:

```js
  if (output) output.render(state.live);
```

- [ ] **Step 4: Styles** (in `styles.css`, beside the `.tape-pill` rules; reuse the existing tokens):

```css
.pill-out { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 11px; letter-spacing: .16em; color: var(--ink-dim); }
.out-strip, .out-banner { display: flex; align-items: center; gap: 10px; padding: 0 12px; min-height: 40px; border-radius: 10px;
  background: var(--well); color: var(--well-ink); box-shadow: inset 0 2px 5px rgba(0,0,0,.6), 0 1px 0 var(--hl); font-size: 13.5px; }
.out-strip[hidden], .out-banner[hidden] { display: none; }
.out-banner { border-radius: 0; min-height: 56px; padding: 0 20px; font-size: 14.5px; }
.out-banner-text { flex: 1; min-width: 0; }
#out-strip-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#out-strip-right { color: #ffb547; text-shadow: 0 0 7px rgba(255,181,71,.6); font-size: 12px; font-weight: 600; }
.out-led { width: 8px; height: 8px; border-radius: 50%; background: var(--led-off); flex: none; }
.out-led.on, .out-choice[aria-pressed="true"] .out-led { background: var(--go); box-shadow: 0 0 0 2px var(--go-ring), 0 0 7px var(--go-glow); }
.out-led.wait { background: var(--warn); box-shadow: 0 0 0 2px var(--warn-ring), 0 0 7px var(--warn-glow); animation: recblink 1s steps(2) infinite; }
.out-choices { display: flex; flex-direction: column; gap: 8px; }
.out-choice { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; align-items: center; text-align: left; min-height: 72px; padding: 12px 14px; }
.out-choice b { font-family: 'Barlow Condensed', sans-serif; font-size: 17px; letter-spacing: .12em; text-transform: uppercase; }
.out-choice span:not(.out-led) { grid-column: 1; font-size: 13px; color: var(--ink-dim); }
.out-choice .out-led { grid-column: 2; grid-row: 1 / span 2; }
.out-measured { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--ink-dim); }
```

If `styles.css` has a key look for `.out-choice` to borrow (`.icon-btn`, `.key`), add that class in the markup instead of restyling. If `recblink` isn't defined in `styles.css`, define it: `@keyframes recblink { 50% { opacity: .35 } }`.

- [ ] **Step 5: Tips and the guide.** In `tips.js`, after the `lock-dot` row:

```js
  { control: 'OUT (tape)', ids: ['tape-out'], tip: 'Where the tape plays: the jam room, this phone, or both. Switching keeps it rolling from the same spot' },
  { control: 'Jam room / This phone / Both', ids: ['out-choice'], tip: 'The jam room plays through the Sidekick and records; this phone plays a backing track here, about 0.8 s behind; both does both' },
  { control: 'Play in the jam room', ids: ['out-jam'], tip: 'Take the tape back from the phone: the jam room plays it from the same spot, and Rec and Catch come back' },
```

In `docs/guide.md` §9's table, after the `Lock dot` row, the same three rows:

```markdown
| OUT (tape) | Where the tape plays: the jam room, this phone, or both. Switching keeps it rolling from the same spot |
| Jam room / This phone / Both | The jam room plays through the Sidekick and records; this phone plays a backing track here, about 0.8 s behind; both does both |
| Play in the jam room | Take the tape back from the phone: the jam room plays it from the same spot, and Rec and Catch come back |
```

In `docs/guide.md`, after §8.9 and before `## 9.`, add:

```markdown
### 8.10 Taking the tape upstairs

The tape can play on your phone as a backing track, anywhere in the house.
Tap **OUT** in the tape's header and choose **This phone**: the jam room goes
silent, and the tape plays here about 0.8 s behind. Everything on the tape
works as usual — play, locate, the loop, mute, solo, levels — and the
playhead and meters are moved back to match what you hear, so a mute shows
`in 0.8 s` until you hear it.

Rec and Catch wait for the jam room: you hear the tape late up here, so a pass
would land off the beat. For an idea, use **Overdub on this device** (8.8).
When you're back downstairs, tap **Play in the jam room** on the laptop or the
bench, or choose **Jam room** under OUT: the tape plays on from the same spot.

**Both** plays the jam room as usual and sends the phone a copy, for when
someone is listening elsewhere while you record.

One phone at a time. If the Wi-Fi drops for 2 s, the tape stops where it was;
the page reconnects and plays on.
```

If guide §9 says how many tips there are, bump the count.

- [ ] **Step 6: Run the JS tests**

Run: `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'`
Expected: PASS, including `help.test.js` (the guide table matches `TIPS`, every `data-tip` has a tip, and the `#810-taking-the-tape-upstairs` anchor resolves if anything links to it).

- [ ] **Step 7: Check it on the demo**

Open `/tape.html` on the demo in two browsers. In the first, OUT → This phone: the strip appears ("Starting on this phone…", then "Playing on this phone · 0.8 s behind" once ▶ is pressed), the sound plays in that browser, and the second shows the banner. **Play in the jam room** in the second: the banner goes, and the first's strip goes.

- [ ] **Step 8: Commit**

```bash
git add web/static/tape.html web/static/styles.css web/static/lib/tape/output-ui.js web/static/lib/tape/page.js web/static/lib/help/tips.js docs/guide.md
git commit -m "Tape page: the OUT menu, the Output sheet, the strip and the banner"
```

---

### Task 9: Playing here — the heard playhead, pending mutes, and the jam room's guards

**Files:**
- Create: `web/static/lib/tape/pending.js`
- Test: `web/static/lib/tape/pending.test.js`
- Modify: `web/static/lib/tape/page.js` (`apply`, `feedMachine`, lane render, `rec`, `doCatch`, `tap`, `mixdown`, the catch panel)
- Modify: `web/static/tape.html` (the jam-only sheet, the panel's one-line notice)
- Modify: `web/static/styles.css`
- Modify: `scripts/smoke-tape.mjs`

**Interfaces:**
- Consumes: `initOutput(...).streamingHere()`, `.player.heard()`, `.player.delayMs()` (Task 8).
- Produces: `class Pending { ask(n, before, delayMs, now); heard(n, current, now) → { mute, solo }; pending(n, now) → boolean }`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pending } from './pending.js';

test('a mute is heard after the delay, and shown at once', () => {
  const p = new Pending();
  p.ask(2, { mute: false, solo: false }, 800, 1000);
  assert.equal(p.pending(2, 1500), true);
  assert.deepEqual(p.heard(2, { mute: true, solo: false }, 1500), { mute: false, solo: false });
  assert.equal(p.pending(2, 1801), false);
  assert.deepEqual(p.heard(2, { mute: true, solo: false }, 1801), { mute: true, solo: false });
});

test('asking again keeps what was heard and moves the time on', () => {
  const p = new Pending();
  p.ask(1, { mute: false, solo: false }, 800, 0);
  p.ask(1, { mute: true, solo: false }, 800, 500); // un-mute before the mute was heard
  assert.deepEqual(p.heard(1, { mute: false, solo: false }, 1000), { mute: false, solo: false });
  assert.equal(p.pending(1, 1299), true);
  assert.equal(p.pending(1, 1301), false);
});

test('a track nobody asked about is as it is', () => {
  assert.deepEqual(new Pending().heard(3, { mute: true, solo: false }, 0), { mute: true, solo: false });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test web/static/lib/tape/pending.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `pending.js`**

```js
// Mutes and solos asked for on a page that hears the tape late: the key
// lights at once, but the track sounds as before until the change reaches
// the speaker.
export class Pending {
  constructor() { this.marks = new Map(); }

  ask(n, before, delayMs, now) {
    const m = this.marks.get(n);
    if (m && now < m.until) m.until = now + delayMs;
    else this.marks.set(n, { mute: !!before.mute, solo: !!before.solo, until: now + delayMs });
  }

  pending(n, now) {
    const m = this.marks.get(n);
    return !!m && now < m.until;
  }

  heard(n, current, now) {
    const m = this.marks.get(n);
    if (m && now < m.until) return { mute: m.mute, solo: m.solo };
    this.marks.delete(n);
    return { mute: !!current.mute, solo: !!current.solo };
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test web/static/lib/tape/pending.test.js`
Expected: PASS.

- [ ] **Step 5: The heard position.** In `page.js`'s `apply(s)`, after `state.live = s.live || null;`:

```js
  // On this phone, show what's heard: everything that draws the playhead
  // reads live.heard.
  if (state.live && output && output.streamingHere()) {
    const h = output.player.heard();
    if (h) state.live.heard = h.pos;
  }
```

Between polls the reels already run on from `heard`, so nothing else moves.

- [ ] **Step 6: Pending mutes and solos.** In `page.js`, import `Pending`, make `const pending = new Pending();`, and change the two lane handlers at the `lane.mute` / `lane.solo` `addEventListener` lines to note the ask first:

```js
      lane.mute.addEventListener('click', () => { askHeard(n); patch({ track: { n, mute: !track(n).mute } }); });
      lane.solo.addEventListener('click', () => { askHeard(n); patch({ track: { n, solo: !track(n).solo } }); });
```

with:

```js
function askHeard(n) {
  if (!output || !output.streamingHere()) return;
  const tr = track(n);
  pending.ask(n, { mute: tr.mute, solo: tr.solo }, output.player.delayMs(), performance.now());
}

// heardTracks is the tracks as the speaker plays them now.
function heardTracks() {
  const now = performance.now();
  return state.tape.tracks.map((tr) => ({ ...tr, ...pending.heard(tr.n, tr, now) }));
}
```

In `feedMachine`, use `heardTracks()` for the levels:

```js
  const tracks = heardTracks();
  const anySolo = tracks.some((tr) => tr.solo);
  …
    levels: (frame) => tracks.map((tr) => levelAt(tr, frame, peaksOf, t.sample_rate, anySolo)),
```

In the lane render loop (where `lane.mute.setAttribute('aria-pressed', …)` is), add:

```js
    const ht = heardTracks().find((x) => x.n === tr.n);
    const heardSolo = heardTracks().some((x) => x.solo);
    lane.row.classList.toggle('unheard', !!ht && (ht.mute || (heardSolo && !ht.solo)));
    lane.row.classList.toggle('pending', pending.pending(tr.n, performance.now()));
    lane.row.dataset.pending = output ? `in ${(output.player.delayMs() / 1000).toFixed(1)} s` : '';
```

and in `styles.css`:

```css
.lane.unheard canvas { opacity: .35; }
.lane.pending .tt-name::after { content: attr(data-pending); margin-left: 8px; font: 11px 'IBM Plex Mono', monospace; color: var(--ink-dim); }
```

(Use the lane row's real class: if the row isn't `.lane`, match the selector to what `buildLanes()` creates, and put the `::after` on the element beside the M/S keys.) Keep the existing muted look driven by `aria-pressed`: the key shows the ask; `unheard` shows the sound.

- [ ] **Step 7: The locate marker.** A locate on this phone is seen at once and heard later. In `page.js`, Task 8 declared `ghost` and passes `getGhost: () => ghost`; set it to `{ pos, until }` in `transport()` before the request when the action is a locate and the tape plays here:

```js
  if (action === 'locate' && output && output.streamingHere()) {
    ghost = { pos: extra.pos, until: performance.now() + output.player.delayMs() };
  }
```

In `drawRuler()`, after the playhead's triangle is drawn, while `ghost && performance.now() < ghost.until`, draw a hollow triangle at `xOf(ghost.pos, view, W)` with the accent colour (`ctx.strokeStyle` = the `--accent` token the ruler already reads, `lineWidth = 1.6`, the same triangle path as the playhead's, stroked, not filled). In the lane drawing, where the playhead line is drawn at `xOf(state.live.heard, view, W)`, draw a dashed line (`ctx.setLineDash([4, 4])`) at the ghost's x in the same colour, then `ctx.setLineDash([])`. Clear `ghost` once `performance.now() >= ghost.until`. In `output-ui.js`, take a `getGhost()` option and, while it returns one, show the strip as `Moving to bar ${barBeat(ghost.pos, grid)}…` with `in ${delay}` on the right (the canvas's "Moving to bar 3… · in 0.8 s").

- [ ] **Step 8: The jam room's guards.** In `tape.html`, beside `#out-sheet`:

```html
<dialog class="sheet" id="jam-only" aria-labelledby="jam-only-title">
  <div class="sheet-inner">
    <h3 id="jam-only-title">Rec and Catch need the jam room</h3>
    <p>This phone hears the tape about <span id="jam-only-delay">0.8 s</span> late, so anything played along up here would land off the beat. To try an idea here, use <b>Overdub on this device</b>.</p>
    <div class="sheet-actions">
      <button class="icon-btn" id="jam-only-close" type="button">Not now</button>
      <button class="icon-btn primary" id="jam-only-switch" type="button" data-tip="out-jam">Switch to the jam room</button>
    </div>
  </div>
</dialog>
```

and, as the first child of the panel that holds `#sources`, `#catch-pass` and `#passes`:

```html
<p id="jam-only-note" class="jam-only-note" hidden>Rec, Catch and the passes wait for the jam room: this phone hears the tape late, so a pass would land off the beat. <a href="#" id="jam-only-change">Change the output</a></p>
```

In `page.js`, a guard used by `rec()`, `doCatch()`, `tap()` and `mixdown()` as their first line (`if (jamOnly()) return;`):

```js
// jamOnly explains, and refuses, what needs the jam room while the tape
// plays on a phone.
function jamOnly() {
  if (!state.live || state.live.output_mode !== 'phone') return false;
  $('jam-only-delay').textContent = `${((output ? output.player.delayMs() : 800) / 1000).toFixed(1)} s`;
  $('jam-only').showModal();
  return true;
}
```

wire the sheet in `wire()`:

```js
  $('jam-only-close').addEventListener('click', () => $('jam-only').close());
  $('jam-only-switch').addEventListener('click', () => { $('jam-only').close(); $('tape-out').click(); });
  $('jam-only-change').addEventListener('click', (e) => { e.preventDefault(); $('tape-out').click(); });
```

and in `render()`, after the existing Rec and catch disable rules:

```js
  const phoneOut = !!(live && live.output_mode === 'phone');
  $('rec').setAttribute('aria-disabled', String(phoneOut));
  $('rec').classList.toggle('dim', phoneOut);
  $('catch-pass').classList.toggle('jam-only', phoneOut);
  $('catch-pass').textContent = phoneOut ? 'Catch · jam room only' : 'Catch the last pass';
  $('jam-only-note').hidden = !phoneOut;
  for (const id of ['sources', 'catch-bars', 'catch-mode', 'passes']) $(id).hidden = phoneOut;
  $('lock-dot').classList.toggle('none', phoneOut);
```

`#catch-pass` must stay clickable in phone mode (so `jamOnly()` can explain): if `render()` sets `$('catch-pass').disabled` earlier, make that rule `&& !phoneOut`. In `styles.css`:

```css
.dim { opacity: .5; }
#catch-pass.jam-only { background: none; color: var(--ink-dim); border: 1px solid var(--edge); box-shadow: none; }
.jam-only-note { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--field); font-size: 13px; color: var(--ink-dim); }
```

The lock dot's grey state: if the `.dot.lock` styles have no grey ("none") class, use the class `page.js` sets when `aligned === 'none'` (see the lock-dot logic in `render()`).

- [ ] **Step 9: A smoke step.** In `scripts/smoke-tape.mjs`, add a step after the existing ones, in its own style:

1. `PUT /api/tapes/output {"mode":"phone"}`.
2. Reload the tape page, and assert `#out-banner` is visible (this browser isn't listening).
3. Click `#rec`, and assert `#jam-only` is open.
4. Close it, and assert `#jam-only-note` is visible.
5. `PUT /api/tapes/output {"mode":"jam"}`, and assert the banner hides within two polls.

- [ ] **Step 10: Run every test**

Run: `go test -race ./... && node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'`
Then, with a demo running: `HINDSIGHT_URL=http://localhost:8080 node scripts/smoke-tape.mjs`
Expected: all pass.

- [ ] **Step 11: Check it on a phone (the rig)**

On the phone over Tailscale: OUT → This phone, ▶. Then:
- Mute track 1: the key lights at once, `in 0.8 s` shows, and the sound and the lane's dimming follow together.
- Tap the ruler at bar 3: the playhead jumps when the sound does.
- Rec: the sheet explains.
- Five minutes playing: no dropout, and the delay readout stays within 0.75–0.85 s.
- Turn Wi-Fi off for 5 s and on again: the tape stops, the strip says "Stream lost", and the stream plays on from there.
- Downstairs, **Play in the jam room**: the Sidekick plays from the same spot.

- [ ] **Step 12: Commit**

```bash
git add web/static scripts/smoke-tape.mjs
git commit -m "Tape page: play here with the heard playhead, pending mutes, and the jam room's guards"
```

---

## After the plan

- The `[rig]` checks (Task 9, Step 10) go in the issue (#28) when it is closed.
- Phase 2 (Sonos) gets its own spec; the `Listener` interface (Task 2) is where it plugs in.
