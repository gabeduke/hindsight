package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
)

// updateRig is an API with an Updater pointed at a fake GitHub, its state
// file in a temp dir, and Start recording what it was asked to install.
type updateRig struct {
	r       *mux.Router
	a       *API
	u       *Updater
	latest  string // what the fake GitHub says
	asked   atomic.Int32
	started []string
	busy    string
}

func newUpdateRig(t *testing.T, running string) *updateRig {
	t.Helper()
	rig := &updateRig{latest: "v2026.10.20.2"}
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rig.asked.Add(1)
		if rig.latest == "" {
			http.Error(w, "nope", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintf(w, `{"tag_name": %q}`, rig.latest)
	}))
	t.Cleanup(gh.Close)
	rig.u = &Updater{
		LatestURL: gh.URL,
		StateFile: filepath.Join(t.TempDir(), "update.json"),
		Start:     func(tag string) error { rig.started = append(rig.started, tag); return nil },
		Client:    gh.Client(),
		CacheFor:  time.Minute,
		Repo:      "gabeduke/hindsight",
	}
	rig.a = New(&config.Config{OutputDir: t.TempDir(), Version: running}, nil, nil, nil, nil)
	rig.a.SetUpdater(rig.u)
	rig.a.busyHook = func() string { return rig.busy }
	rig.r = mux.NewRouter()
	rig.a.SetupRoutes(rig.r)
	return rig
}

func (rig *updateRig) get(t *testing.T, path string) (int, updateResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	rig.r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	var resp updateResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w.Code, resp
}

func (rig *updateRig) post(t *testing.T, body string) (int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	rig.r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/update", strings.NewReader(body)))
	return w.Code, w.Body.String()
}

func TestUpdateOffersANewerRelease(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	code, resp := rig.get(t, "/api/update")
	if code != http.StatusOK || resp.Running != "v2026.10.20.1" || resp.Latest != "v2026.10.20.2" || !resp.Available ||
		resp.Notes != "https://github.com/gabeduke/hindsight/releases/tag/v2026.10.20.2" {
		t.Fatalf("GET = %d %+v", code, resp)
	}
}

func TestUpdateIsNotOfferedWhenCurrentOrAhead(t *testing.T) {
	for _, running := range []string{"v2026.10.20.2", "v2026.10.20.3", "v2026.10.21.1"} {
		rig := newUpdateRig(t, running)
		if _, resp := rig.get(t, "/api/update"); resp.Available {
			t.Errorf("running %s, latest %s: offered an update", running, resp.Latest)
		}
	}
}

func TestUpdateOffersAnyReleaseToADevBuild(t *testing.T) {
	rig := newUpdateRig(t, "dev")
	if _, resp := rig.get(t, "/api/update"); !resp.Available {
		t.Fatalf("a dev build wasn't offered %s", resp.Latest)
	}
}

func TestNewerReleaseComparesNumbersNotText(t *testing.T) {
	cases := []struct {
		latest, running string
		want            bool
	}{
		{"v2026.10.20.10", "v2026.10.20.9", true}, // text order says false
		{"v2026.10.20.9", "v2026.10.20.10", false},
		{"v2026.11.01.1", "v2026.10.31.4", true},
		{"v2026.10.20.1", "v2026.10.20.1", false},
		{"", "v2026.10.20.1", false},
		{"nonsense", "dev", false},
	}
	for _, c := range cases {
		if got := newerRelease(c.latest, c.running); got != c.want {
			t.Errorf("newerRelease(%q, %q) = %v", c.latest, c.running, got)
		}
	}
}

func TestUpdateCachesGitHubsAnswer(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	rig.get(t, "/api/update")
	rig.get(t, "/api/update")
	if n := rig.asked.Load(); n != 1 {
		t.Fatalf("asked GitHub %d times for two GETs", n)
	}
	rig.get(t, "/api/update?refresh=1")
	if n := rig.asked.Load(); n != 2 {
		t.Fatalf("refresh=1 didn't ask again (%d)", n)
	}
}

func TestUpdateSaysWhenGitHubIsOutOfReach(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	rig.latest = ""
	code, resp := rig.get(t, "/api/update")
	if code != http.StatusOK || resp.Error == "" || resp.Available {
		t.Fatalf("GET with GitHub down = %d %+v", code, resp)
	}
}

func TestUpdateGetPassesOnTheScriptsProgress(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	os.WriteFile(rig.u.StateFile, []byte(`{"state":"rolled_back","tag":"v2026.10.20.2","from":"v2026.10.20.1","message":"didn't come up; still on v2026.10.20.1","at":"2026-10-09T14:00:00Z"}`+"\n"), 0o644)
	_, resp := rig.get(t, "/api/update")
	if resp.Update == nil || resp.Update.State != "rolled_back" || resp.Update.Tag != "v2026.10.20.2" {
		t.Fatalf("update state = %+v", resp.Update)
	}
}

