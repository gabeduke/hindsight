package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
)

func newRibbonAPI(t *testing.T) (*mux.Router, *audio.Capture, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{OutputDir: dir, Channels: 2, SampleRate: 48000, FramesPerBuf: 256, RingSeconds: 10, SaveChannels: []int{0, 1}}
	cap := audio.NewCapture(cfg, nil)
	s := audio.NewSaver(cap)
	t.Cleanup(s.WaitBackground)
	a := New(cfg, cap, s, cap.Envelope(), nil)
	t.Cleanup(a.WaitBackground) // a preview encode must not outlive the takes folder
	r := mux.NewRouter()
	a.SetupRoutes(r)
	return r, cap, dir
}

func TestTriggerSavesAnyAbsoluteSpan(t *testing.T) {
	r, cap, dir := newRibbonAPI(t)
	cap.Ring().WriteFrames(make([]int32, 48000*4*2))

	w := do(t, r, http.MethodPost, "/api/trigger?from=48000&to=96000")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Name    string  `json:"name"`
		Seconds float64 `json:"seconds"`
		From    uint64  `json:"from_frame"`
		To      uint64  `json:"to_frame"`
		Clamped bool    `json:"clamped"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if got.Seconds != 1 || got.From != 48000 || got.To != 96000 || got.Clamped {
		t.Fatalf("answer = %+v", got)
	}
	if info, err := audio.ReadWAVInfo(filepath.Join(dir, got.Name)); err != nil || info.Frames() != 48000 {
		t.Fatalf("take = %+v %v", info, err)
	}
	// From a flag to now: no "to".
	w = do(t, r, http.MethodPost, "/api/trigger?from=144000")
	json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != http.StatusOK || got.To != 192000 {
		t.Fatalf("from-to-now = %d %+v", w.Code, got)
	}
	for _, bad := range []string{"from=x", "from=10&to=5", "from=10&to=x"} {
		if w := do(t, r, http.MethodPost, "/api/trigger?"+bad); w.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", bad, w.Code)
		}
	}
	// Past the ring's newest frame: nothing there to save.
	if w := do(t, r, http.MethodPost, "/api/trigger?from=500000"); w.Code != http.StatusConflict {
		t.Errorf("a span after now = %d, want 409", w.Code)
	}
}

func TestTheEnvelopeSaysWhereNowIs(t *testing.T) {
	r, cap, _ := newRibbonAPI(t)
	cap.Ring().WriteFrames(make([]int32, 1234*2))
	var env envelopeResponse
	json.Unmarshal(do(t, r, http.MethodGet, "/api/envelope?buckets=10").Body.Bytes(), &env)
	if env.TotalFrames != 1234 || env.SampleRate != 48000 {
		t.Fatalf("envelope says total %d at %d Hz", env.TotalFrames, env.SampleRate)
	}
}
