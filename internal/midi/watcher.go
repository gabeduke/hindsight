package midi

import (
	"log"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Policy decides which rawmidi ports get opened and which one is the clock.
type Policy struct {
	// Capture is whether to store events at all. Off, the watcher opens only
	// the clock device and feeds only the tempo path -- the behaviour before
	// MIDI capture existed.
	Capture bool
	// Allow, if non-empty, restricts opening to ports matching one of these
	// substrings. Deny excludes ports matching any of them and wins over
	// Allow. Matching is Port.Matches: case-insensitive, name or node path.
	Allow []string
	Deny  []string
	// ClockDevice is the substring naming whose clock pulses drive the tempo
	// path. Empty means no device's clock is used.
	ClockDevice string
}

// ParseList splits a comma-separated environment value into trimmed,
// non-empty substrings.
func ParseList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (p Policy) allows(port Port) bool {
	for _, d := range p.Deny {
		if port.Matches(d) {
			return false
		}
	}
	if !p.Capture {
		return port.Matches(p.ClockDevice)
	}
	if len(p.Allow) == 0 {
		return true
	}
	for _, a := range p.Allow {
		if port.Matches(a) {
			return true
		}
	}
	// The clock device is opened even when the allowlist leaves it out:
	// asking for a tempo from a device you did not open is a configuration
	// that cannot work, so it is resolved in the obvious direction.
	return port.Matches(p.ClockDevice)
}

// DeviceInfo is a connected device as reported to the API and the manifest.
type DeviceInfo struct {
	ID        uint16 `json:"id"`
	Name      string `json:"name"`
	Node      string `json:"node"`
	Clock     bool   `json:"clock"`
	Connected bool   `json:"connected"`
	Events    uint64 `json:"events"`
	Bytes     uint64 `json:"bytes"`
}

// Watcher keeps every rawmidi port on the system open and reading.
//
// It stands in for the ALSA sequencer's System:announce subscription that a
// libasound client would use: a poll of /dev/snd every couple of seconds.
// The outcome is the same -- any class-compliant device that enumerates gets
// read, add and remove mid-session are survived -- and it needs no cgo, no
// library and no daemon, which is what keeps the demo and the tests running
// on a Mac.
//
// It mirrors Capture.supervise's shape: detect, open, notice failure, forget,
// rediscover. What it does not share is any path back into the capture
// thread. Nothing here holds a lock the audio path can wait on.
type Watcher struct {
	// CardsPath and SndDir default to the real ALSA locations and are fields
	// so tests can point them at a fixture directory.
	CardsPath string
	SndDir    string
	// Poll is the interval between scans of SndDir. Two seconds is quick
	// enough that a device plugged in mid-jam misses one bar, and slow enough
	// that an idle Pi is not stat-ing a directory forty times a minute.
	Poll time.Duration
	// DrainWindow is how long after opening a node its bytes are discarded as
	// backlog rather than timestamped. See portReader.readLoop.
	DrainWindow time.Duration

	policy Policy
	clock  *Clock
	events *EventRing

	mu      sync.Mutex
	devices map[string]*portReader // by node path
	gone    map[uint16]DeviceInfo  // departed devices, by id, for naming their events
	nextID  uint16

	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{}

	// quiet suppresses repeated "no devices" logs. Everything is unplugged
	// for days at a time and a 2-second poll would otherwise write 40,000
	// identical lines into the journal every day.
	quiet atomic.Bool
}

// NewWatcher builds a watcher feeding clock pulses from the policy's clock
// device into clock, and every other message into events. events may be nil
// when policy.Capture is false.
func NewWatcher(policy Policy, clock *Clock, events *EventRing) *Watcher {
	if events == nil {
		events = NewEventRing(1)
	}
	return &Watcher{
		CardsPath:   DefaultCardsPath,
		SndDir:      DefaultSndDir,
		Poll:        2 * time.Second,
		DrainWindow: defaultDrainWindow,
		policy:      policy,
		clock:       clock,
		events:      events,
		devices:     make(map[string]*portReader),
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
	}
}

// Start launches the poll loop. It returns immediately; use Devices to
// observe state.
func (w *Watcher) Start() { go w.run() }

// Stop ends the loop and closes every open node. It does not wait for the
// reader goroutines, for the reason given on portReader.close.
func (w *Watcher) Stop() {
	w.stopOnce.Do(func() { close(w.stop) })
	<-w.done
	w.mu.Lock()
	for _, r := range w.devices {
		r.close()
	}
	w.mu.Unlock()
}

// Connected reports whether the clock device is open right now. It is what
// the status page's MIDI tile means by connected: the tempo source, not any
// device at all.
func (w *Watcher) Connected() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, r := range w.devices {
		if r.port.Matches(w.policy.ClockDevice) && r.connected.Load() {
			return true
		}
	}
	return false
}

