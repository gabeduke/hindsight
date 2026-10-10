//go:build cgo

package audio

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
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

	overflows atomic.Uint64 // input overflows ALSA reported: frames lost before the ring

	picked   string // the device the last Open chose, under mu
	pickedIn int    // and its inputs
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

		// The status flags ride along so an input overflow -- frames the
		// device lost before they reached us -- is counted: the tape's
		// alignment has to know when the recording skipped.
		st, err := portaudio.OpenStream(p, func(in []int32, _ portaudio.StreamCallbackTimeInfo, flags portaudio.StreamCallbackFlags) {
			if flags&portaudio.InputOverflow != 0 {
				s.overflows.Add(1)
			}
			sink(in)
		})
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

// Overflows counts the input overflows ALSA has reported.
func (s *deviceSource) Overflows() uint64 { return s.overflows.Load() }

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
// direct one. The old code kept the *last* match, which was arbitrary. Under
// DEVICE_MATCH=auto it is the hardware input with the most inputs (pickInput).
//
// Under CHANNELS=auto the device is chosen whatever its input count, and the
// count is kept for Picked: a device with more inputs than the ring opens its
// first channels, one with fewer can't be opened at all and is reported as
// not there -- either way the capture sees the difference and restarts
// Hindsight to fit.
func (s *deviceSource) pickDevice() (*portaudio.DeviceInfo, error) {
	// Nothing picked until something is: a stale pick would read as an
	// interface that isn't there any more.
	s.mu.Lock()
	s.picked, s.pickedIn = "", 0
	s.mu.Unlock()

	devices, err := portaudio.Devices()
	if err != nil {
		return nil, fmt.Errorf("enumerate devices: %w", err)
	}
	need := s.cfg.Channels
	if s.cfg.ChannelsAuto {
		need = 0
	}
	i, fellBack, err := pickInput(inDevs(devices), s.cfg.DeviceMatch, need)
	if err != nil {
		return nil, err
	}
	dev := devices[i]
	if fellBack {
		log.Printf("[!] no input matching %q with >=%d channels; falling back to %q",
			s.cfg.DeviceMatch, max(need, 1), dev.Name)
	}

	s.mu.Lock()
	s.picked, s.pickedIn = dev.Name, dev.MaxInputChannels
	s.mu.Unlock()

	if dev.MaxInputChannels < s.cfg.Channels {
		return nil, fmt.Errorf("%w: %q has %d inputs, the ring %d", ErrNoDevice, dev.Name, dev.MaxInputChannels, s.cfg.Channels)
	}
	return dev, nil
}

// Picked reports the device the last Open chose and its input count.
func (s *deviceSource) Picked() (string, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.picked, s.pickedIn
}

func inDevs(devices []*portaudio.DeviceInfo) []inDev {
	out := make([]inDev, len(devices))
	for i, d := range devices {
		out[i] = inDev{Name: d.Name, MaxIn: d.MaxInputChannels}
	}
	return out
}

// ProbeInput reports the input pickDevice would open now and how many inputs
// it has, or "", 0 when there is none. main calls it once, before the ring is
// sized; it leaves PortAudio up, which the capture's first Open takes as it
// finds it.
func ProbeInput(cfg *config.Config) (name string, channels int) {
	_ = sharedPA.Do(func() error {
		devices, err := portaudio.Devices()
		if err != nil {
			return err
		}
		need := cfg.Channels
		if cfg.ChannelsAuto {
			need = 0
		}
		i, _, err := pickInput(inDevs(devices), cfg.DeviceMatch, need)
		if err != nil {
			return err
		}
		name, channels = devices[i].Name, devices[i].MaxInputChannels
		return nil
	})
	return name, channels
}

// ListInputs lists the hardware inputs connected, for the settings sheet.
// It is called while the capture runs, so it reads the device list PortAudio
// already holds rather than rescanning, which would close the live stream:
// an interface plugged in since appears once the capture next rescans (when
// its own interface stalls or is missing). With PortAudio not up -- the demo,
// or shutting down -- it lists nothing rather than bringing it up.
func ListInputs() []Input {
	var out []Input
	sharedPA.IfUp(func() {
		devices, err := portaudio.Devices()
		if err != nil {
			return
		}
		out = listHardware(inDevs(devices))
	})
	return out
}