func TestUpdatePostStartsTheLatest(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	code, body := rig.post(t, "")
	if code != http.StatusAccepted || len(rig.started) != 1 || rig.started[0] != "v2026.10.20.2" {
		t.Fatalf("POST = %d %s, started %v", code, body, rig.started)
	}
	// It answers with the Pi's clock and leaves a queued state stamped with
	// it, which the page follows from.
	var ans struct{ Tag, Since string }
	json.Unmarshal([]byte(body), &ans)
	s := rig.u.state()
	if s == nil || s.State != "queued" || s.Tag != "v2026.10.20.2" || s.At != ans.Since || ans.Since == "" {
		t.Fatalf("after POST: answer %+v, state %+v", ans, s)
	}
}

func TestUpdatePostTakesAChunkedEmptyBody(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	req := httptest.NewRequest(http.MethodPost, "/api/update", strings.NewReader(""))
	req.ContentLength = -1
	w := httptest.NewRecorder()
	rig.r.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("chunked empty POST = %d %s", w.Code, w.Body)
	}
}

func TestUpdateRemembersAFailureOnlyBriefly(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	rig.u.CacheFor = 10 * time.Minute
	rig.latest = ""
	rig.get(t, "/api/update")
	rig.latest = "v2026.10.20.2"
	rig.u.checked = time.Now().Add(-2 * time.Minute) // past a failure's minute
	if _, resp := rig.get(t, "/api/update"); !resp.Available {
		t.Fatalf("still remembering GitHub being down: %+v", resp)
	}
	// A success is kept the full time.
	rig.u.checked = time.Now().Add(-2 * time.Minute)
	rig.latest = "v2026.10.20.3"
	if _, resp := rig.get(t, "/api/update"); resp.Latest != "v2026.10.20.2" {
		t.Fatalf("a good answer wasn't kept: %+v", resp)
	}
}

func TestUpdatePostTakesANamedTagButOnlyAReleaseTag(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	if code, _ := rig.post(t, `{"tag":"v2026.10.09.3"}`); code != http.StatusAccepted || rig.started[0] != "v2026.10.09.3" {
		t.Fatalf("named tag: %d, %v", code, rig.started)
	}
	// Older than the updater: installing it would take the button away.
	for _, bad := range []string{`{"tag":"../../etc"}`, `{"tag":"v1;rm -rf ~"}`, `{"tag":"latest"}`, `{"tag":"v2026.10.08.6"}`, `{"tag":"v2026.10.09.2"}`} {
		if code, _ := rig.post(t, bad); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", bad, code)
		}
	}
	if len(rig.started) != 1 {
		t.Fatalf("a bad tag was started: %v", rig.started)
	}
}

func TestUpdatePostRefusesWhileBusy(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	rig.busy = "a take is saving"
	code, body := rig.post(t, "")
	if code != http.StatusConflict || !strings.Contains(body, "a take is saving") || len(rig.started) != 0 {
		t.Fatalf("POST while busy = %d %s, started %v", code, body, rig.started)
	}
}

func TestUpdatePostRefusesWhileAnUpdateRuns(t *testing.T) {
	rig := newUpdateRig(t, "v2026.10.20.1")
	now := time.Now().UTC().Format(time.RFC3339)
	os.WriteFile(rig.u.StateFile, []byte(`{"state":"installing","tag":"v2026.10.20.2","at":"`+now+`"}`), 0o644)
	if code, _ := rig.post(t, ""); code != http.StatusConflict || len(rig.started) != 0 {
		t.Fatalf("second POST = %d, started %v", code, rig.started)
	}
	// One left behind by a run that died long ago doesn't block forever.
	os.WriteFile(rig.u.StateFile, []byte(`{"state":"installing","tag":"v2026.10.20.2","at":"2026-01-01T00:00:00Z"}`), 0o644)
	if code, _ := rig.post(t, ""); code != http.StatusAccepted {
		t.Fatalf("POST after a stale state = %d", code)
	}
}

func TestUpdateIsAbsentWithoutAnUpdater(t *testing.T) {
	r, _ := newTestAPI(t)
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(m, "/api/update", nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("%s /api/update without an updater = %d", m, w.Code)
		}
	}
}

func TestBusyIsQuietWithNothingGoingOn(t *testing.T) {
	a := New(&config.Config{OutputDir: t.TempDir()}, nil, nil, nil, nil)
	if why := a.busy(); why != "" {
		t.Fatalf("busy() = %q with no saver, phones or tape", why)
	}
}
