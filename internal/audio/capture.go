package audio

import (
	"errors"
	"log"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/mono"
)

// ErrNoDevice is what a source returns when the interface isn't there to
// open. Capture keeps retrying, and reports itself as waiting rather than
// failed.
var ErrNoDevice = errors.New("no input device")

// blockPoolSize bounds how much audio can be in flight between the source's
// delivery goroutine and the ring writer. At 2048 frames per block this is
// several seconds of slack, which is what lets a large Snapshot hold the ring
// lock without the callback ever blocking.
const blockPoolSize = 64

// staleAfter is how long without a callback before capture is declared dead.
const staleAfter = 2 * time.Second

// levelBinMillis is the width of one level bin. The envelope's capacity is
// derived from it, so the two cannot drift.
const levelBinMillis = 10

// Capture owns the audio device, the ring buffer and the level meters.
type Capture struct {
	cfg    *config.Config
	src    Source
	ring   *Ring
	flags  *FlagStore
	levels *Levels
	env    *Envelope
	bridge *ClockBridge

	// handed counts frames handed to the ring writer. Touched only on the
	// source's delivery goroutine, so it needs no atomic; it is what the
	// bridge records, and it equals ring.TotalFrames once the writer catches
	// up, because a block that is dropped advances neither.
	handed uint64

	free   chan []int32
	filled chan []int32

	lastCallback atomic.Int64 // unix nanos
	xruns        atomic.Uint64

	// dropouts is where the capture lost audio, newest last: each the ring
	// frame after a gap (a block dropped, or an overflow the device
	// reported), plus one so that 0 is an empty slot. A small fixed ring,
	// written only on the delivery goroutine without a lock or an
	// allocation; a save turns those inside its take into the take's
	// Dropouts (step C4). lastDrop and overflows are the delivery
	// goroutine's own: the last frame marked (+1), so a burst of drops at
	// one frame is one dropout, and the device's overflow count last seen
	// (-1: not seen yet).
	dropouts  [maxDropouts]atomic.Uint64
	dropN     atomic.Uint64
	lastDrop  uint64
	overflows int64
	// reopened says supervise opened the stream again (after a stall, a
	// failure, the interface coming back): the ring then has a splice, and
	// the first block after it marks one.
	reopened   atomic.Bool
	healthy    atomic.Bool
	deviceName atomic.Value // string
	lastErr    atomic.Value // string
	waiting    atomic.Bool  // the last open failed with ErrNoDevice

	// extras are the extra inputs (AddExtraInputs): their channels follow
	// the main interface's in the ring, written by the ring writer behind
	// the head.
	extras []*extraInput

	// onMismatch is called when an open finds an interface whose input count
	// isn't the ring's (SetOnMismatch). Set before Start, read only by
	// supervise.
	onMismatch func(name string, inputs int)

	stop     chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
}

func NewCapture(cfg *config.Config, src Source) *Capture {
	c := &Capture{
		cfg:    cfg,
		src:    src,
		ring:   NewRing(cfg.RingFrames(), cfg.BusChannels()),
		flags:  NewFlagStore(MaxLiveFlags),
		levels: NewLevels(cfg.BusChannels(), cfg.SampleRate, levelBinMillis),
		free:   make(chan []int32, blockPoolSize),
		filled: make(chan []int32, blockPoolSize),
		stop:   make(chan struct{}),

		overflows: -1,
	}
	blockLen := cfg.FramesPerBuf * cfg.Channels
	for i := 0; i < blockPoolSize; i++ {
		c.free <- make([]int32, blockLen)
	}
	// Capacity comes from the same RingSeconds as the audio ring, so the
	// ribbon's timeline cannot drift from what Capture would actually write.
	// SaveChannels is what the meters and the takes use, so the ribbon shows
	// the same pair even under SAVE_ALL_CHANNELS.
	c.env = NewEnvelope(cfg.RingSeconds*1000/levelBinMillis, cfg.SaveChannels, levelBinMillis)
	c.levels.SetEnvelope(c.env)
	c.levels.SetWidth(cfg.Channels)
	// One pair per block over the whole ring, plus slack for a source that
	// delivers smaller blocks than configured.
	fpb := cfg.FramesPerBuf
	if fpb < 1 {
		fpb = 1
	}
	c.bridge = NewClockBridge(cfg.RingFrames()/fpb*2+64, cfg.SampleRate)
	c.deviceName.Store("")
	c.lastErr.Store("")
	return c
}

