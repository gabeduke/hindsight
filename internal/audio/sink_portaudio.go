//go:build cgo

package audio

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/mono"
	"github.com/gordonklaus/portaudio"
)

// deviceSink is the tape's output through PortAudio: an output-only stream
// on the capture's own card, kept open by its own supervisor. A rescan the
// capture makes closes it (through the shared lifecycle), and the supervisor
// opens it again in the new generation; so does a stall.
//
// It is a separate stream rather than a duplex one, so the dashcam's health
// never depends on playback's.
type deviceSink struct {
	cfg         *config.Config
	pa          *paLifecycle
	captureName func() string
	bridge      *ClockBridge

	mu       sync.Mutex
	pull     func([]int32)
	channels int
	handle   int
	gen      uint64
	open     bool
	stop     chan struct{}
	done     chan struct{}

	frames       atomic.Uint64 // output frames pulled, across reopens: the engine's count since Open
	lastCallback atomic.Int64
	restarts     atomic.Uint64 // stream reopens and output underflows: where the output may have slipped
	name         atomic.Value  // string: the device while open, else ""
	reported     atomic.Int64  // the output latency PortAudio reported, ns
}

// NewDeviceSink returns the tape's PortAudio output. captureName names the
// capture's device, so the output goes to the same card.
func NewDeviceSink(cfg *config.Config, captureName func() string) Sink {
	s := &deviceSink{cfg: cfg, pa: sharedPA, captureName: captureName,
		bridge: NewClockBridge(256, cfg.SampleRate)}
	s.name.Store("")
	return s
}

// Open starts the supervisor and waits a moment for the first open, so the
// log can say where the tape plays. An output that isn't there yet is not an
// error: the supervisor keeps trying, as the capture does.
func (s *deviceSink) Open(channels int, pull func([]int32)) (string, error) {
	s.mu.Lock()
	if s.stop != nil {
		s.mu.Unlock()
		return "", fmt.Errorf("tape output already open")
	}
	s.pull, s.channels = pull, channels
	s.stop, s.done = make(chan struct{}), make(chan struct{})
	s.mu.Unlock()
	go s.supervise()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n := s.Name(); n != "" {
			return n, nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return "", nil
}

func (s *deviceSink) Close() {
	s.mu.Lock()
	stop, done := s.stop, s.done
	s.stop = nil
	s.mu.Unlock()
	if stop == nil {
		return
	}
	close(stop)
	<-done
}

// Name is the device the tape is playing through, or "" while it isn't.
func (s *deviceSink) Name() string { return s.name.Load().(string) }

// OutputBridge maps the monotonic clock to the output frame being heard.
func (s *deviceSink) OutputBridge() *ClockBridge { return s.bridge }

// Restarts counts the moments the output may have slipped against the
// capture: reopens and underflows. Where they fall, a measured delta no
// longer holds.
func (s *deviceSink) Restarts() uint64 { return s.restarts.Load() }

func (s *deviceSink) supervise() {
	defer close(s.done)
	s.mu.Lock()
	stop := s.stop
	s.mu.Unlock()
	backoff := time.Second
	lastErr := ""
	first := true // the engine logs the first open
	for {
		if !s.isOpen() {
			if err := s.openStream(); err != nil {
				if err.Error() != lastErr {
					log.Printf("[!] tape output: %v (retrying)", err)
					lastErr = err.Error()
				}
				select {
				case <-stop:
					return
				case <-time.After(backoff):
				}
				if backoff < 15*time.Second {
					backoff *= 2
				}
				continue
			}
			backoff, lastErr = time.Second, ""
			if !first {
				log.Printf("[*] tape output on %q again", s.Name())
			}
			first = false
		}
		select {
		case <-stop:
			s.closeStream()
			return
		case <-time.After(500 * time.Millisecond):
		}
		last := s.lastCallback.Load()
		switch {
		case s.pa.Gen() != s.genOpen():
			log.Printf("[!] tape output: closed by a device rescan; reopening")
			s.closeStream()
		case last != 0 && time.Since(time.Unix(0, last)) > staleAfter:
			log.Printf("[!] tape output stalled (no callback for %s); reopening", staleAfter)
			s.closeStream()
		}
	}
}

func (s *deviceSink) isOpen() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.open
}

func (s *deviceSink) genOpen() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gen
}

func (s *deviceSink) openStream() error {
	var name string
	var latency time.Duration
	handle, gen, err := s.pa.Open(func() (func(), error) {
		devices, err := portaudio.Devices()
		if err != nil {
			return nil, fmt.Errorf("enumerate devices: %w", err)
		}
		list := make([]outDev, len(devices))
		for i, d := range devices {
			list[i] = outDev{Name: d.Name, MaxOut: d.MaxOutputChannels}
		}
		i, err := pickOutput(list, s.captureName(), s.cfg.DeviceMatch, s.channels)
		if err != nil {
			return nil, err
		}
		dev := devices[i]
		p := portaudio.HighLatencyParameters(nil, dev)
		p.Output.Channels = s.channels
		p.SampleRate = float64(s.cfg.SampleRate)
		p.FramesPerBuffer = 1024
		p.Output.Latency = time.Duration(s.cfg.OutputLatencyMS) * time.Millisecond
		st, err := portaudio.OpenStream(p, s.callback)
		if err != nil {
			return nil, fmt.Errorf("open %q for output: %w", dev.Name, err)
		}
		if info := st.Info(); info != nil {
			latency = info.OutputLatency
		}
		if err := st.Start(); err != nil {
			st.Close()
			return nil, fmt.Errorf("start %q for output: %w", dev.Name, err)
		}
		name = dev.Name
		return func() {
			_ = st.Stop()
			_ = st.Close()
		}, nil
	})
	if err != nil {
		return err
	}
	s.reported.Store(int64(latency))
	s.lastCallback.Store(time.Now().UnixNano())
	s.mu.Lock()
	s.handle, s.gen, s.open = handle, gen, true
	s.mu.Unlock()
	s.name.Store(name)
	return nil
}

func (s *deviceSink) closeStream() {
	s.mu.Lock()
	h := s.handle
	wasOpen := s.open
	s.handle, s.open = 0, false
	s.mu.Unlock()
	s.pa.Close(h)
	s.name.Store("")
	if wasOpen {
		s.restarts.Add(1)
	}
}

// callback runs on PortAudio's thread. It never blocks: the engine's pull
// copies a rendered block or plays silence.
func (s *deviceSink) callback(out []int32, ti portaudio.StreamCallbackTimeInfo, flags portaudio.StreamCallbackFlags) {
	now := mono.Now()
	d := s.frames.Load()
	s.pull(out)
	s.frames.Store(d + uint64(len(out)/s.channels))
	if flags&portaudio.OutputUnderflow != 0 {
		s.restarts.Add(1)
	}
	// The buffer's first frame is heard at its DAC time. A host that doesn't
	// say falls back to the latency the stream reported.
	lat := int64(ti.OutputBufferDacTime - ti.CurrentTime)
	if lat <= 0 || lat > int64(time.Second) {
		lat = s.reported.Load()
	}
	s.bridge.Record(now+lat, d)
	s.lastCallback.Store(time.Now().UnixNano())
}
