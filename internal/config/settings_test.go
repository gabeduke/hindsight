package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every default must load: a registry entry whose default LoadFrom refuses
// would break every install that never touched it.
func TestRegistryDefaultsLoad(t *testing.T) {
	clearEnv(t)
	vals := map[string]string{}
	for _, s := range Settings {
		if err := s.Check(s.Default); err != nil && s.Default != "" {
			t.Errorf("%s: default %q fails Check: %v", s.Key, s.Default, err)
		}
		vals[s.Key] = s.Default
	}
	if _, err := LoadFrom(Layer(vals)); err != nil {
		t.Fatalf("defaults don't load: %v", err)
	}
}

func TestRegistryKeysAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Settings {
		if seen[s.Key] {
			t.Errorf("%s twice", s.Key)
		}
		seen[s.Key] = true
	}
}

// envInt falls back to the default on a value it can't parse; the app must
// refuse it instead, or a typo would silently save as "unchanged".
func TestCheckRefusesWhatLoadWouldIgnore(t *testing.T) {
	bad := map[string]string{
		"RING_SECONDS":      "ten",
		"CHANNELS":          "0",
		"MIN_FREE_GB":       "NaN",
		"MIDI_CAPTURE":      "maybe",
		"SAVE_MIX":          "surround",
		"SAMPLE_RATE":       "22050",
		"TAPE_HANDLE_S":     "11",
		"MIDI_CLOCK_DEVICE": "two\nlines",
	}
	for k, v := range bad {
		s, _ := Lookup(k)
		if err := s.Check(v); err == nil {
			t.Errorf("%s=%q passed Check", k, v)
		}
	}
	good := map[string]string{"CHANNELS": "auto", "RING_SECONDS": "600", "SAVE_MIX": "mono", "MIDI_CAPTURE": "false"}
	for k, v := range good {
		s, _ := Lookup(k)
		if err := s.Check(v); err != nil {
			t.Errorf("%s=%q: %v", k, v, err)
		}
	}
}

func writeFile(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// The app's value wins over the env file's, which wins over the default.
func TestLoadLayersSettingsOverEnv(t *testing.T) {
	clearEnv(t)
	t.Setenv("RING_SECONDS", "300")
	t.Setenv("MAX_SAVES", "5")
	t.Setenv("SETTINGS_FILE", writeFile(t, `{"RING_SECONDS": "120", "SAVE_MIX": "mono", "SOMETHING_NEW": "x"}`))

	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.RingSeconds != 120 || c.MaxSaves != 5 || c.SaveMix != "mono" {
		t.Errorf("ring=%d max=%d mix=%s, want 120 5 mono", c.RingSeconds, c.MaxSaves, c.SaveMix)
	}
	if c.SettingsErr != "" {
		t.Errorf("SettingsErr = %q", c.SettingsErr)
	}
	if c.Running["RING_SECONDS"] != "120" || c.Running["MAX_SAVES"] != "5" || c.Running["SAMPLE_RATE"] != "48000" {
		t.Errorf("Running = %v", c.Running)
	}
}

// A file the app can't use is set aside, not fatal: Hindsight has to come up
// for the sheet to fix it.
func TestLoadSetsABadFileAside(t *testing.T) {
	for name, body := range map[string]string{
		"not json":     `{"RING_SECONDS": `,
		"bad value":    `{"RING_SECONDS": "ten"}`,
		"fails as one": `{"CHANNELS": "2", "SAVE_CHANNELS": "3,4"}`,
		"not a string": `{"RING_SECONDS": [1]}`,
	} {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("RING_SECONDS", "300")
			t.Setenv("SETTINGS_FILE", writeFile(t, body))
			c, err := Load()
			if err != nil {
				t.Fatalf("Load failed outright: %v", err)
			}
			if c.SettingsErr == "" || c.RingSeconds != 300 {
				t.Errorf("SettingsErr=%q ring=%d, want an error and the env's 300", c.SettingsErr, c.RingSeconds)
			}
		})
	}
}

// JSON numbers and booleans are accepted as their string forms, for a file
// edited by hand.
func TestReadSettingsTakesNumbersAndBools(t *testing.T) {
	vals, unknown, err := ReadSettings(writeFile(t, `{"RING_SECONDS": 600, "MIDI_CAPTURE": false, "OLD": 1}`))
	if err != nil {
		t.Fatal(err)
	}
	if vals["RING_SECONDS"] != "600" || vals["MIDI_CAPTURE"] != "false" {
		t.Errorf("vals = %v", vals)
	}
	if strings.Join(unknown, ",") != "OLD" {
		t.Errorf("unknown = %v", unknown)
	}
}

func TestWriteSettingsRoundTrips(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "settings.json")
	if err := WriteSettings(p, map[string]string{"SAVE_MIX": "mono"}); err != nil {
		t.Fatal(err)
	}
	vals, _, err := ReadSettings(p)
	if err != nil || vals["SAVE_MIX"] != "mono" {
		t.Fatalf("vals=%v err=%v", vals, err)
	}
	left, _ := filepath.Glob(filepath.Join(filepath.Dir(p), ".settings-*"))
	if len(left) != 0 {
		t.Errorf("temp files left: %v", left)
	}
}

func TestSetChannelsFallsBackToAPairItHas(t *testing.T) {
	clearEnv(t)
	t.Setenv("SAVE_CHANNELS", "3,4")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Channels != 0 {
		t.Fatalf("Channels = %d before resolving auto", c.Channels)
	}
	if note := c.SetChannels(2); note == "" || c.Channels != 2 || c.SaveChannels[0] != 0 || c.SaveChannels[1] != 1 {
		t.Errorf("note=%q channels=%d save=%v", note, c.Channels, c.SaveChannels)
	}
	if note := c.SetChannels(8); note != "" {
		t.Errorf("1,2 fits 8, got %q", note)
	}
}
