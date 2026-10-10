package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Setting is one value the app can change (docs/superpowers/specs/
// 2026-10-09-settings-design.md). Its Key is the environment variable it
// overrides, so the env file, settings.json and the docs share one name.
//
// Every value travels as a string and is parsed by LoadFrom, exactly as the
// env file's is; Check only refuses what LoadFrom would quietly ignore.
type Setting struct {
	Key     string   `json:"key"`
	Group   string   `json:"group"`
	Label   string   `json:"label"`
	Help    string   `json:"help"`
	Kind    string   `json:"kind"` // int, float, bool, text, choice
	Min     float64  `json:"min,omitempty"`
	Max     float64  `json:"max,omitempty"`
	Unit    string   `json:"unit,omitempty"`
	Choices []string `json:"choices,omitempty"`
	// Auto says the int also takes "auto" (CHANNELS).
	Auto bool `json:"auto,omitempty"`
	// Default is the built-in value, as the env file would spell it.
	Default string `json:"default"`
}

// Settings is the registry, in the order the sheet shows it. What is not
// here stays in the env file: where things live (PORT, OUTPUT_DIR, TAPE_DIR,
// STATIC_DIR, SETTINGS_FILE, UPDATE_REPO) and development knobs.
var Settings = []Setting{
	{Key: "DEVICE_MATCH", Group: "Input", Label: "Interface", Kind: "text", Default: "auto",
		Help: "Which audio interface to record from: auto, or part of its name"},
	{Key: "CHANNELS", Group: "Input", Label: "Channels", Kind: "int", Auto: true, Min: 1, Max: MaxChannels, Default: "auto",
		Help: "How many of its inputs to open; auto opens them all"},
	{Key: "SAVE_CHANNELS", Group: "Input", Label: "Inputs to keep", Kind: "text", Default: "1,2",
		Help: "The inputs a take is made from, numbered as the interface labels them"},
	{Key: "SAVE_MIX", Group: "Input", Label: "Mix", Kind: "choice", Choices: []string{"stereo", "mono"}, Default: "stereo",
		Help: "Stereo keeps them left and right; mono puts them all in the middle"},
	{Key: "SAVE_ALL_CHANNELS", Group: "Input", Label: "Keep every input", Kind: "bool", Default: "false",
		Help: "Write every input to the take, for stems; costs a lot more disk"},
	{Key: "SAMPLE_RATE", Group: "Input", Label: "Sample rate", Kind: "choice", Choices: []string{"44100", "48000", "96000"}, Unit: "Hz", Default: "48000",
		Help: "48000 unless the interface can't"},
	{Key: "INPUT_LATENCY_MS", Group: "Input", Label: "Input latency", Kind: "int", Min: 10, Max: 1000, Unit: "ms", Default: "100",
		Help: "Leave it at 100: lower makes the Pi busy-wait on USB"},

	{Key: "RING_SECONDS", Group: "Buffer", Label: "Buffer length", Kind: "int", Min: 10, Max: 3600, Unit: "s", Default: "900",
		Help: "How far back Hindsight can reach, and the longest take"},

	{Key: "MIN_FREE_GB", Group: "Saving", Label: "Keep free", Kind: "float", Min: 0, Max: 1000, Unit: "GB", Default: "1",
		Help: "Refuse to save when the disk has less than this free"},
	{Key: "MAX_SAVES", Group: "Saving", Label: "Most takes", Kind: "int", Min: 0, Max: 100000, Default: "0",
		Help: "Move the oldest takes to the trash past this many; 0 keeps them all"},

	{Key: "MIDI_CAPTURE", Group: "MIDI", Label: "Record MIDI", Kind: "bool", Default: "true",
		Help: "Save a .mid beside a take when MIDI was played"},
	{Key: "MIDI_CLOCK_DEVICE", Group: "MIDI", Label: "Clock from", Kind: "text", Default: "",
		Help: "Part of the name of the device whose clock sets the tempo; empty follows the interface"},
	{Key: "MIDI_DEVICES", Group: "MIDI", Label: "Only these", Kind: "text", Default: "",
		Help: "Comma-separated names; empty records every MIDI device"},
	{Key: "MIDI_IGNORE", Group: "MIDI", Label: "Ignore", Kind: "text", Default: "",
		Help: "Comma-separated names never to open"},
	{Key: "MIDI_LATENCY_MS", Group: "MIDI", Label: "MIDI delay", Kind: "float", Min: -1000, Max: 1000, Unit: "ms", Default: "0",
		Help: "Move every MIDI event this much later, to land on its audio"},
	{Key: "MIDI_SNAP_BARS", Group: "MIDI", Label: "Start on a bar", Kind: "bool", Default: "true",
		Help: "Start a take on the last downbeat, so the .mid begins on bar 1"},

	{Key: "TAPE", Group: "Tape", Label: "Tape", Kind: "bool", Default: "false",
		Help: "The four-track tape, played out through the interface"},
	{Key: "TAPE_TRACKS", Group: "Tape", Label: "Tracks", Kind: "int", Min: 1, Max: 16, Default: "4",
		Help: "Tracks a new tape has"},
	{Key: "TAPE_LENGTH_S", Group: "Tape", Label: "Track length", Kind: "int", Min: 10, Max: 7200, Unit: "s", Default: "1200",
		Help: "How long a track can be; a loaded clip takes 23 MB of RAM a minute"},
	{Key: "TAPE_HANDLE_S", Group: "Tape", Label: "Handles", Kind: "float", Min: 0, Max: 10, Unit: "s", Default: "2",
		Help: "Audio a clip keeps either side, to drag a trimmed edge back out"},
	{Key: "TAPE_MIXDOWN_TAIL_S", Group: "Tape", Label: "Mixdown tail", Kind: "float", Min: 0, Max: 30, Unit: "s", Default: "2",
		Help: "How long a mixdown runs past Out, for reverb to ring out"},
	{Key: "TAPE_SOURCES", Group: "Tape", Label: "Sources", Kind: "text", Default: "main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8",
		Help: "The inputs a catch can take from: name=L,R[:buses], space-separated"},
	{Key: "TAPE_CLOCK", Group: "Tape", Label: "Clock", Kind: "choice", Choices: []string{"free", "lead"}, Default: "free",
		Help: "Lead sends MIDI clock to the devices below"},
	{Key: "TAPE_CLOCK_OUT", Group: "Tape", Label: "Clock to", Kind: "text", Default: "",
		Help: "Devices that follow the tape's clock: name[:nudge ms], comma-separated"},
	{Key: "OUTPUT_LATENCY_MS", Group: "Tape", Label: "Output latency", Kind: "int", Min: 10, Max: 1000, Unit: "ms", Default: "100",
		Help: "Asked of the interface for the tape's playback"},
	{Key: "TAPE_LATENCY_MS", Group: "Tape", Label: "Catch delay", Kind: "float", Min: -1000, Max: 1000, Unit: "ms", Default: "0",
		Help: "Take every catch this much later, when you hear the tape late"},
}

// Lookup finds a setting by key.
func Lookup(key string) (Setting, bool) {
	for _, s := range Settings {
		if s.Key == key {
			return s, true
		}
	}
	return Setting{}, false
}

// Check refuses a value LoadFrom would misread or quietly replace with the
// default. Range and cross-field checks are LoadFrom's own.
func (s Setting) Check(v string) error {
	v = strings.TrimSpace(v)
	switch s.Kind {
	case "int":
		if s.Auto && strings.EqualFold(v, "auto") {
			return nil
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("%s must be a whole number", s.Key)
		}
		if float64(n) < s.Min || float64(n) > s.Max {
			return fmt.Errorf("%s must be %g to %g", s.Key, s.Min, s.Max)
		}
	case "float":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Errorf("%s must be a number", s.Key)
		}
		if f < s.Min || f > s.Max {
			return fmt.Errorf("%s must be %g to %g", s.Key, s.Min, s.Max)
		}
	case "bool":
		if _, err := strconv.ParseBool(v); err != nil {
			return fmt.Errorf("%s must be true or false", s.Key)
		}
	case "choice":
		for _, c := range s.Choices {
			if strings.EqualFold(v, c) {
				return nil
			}
		}
		return fmt.Errorf("%s must be one of %s", s.Key, strings.Join(s.Choices, ", "))
	}
	if strings.ContainsAny(v, "\n\r\x00") {
		return fmt.Errorf("%s must be one line", s.Key)
	}
	return nil
}