func (c *Capture) Ring() *Ring       { return c.ring }
func (c *Capture) Flags() *FlagStore { return c.flags }
func (c *Capture) Levels() *Levels   { return c.levels }

// MarkNow records a live mark at the newest frame the ring actually holds,
// reporting false when there is no audio to mark.
//
// The -1 is the whole point of this method existing rather than callers doing
// it themselves. TotalFrames is a count, so valid frame indices are
// 0..TotalFrames()-1, while flagsForWindow's window is half-open
// [start, end) with end == TotalFrames(). A mark placed at TotalFrames()
// would sit one past the last frame of every take that contains it and be
// dropped at save time -- silently losing exactly the flag the user just
// asked for.
func (c *Capture) MarkNow() (uint64, bool) {
	total := c.ring.TotalFrames()
	if total == 0 {
		return 0, false
	}
	return c.flags.Mark(total - 1), true
}

func (c *Capture) Envelope() *Envelope { return c.env }

// Bridge ties ring frames to the monotonic clock, for placing MIDI.
func (c *Capture) Bridge() *ClockBridge { return c.bridge }

func (c *Capture) Healthy() bool {
	if !c.healthy.Load() {
		return false
	}
	last := c.lastCallback.Load()
	return last != 0 && time.Since(time.Unix(0, last)) < staleAfter
}

func (c *Capture) XRuns() uint64 { return c.xruns.Load() }

// maxDropouts is how many dropouts the capture remembers: far more than a
// healthy rig ever has in a ring's length, and a rig that has more has
// bigger problems than which of them its takes are told about.
const maxDropouts = 64

// markDropout notes a gap in the ring at frame, on the delivery goroutine.
func (c *Capture) markDropout(frame uint64) {
	if frame+1 == c.lastDrop {
		return
	}
	c.lastDrop = frame + 1
	i := c.dropN.Add(1) - 1
	c.dropouts[i%maxDropouts].Store(frame + 1)
}

