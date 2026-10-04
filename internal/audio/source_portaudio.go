//go:build cgo

package audio

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gordonklaus/portaudio"
)

// sharedPA is the one PortAudio lifecycle: the library is process-global,
// and the capture and the tape's output both open streams on it.
var sharedPA = newPALifecycle(portaudio.Initialize, portaudio.Terminate)

// deviceSource is the real audio interface, opened through PortAudio.
type deviceSource struct {
	cfg *config.Config
	pa  *paLifecycle

	mu     sync.Mutex
	stream *portaudio.Stream
	handle int // the stream's registration with pa
}

func NewDeviceSource(cfg *config.Config) Source {
	return &deviceSource{cfg: cfg, pa: sharedPA}
}

func (s *deviceSource) Open(sink func([]int32)) (string, error) {
	// PortAudio comes up if it isn't, and no rescan can run while the device
	// is picked and the stream opened.
	var name string
	var stream *portaudio.Stream
	handle, _, err := s.pa.Open(func() (func(), error) {
		dev, err := s.pickDevice()
		if err != nil {
			return nil, err
		}

		p := portaudio.HighLatencyParameters(dev, nil)
		p.Input.Channels = s.cfg.Channels
		p.SampleRate = float64(s.cfg.SampleRate)
		p.FramesPerBuffer = s.cfg.FramesPerBuf
		// An explicit, generous latency is the fix for the busy-poll that
		// pegged a core: LowLatencyParameters asks a USB device for a
		// deadline it cannot meet, so PortAudio spins. A ring buffer has no
		// latency requirement.
		p.Input.Latency = time.Duration(s.cfg.InputLatencyMS) * time.Millisecond

		st, err := portaudio.OpenStream(p, sink)
		if err != nil {
			return nil, fmt.Errorf("open %q: %w", dev.Name, err)
		}
		if err := st.Start(); err != nil {
			st.Close()
			return nil, fmt.Errorf("start %q: %w", dev.Name, err)
		}
		name, stream = dev.Name, st
		return func() {
			_ = st.Stop()
			_ = st.Close()
		}, nil
	})
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	s.stream, s.handle = stream, handle
	s.mu.Unlock()

	return name, nil
}

// InputLatency reports what PortAudio actually gave the stream, which need
// not be what INPUT_LATENCY_MS asked for.
func (s *deviceSource) InputLatency() time.Duration {
	s.mu.Lock()
	st := s.stream
	s.mu.Unlock()
	if st == nil {
		return 0
	}
	if info := st.Info(); info != nil {
		return info.InputLatency
	}
	return 0
}

func (s *deviceSource) Close() {
	s.mu.Lock()
	h := s.handle
	s.stream, s.handle = nil, 0
	s.mu.Unlock()

	// Through the lifecycle, which closes it unless a terminate already did.
	s.pa.Close(h)
}

// Reset re-enumerates devices. PortAudio's device list is frozen at
// Pa_Initialize and never rescans, so an interface that was power-cycled is
// invisible until the library is torn down and brought back up. The capture's
// own stream is closed by then; any other stream on the library -- the tape's
// output -- is closed by the rescan, and its owner opens it again.
func (s *deviceSource) Reset() error { return s.pa.Rescan() }

func (s *deviceSource) Shutdown() error { return s.pa.Term() }

// pickDevice selects the input deterministically. ALSA exposes the same card
// under several PortAudio names (hw, plughw, default, sysdefault, front,
// dsnoop); the plug-based ones can silently add format conversion, so prefer a
// direct one. The old code kept the *last* match, which was arbitrary.
func (s *deviceSource) pickDevice() (*portaudio.DeviceInfo, error) {
	devices, err := portaudio.Devices()
	if err != nil {
		return nil, fmt.Errorf("enumerate devices: %w", err)
	}

	var match, fallback *portaudio.DeviceInfo
	bestScore := -1

	for _, d := range devices {
		if d.MaxInputChannels < s.cfg.Channels {
			continue
		}
		if fallback == nil {
			fallback = d
		}
		if s.cfg.DeviceMatch == "" || !strings.Contains(d.Name, s.cfg.DeviceMatch) {
			continue
		}
		if s := deviceScore(d.Name); s > bestScore {
			bestScore, match = s, d
		}
	}

	if match != nil {
		return match, nil
	}
	if fallback != nil {
		log.Printf("[!] no input matching %q with >=%d channels; falling back to %q",
			s.cfg.DeviceMatch, s.cfg.Channels, fallback.Name)
		return fallback, nil
	}
	return nil, fmt.Errorf("%w: none with >=%d channels (is it off, unplugged, or in use by another process?)", ErrNoDevice, s.cfg.Channels)
}
