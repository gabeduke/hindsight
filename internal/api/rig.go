package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/rig"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The rig (docs/superpowers/specs/2026-10-15-rig-design.md): the kit drawn
// as devices and cables, where each cable is a setting.
//
//	GET /api/rig          the graph, built from the settings, the tape and
//	                      what's plugged in, every time it's asked
//	PUT /api/rig/labels   {"ep-136.in1": "guitar", "ep-136.aux": ""}: the
//	                      jacks you draw, kept in rig.json beside
//	                      settings.json ("" removes one). They route nothing.
//
// Plugging a cable writes its setting through the route that already owns
// it -- PATCH /api/tapes, PUT /api/settings, PUT /api/tapes/output -- and the
// next read draws it. The page never stores a picture of the rig.

// rigHooks stand in for the hardware: where the interface is, its USB id,
// and the MIDI ports. Nil: the real ones.
type rigHooks struct {
	device func() string
	usb    func(device string) string
	midi   func() []rig.MIDIPort
}

// rigState is the API's rig: the hooks, and the labels, read once and kept,
// since the tape page asks for its taps' names several times a second.
type rigState struct {
	hooks rigHooks

	mu       sync.Mutex
	labels   map[string]string // nil until read
	profiles map[string]rig.Profile
}

// SetRigUSB says how the interface's USB id is found: the demo, whose
// synthetic interface is routed as the Sidekick is, says it's one.
func (a *API) SetRigUSB(f func(device string) string) { a.rig.hooks.usb = f }

func (a *API) rigDevice() string {
	if a.rig.hooks.device != nil {
		return a.rig.hooks.device()
	}
	if a.cap != nil {
		return a.cap.DeviceName()
	}
	return ""
}

func (a *API) rigUSBID(device string) string {
	if a.rig.hooks.usb != nil {
		return a.rig.hooks.usb(device)
	}
	return rig.USBID(device, rig.ProcAsound)
}