// BPM forwards to the clock so a caller can hold only the Watcher.
func (w *Watcher) BPM(start, end time.Time) (float64, bool) { return w.clock.BPM(start, end) }

// Clock is the tempo path's pulse ring.
func (w *Watcher) Clock() *Clock { return w.clock }

// Events copies out every stored event in [startNS, endNS), oldest first.
func (w *Watcher) Events(startNS, endNS int64) []Event { return w.events.Between(startNS, endNS) }

// Ring exposes the event ring, for its counters.
func (w *Watcher) Ring() *EventRing { return w.events }

// Devices lists what is open right now, by id.
func (w *Watcher) Devices() []DeviceInfo {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]DeviceInfo, 0, len(w.devices))
	for _, r := range w.devices {
		out = append(out, DeviceInfo{
			ID:        r.id,
			Name:      r.port.Name,
			Node:      r.port.Node,
			Clock:     r.port.Matches(w.policy.ClockDevice),
			Connected: r.connected.Load(),
			Events:    r.events.Load(),
			Bytes:     r.bytes.Load(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Device looks a device up by id. Ids are never reused within a run, so an
// event's Device field resolves to the device that produced it even after
// that device has been unplugged and something else has taken its node.
func (w *Watcher) Device(id uint16) (DeviceInfo, bool) {
	for _, d := range w.Devices() {
		if d.ID == id {
			return d, true
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if d, ok := w.gone[id]; ok {
		return d, true
	}
	return DeviceInfo{}, false
}

func (w *Watcher) run() {
	defer close(w.done)
	w.scan()
	t := time.NewTicker(w.Poll)
	defer t.Stop()
	for {
		select {
		case <-w.stop:
			return
		case <-t.C:
			w.scan()
		}
	}
}

// scan reconciles the open set against what the system exposes now.
func (w *Watcher) scan() {
	ports := Enumerate(w.CardsPath, w.SndDir)
	present := make(map[string]Port, len(ports))
	for _, p := range ports {
		present[p.Node] = p
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	// Forget readers whose goroutine has exited. Their node may or may not
	// still exist; if it does, it is reopened below, which is what a replug
	// that lands on the same card number needs.
	for node, r := range w.devices {
		if r.gone.Load() {
			w.remember(r)
			delete(w.devices, node)
		}
	}

	for node, p := range present {
		if _, open := w.devices[node]; open {
			continue
		}
		if !w.policy.allows(p) {
			continue
		}
		w.open(p)
	}

	if len(w.devices) == 0 {
		if !w.quiet.Swap(true) {
			log.Printf("[*] midi: no devices — takes will have no MIDI")
		}
	} else {
		w.quiet.Store(false)
	}
}

// open starts a reader for a port. Called with mu held.
func (w *Watcher) open(p Port) {
	w.nextID++
	r := &portReader{
		port:  p,
		id:    w.nextID,
		drain: w.DrainWindow,
	}
	isClock := p.Matches(w.policy.ClockDevice)
	if w.policy.Capture {
		r.onEvent = w.events.Push
	}
	r.onRealtime = func(ts time.Time, ns int64, b byte) {
		if isClock {
			w.clock.Feed(ts, b)
		}
		if w.policy.Capture && (b == StartByte || b == ContinueByte || b == StopByte) {
			w.events.Push(Event{NS: ns, Device: r.id, Status: b})
		}
	}
	w.devices[p.Node] = r
	go r.run()
}

// remember keeps a departed device's identity so an event stored under its id
// can still be named at save time. Bounded: a device that flaps all night
// must not grow this without limit. Called with mu held.
func (w *Watcher) remember(r *portReader) {
	if w.gone == nil {
		w.gone = make(map[uint16]DeviceInfo)
	}
	if len(w.gone) >= maxRemembered {
		var oldest uint16 = ^uint16(0)
		for id := range w.gone {
			if id < oldest {
				oldest = id
			}
		}
		delete(w.gone, oldest)
	}
	w.gone[r.id] = DeviceInfo{
		ID: r.id, Name: r.port.Name, Node: r.port.Node,
		Clock: r.port.Matches(w.policy.ClockDevice), Events: r.events.Load(), Bytes: r.bytes.Load(),
	}
}

// maxRemembered bounds the departed-device table.
const maxRemembered = 64
