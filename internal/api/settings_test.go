package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
)

type settingsRig struct {
	a        *API
	r        *mux.Router
	file     string
	restarts int
	busy     string
}

// newSettingsRig starts an API as Hindsight would with env as its
// environment, and settings.json in a temp dir.
func newSettingsRig(t *testing.T, env ...string) *settingsRig {
	t.Helper()
	for _, s := range config.Settings {
		t.Setenv(s.Key, "")
	}
	for i := 0; i+1 < len(env); i += 2 {
		t.Setenv(env[i], env[i+1])
	}
	rig := &settingsRig{file: filepath.Join(t.TempDir(), "settings.json")}
	t.Setenv("SETTINGS_FILE", rig.file)
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetChannels(2)
	rig.a = New(cfg, nil, nil, nil, nil)
	rig.a.busyHook = func() string { return rig.busy }
	rig.a.SetRestart(func() { rig.restarts++ })
	old := listInputs
	listInputs = func() []audio.Input {
		return []audio.Input{{Name: "Scarlett Solo 4th Gen: USB Audio (hw:3,0)", Channels: 2}}
	}
	t.Cleanup(func() { listInputs = old })
	rig.r = mux.NewRouter()
	rig.a.SetupRoutes(rig.r)
	return rig
}

func (rig *settingsRig) do(t *testing.T, method, path, body string) (*httptest.ResponseRecorder, settingsResponse) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	w := httptest.NewRecorder()
	rig.r.ServeHTTP(w, req)
	var resp settingsResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w, resp
}

func find(resp settingsResponse, key string) settingView {
	for _, s := range resp.Settings {
		if s.Key == key {
			return s
		}
	}
	return settingView{}
}

func TestSettingsGetDescribesEveryValue(t *testing.T) {
	rig := newSettingsRig(t, "MAX_SAVES", "7")
	w, resp := rig.do(t, http.MethodGet, "/api/settings", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET: %d %s", w.Code, w.Body)
	}
	if len(resp.Settings) != len(config.Settings) || resp.RestartNeeded || len(resp.Inputs) != 1 || resp.Channels != 2 {
		t.Fatalf("resp = %+v", resp)
	}
	if s := find(resp, "SAVE_MIX"); s.Value != "stereo" || s.From != "default" || s.Group != "Input" {
		t.Errorf("SAVE_MIX = %+v", s)
	}
	// From the env file: shown as such, and in effect.
	if s := find(resp, "MAX_SAVES"); s.Value != "7" || s.Running != "7" || s.From != "env" {
		t.Errorf("MAX_SAVES = %+v", s)
	}
}

func TestSettingsPutSavesAndAsksForARestart(t *testing.T) {
	rig := newSettingsRig(t)
	w, resp := rig.do(t, http.MethodPut, "/api/settings", `{"SAVE_MIX": "mono", "RING_SECONDS": " 600 "}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", w.Code, w.Body)
	}
	if !resp.RestartNeeded {
		t.Error("restart_needed false after a change")
	}
	if s := find(resp, "SAVE_MIX"); s.Value != "mono" || s.Running != "stereo" || s.From != "app" {
		t.Errorf("SAVE_MIX = %+v", s)
	}
	vals, _, err := config.ReadSettings(rig.file)
	if err != nil || vals["RING_SECONDS"] != "600" || vals["SAVE_MIX"] != "mono" {
		t.Fatalf("file: %v %v", vals, err)
	}

	// null resets to the env/default, and takes it out of the file.
	_, resp = rig.do(t, http.MethodPut, "/api/settings", `{"SAVE_MIX": null}`)
	if s := find(resp, "SAVE_MIX"); s.Value != "stereo" || s.From != "default" {
		t.Errorf("after reset SAVE_MIX = %+v", s)
	}
	vals, _, _ = config.ReadSettings(rig.file)
	if _, ok := vals["SAVE_MIX"]; ok || vals["RING_SECONDS"] != "600" {
		t.Errorf("file after reset: %v", vals)
	}
}

// Nothing is written when any part is refused, including a combination that
// only fails as a whole.
func TestSettingsPutRefusesAndWritesNothing(t *testing.T) {
	for name, body := range map[string]string{
		"unknown key":    `{"PORT": "80"}`,
		"bad value":      `{"RING_SECONDS": "ten"}`,
		"fails together": `{"CHANNELS": "2", "SAVE_CHANNELS": "3,4"}`,
		"not an object":  `["RING_SECONDS"]`,
	} {
		t.Run(name, func(t *testing.T) {
			rig := newSettingsRig(t)
			w, _ := rig.do(t, http.MethodPut, "/api/settings", body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("code = %d %s", w.Code, w.Body)
			}
			if _, err := os.Stat(rig.file); !os.IsNotExist(err) {
				t.Errorf("settings.json written: %v", err)
			}
		})
	}
}

func TestRestartWaitsUntilNothingIsBusy(t *testing.T) {
	rig := newSettingsRig(t)
	rig.busy = "a take is saving"
	w, _ := rig.do(t, http.MethodPost, "/api/restart", "")
	if w.Code != http.StatusConflict || rig.restarts != 0 {
		t.Fatalf("busy: code %d, restarts %d", w.Code, rig.restarts)
	}
	rig.busy = ""
	w, _ = rig.do(t, http.MethodPost, "/api/restart", "")
	if w.Code != http.StatusAccepted || rig.restarts != 1 {
		t.Fatalf("idle: code %d, restarts %d", w.Code, rig.restarts)
	}
}
