package config

import (
	"os"
	"path/filepath"
	"testing"
)

// clearEnv blanks every variable Load reads, so a developer's own shell
// cannot change what the defaults appear to be.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"DEVICE_MATCH", "CHANNELS", "SAMPLE_RATE", "FRAMES_PER_BUFFER",
		"INPUT_LATENCY_MS", "RING_SECONDS", "OUTPUT_DIR", "SAVE_CHANNELS",
		"SAVE_ALL_CHANNELS", "MIN_FREE_GB", "MAX_SAVES", "PORT",
		"MIDI_CAPTURE", "MIDI_DEVICES", "MIDI_IGNORE", "MIDI_CLOCK_DEVICE",
		"MIDI_RING_EVENTS", "MIDI_LATENCY_MS",
	} {
		t.Setenv(k, "")
	}
}

// The EP-136 presents four stereo record pairs. Measured 2026-09-08: USB 1/2
// is the post-fader MAIN, USB 3/4 a pre-fader tap on channel one. Defaulting
// to the tap records one strip at its own limiter ceiling, with the mixer and
// every other input missing -- and does so without complaining.
func TestLoadDefaultsToThePostFaderMain(t *testing.T) {
	clearEnv(t)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	want := []int{0, 1} // stored zero-based; 1,2 as the hardware labels them
	if len(c.SaveChannels) != len(want) {
		t.Fatalf("SaveChannels = %v, want %v", c.SaveChannels, want)
	}
	for i := range want {
		if c.SaveChannels[i] != want[i] {
			t.Errorf("SaveChannels = %v, want %v", c.SaveChannels, want)
			break
		}
	}
}

func TestLoadDefaultOutputDirIsUnderTheInstallRoot(t *testing.T) {
	clearEnv(t)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	home, _ := os.UserHomeDir()
	want := filepath.Join(home, "hindsight", "jam_saves")
	if c.OutputDir != want {
		t.Errorf("OutputDir = %q, want %q", c.OutputDir, want)
	}
}

func TestLoadRejectsAChannelOutsideTheDevice(t *testing.T) {
	clearEnv(t)
	t.Setenv("CHANNELS", "2")
	t.Setenv("SAVE_CHANNELS", "3,4")

	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded with SAVE_CHANNELS beyond CHANNELS; want an error")
	}
}

func TestLoadDefaultVersionIsDev(t *testing.T) {
	clearEnv(t)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if c.Version != "dev" {
		t.Errorf("Version = %q, want %q", c.Version, "dev")
	}
}

// The clock device follows DEVICE_MATCH unless set, so a rig where the EP is
// the only clock keeps its tempo stamp with no new configuration.
func TestMIDIDefaults(t *testing.T) {
	clearEnv(t)
	c, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !c.MIDICapture || c.MIDIClockDevice != "EP-136" || c.MIDIRingEvents != 1_000_000 || c.MIDILatencyMS != 0 {
		t.Errorf("defaults: capture=%t clock=%q ring=%d latency=%v", c.MIDICapture, c.MIDIClockDevice, c.MIDIRingEvents, c.MIDILatencyMS)
	}
	if c.MIDIDevices != nil || c.MIDIIgnore != nil {
		t.Errorf("lists: devices=%q ignore=%q, want both nil", c.MIDIDevices, c.MIDIIgnore)
	}
}

func TestMIDIConfigFromEnv(t *testing.T) {
	clearEnv(t)
	t.Setenv("DEVICE_MATCH", "EP-136")
	t.Setenv("MIDI_CLOCK_DEVICE", "Bento")
	t.Setenv("MIDI_DEVICES", "Orchid, Bento,KeyStep")
	t.Setenv("MIDI_IGNORE", "EP-136")
	t.Setenv("MIDI_CAPTURE", "false")
	t.Setenv("MIDI_LATENCY_MS", "3.5")
	c, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if c.MIDIClockDevice != "Bento" || c.MIDICapture || c.MIDILatencyMS != 3.5 {
		t.Errorf("clock=%q capture=%t latency=%v", c.MIDIClockDevice, c.MIDICapture, c.MIDILatencyMS)
	}
	if len(c.MIDIDevices) != 3 || c.MIDIDevices[1] != "Bento" || len(c.MIDIIgnore) != 1 {
		t.Errorf("devices=%q ignore=%q", c.MIDIDevices, c.MIDIIgnore)
	}
}

func TestMIDIRingEventsMustBePositive(t *testing.T) {
	clearEnv(t)
	t.Setenv("MIDI_RING_EVENTS", "0")
	if _, err := Load(); err == nil {
		t.Fatal("MIDI_RING_EVENTS=0 must be rejected")
	}
}