// rigMIDI is every MIDI port plugged in, ignored ones too (they're the ones
// to plug back), and whether Hindsight has each open.
func (a *API) rigMIDI() []rig.MIDIPort {
	if a.rig.hooks.midi != nil {
		return a.rig.hooks.midi()
	}
	open := map[string]bool{}
	if l, ok := a.midi.(DeviceLister); ok && a.midi != nil {
		for _, d := range l.Devices() {
			if d.Connected {
				open[d.Name] = true
			}
		}
	}
	seen := map[string]bool{}
	var out []rig.MIDIPort
	for _, p := range midi.Enumerate(midi.DefaultCardsPath, midi.DefaultSndDir) {
		if !seen[p.Name] {
			seen[p.Name] = true
			out = append(out, rig.MIDIPort{Name: p.Name, Open: open[p.Name]})
		}
	}
	// What has no node of its own: the demo's sequencer.
	for name := range open {
		if !seen[name] {
			seen[name] = true
			out = append(out, rig.MIDIPort{Name: name, Open: true})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (a *API) labelsPath() string { return rig.LabelsPath(a.settingsFile()) }

// rigLabels is rig.json's labels, read once and kept.
func (a *API) rigLabels() map[string]string {
	a.rig.mu.Lock()
	defer a.rig.mu.Unlock()
	if a.rig.labels == nil {
		l, err := rig.ReadLabels(a.labelsPath())
		if err != nil {
			l = map[string]string{}
		}
		a.rig.labels = l
	}
	out := make(map[string]string, len(a.rig.labels))
	for k, v := range a.rig.labels {
		out[k] = v
	}
	return out
}

// rigProfile is the interface's profile, looked up once per device.
func (a *API) rigProfile(device string) rig.Profile {
	a.rig.mu.Lock()
	p, ok := a.rig.profiles[device]
	a.rig.mu.Unlock()
	if ok {
		return p
	}
	p, ok = rig.ForUSB(a.rigUSBID(device))
	if !ok {
		p = rig.Generic(device, a.cfg.Channels, 0)
	}
	a.rig.mu.Lock()
	if a.rig.profiles == nil {
		a.rig.profiles = map[string]rig.Profile{}
	}
	a.rig.profiles[device] = p
	a.rig.mu.Unlock()
	return p
}

// labelSources names each source with what's drawn into its jack, so the
// tape page's input chips can say "guitar".
func (a *API) labelSources(srcs []tape.SourceState) {
	labels := a.rigLabels()
	if len(labels) == 0 {
		return
	}
	p := a.rigProfile(a.rigDevice())
	for i := range srcs {
		s := &srcs[i]
		if n := labels["kit.tap."+s.Name]; n != "" {
			s.Label = n
			continue
		}
		if len(s.Pair) == 2 {
			if t, ok := p.TapAt([2]int{s.Pair[0], s.Pair[1]}); ok && t.From != "" {
				s.Label = labels[p.ID+"."+t.From]
			}
		}
	}
}

// rigSettings is every setting as the sheet reads it: saved and running.
func (a *API) rigSettings() (map[string]rig.Setting, bool) {
	vals, _, err := config.ReadSettings(a.settingsFile())
	if err != nil {
		vals = nil
	}
	value, _ := config.Effective(vals)
	out := make(map[string]rig.Setting, len(value))
	restart := false
	for _, s := range config.Settings {
		v := value[s.Key]
		run := v
		if a.cfg.Running != nil {
			run = a.cfg.Running[s.Key]
		}
		out[s.Key] = rig.Setting{Value: v, Running: run}
		if !strings.EqualFold(v, run) {
			restart = true
		}
	}
	return out, restart
}

func (a *API) rigInputs() rig.Inputs {
	device := a.rigDevice()
	settings, restart := a.rigSettings()
	in := rig.Inputs{Interface: device, Channels: a.cfg.Channels, MIDI: a.rigMIDI(), Settings: settings,
		Labels: a.rigLabels(), Version: a.cfg.Version, RestartNeeded: restart}
	if device != "" {
		in.USBID = a.rigUSBID(device)
	}
	_, in.Controller = config.Lookup("TAPE_CONTROLLER")
	if a.tape != nil {
		for _, s := range a.tape.Sources() {
			v := rig.SourceView{Name: s.Name, Hears: s.Leaks, PeakDB: s.PeakDB}
			if len(s.Pair) == 2 {
				v.Pair = [2]int{s.Pair[0], s.Pair[1]}
			}
			in.Sources = append(in.Sources, v)
		}
		if t := a.tape.Loaded(); t != nil {
			tv := &rig.TapeView{ID: t.ID, Armed: t.Armed(), Output: string(a.tape.OutputMode()), Streams: a.tape.Stream() != nil}
			for i, tr := range t.Tracks {
				v := rig.TrackView{N: tr.N, Name: tr.Name, Bus: tr.Bus, Clips: len(tr.Clips), Mute: tr.Mute}
				if i < len(t.Inputs) {
					v.Input = t.Inputs[i]
				}
				tv.Tracks = append(tv.Tracks, v)
			}
			in.Tape = tv
		}
	} else if srcs, err := tape.ParseSources(settings["TAPE_SOURCES"].Running, max(a.cfg.Channels, 1)); err == nil {
		// The tape is off: the taps are still what a KEEP chooses among.
		for _, s := range srcs {
			in.Sources = append(in.Sources, rig.SourceView{Name: s.Name, Pair: [2]int{s.Pair[0] + 1, s.Pair[1] + 1}, Hears: s.Leaks})
		}
	}
	return in
}

func (a *API) handleRig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, rig.Build(a.rigInputs()))
}

func (a *API) handleRigLabels(w http.ResponseWriter, r *http.Request) {
	var body map[string]*string
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, `send {"socket id": "label"}, with "" or null to remove one`)
		return
	}
	a.rig.mu.Lock()
	defer a.rig.mu.Unlock()
	cur, err := rig.ReadLabels(a.labelsPath())
	if err != nil {
		cur = map[string]string{} // a broken file is replaced, not a trap
	}
	for id, v := range body {
		label := ""
		if v != nil {
			label = *v
		}
		clean, err := rig.CleanLabel(id, label)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if clean == "" {
			delete(cur, id)
		} else {
			cur[id] = clean
		}
	}
	if len(cur) > 200 {
		writeErr(w, http.StatusBadRequest, "that's more labels than a rig has jacks")
		return
	}
	if err := rig.WriteLabels(a.labelsPath(), cur); err != nil {
		writeErr(w, http.StatusInternalServerError, "couldn't save the labels: "+err.Error())
		return
	}
	a.rig.labels = cur
	writeJSON(w, http.StatusOK, map[string]any{"labels": cur})
}
