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
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// Out sends MIDI to the devices whose names match its targets: the tape's
// clock, leading the Bento. A message is given the moment it should arrive,
// on the monotonic clock the audio bridges use, and each device writes it
// then, plus that device's own nudge. The devices come and go: Out looks for
// them every couple of seconds, as the Watcher does, and drops one whose
// write fails until it's back.
//
// Opening a rawmidi node write-only opens its output alone, so this never
// competes with the Watcher reading the same device.
type Out struct {
	targets   []OutTarget
	cardsPath string
	sndDir    string
	// open opens a port for writing; tests replace it.
	open func(node string) (io.WriteCloser, error)

	mu       sync.Mutex
	ports    map[string]*outPort // by node
	extra    []*outPort          // always there: the demo's follower
	follower *Follower

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
	at  int64
	msg []byte
}

// outPort is one open device.
type outPort struct {
	name  string
	node  string
	nudge int64 // ns
	w     io.WriteCloser
	q     chan timed
	dead  atomic.Bool
	sent  atomic.Uint64
}

// outQueue is how far ahead messages can pile up for one device: a few
// seconds of clock at the fastest tempo.
const outQueue = 2048

// NewOut makes an Out for targets; Start begins looking for them.
func NewOut(targets []OutTarget) *Out {
	return &Out{
		targets:   targets,
		cardsPath: DefaultCardsPath,
		sndDir:    DefaultSndDir,
		open: func(node string) (io.WriteCloser, error) {
			return os.OpenFile(node, os.O_WRONLY, 0)
		},
		ports: map[string]*outPort{},
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
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

// AddWriter adds a device that's always there -- the demo's follower --
// under name.
func (o *Out) AddWriter(name string, w io.WriteCloser) {
	p := &outPort{name: name, node: name, w: w, q: make(chan timed, outQueue)}
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
		for _, p := range o.ports {
			p.close()
		}
		for _, p := range o.extra {
			p.close()
		}
		o.mu.Unlock()
	})
}

// scan opens targets that have appeared and forgets ones that failed.
func (o *Out) scan() {
	ports := Enumerate(o.cardsPath, o.sndDir)
	o.mu.Lock()
	defer o.mu.Unlock()
	for node, p := range o.ports {
		if p.dead.Load() {
			delete(o.ports, node)
		}
	}
	for _, port := range ports {
		if _, open := o.ports[port.Node]; open {
			continue
		}
		for _, t := range o.targets {
			if !port.Matches(t.Match) {
				continue
			}
			w, err := o.open(port.Node)
			if err != nil {
				log.Printf("[!] midi out: %s (%s): %v", port.Name, port.Node, err)
				break
			}
			p := &outPort{name: port.Name, node: port.Node, nudge: int64(t.NudgeMS * 1e6), w: w, q: make(chan timed, outQueue)}
			o.ports[port.Node] = p
			log.Printf("[*] midi out: sending to %s (%s)", port.Name, port.Node)
			go p.run()
			break
		}
	}
}

// Send schedules msg to arrive at every device at mono time at.
func (o *Out) Send(at int64, msg []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for _, p := range o.ports {
		p.send(timed{at: at + p.nudge, msg: msg})
	}
	for _, p := range o.extra {
		p.send(timed{at: at + p.nudge, msg: msg})
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
		// A device that isn't taking its messages: it's gone, or stuck.
		// Dropping is better than holding the clock's sender up.
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
		if _, err := p.w.Write(t.msg); err != nil {
			if !p.dead.Swap(true) {
				log.Printf("[!] midi out: %s: %v", p.name, err)
				p.w.Close()
			}
			return // the next scan opens it again if it's back
		}
		p.sent.Add(1)
	}
}

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
