package midi

import (
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// Out sends MIDI to the devices whose names match its targets: the tape's
// clock, leading the Bento. A message is given the moment it should arrive,
// on the monotonic clock the audio bridges use, and each device writes it
// then, plus that device's own nudge. The devices come and go: Out looks for
// them every couple of seconds, as the Watcher does, drops one whose node has
// gone or whose write fails, and opens it again when it's back.
//
// Opening a rawmidi node write-only opens its output alone, so this never
// competes with the Watcher reading the same device; and it's opened
// non-blocking, so an output another program holds can't hang the clock.
type Out struct {
	targets   []OutTarget
	cardsPath string
	sndDir    string
	// open opens a port for writing; tests replace it.
	open func(node string) (io.WriteCloser, error)

	mu       sync.Mutex
	ports    map[string]*outPort  // by node
	failed   map[string]time.Time // nodes whose open failed, and when
	extra    []*outPort           // always there: the demo's follower
	follower *Follower
	stopped  bool

	// gen moves when a device appears or loses messages: whoever sends the
	// clock tells the followers where they are again.
	gen atomic.Uint64

	stop chan struct{}
	done chan struct{}
	once sync.Once
}

// OutTarget is a device to send to: a substring of its name, and how many
// milliseconds early (negative) or late its messages should be written, for
// a device that's slow or quick to act on them.
type OutTarget struct {
	Match   string
	NudgeMS float64
}

// ParseOutTargets reads "bento, mpc:-3": comma-separated name substrings,
// each with an optional :nudge in milliseconds.
func ParseOutTargets(s string) ([]OutTarget, error) {
	var out []OutTarget
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		t := OutTarget{Match: part}
		if i := strings.LastIndex(part, ":"); i > 0 {
			v, err := strconv.ParseFloat(strings.TrimSpace(part[i+1:]), 64)
			if err != nil || v < -100 || v > 100 {
				return nil, fmt.Errorf("%q: the nudge after the colon must be milliseconds, -100 to 100", part)
			}
			t.Match, t.NudgeMS = strings.TrimSpace(part[:i]), v
		}
		out = append(out, t)
	}
	return out, nil
}

// timed is a message and when to write it, in mono ns.
type timed struct {
	at    int64
	msg   []byte
	epoch uint64 // the port's epoch when queued: SendNow drops older ones
}

// outPort is one open device.
type outPort struct {
	name  string
	node  string
	nudge int64 // ns
	w     io.WriteCloser
	q     chan timed
	wmu   sync.Mutex // one write at a time: run's and SendNow's
	epoch atomic.Uint64
	dead  atomic.Bool
	lost  atomic.Bool // messages were dropped: say so once it takes them again
	sent  atomic.Uint64
	out   *Out
}

const (
	// outQueue is how far ahead messages can pile up for one device: a few
	// seconds of clock at the fastest tempo.
	outQueue = 2048
	// outStale is how late a message can be and still go: later, the device
	// was stuck, and a burst of old clock would throw its count further.
	outStale = 250 * time.Millisecond
	// outRetry is how long a node that wouldn't open is left alone.
	outRetry = 30 * time.Second
)

