// Package config holds the runtime configuration for Hindsight, sourced
// entirely from environment variables so the buffer length and channel
// routing can change without a rebuild.
package config

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	// Capture
	DeviceMatch string // substring used to pick the PortAudio input device; "" picks one itself (DEVICE_MATCH=auto)
	Channels    int    // channels to capture from the device; 0 until auto is resolved (CHANNELS=auto)
	// ChannelsAuto says CHANNELS was auto: Channels is what the interface had
	// at startup, and a different interface turning up restarts Hindsight to fit.
	ChannelsAuto   bool
	SampleRate     int
	FramesPerBuf   int
	InputLatencyMS int // explicit latency; low values make PortAudio busy-poll

	// Ring buffer
	RingSeconds int

	// Saving
	OutputDir       string
	SaveChannels    []int // zero-based indices of the pair written to a take
	SaveAllChannels bool
	// SaveMix is how SaveChannels become the take: "stereo" writes them as
	// they are, "mono" averages them onto both sides.
	SaveMix   string
	MinFreeGB float64
	MaxSaves  int // 0 = unlimited

	// MIDI
	MIDICapture     bool     // store events from every MIDI device, not just the clock
	MIDIDevices     []string // allowlist substrings; empty means every device
	MIDIIgnore      []string // denylist substrings
	MIDIClockDevice string   // whose clock drives the tempo map and the BPM stamp
	// MIDIClockAuto says MIDI_CLOCK_DEVICE was not set, so the clock follows
	// the audio interface; under DEVICE_MATCH=auto, main fills it in once the
	// interface is known.
	MIDIClockAuto  bool
	MIDIRingEvents int     // event ring capacity
	MIDILatencyMS  float64 // added to every MIDI timestamp before alignment
	MIDISnapBars   bool    // start a take on the last downbeat before the window

	// Tape (docs/superpowers/specs/2026-10-03-tape-design.md). Off by
	// default, so a rig that only wants the dashcam never opens playback.
	Tape        bool
	TapeDir     string
	TapeTracks  int
	TapeLengthS int    // a track's length: 20 minutes by default
	TapeSources string // name=L,R[:buses] ..., parsed by the tape package
	// TapeHandleS is how much of the source a new pool file keeps either side
	// of its clip, so a trimmed edge can be dragged back out: 0 to 10 s.
	TapeHandleS float64
	// TapeMixdownTailS is how long a mixdown runs on past Out, so the
	// strips' reverb and delay ring out.
	TapeMixdownTailS float64
	// TapeClock is who leads: free (no clock out) or lead (the tape sends
	// MIDI clock to TapeClockOut). follow is the spec's, not built yet.
	TapeClock string
	// TapeClockOut names the devices that follow the tape's clock:
	// "bento, mpc:-3", each with an optional nudge in milliseconds.
	TapeClockOut string
	// OutputLatencyMS is asked of PortAudio for the tape's output, generous
	// for the same busy-poll reason as the input's.
	OutputLatencyMS int
	// TapeLatencyMS takes every catch this much later in the recording:
	// for hearing the tape later than the instrument (the instrument from
	// its own speaker), which makes a part land that much late.
	TapeLatencyMS float64
	// TapeDemoAlign makes the demo's output hide where it lands in the ring,
	// so the aligner has to find it, as on the Pi.
	TapeDemoAlign bool

	// Server
	Port string

	// UpdateRepo is the GitHub owner/repo whose releases the Update button
	// offers (and deploy/hindsight-update installs).
	UpdateRepo string

	// SettingsFile is the app's settings.json (SETTINGS_FILE), and
	// SettingsErr why it was not used, when it wasn't: Load then fell back to
	// the environment alone. See settings.go.
	SettingsFile string
	SettingsErr  string
	// Running is every setting's value as this process started, so the
	// sheet can tell a saved change from one in effect.
	Running map[string]string

	// Version is stamped by the build (-ldflags -X main.version) and reported
	// on /api/status, so an installed Pi can say which release it is running.
	Version string
}