// Dropouts answers the gaps strictly inside the ring frames [start, end), in
// frames from start, earliest first: where a take of that span lost audio. A
// gap at start itself is before the take's first frame, so isn't in it.
func (c *Capture) Dropouts(start, end uint64) []int64 {
	n := c.dropN.Load()
	k := min(n, maxDropouts)
	// Wrapped, and its oldest kept is inside the span: older ones in it are
	// forgotten. A rig losing audio that often has bigger problems; say so.
	if n > maxDropouts {
		if v := c.dropouts[(n-k)%maxDropouts].Load(); v > 0 && v-1 > start && v-1 < end {
			log.Printf("[!] more than %d dropouts since this take began: only the last %d are marked", maxDropouts, maxDropouts)
		}
	}
	var out []int64
	for i := n - k; i < n; i++ {
		v := c.dropouts[i%maxDropouts].Load()
		if v == 0 {
			continue
		}
		if f := v - 1; f > start && f < end {
			out = append(out, int64(f-start))
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// InputOverflows counts the overflows the device reported: frames lost
// before they reached the capture at all. Only a real device knows.
func (c *Capture) InputOverflows() uint64 {
	if o, ok := c.src.(interface{ Overflows() uint64 }); ok {
		return o.Overflows()
	}
	return 0
}
func (c *Capture) DeviceName() string { s, _ := c.deviceName.Load().(string); return s }
func (c *Capture) LastError() string  { s, _ := c.lastErr.Load().(string); return s }

// Waiting reports that capture is down only because the interface isn't
// there yet -- switched off, or still booting -- rather than because
// something failed. The main page says "waiting for the interface" then,
// not "capture error".
func (c *Capture) Waiting() bool { return c.waiting.Load() }

// BufferedSeconds reports how much audio is currently retrievable.
func (c *Capture) BufferedSeconds() float64 {
	return float64(c.ring.BufferedFrames()) / float64(c.cfg.SampleRate)
}

// SetOnMismatch asks to be told, after each open of the stream, when the
// interface chosen has a different number of inputs from the ring's channels:
// under CHANNELS=auto that means another interface than the one Hindsight was
// sized for at startup, and main restarts to fit it. Only a source that
// reports what it picked (Fitted) can tell. Call it before Start.
func (c *Capture) SetOnMismatch(f func(name string, inputs int)) { c.onMismatch = f }

// checkFit calls onMismatch if the source's last pick doesn't fit the ring.
// It runs after every open, failed or not: a device with fewer inputs than
// the ring fails to open, and is exactly the case that must not just wait.
func (c *Capture) checkFit() {
	if c.onMismatch == nil {
		return
	}
	f, ok := c.src.(Fitted)
	if !ok {
		return
	}
	// CHANNELS=auto never sizes past MaxChannels, so a bigger interface
	// fits once it gets those: comparing the raw count would restart forever.
	if name, n := f.Picked(); n > 0 && min(n, config.MaxChannels) != c.cfg.Channels {
		c.onMismatch(name, n)
	}
}

// AddExtraInputs gives the capture its extra inputs' streams, one for each of
// EXTRA_INPUTS in order, their channels numbered on after the main
// interface's. Call it before Start.
func (c *Capture) AddExtraInputs(srcs []ExtraSource) {
	w := config.ExtraInputChannels
	for i, src := range srcs {
		if i >= len(c.cfg.ExtraInputs) {
			break
		}
		c.extras = append(c.extras, newExtraInput(c.cfg.ExtraInputs[i], c.cfg.Channels+i*w, w,
			c.cfg.SampleRate, src, c.levels, c.cfg.ExtraInputOffsetMS, c.ExtraLag()))
	}
}

// ExtraLag is how far behind the head the extra inputs' channels are
// written, in frames: one of the main interface's blocks, the extra stream's
// latency, and slack. A reader that wants the newest audio of an extra
// channel stops this far short of the head.
// A negative EXTRA_INPUT_OFFSET_MS reads the extra input that much later
// again, so it adds to the lag.
func (c *Capture) ExtraLag() uint64 {
	ms := float64(c.cfg.InputLatencyMS+extraSlackMS) + max(0, -c.cfg.ExtraInputOffsetMS)
	return uint64(c.cfg.FramesPerBuf + int(ms*float64(c.cfg.SampleRate)/1000))
}

// ExtraInputStatus is how one extra input is doing, for the status line and
// the rig.
type ExtraInputStatus struct {
	Match    string  `json:"match"`
	Device   string  `json:"device"`   // what it opened; "" while it isn't open
	Channels [2]int  `json:"channels"` // the bus's channels it fills, 1-indexed
	Live     bool    `json:"live"`
	Locked   bool    `json:"locked"` // the resampler holds it where the bridges place it
	PPM      float64 `json:"ppm"`    // how far its clock runs from the main interface's
}

// ExtraInputs reports each extra input.
func (c *Capture) ExtraInputs() []ExtraInputStatus {
	out := make([]ExtraInputStatus, 0, len(c.extras))
	for _, x := range c.extras {
		out = append(out, ExtraInputStatus{Match: x.match, Device: x.name.Load().(string),
			Channels: [2]int{x.first + 1, x.first + x.width}, Live: x.live.Load(),
			Locked: x.locked.Load(), PPM: float64(x.ppm.Load()) / 1000})
	}
	return out
}

// NewestFor is the ring's window as a reader of channels chs (0-indexed)
// should see it: [oldest, newest), where newest stops where the joiner has
// got to (about ExtraLag short of the head) when any of them is an extra
// input's, whose newest frames aren't written yet.
func (c *Capture) NewestFor(chs []int) (oldest, newest uint64) {
	oldest, newest = c.ring.Window()
	for _, ch := range chs {
		if x := c.extraOf(ch); x != nil {
			newest = min(newest, max(x.written.Load(), oldest))
		}
	}
	return oldest, newest
}

// extraOf is the extra input whose channels hold ch (0-indexed), or nil.
func (c *Capture) extraOf(ch int) *extraInput {
	for _, x := range c.extras {
		if ch >= x.first && ch < x.first+x.width {
			return x
		}
	}
	return nil
}

// AwaitExtra waits, at most wait, for the extra inputs' channels among chs
// (0-indexed) to be written up to ring frame end, and says whether they are:
// at once with none of theirs among chs. It gives up early if the ring stops
// coming in. A KEEP and a span saved from the ring wait on it, so a take of
// the guitar doesn't end on the lag's silence.
func (c *Capture) AwaitExtra(chs []int, end uint64, wait time.Duration) bool {
	deadline := time.Now().Add(wait)
	_, last := c.ring.Window()
	moved := time.Now()
	for {
		if _, n := c.NewestFor(chs); n >= end {
			return true
		}
		if _, head := c.ring.Window(); head != last {
			last, moved = head, time.Now()
		}
		if time.Now().After(deadline) || time.Since(moved) > staleAfter {
			return false
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// ExtraWait is how long a save waits for the extra inputs to catch up with
// its end: the lag, and a second for the joiner to be late.
func (c *Capture) ExtraWait() time.Duration {
	return time.Duration(c.ExtraLag())*time.Second/time.Duration(c.cfg.SampleRate) + time.Second
}

// ExtraGapsIn are the extra inputs' gaps over the ring frames [start, end)
// for channels chs, in frames from start (0 for one the span starts inside,
// as Gaps answers): what a take of those channels lost.
func (c *Capture) ExtraGapsIn(chs []int, start, end uint64) []int64 {
	var out []int64
	seen := map[*extraInput]bool{}
	for _, ch := range chs {
		if x := c.extraOf(ch); x != nil && !seen[x] {
			seen[x] = true
			out = append(out, x.Gaps(start, end)...)
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// ExtraGaps answers where an extra input's audio stops holding strictly
// inside the ring frames [start, end), in frames from start, for the extra
// input whose channels hold ch (0-indexed); nil for a main channel.
func (c *Capture) ExtraGaps(ch int, start, end uint64) []int64 {
	if x := c.extraOf(ch); x != nil {
		return x.Gaps(start, end)
	}
	return nil
}

// Start brings up the ring writer, the level broadcaster and the supervised
// audio stream. It returns immediately; use Healthy to observe state.
//
// The error return is reserved for a future Source whose start-up can fail
// synchronously; today every failure is discovered and retried inside
// supervise, so this always returns nil.
func (c *Capture) Start() error {
	c.wg.Add(3 + len(c.extras))
	go c.ringWriter()
	go c.broadcaster()
	go c.supervise()
	for _, x := range c.extras {
		go func() {
			defer c.wg.Done()
			x.supervise(c.stop)
		}()
	}
	return nil
}

// ringWriter is the single owner of the ring buffer.
func (c *Capture) ringWriter() {
	defer c.wg.Done()
	for {
		select {
		case <-c.stop:
			return
		case block := <-c.filled:
			c.ring.WriteNarrow(block, c.cfg.Channels)
			for _, x := range c.extras {
				x.join(c.ring, c.bridge)
			}
			select {
			case c.free <- block:
			default:
			}
		}
	}
}

// broadcaster pushes level frames to websocket subscribers at ~25fps.
func (c *Capture) broadcaster() {
	defer c.wg.Done()
	t := time.NewTicker(40 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.levels.Broadcast()
		}
	}
}

// supervise keeps a live stream open, rebuilding it when it dies. The previous
// implementation latched an isRecording flag that nothing ever cleared, so a
// dead stream was never restarted and the UI reported "Active" forever.
func (c *Capture) supervise() {
	defer c.wg.Done()

	backoff := time.Second
	opened := false
	for {
		select {
		case <-c.stop:
			c.src.Close()
			c.healthy.Store(false)
			return
		default:
		}

		// Not the first open: what the ring gets next follows a gap.
		if opened {
			c.reopened.Store(true)
		}
		name, err := c.src.Open(c.processAudio)
		c.checkFit()
		if err != nil {
			c.lastErr.Store(err.Error())
			c.waiting.Store(errors.Is(err, ErrNoDevice))
			c.healthy.Store(false)
			log.Printf("[!] capture: %v (retry in %s)", err, backoff)
			select {
			case <-c.stop:
				return
			case <-time.After(backoff):
			}
			if backoff < 15*time.Second {
				backoff *= 2
			}
			if err := c.src.Reset(); err != nil {
				log.Printf("[!] device rescan: %v", err)
			}
			continue
		}

		opened = true
		backoff = time.Second
		c.lastErr.Store("")
		c.waiting.Store(false)
		c.deviceName.Store(name)
		if l, ok := c.src.(Latent); ok {
			c.bridge.SetPipelineLatency(int64(l.InputLatency()))
		}
		c.lastCallback.Store(time.Now().UnixNano())
		c.healthy.Store(true)
		log.Printf("[*] capture live on %q — ring %ds, %d ch @ %d Hz",
			c.DeviceName(), c.cfg.RingSeconds, c.cfg.BusChannels(), c.cfg.SampleRate)

		// Watch for the stream going stale.
		tick := time.NewTicker(500 * time.Millisecond)
		for alive := true; alive; {
			select {
			case <-c.stop:
				tick.Stop()
				c.src.Close()
				c.healthy.Store(false)
				return
			case <-tick.C:
				last := c.lastCallback.Load()
				if last != 0 && time.Since(time.Unix(0, last)) > staleAfter {
					log.Printf("[!] capture stalled (no callback for %s) — restarting", staleAfter)
					c.lastErr.Store("audio stream stalled; restarting")
					c.healthy.Store(false)
					alive = false
				}
			}
		}
		tick.Stop()
		c.src.Close()
		c.healthy.Store(false)
		// A stall is most often the interface going away. PortAudio's device
		// list is frozen until a rescan, so rescan now: the next Open then
		// sees it gone and reports waiting, rather than failing on a stale
		// entry first.
		if err := c.src.Reset(); err != nil {
			log.Printf("[!] device rescan: %v", err)
		}
	}
}

// processAudio runs on the source's delivery goroutine (the sink passed to
// Source.Open). It must never block or allocate, so it takes a pooled block,
// copies into it, and hands it off without waiting.
func (c *Capture) processAudio(in []int32) {
	c.lastCallback.Store(time.Now().UnixNano())
	c.levels.Accumulate(in)
	// The stream was opened again (a stall, the interface back): the audio
	// between is gone, a gap just before this block.
	if c.reopened.Load() && c.reopened.Swap(false) && c.handed > 0 {
		c.markDropout(c.handed)
	}
	// The device lost frames before this block: a gap just before it.
	if ov := int64(c.InputOverflows()); ov != c.overflows {
		if c.overflows >= 0 && ov > c.overflows {
			c.markDropout(c.handed)
		}
		c.overflows = ov
	}

	select {
	case block := <-c.free:
		block = block[:cap(block)]
		if len(block) < len(in) {
			block = make([]int32, len(in))
		}
		n := copy(block, in)
		select {
		case c.filled <- block[:n]:
			c.handed += uint64(n / c.cfg.Channels)
			c.bridge.Record(mono.Now(), c.handed)
		default:
			c.xruns.Add(1)
			c.markDropout(c.handed)
			select {
			case c.free <- block:
			default:
			}
		}
	default:
		// Ring writer is behind; drop this block rather than stall the device.
		c.xruns.Add(1)
		c.markDropout(c.handed)
	}
}

// Stop tears everything down.
func (c *Capture) Stop() {
	c.stopOnce.Do(func() {
		close(c.stop)
		c.wg.Wait()
		c.src.Close()
		_ = c.src.Shutdown()
	})
}