// NewOut makes an Out for targets; Start begins looking for them.
func NewOut(targets []OutTarget) *Out {
	return &Out{
		targets:   targets,
		cardsPath: DefaultCardsPath,
		sndDir:    DefaultSndDir,
		open: func(node string) (io.WriteCloser, error) {
			return os.OpenFile(node, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		},
		ports:  map[string]*outPort{},
		failed: map[string]time.Time{},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
}

// NewDemoOut is an Out with no devices but the demo's follower, which
// stands in for the Bento: it hears the clock and says what tempo arrived.
func NewDemoOut() *Out {
	o := NewOut(nil)
	o.follower = NewFollower()
	o.AddWriter("Demo follower", o.follower)
	return o
}

// Heard is what the demo's follower made of the clock; ok is false for an
// Out without one.
func (o *Out) Heard() (bpm float64, ok, running bool, spp int) {
	if o.follower == nil {
		return 0, false, false, 0
	}
	return o.follower.Heard()
}

// Gen moves each time a device appears or loses messages.
func (o *Out) Gen() uint64 { return o.gen.Load() }

// AddWriter adds a device that's always there -- the demo's follower --
// under name.
func (o *Out) AddWriter(name string, w io.WriteCloser) {
	p := &outPort{name: name, node: name, w: w, q: make(chan timed, outQueue), out: o}
	o.mu.Lock()
	o.extra = append(o.extra, p)
	o.mu.Unlock()
	go p.run()
}

// Start looks for the devices now and every two seconds.
func (o *Out) Start() {
	go func() {
		defer close(o.done)
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			o.scan()
			select {
			case <-o.stop:
				return
			case <-t.C:
			}
		}
	}()
}

// Stop closes every device.
func (o *Out) Stop() {
	o.once.Do(func() {
		close(o.stop)
		o.mu.Lock()
		o.stopped = true
		for _, p := range o.ports {
			p.close()
		}
		for _, p := range o.extra {
			p.close()
		}
		o.mu.Unlock()
	})
}

// scan opens targets that have appeared and forgets ones that have gone.
// Opening happens outside the lock: the clock never waits on a device.
func (o *Out) scan() {
	ports := Enumerate(o.cardsPath, o.sndDir)
	present := map[string]bool{}
	for _, port := range ports {
		present[port.Node] = true
	}
	type want struct {
		port  Port
		nudge float64
	}
	var opens []want
	o.mu.Lock()
	for node, p := range o.ports {
		if p.dead.Load() || !present[node] {
			// A device unplugged -- and maybe plugged straight back in at
			// the same node -- is opened afresh.
			p.close()
			delete(o.ports, node)
		}
	}
	now := time.Now()
	for _, port := range ports {
		if _, open := o.ports[port.Node]; open {
			continue
		}
		if at, ok := o.failed[port.Node]; ok && now.Sub(at) < outRetry {
			continue
		}
		for _, t := range o.targets {
			if port.Matches(t.Match) {
				opens = append(opens, want{port, t.NudgeMS})
				break
			}
		}
	}
	o.mu.Unlock()

	for _, w := range opens {
		f, err := o.open(w.port.Node)
		o.mu.Lock()
		if err != nil {
			if _, before := o.failed[w.port.Node]; !before {
				log.Printf("[!] midi out: %s (%s): %v; trying again every %s", w.port.Name, w.port.Node, err, outRetry)
			}
			o.failed[w.port.Node] = time.Now()
			o.mu.Unlock()
			continue
		}
		if o.stopped {
			o.mu.Unlock()
			f.Close()
			return
		}
		delete(o.failed, w.port.Node)
		p := &outPort{name: w.port.Name, node: w.port.Node, nudge: int64(w.nudge * 1e6), w: f, q: make(chan timed, outQueue), out: o}
		o.ports[w.port.Node] = p
		o.mu.Unlock()
		log.Printf("[*] midi out: sending to %s (%s)", w.port.Name, w.port.Node)
		go p.run()
		o.gen.Add(1)
	}
}

// Send schedules msg to arrive at every device at mono time at.
func (o *Out) Send(at int64, msg []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, p := range o.ports {
		p.send(timed{at: at + p.nudge, msg: msg, epoch: p.epoch.Load()})
	}
	for _, p := range o.extra {
		p.send(timed{at: at + p.nudge, msg: msg, epoch: p.epoch.Load()})
	}
}

// SendNow writes msg to every device at once, dropping whatever is queued:
// a Stop when the clock goes away mustn't wait behind clock meant for later.
// It waits for the writes a moment at most: a stuck device can't hold up a
// shutdown.
func (o *Out) SendNow(msg []byte) {
	o.mu.Lock()
	ports := append([]*outPort(nil), o.extra...)
	for _, p := range o.ports {
		ports = append(ports, p)
	}
	o.mu.Unlock()
	var wg sync.WaitGroup
	for _, p := range ports {
		p.epoch.Add(1)
		wg.Add(1)
		go func() { defer wg.Done(); p.write(msg) }()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
	}
}

// Devices names the devices being sent to.
func (o *Out) Devices() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []string
	for _, p := range o.ports {
		if !p.dead.Load() {
			out = append(out, p.name)
		}
	}
	for _, p := range o.extra {
		out = append(out, p.name)
	}
	sort.Strings(out)
	return out
}