// LoadFrom builds the configuration from get, which answers "" for a value
// that is not set. Load layers settings.json over the environment through it;
// the settings API validates a proposed change the same way.
func LoadFrom(get func(string) string) (*Config, error) {
	home, _ := os.UserHomeDir()

	c := &Config{
		DeviceMatch:      autoBlank(env(get, "DEVICE_MATCH", "auto")),
		SampleRate:       envInt(get, "SAMPLE_RATE", 48000),
		FramesPerBuf:     envInt(get, "FRAMES_PER_BUFFER", 2048),
		InputLatencyMS:   envInt(get, "INPUT_LATENCY_MS", 100),
		RingSeconds:      envInt(get, "RING_SECONDS", 900),
		OutputDir:        env(get, "OUTPUT_DIR", filepath.Join(home, "hindsight", "jam_saves")),
		SaveAllChannels:  envBool(get, "SAVE_ALL_CHANNELS", false),
		SaveMix:          strings.ToLower(strings.TrimSpace(env(get, "SAVE_MIX", "stereo"))),
		MinFreeGB:        envFloat(get, "MIN_FREE_GB", 1.0),
		MaxSaves:         envInt(get, "MAX_SAVES", 0),
		MIDICapture:      envBool(get, "MIDI_CAPTURE", true),
		MIDIDevices:      splitList(env(get, "MIDI_DEVICES", "")),
		MIDIIgnore:       splitList(env(get, "MIDI_IGNORE", "")),
		MIDIRingEvents:   envInt(get, "MIDI_RING_EVENTS", 1_000_000),
		MIDILatencyMS:    envFloat(get, "MIDI_LATENCY_MS", 0),
		MIDISnapBars:     envBool(get, "MIDI_SNAP_BARS", true),
		Tape:             envBool(get, "TAPE", false),
		TapeDir:          env(get, "TAPE_DIR", filepath.Join(home, "hindsight", "tapes")),
		TapeTracks:       envInt(get, "TAPE_TRACKS", 4),
		TapeLengthS:      envInt(get, "TAPE_LENGTH_S", 1200),
		TapeSources:      env(get, "TAPE_SOURCES", "main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8"),
		TapeMixdownTailS: envFloat(get, "TAPE_MIXDOWN_TAIL_S", 2),
		TapeHandleS:      envFloat(get, "TAPE_HANDLE_S", 2),
		TapeClock:        strings.ToLower(strings.TrimSpace(env(get, "TAPE_CLOCK", "free"))),
		TapeClockOut:     env(get, "TAPE_CLOCK_OUT", ""),
		OutputLatencyMS:  envInt(get, "OUTPUT_LATENCY_MS", 100),
		TapeLatencyMS:    envFloat(get, "TAPE_LATENCY_MS", 0),
		TapeDemoAlign:    envBool(get, "TAPE_DEMO_ALIGN", false),
		Port:             env(get, "PORT", "5000"),
		UpdateRepo:       env(get, "UPDATE_REPO", "gabeduke/hindsight"),
		Version:          "dev",
	}
	// The clock device defaults to the audio interface, so a rig where the
	// EP-136 is the only thing sending clock keeps its tempo stamp with no
	// new configuration. Set it to "Bento" (or whatever the sequencer's
	// product string is) once that is the clock that matters.
	//
	// Under DEVICE_MATCH=auto there is no name to default to until the
	// interface is found; main sets it then (MIDIClockAuto).
	c.MIDIClockDevice = env(get, "MIDI_CLOCK_DEVICE", c.DeviceMatch)
	c.MIDIClockAuto = get("MIDI_CLOCK_DEVICE") == ""

	// CHANNELS=auto (the default) opens every input the interface has; 0
	// until main resolves it, before anything is sized from it.
	switch v := strings.TrimSpace(get("CHANNELS")); {
	case v == "" || strings.EqualFold(v, "auto"):
		c.Channels = 0
		c.ChannelsAuto = true
	default:
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("CHANNELS must be a number or auto, got %q", v)
		}
		if n < 1 {
			return nil, fmt.Errorf("CHANNELS must be >= 1, got %d", n)
		}
		c.Channels = n
	}

	// SAVE_CHANNELS is 1-indexed in the environment because that is how the
	// hardware labels them; store zero-based.
	//
	// The EP-136 presents its eight inputs as four stereo record pairs and
	// Teenage Engineering does not document which USB pair is which, so it was
	// measured (2026-09-08) by playing into mixer channel 1 and comparing
	// levels with the fader up and down: USB 1/2 moved 20.8 dB, USB 3/4 did
	// not move at all. 1/2 is the post-fader MAIN; 3/4 is a pre-fader tap on
	// one strip, which records at that strip's limiter ceiling with the mixer
	// -- and everything plugged into the other inputs -- missing.
	//
	// scripts/channel-probe.py re-runs the measurement if this is ever in doubt.
	//
	// Under CHANNELS=auto the range is checked again by SetChannels.
	max := c.Channels
	if max == 0 {
		max = MaxChannels
	}
	ch, err := parseChannels(env(get, "SAVE_CHANNELS", "1,2"), max)
	if err != nil {
		return nil, err
	}
	c.SaveChannels = ch
	switch c.SaveMix {
	case "stereo", "mono":
	default:
		return nil, fmt.Errorf("SAVE_MIX must be stereo or mono, got %q", c.SaveMix)
	}

	if c.RingSeconds < 1 {
		return nil, fmt.Errorf("RING_SECONDS must be >= 1, got %d", c.RingSeconds)
	}
	if c.Channels > MaxChannels {
		return nil, fmt.Errorf("CHANNELS must be at most %d, got %d", MaxChannels, c.Channels)
	}
	if c.SampleRate < 8000 || c.SampleRate > 192000 {
		return nil, fmt.Errorf("SAMPLE_RATE must be 8000 to 192000, got %d", c.SampleRate)
	}
	if c.MIDIRingEvents < 1 {
		return nil, fmt.Errorf("MIDI_RING_EVENTS must be >= 1, got %d", c.MIDIRingEvents)
	}
	if c.TapeHandleS < 0 || c.TapeHandleS > 10 || math.IsNaN(c.TapeHandleS) {
		return nil, fmt.Errorf("TAPE_HANDLE_S must be 0 to 10, got %g", c.TapeHandleS)
	}
	switch c.TapeClock {
	case "free", "lead", "follow":
	default:
		return nil, fmt.Errorf("TAPE_CLOCK must be free, lead or follow, got %q", c.TapeClock)
	}
	return c, nil
}

