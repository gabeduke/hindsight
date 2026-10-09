package api

// The releases you can move between: GET /api/update/releases lists them,
// newest first, each with what it changed, so the page can show what moving
// from the running version to any of them would bring in or take out.
//
// The list stops at UpdateFloor, the first release with the updater in it.
// Installing anything older would take the Update button away with it, and
// the way back would be SSH.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// UpdateFloor is the oldest release the Update button will install: the
// first one that carries deploy/hindsight-update and the button itself.
const UpdateFloor = "v2026.10.09.3"

// Release is one release as the page shows it.
type Release struct {
	Tag  string `json:"tag"`
	Date string `json:"date"` // RFC 3339, when it was published
	URL  string `json:"url"`
	// Changes are its notes, one line per commit, without the changelog's
	// own [skip ci] commits or the short hashes.
	Changes []string `json:"changes"`
}

type releasesResponse struct {
	Running  string    `json:"running"`
	Floor    string    `json:"floor"`
	Releases []Release `json:"releases"`
	Error    string    `json:"error,omitempty"`
}

// compareRelease orders two versions: -1, 0 or 1, and false if either isn't
// a release. A build stamped from git (v2026.10.09.3-4-gabc123, deploy.sh)
// compares as the release it's built on: newer by commits, not by a release.
func compareRelease(a, b string) (int, bool) {
	x, okA := releaseParts(a)
	y, okB := releaseParts(b)
	if !okA || !okB {
		return 0, false
	}
	for i := 0; i < len(x) || i < len(y); i++ {
		var p, q int
		if i < len(x) {
			p = x[i]
		}
		if i < len(y) {
			q = y[i]
		}
		if p != q {
			if p < q {
				return -1, true
			}
			return 1, true
		}
	}
	return 0, true
}

// atOrAboveFloor reports whether tag is UpdateFloor or newer.
func atOrAboveFloor(tag string) bool {
	c, ok := compareRelease(tag, UpdateFloor)
	return ok && c >= 0
}

// changeLine is one commit in a release body: "- subject (abc1234)".
var changeLine = regexp.MustCompile(`^\s*-\s+(.*?)(?:\s+\([0-9a-f]{7,40}\))?\s*$`)

// releaseChanges pulls a release body's commit lines out, dropping the
// changelog's own commits, which say nothing about what the release does.
func releaseChanges(body string) []string {
	out := []string{}
	for _, line := range strings.Split(body, "\n") {
		m := changeLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		c := strings.TrimSpace(m[1])
		if c == "" || strings.Contains(c, "[skip ci]") || c == "No changes recorded." {
			continue
		}
		out = append(out, c)
	}
	return out
}

// releases is every release from UpdateFloor up, newest first, cached like
// latest: ten minutes, a failure a minute.
func (u *Updater) releases(refresh bool) ([]Release, error) {
	u.relMu.Lock()
	defer u.relMu.Unlock()
	keep := u.CacheFor
	if u.relErr != nil && keep > time.Minute {
		keep = time.Minute
	}
	if !refresh && !u.relChecked.IsZero() && time.Since(u.relChecked) < keep {
		return u.rel, u.relErr
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	u.rel, u.relErr = u.askReleases(ctx)
	u.relChecked = time.Now()
	return u.rel, u.relErr
}

func (u *Updater) askReleases(ctx context.Context) ([]Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.ReleasesURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := u.Client.Do(req)
	if err != nil {
		return nil, errors.New("couldn't reach GitHub: is the Pi online?")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %d", resp.StatusCode)
	}
	var list []struct {
		Tag        string `json:"tag_name"`
		Body       string `json:"body"`
		URL        string `json:"html_url"`
		Published  string `json:"published_at"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, errors.New("GitHub's answer wasn't a list of releases")
	}
	out := []Release{}
	for _, r := range list {
		if r.Draft || r.Prerelease || !releaseTag.MatchString(r.Tag) || !atOrAboveFloor(r.Tag) {
			continue
		}
		out = append(out, Release{Tag: r.Tag, Date: r.Published, URL: r.URL, Changes: releaseChanges(r.Body)})
	}
	// Newest first by version, not by GitHub's order, which is by date.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			if c, _ := compareRelease(out[j].Tag, out[j-1].Tag); c <= 0 {
				break
			}
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}

func (a *API) handleReleases(w http.ResponseWriter, r *http.Request) {
	u := a.updater
	if u == nil {
		writeErr(w, http.StatusNotFound, "updates aren't set up on this install")
		return
	}
	resp := releasesResponse{Running: a.cfg.Version, Floor: UpdateFloor, Releases: []Release{}}
	list, err := u.releases(r.URL.Query().Get("refresh") == "1")
	if err != nil {
		resp.Error = err.Error()
	} else {
		resp.Releases = list
	}
	writeJSON(w, http.StatusOK, resp)
}