func (p *outPort) send(t timed) {
	if p.dead.Load() {
		return
	}
	select {
	case p.q <- t:
	default:
		// A device that isn't taking its messages: it's stuck. Dropping is
		// better than holding the clock's sender up; the followers are
		// told where they are once it takes messages again.
		p.lost.Store(true)
	}
}

// run writes each message at its time.
func (p *outPort) run() {
	for t := range p.q {
		if d := time.Duration(t.at - mono.Now()); d > 0 {
			time.Sleep(d)
		}
		if p.dead.Load() {
			return
		}
		if t.epoch != p.epoch.Load() {
			continue // dropped by SendNow
		}
		if late := time.Duration(mono.Now() - t.at); late > outStale {
			p.lost.Store(true) // stuck a while: not a burst of old clock
			continue
		}
		if !p.write(t.msg) {
			return // the next scan opens it again if it's back
		}
	}
}

// write writes msg, and answers whether the device is still there.
func (p *outPort) write(msg []byte) bool {
	p.wmu.Lock()
	defer p.wmu.Unlock()
	if p.dead.Load() {
		return false
	}
	if _, err := p.w.Write(msg); err != nil {
		if !p.dead.Swap(true) {
			log.Printf("[!] midi out: %s: %v", p.name, err)
			p.w.Close()
		}
		return false
	}
	p.sent.Add(1)
	if p.lost.Swap(false) {
		p.out.gen.Add(1) // taking messages again, having lost some
	}
	return true
}

// close ends the port. Closing the file wakes a write stuck on it, so this
// doesn't wait for one.
func (p *outPort) close() {
	if !p.dead.Swap(true) {
		p.w.Close()
	}
	close(p.q)
}

// Follower is a device that follows a clock, in memory: the demo's stand-in
// for the Bento. It reads what's written to it as a MIDI stream and keeps
// the clock it hears, so the demo can show the tempo arriving.
type Follower struct {
	clock   *Clock
	mu      sync.Mutex
	running bool
	spp     int // the last song position, in 16ths
	status  byte
	data    []byte
}

// NewFollower makes one with a few seconds of clock history.
func NewFollower() *Follower { return &Follower{clock: NewClock(4096)} }

// Write takes MIDI bytes as they arrive.
func (f *Follower) Write(b []byte) (int, error) {
	now := time.Now()
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range b {
		switch {
		case c >= ClockByte:
			f.clock.Feed(now, c)
			switch c {
			case StartByte:
				f.running, f.spp = true, 0
			case ContinueByte:
				f.running = true
			case StopByte:
				f.running = false
			}
		case c >= 0x80:
			f.status, f.data = c, f.data[:0]
		default:
			f.data = append(f.data, c)
			if f.status == SongPosition && len(f.data) == 2 {
				f.spp = int(f.data[0]) | int(f.data[1])<<7
				f.data = f.data[:0]
			}
		}
	}
	return len(b), nil
}

func (f *Follower) Close() error { return nil }

// Heard is what the follower makes of it: the tempo over the last three
// seconds, whether it's running, and the last song position.
func (f *Follower) Heard() (bpm float64, ok, running bool, spp int) {
	now := time.Now()
	bpm, ok = f.clock.BPM(now.Add(-3*time.Second), now)
	f.mu.Lock()
	defer f.mu.Unlock()
	return bpm, ok, f.running, f.spp
}