// MaxChannels bounds CHANNELS, and what CHANNELS=auto will open.
const MaxChannels = 32

// AutoChannels is what CHANNELS=auto sizes for when no interface is there to
// ask: a stereo pair.
const AutoChannels = 2

// SetChannels resolves CHANNELS=auto to n, the inputs the interface has
// (capped at MaxChannels). A SAVE_CHANNELS that n can't satisfy falls back to
// the first pair (or the one channel), reported in the returned note so the
// log says why the take isn't what was asked for.
func (c *Config) SetChannels(n int) (note string) {
	if n < 1 {
		n = AutoChannels
	}
	if n > MaxChannels {
		n = MaxChannels
	}
	c.Channels = n
	for _, s := range c.SaveChannels {
		if s >= n {
			old := c.SaveChannels
			c.SaveChannels = []int{0, min(1, n-1)}
			return fmt.Sprintf("SAVE_CHANNELS %v is past the %d channel(s) this interface has; saving %v",
				oneBased(old), n, oneBased(c.SaveChannels))
		}
	}
	return ""
}

func oneBased(ch []int) []int {
	out := make([]int, len(ch))
	for i, v := range ch {
		out[i] = v + 1
	}
	return out
}

// autoBlank maps DEVICE_MATCH=auto to "", which is how the device source
// knows to pick for itself.
func autoBlank(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "auto") {
		return ""
	}
	return v
}

// RingFrames is the ring capacity in frames (one frame = one sample per channel).
func (c *Config) RingFrames() int { return c.RingSeconds * c.SampleRate }

// OutChannels returns the zero-based channel indices actually written to a take.
func (c *Config) OutChannels() []int {
	if c.SaveAllChannels {
		all := make([]int, c.Channels)
		for i := range all {
			all[i] = i
		}
		return all
	}
	return c.SaveChannels
}

func (c *Config) String() string {
	disp := oneBased(c.SaveChannels)
	dev := c.DeviceMatch
	if dev == "" {
		dev = "auto"
	}
	return fmt.Sprintf(
		"device=%q channels=%d rate=%d frames/buf=%d latency=%dms ring=%ds (%d frames, %s) "+
			"save_channels=%v save_mix=%s save_all=%t min_free=%.1fGB max_saves=%d out=%s "+
			"midi_capture=%t midi_clock=%q midi_latency=%.1fms",
		dev, c.Channels, c.SampleRate, c.FramesPerBuf, c.InputLatencyMS,
		c.RingSeconds, c.RingFrames(), humanBytes(int64(c.RingFrames())*int64(c.Channels)*4),
		disp, c.SaveMix, c.SaveAllChannels, c.MinFreeGB, c.MaxSaves, c.OutputDir,
		c.MIDICapture, c.MIDIClockDevice, c.MIDILatencyMS,
	)
}

func parseChannels(s string, max int) ([]int, error) {
	parts := strings.Split(s, ",")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, fmt.Errorf("SAVE_CHANNELS: %q is not a number", p)
		}
		if n < 1 || n > max {
			return nil, fmt.Errorf("SAVE_CHANNELS: channel %d out of range 1..%d", n, max)
		}
		out = append(out, n-1)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("SAVE_CHANNELS: no channels given")
	}
	return out, nil
}

// splitList splits a comma-separated value into trimmed, non-empty parts.
func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func humanBytes(n int64) string {
	const u = 1024
	if n < u {
		return fmt.Sprintf("%dB", n)
	}
	div, exp := int64(u), 0
	for m := n / u; m >= u; m /= u {
		div *= u
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(n)/float64(div), "KMGT"[exp])
}

func env(get func(string) string, k, def string) string {
	if v := get(k); v != "" {
		return v
	}
	return def
}

func envInt(get func(string) string, k string, def int) int {
	if v := get(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envFloat(get func(string) string, k string, def float64) float64 {
	if v := get(k); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func envBool(get func(string) string, k string, def bool) bool {
	if v := get(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
