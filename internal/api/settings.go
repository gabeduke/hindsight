package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
)

// The settings sheet (docs/superpowers/specs/2026-10-09-settings-design.md):
// the registry, what each value is now and where it comes from, and whether a
// restart is owed. Changes go to settings.json and apply on restart.

type settingView struct {
	config.Setting
	Value   string `json:"value"`
	Running string `json:"running"`
	From    string `json:"from"` // app, env, default
}

type settingsResponse struct {
	Settings      []settingView `json:"settings"`
	RestartNeeded bool          `json:"restart_needed"`
	Error         string        `json:"error,omitempty"`
	File          string        `json:"file"`
	Device        string        `json:"device"`   // the interface open now
	Channels      int           `json:"channels"` // what the ring was sized for
	Inputs        []audio.Input `json:"inputs"`
	MemoryBytes   uint64        `json:"memory_bytes,omitempty"`
}

// SetRestart is what POST /api/restart calls once it has said yes; nil
// leaves the endpoint answering 501.
func (a *API) SetRestart(f func()) { a.restart = f }

// Busy is busy(), for main: an interface that turns up with a different
// number of inputs restarts Hindsight only when nothing would be cut short.
func (a *API) Busy() string { return a.busy() }

// listInputs stands in for audio.ListInputs in tests.
var listInputs = audio.ListInputs

func (a *API) settingsFile() string {
	if a.cfg.SettingsFile != "" {
		return a.cfg.SettingsFile
	}
	return config.SettingsPath()
}

func (a *API) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	vals, _, err := config.ReadSettings(a.settingsFile())
	resp := settingsResponse{File: a.settingsFile(), Channels: a.cfg.Channels, MemoryBytes: totalMemory()}
	if err != nil {
		resp.Error = err.Error()
		vals = nil
	} else if a.cfg.SettingsErr != "" {
		// The file reads, but this process started without it.
		resp.Error = a.cfg.SettingsErr
	}
	value, from := config.Effective(vals)
	for _, s := range config.Settings {
		v := settingView{Setting: s, Value: value[s.Key], Running: a.cfg.Running[s.Key], From: from[s.Key]}
		if v.Running == "" && a.cfg.Running == nil {
			v.Running = v.Value
		}
		if !strings.EqualFold(v.Value, v.Running) {
			resp.RestartNeeded = true
		}
		resp.Settings = append(resp.Settings, v)
	}
	if a.cap != nil {
		resp.Device = a.cap.DeviceName()
	}
	resp.Inputs = listInputs()
	if resp.Inputs == nil {
		resp.Inputs = []audio.Input{}
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleSettingsPut sets the keys given and resets those given as null. The
// result must load as a whole -- SAVE_CHANNELS past CHANNELS is refused here,
// not at the next start -- and nothing is written on any error.
func (a *API) handleSettingsPut(w http.ResponseWriter, r *http.Request) {
	var body map[string]*string
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "body must be a JSON object of setting → value or null")
		return
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	path := a.settingsFile()
	vals, _, err := config.ReadSettings(path)
	if err != nil {
		// A broken file is replaced by what this request leaves, rather than
		// trapping the sheet behind it.
		vals = map[string]string{}
	}
	keys := make([]string, 0, len(body))
	for k := range body {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		s, ok := config.Lookup(k)
		if !ok {
			writeErr(w, http.StatusBadRequest, k+" is not a setting the app can change")
			return
		}
		v := body[k]
		if v == nil {
			delete(vals, k)
			continue
		}
		val := strings.TrimSpace(*v)
		if err := s.Check(val); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		vals[k] = val
	}
	if _, err := config.LoadFrom(config.Layer(vals)); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := config.WriteSettings(path, vals); err != nil {
		writeErr(w, http.StatusInternalServerError, "couldn't save the settings: "+err.Error())
		return
	}
	a.handleSettingsGet(w, r)
}

// handleRestart restarts Hindsight to apply the settings, unless that would
// cut something short -- the same rule as the Update button.
func (a *API) handleRestart(w http.ResponseWriter, r *http.Request) {
	if a.restart == nil {
		writeErr(w, http.StatusNotImplemented, "this Hindsight can't restart itself")
		return
	}
	if why := a.busy(); why != "" {
		writeErr(w, http.StatusConflict, "not now: "+why)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"version": a.cfg.Version})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	a.restart()
}