// SettingsPath is where the app's settings live: SETTINGS_FILE, or
// ~/hindsight/settings.json beside the env file.
func SettingsPath() string {
	if p := os.Getenv("SETTINGS_FILE"); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "hindsight", "settings.json")
}

// ReadSettings reads the app's settings: key → value, as strings. A missing
// file is no settings, not an error. Keys the registry doesn't know are
// dropped and named, so an older binary starts with a newer file.
func ReadSettings(path string) (map[string]string, []string, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	raw := map[string]any{}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	out := make(map[string]string, len(raw))
	var unknown []string
	for k, v := range raw {
		s, ok := Lookup(k)
		if !ok {
			unknown = append(unknown, k)
			continue
		}
		var str string
		switch v := v.(type) {
		case string:
			str = v
		case bool:
			str = strconv.FormatBool(v)
		case float64:
			str = strconv.FormatFloat(v, 'f', -1, 64)
		default:
			return nil, nil, fmt.Errorf("%s: %s is not a value", filepath.Base(path), k)
		}
		if err := s.Check(str); err != nil {
			return nil, nil, err
		}
		out[k] = str
	}
	sort.Strings(unknown)
	return out, unknown, nil
}

// WriteSettings replaces the file atomically: a reader, or a power cut, sees
// the old file or the new one, never half of either.
func WriteSettings(path string, vals map[string]string) error {
	b, err := json.MarshalIndent(vals, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".settings-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // a no-op once renamed
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// Layer answers a key from vals first, then the environment. It is the
// getter LoadFrom reads through.
func Layer(vals map[string]string) func(string) string {
	return func(k string) string {
		if v, ok := vals[k]; ok {
			return v
		}
		return os.Getenv(k)
	}
}

// Load reads the configuration: settings.json over the environment over the
// defaults. A settings file that can't be read, or that makes a config
// LoadFrom refuses, is set aside rather than fatal -- it is the app that
// writes it, and the app has to come up to fix it. Why lands in SettingsErr.
func Load() (*Config, error) {
	path := SettingsPath()
	vals, unknown, err := ReadSettings(path)
	if len(unknown) > 0 {
		log.Printf("[!] settings: ignoring %s in %s (not settings this version knows)", strings.Join(unknown, ", "), path)
	}
	if err == nil {
		c, lerr := LoadFrom(Layer(vals))
		if lerr == nil {
			c.SettingsFile = path
			c.Running, _ = Effective(vals)
			return c, nil
		}
		err = lerr
	}
	log.Printf("[!] settings: %s not used: %v", path, err)
	c, lerr := LoadFrom(os.Getenv)
	if lerr != nil {
		return nil, lerr
	}
	c.SettingsFile = path
	c.SettingsErr = err.Error()
	c.Running, _ = Effective(nil)
	return c, nil
}

// Effective is every setting's value under vals: the app's, else the
// environment's, else the default. from says which, per key: app, env or
// default.
func Effective(vals map[string]string) (value, from map[string]string) {
	value = make(map[string]string, len(Settings))
	from = make(map[string]string, len(Settings))
	for _, s := range Settings {
		switch v, ok := vals[s.Key]; {
		case ok:
			value[s.Key], from[s.Key] = v, "app"
		case os.Getenv(s.Key) != "":
			value[s.Key], from[s.Key] = os.Getenv(s.Key), "env"
		default:
			value[s.Key], from[s.Key] = s.Default, "default"
		}
	}
	return value, from
}
