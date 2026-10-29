package tape

import (
	"math"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// Latency, measured in use (docs/plan/the-instrument.md, step 1; decision
// 0016): every control a hand plays carries its times to the moment it is
// heard, and the Pi keeps the numbers. They are never sent anywhere else.
//
// A control is stamped as it reaches the engine (Press, Set, Release and
// PreviewMod, through their Stamped forms), and again by the render
// goroutine with the output frame it applies it at. That second stamp is
// the only thing the render path does: a few atomic stores into a ring
// made with the engine, no lock and no allocation
// (TestTimingAllocatesNothing). A collector off the render path reads the
// ring four times a second and, once a frame has gone to the device, asks
// the output's clock bridge when it is heard (heardAt), or, for a phone
// listening, the phone's own report of the frame it is playing (HearOnPhone).
//
// A control that waited for a grid line (a press quantised to a 16th,
// landing on a line still to come) is counted apart and not timed: its wait
// is the music's, not the machine's. One that lands late on its line goes
// out at once, so it is timed. One applied where the device played silence
// (a render that fell behind) was never heard, and isn't timed either.

// Via is the way a control came in.
type Via uint8

const (
	ViaNone Via = iota // not timed: a test, an HTTP call
	ViaPage            // a page's Play socket (GET /api/tapes/play)
	ViaMIDI            // a controller plugged into the Pi
)

func (v Via) String() string {
	switch v {
	case ViaPage:
		return "page"
	case ViaMIDI:
		return "midi"
	}
	return ""
}

// Stamp is what a control says of its own times: the way it came, and, from
// a page, the touch and the send on the Pi's clock (mono ns, by the page's
// clock offset; 0 where it doesn't say). Its arrival the engine stamps
// itself.
type Stamp struct {
	Via   Via
	Touch int64
	Sent  int64
}

// latSlots is how many stamped controls the ring holds between two
// collections: a quarter of a second of a flood of knob moves at 30 a
// second a pad is far fewer.
const latSlots = 512

// latKeep is how many of the latest controls each path's figures are of.
const latKeep = 256

// latEvery is how often the collector reads the ring.
const latEvery = 250 * time.Millisecond

// earFresh is how old a phone's report of what it plays may be and still
// place a frame in time.
const earFresh = 3 * time.Second

// latSlot is one control, applied. Every field is atomic so the collector
// may read a slot the render goroutine is lapping, and throw it away.
type latSlot struct {
	via, arrived, touch, sent, frame atomic.Int64
}

// latRing is written by the render goroutine alone.
type latRing struct {
	n         atomic.Uint64
	quantised atomic.Uint64
	slots     [latSlots]latSlot
}

func (r *latRing) add(st Stamp, arrived int64, frame uint64) {
	i := r.n.Load()
	s := &r.slots[i%latSlots]
	s.via.Store(int64(st.Via))
	s.arrived.Store(arrived)
	s.touch.Store(st.Touch)
	s.sent.Store(st.Sent)
	s.frame.Store(int64(frame))
	r.n.Store(i + 1)
}

// latEvent is a slot, read out.
type latEvent struct {
	via                  Via
	arrived, touch, sent int64
	frame                uint64
}

// Ear is a phone's report of what it plays: output frame Frame is heard on
// it at At (mono ns, by its clock offset), with its jitter buffer FillMS
// full and its audio output OutputMS behind (AudioContext.outputLatency),
// and Underruns since it began listening.
type Ear struct {
	Frame     uint64
	At        int64
	FillMS    float64
	OutputMS  float64
	Underruns uint64
}

// latSample is one control's times, in ms; NaN where it didn't say.
type latSample struct {
	total, touchToSend, sendToPi, piToEar float64
}

// latPath is the latest controls on one way to one ear.
type latPath struct {
	n    int // ever
	keep [latKeep]latSample
}

func (p *latPath) add(s latSample) {
	p.keep[p.n%latKeep] = s
	p.n++
}

// latency is the engine's: the ring, and the collector's view of it.
type latency struct {
	ring latRing

	mu      sync.Mutex
	cursor  uint64     // the next ring slot to read
	pending []latEvent // read, not yet heard
	missed  uint64     // lapped in the ring, or never heard
	paths   map[string]*latPath
	ear     Ear
	earAt   int64 // mono ns the ear was reported
}

// timed is the render goroutine's stamp: a control drained with the render
// head at drain, applied at output frame out. Atomics only.
func (e *Engine) timed(st Stamp, arrived int64, drain, out uint64) {
	if st.Via == ViaNone {
		return
	}
	if out != drain {
		e.lat.ring.quantised.Add(1)
		return
	}
	e.lat.ring.add(st, arrived, out)
}

// HearOnPhone takes a listening phone's report of what it plays.
func (e *Engine) HearOnPhone(ear Ear) {
	e.lat.mu.Lock()
	e.lat.ear, e.lat.earAt = ear, e.now()
	e.lat.mu.Unlock()
}

// startLatency runs the collector until the engine stops.
func (e *Engine) startLatency() {
	go func() {
		t := time.NewTicker(latEvery)
		defer t.Stop()
		for {
			select {
			case <-e.stop:
				return
			case <-t.C:
				e.safely(e.collectLatency)
			}
		}
	}()
}

// collectLatency reads what the render goroutine stamped and times what has
// gone to the device.
func (e *Engine) collectLatency() {
	l := &e.lat
	l.mu.Lock()
	defer l.mu.Unlock()
	n := l.ring.n.Load()
	// Slot n%latSlots, the oldest still kept, may be the one being written:
	// latSlots-1 behind the writer is as far back as a read can trust.
	if n-l.cursor >= latSlots {
		l.missed += n - l.cursor - (latSlots - 1)
		l.cursor = n - (latSlots - 1)
	}
	for ; l.cursor < n; l.cursor++ {
		s := &l.ring.slots[l.cursor%latSlots]
		ev := latEvent{
			via:     Via(s.via.Load()),
			arrived: s.arrived.Load(),
			touch:   s.touch.Load(),
			sent:    s.sent.Load(),
			frame:   uint64(s.frame.Load()),
		}
		if l.ring.n.Load()-l.cursor >= latSlots {
			l.missed++ // lapped while it was read
			continue
		}
		l.pending = append(l.pending, ev)
	}
	if len(l.pending) > latSlots {
		l.missed += uint64(len(l.pending) - latSlots)
		l.pending = slices.Delete(l.pending, 0, len(l.pending)-latSlots)
	}
	delivered := e.delivered.Load()
	mode := e.OutputMode()
	sr := float64(e.sampleRate())
	earOK := l.earAt != 0 && e.now()-l.earAt <= int64(earFresh) && mode != ModeJam
	kept := l.pending[:0]
	for _, ev := range l.pending {
		if ev.frame >= delivered {
			kept = append(kept, ev) // not at the device yet
			continue
		}
		heard := false
		if mode != ModePhone && (e.sink != nil || e.heardFn != nil) {
			if at, ok := e.heardAt(ev.frame); ok {
				l.sample(ev, "room", at)
				heard = true
			}
		}
		if earOK {
			at := l.ear.At + int64((float64(ev.frame)-float64(l.ear.Frame))*1e9/sr)
			l.sample(ev, "phone", at)
			heard = true
		}
		if !heard {
			l.missed++
		}
	}
	l.pending = kept
}

// sample adds one control, heard at mono ns at on ear, to its path. Called
// with mu held.
func (l *latency) sample(ev latEvent, ear string, at int64) {
	ms := func(a, b int64) float64 {
		if a == 0 || b == 0 {
			return math.NaN()
		}
		return float64(b-a) / 1e6
	}
	from := ev.arrived
	if ev.sent != 0 {
		from = ev.sent
	}
	if ev.touch != 0 {
		from = ev.touch
	}
	s := latSample{
		total:       ms(from, at),
		touchToSend: ms(ev.touch, ev.sent),
		sendToPi:    ms(ev.sent, ev.arrived),
		piToEar:     ms(ev.arrived, at),
	}
	key := ev.via.String() + "→" + ear
	if l.paths == nil {
		l.paths = map[string]*latPath{}
	}
	p := l.paths[key]
	if p == nil {
		p = &latPath{}
		l.paths[key] = p
	}
	p.add(s)
}

// sampleRate is the tape's rate.
func (e *Engine) sampleRate() int {
	if e.store != nil {
		return e.store.SampleRate()
	}
	return 48000
}

// ---------------------------------------------------------------------------
// What GET /api/latency says.

// Spread is a rolling figure: its median, 95th percentile and worst, in ms,
// over N controls.
type Spread struct {
	N   int     `json:"n"`
	P50 float64 `json:"p50_ms"`
	P95 float64 `json:"p95_ms"`
	Max float64 `json:"max_ms"`
}

// LatencyPath is one way in to one ear: "page→room" is a page's touch to
// the jam room's speakers, "page→phone" to the phone listening, "midi→room"
// a controller on the Pi to the room. Total runs from the touch where the
// page said when it was, else from its send, else from the Pi's arrival. The legs are there
// where they are known.
type LatencyPath struct {
	Path        string  `json:"path"`
	Via         string  `json:"via"`
	Ear         string  `json:"ear"`
	Count       int     `json:"count"` // ever, since the Pi started
	Total       Spread  `json:"total"`
	TouchToSend *Spread `json:"touch_to_send,omitempty"` // the page's own handling
	SendToPi    *Spread `json:"send_to_pi,omitempty"`    // the Wi-Fi, by the clock offset
	PiToEar     Spread  `json:"pi_to_ear"`               // the render ahead, the device's buffer, a phone's stream
}

// LatencyBuffers are the settings the figures were taken with.
type LatencyBuffers struct {
	SampleRate      int      `json:"sample_rate"`
	BlockFrames     int      `json:"block_frames"`
	AheadFrames     uint64   `json:"ahead_frames"` // the renderer's lead on the device (aheadFor)
	AheadMS         float64  `json:"ahead_ms"`
	OutputLatencyMS float64  `json:"output_latency_ms"` // OUTPUT_LATENCY_MS, asked of the device
	PullFrames      int      `json:"pull_frames,omitempty"`
	LeadMS          *float64 `json:"lead_ms,omitempty"` // the render head, from now: the best a press can do
}

// LatencyUnderflows are the gaps so far: blocks the device played as
// silence because none was rendered, the device's own restarts and slips,
// and a phone's jitter buffer running dry.
type LatencyUnderflows struct {
	Render uint64  `json:"render"`
	Device uint64  `json:"device"`
	Phone  *uint64 `json:"phone,omitempty"`
}

// PhoneEar is the listening phone's buffers, as it last said.
type PhoneEar struct {
	FillMS   float64 `json:"fill_ms"`
	OutputMS float64 `json:"output_ms"`
	AgeS     float64 `json:"age_s"`
}

// LatencyReport is GET /api/latency.
type LatencyReport struct {
	Paths      []LatencyPath     `json:"paths"`
	Quantised  uint64            `json:"quantised"` // waited for a grid line: not timed
	Missed     uint64            `json:"missed"`    // stamped, never heard
	Buffers    LatencyBuffers    `json:"buffers"`
	Underflows LatencyUnderflows `json:"underflows"`
	Phone      *PhoneEar         `json:"phone,omitempty"`
}

// Latency is the figures so far.
func (e *Engine) Latency() LatencyReport {
	e.collectLatency()
	sr := e.sampleRate()
	r := LatencyReport{
		Paths: []LatencyPath{},
		Buffers: LatencyBuffers{
			SampleRate:      sr,
			BlockFrames:     BlockFrames,
			AheadFrames:     e.ahead,
			AheadMS:         round1(float64(e.ahead) * 1000 / float64(sr)),
			OutputLatencyMS: e.outputMS,
		},
		Underflows: LatencyUnderflows{Render: e.late.Load()},
		Quantised:  e.lat.ring.quantised.Load(),
	}
	if p, ok := e.sink.(audio.PullSize); ok {
		r.Buffers.PullFrames = p.PullFrames()
	}
	if d, ok := e.TrickLead(); ok {
		ms := round1(float64(d) / 1e6)
		r.Buffers.LeadMS = &ms
	}
	if s, ok := e.sink.(outputSink); ok {
		r.Underflows.Device = s.Restarts()
	}
	l := &e.lat
	l.mu.Lock()
	defer l.mu.Unlock()
	r.Missed = l.missed
	if l.earAt != 0 {
		u := l.ear.Underruns
		r.Underflows.Phone = &u
		r.Phone = &PhoneEar{FillMS: l.ear.FillMS, OutputMS: l.ear.OutputMS, AgeS: round1(float64(e.now()-l.earAt) / 1e9)}
	}
	keys := make([]string, 0, len(l.paths))
	for k := range l.paths {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		r.Paths = append(r.Paths, l.paths[k].report(k))
	}
	return r
}

func (p *latPath) report(key string) LatencyPath {
	n := min(p.n, latKeep)
	get := func(f func(latSample) float64) []float64 {
		var v []float64
		for _, s := range p.keep[:n] {
			if x := f(s); !math.IsNaN(x) {
				v = append(v, x)
			}
		}
		return v
	}
	via, ear, _ := strings.Cut(key, "→")
	out := LatencyPath{
		Path:    key,
		Via:     via,
		Ear:     ear,
		Count:   p.n,
		Total:   spread(get(func(s latSample) float64 { return s.total })),
		PiToEar: spread(get(func(s latSample) float64 { return s.piToEar })),
	}
	if v := get(func(s latSample) float64 { return s.touchToSend }); len(v) > 0 {
		sp := spread(v)
		out.TouchToSend = &sp
	}
	if v := get(func(s latSample) float64 { return s.sendToPi }); len(v) > 0 {
		sp := spread(v)
		out.SendToPi = &sp
	}
	return out
}

// spread is v's median, 95th percentile (nearest rank) and worst.
func spread(v []float64) Spread {
	if len(v) == 0 {
		return Spread{}
	}
	slices.Sort(v)
	rank := func(p float64) float64 {
		i := int(math.Ceil(p*float64(len(v)))) - 1
		return v[max(0, min(len(v)-1, i))]
	}
	return Spread{N: len(v), P50: round1(rank(0.5)), P95: round1(rank(0.95)), Max: round1(v[len(v)-1])}
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

// ClockMS is the clock controls are stamped with, in ms: what a page's
// clock offset is taken against.
func (e *Engine) ClockMS() float64 { return float64(e.now()) / 1e6 }
