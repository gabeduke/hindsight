package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/hub"
)

type fakeHubStatus struct{ s hub.Status }

func (f fakeHubStatus) Status() *hub.Status { s := f.s; return &s }

// The hub is off unless configured, and then "hub" is null, on both answers.
func TestHubNullWhenOff(t *testing.T) {
	rig := newSettingsRig(t)
	w, resp := rig.do(t, http.MethodGet, "/api/settings", "")
	if resp.Hub != nil || !strings.Contains(w.Body.String(), `"hub":null`) {
		t.Fatalf("settings hub = %+v (%s)", resp.Hub, w.Body)
	}
	b, _ := json.Marshal(statusResponse{Hub: rig.a.hubStatus()})
	if !strings.Contains(string(b), `"hub":null`) {
		t.Fatalf("status: %s", b)
	}
}

func TestHubOnSettings(t *testing.T) {
	rig := newSettingsRig(t)
	na := time.Date(2027, 1, 7, 0, 0, 0, 0, time.UTC)
	rig.a.SetHub(fakeHubStatus{hub.Status{Name: "mike.hindsight.leetserve.com",
		URL: "https://mike.hindsight.leetserve.com", CertNotAfter: &na}})
	w, resp := rig.do(t, http.MethodGet, "/api/settings", "")
	if resp.Hub == nil || resp.Hub.URL != "https://mike.hindsight.leetserve.com" {
		t.Fatalf("settings hub = %+v (%s)", resp.Hub, w.Body)
	}
	for _, k := range []string{`"name"`, `"url"`, `"last_heartbeat":null`, `"error":""`, `"cert_not_after":"2027-01-07T00:00:00Z"`} {
		if !strings.Contains(w.Body.String(), k) {
			t.Errorf("missing %s in %s", k, w.Body)
		}
	}
}
