package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
)

// GitHub's list, as it sends it: newest published first, every release.
const ghReleases = `[
 {"tag_name":"v2026.10.10.1","html_url":"https://github.com/x/y/releases/tag/v2026.10.10.1","published_at":"2026-10-10T09:00:00Z",
  "body":"## v2026.10.10.1 — 2026-10-10\n\n- Add a releases picker (abc1234)\n- Record v2026.10.09.10 in the changelog [skip ci] (def5678)\n"},
 {"tag_name":"v2026.10.09.10","html_url":"u10","published_at":"2026-10-09T20:00:00Z","body":"## v2026.10.09.10 — 2026-10-09\n\n- Ten (1111111)\n"},
 {"tag_name":"v2026.10.09.9","html_url":"u9","published_at":"2026-10-09T21:00:00Z","body":"## v2026.10.09.9 — 2026-10-09\n\n- No changes recorded.\n"},
 {"tag_name":"v2026.10.09.4","html_url":"u4","published_at":"2026-10-09T16:00:00Z","draft":true,"body":""},
 {"tag_name":"v2026.10.09.3","html_url":"u3","published_at":"2026-10-09T14:55:44Z","body":"## v2026.10.09.3 — 2026-10-09\n\n- Add an Update button that installs the latest release on the Pi (a237e8f)\n"},
 {"tag_name":"v2026.10.09.2","html_url":"u2","published_at":"2026-10-09T14:47:14Z","body":"## v2026.10.09.2 — 2026-10-09\n\n- Slide the lit tab (75622b2)\n"}
]`

func newReleasesRig(t *testing.T, running string) (*mux.Router, *atomic.Int32) {
	t.Helper()
	var asked atomic.Int32
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		w.Write([]byte(ghReleases))
	}))
	t.Cleanup(gh.Close)
	a := New(&config.Config{OutputDir: t.TempDir(), Version: running}, nil, nil, nil, nil)
	a.SetUpdater(&Updater{ReleasesURL: gh.URL, LatestURL: gh.URL, StateFile: t.TempDir() + "/u.json",
		Client: gh.Client(), CacheFor: time.Minute, Start: func(string) error { return nil }})
	r := mux.NewRouter()
	a.SetupRoutes(r)
	return r, &asked
}

func getReleases(t *testing.T, r *mux.Router) releasesResponse {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/update/releases", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET releases = %d %s", w.Code, w.Body)
	}
	var resp releasesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestReleasesListsFromTheFloorUpNewestFirst(t *testing.T) {
	r, _ := newReleasesRig(t, "v2026.10.09.3")
	resp := getReleases(t, r)
	var tags []string
	for _, rel := range resp.Releases {
		tags = append(tags, rel.Tag)
	}
	// .10 after .9 by number, not by text or publish date; the draft and
	// everything under the floor left out.
	want := []string{"v2026.10.10.1", "v2026.10.09.10", "v2026.10.09.9", "v2026.10.09.3"}
	if !reflect.DeepEqual(tags, want) {
		t.Fatalf("tags = %v, want %v", tags, want)
	}
	if resp.Running != "v2026.10.09.3" || resp.Floor != UpdateFloor {
		t.Fatalf("running %q floor %q", resp.Running, resp.Floor)
	}
}

func TestReleasesCarryTheirChangesWithoutChangelogNoise(t *testing.T) {
	r, _ := newReleasesRig(t, "v2026.10.09.3")
	resp := getReleases(t, r)
	if got := resp.Releases[0].Changes; !reflect.DeepEqual(got, []string{"Add a releases picker"}) {
		t.Fatalf("changes = %q", got)
	}
	if got := resp.Releases[2].Changes; len(got) != 0 {
		t.Fatalf("an empty release has changes %q", got)
	}
}

func TestReleasesAreCached(t *testing.T) {
	r, asked := newReleasesRig(t, "v2026.10.09.3")
	getReleases(t, r)
	getReleases(t, r)
	if n := asked.Load(); n != 1 {
		t.Fatalf("asked GitHub %d times", n)
	}
}

func TestReleasesAbsentWithoutAnUpdater(t *testing.T) {
	r, _ := newTestAPI(t)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/update/releases", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("= %d", w.Code)
	}
}

func TestAGitStampedBuildComparesAsItsRelease(t *testing.T) {
	cases := []struct {
		latest, running string
		want            bool
	}{
		{"v2026.10.09.3", "v2026.10.09.3-4-gabc1234", false}, // ahead of it by commits
		{"v2026.10.09.4", "v2026.10.09.3-4-gabc1234", true},
		{"v2026.10.09.4", "v2026.10.09.3-4-gabc1234-dirty", true},
		{"v2026.10.09.3", "dev", true},
	}
	for _, c := range cases {
		if got := newerRelease(c.latest, c.running); got != c.want {
			t.Errorf("newerRelease(%q, %q) = %v", c.latest, c.running, got)
		}
	}
	if !atOrAboveFloor("v2026.10.09.3") || atOrAboveFloor("v2026.10.09.2") || !atOrAboveFloor("v2026.10.10.1") || atOrAboveFloor("dev") {
		t.Fatal("floor")
	}
}
