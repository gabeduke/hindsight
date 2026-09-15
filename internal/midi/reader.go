package midi

import (
	"errors"
	"io"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// readBuf is one read's worth of bytes. The EP emits about 62 a second and a
// keyboard a few hundred at most, so this is never close to full; it exists
// so a burst after a stall is taken in one syscall rather than 64.
const readBuf = 256

// defaultDrainWindow is how long after opening the device its bytes are thrown
// away instead of timestamped.
//
// ALSA starts buffering clock the moment the device node appears, and the
// watcher can be a whole poll interval behind that. The backlog is then handed
// over in the first read or two, so those pulses share a handful of arrival
// times, and the near-zero intervals between them drag the rolling median far
// above the real tempo. Measured on hardware: three seconds after a replug
// Hindsight reported 223.3 BPM against a true 120.
//
// scripts/midi-probe.py drains for exactly this reason, and its comments
// record the same failure in an ad-hoc reader that over-reported by 10 BPM.
//
// 150ms is generous: a full 4KB rawmidi buffer is handed over in microseconds,
// while the cost is six real pulses at 120 BPM, out of a 900-second ring.
const defaultDrainWindow = 150 * time.Millisecond

// portReader owns one open rawmidi node: reading, timestamping, parsing, and
// noticing when the device goes away.
//
// Every error here is logged and dropped. Hindsight's job is audio; a MIDI
// failure produces a take with less MIDI in it and nothing else. There is no
// path from here into the capture thread.
type portReader struct {
	port  Port
	id    uint16 // assigned by opened once the node is actually open
	drain time.Duration

	// isClock marks the one reader whose pulses feed the tempo path. Set
	// before run starts and never changed, so no lock guards it.
	isClock bool

	// opened is called on the reader's goroutine once the node is open, and
	// hands back the device id. Ids are allocated here rather than at
	// scan time so a node that cannot be opened never burns one.
	opened func() uint16

	// onEvent receives complete messages; onRealtime receives clock and
	// transport bytes with the read's timestamp. Both are called on the
	// reader's goroutine.
	onEvent    func(Event)
	onRealtime func(ts time.Time, ns int64, b byte)

	parser Parser

	mu   sync.Mutex
	file *os.File

	connected atomic.Bool
	gone      atomic.Bool
	failed    atomic.Bool // could not be opened or read; see run

	bytes  atomic.Uint64
	events atomic.Uint64
	sysex  atomic.Uint64 // SysEx messages skipped, mirrored from the parser
}

// run opens the node and reads it until it fails. It is the body of the
// device's goroutine; when it returns the device is gone.
func (r *portReader) run() {
	defer r.gone.Store(true)

	f, err := os.Open(r.port.Node)
	if err != nil {
		r.failed.Store(true)
		log.Printf("[!] midi: open %s: %v", r.port.Node, err)
		return
	}
	r.mu.Lock()
	r.file = f
	r.mu.Unlock()

	if r.opened != nil {
		r.id = r.opened()
	}
	r.connected.Store(true)
	log.Printf("[*] midi: reading %q from %s", r.port.Name, r.port.Node)
	start := time.Now()
	r.readLoop(f)
	r.connected.Store(false)
	r.close()
	// A node that closes within a second of opening, having delivered
	// nothing, is not a device that was unplugged: it is one that cannot be
	// read at all -- an output-only substream, a node another process holds
	// -- and reopening it every poll would fill the journal and churn ids.
	// If the node itself is gone, that was an unplug, however quick.
	if time.Since(start) < flapWindow && r.bytes.Load() == 0 {
		if _, err := os.Stat(r.port.Node); err == nil {
			r.failed.Store(true)
			log.Printf("[!] midi: %q on %s closed at once with nothing read — leaving it for %s", r.port.Name, r.port.Node, failedRetry)
			return
		}
	}
	log.Printf("[*] midi: %q on %s closed", r.port.Name, r.port.Node)
}

// flapWindow and failedRetry govern nodes that open but cannot be read. See
// run.
const (
	flapWindow  = time.Second
	failedRetry = time.Minute
)

// readLoop timestamps at arrival, one time.Now() per read rather than per
// byte. Batch-then-timestamp cannot place a note against an audio frame, and
// the tempo estimator refuses outright once most pulses stop carrying
// distinct arrival times -- so a read that returns as its bytes land is a
// correctness requirement, not an optimisation.
func (r *portReader) readLoop(f *os.File) {
	buf := make([]byte, readBuf)

	opened := time.Now()
	drainUntil := opened.Add(r.drain)
	dropped := 0
	draining := r.drain > 0

	var now time.Time
	var ns int64
	r.parser.OnMessage = func(status, d1, d2 byte) {
		r.events.Add(1)
		if r.onEvent != nil {
			r.onEvent(Event{NS: ns, Device: r.id, Status: status, D1: d1, D2: d2})
		}
	}
	r.parser.OnRealtime = func(b byte) {
		if r.onRealtime != nil {
			r.onRealtime(now, ns, b)
		}
	}

	for {
		n, err := f.Read(buf)
		now = time.Now()
		ns = mono.Of(now)

		if draining {
			if now.Before(drainUntil) {
				dropped += n
				n = 0
			} else {
				draining = false
				if dropped > 0 {
					log.Printf("[*] midi: %q: dropped %d backlog bytes buffered before the reader opened", r.port.Name, dropped)
				}
			}
		}

		r.bytes.Add(uint64(n))
		for _, b := range buf[:n] {
			r.parser.Feed(b)
		}
		r.sysex.Store(r.parser.SysExDropped)

		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, os.ErrClosed) {
				log.Printf("[!] midi: read %s: %v", f.Name(), err)
			}
			return
		}
	}
}

// close releases the node. Called from run on exit and from the watcher on
// Stop; a blocking read on a character device cannot be interrupted portably,
// so Stop does not wait for the goroutine -- the only caller is process
// shutdown, where a goroutine parked in a read costs nothing.
func (r *portReader) close() {
	r.mu.Lock()
	f := r.file
	r.file = nil
	r.mu.Unlock()
	if f != nil {
		f.Close()
	}
	r.connected.Store(false)
}
