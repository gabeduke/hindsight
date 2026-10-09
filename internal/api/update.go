package api

// The Update button: is there a newer release, and install it.
//
// Installing is deploy/hindsight-update's job, run as the systemd user unit
// hindsight-update@<tag>.service. It runs outside this process on purpose:
// the release's install.sh restarts Hindsight, and an updater that was a
// child of Hindsight would die with it, halfway. This side only asks GitHub
// what the latest release is, says whether it's newer than what's running,
// refuses while something is being recorded, and starts the unit. The unit
// writes its progress to ~/hindsight/update.json, which GET /api/update
// passes on, so the page can follow it across the restart.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Updater knows where releases come from and how to start an install. The
// zero value is not usable; NewUpdater fills it.
type Updater struct {
	// LatestURL answers GitHub's "latest release" JSON ({"tag_name": ...}).
	LatestURL string
	// StateFile is where deploy/hindsight-update writes its progress.
	StateFile string
	// Start begins installing tag outside this process.
	Start func(tag string) error
	// Client asks LatestURL. Short timeout: a Pi with no internet should say
	// so quickly, not hang the page.
	Client *http.Client
	// CacheFor is how long an answer from GitHub is reused. Unauthenticated,
	// GitHub allows 60 asks an hour from one address. A failure is reused
	// for a minute at most, so one blip doesn't hide the button for long.
	CacheFor time.Duration
	// Repo is owner/repo, for the link to a release's notes.
	Repo string

	mu      sync.Mutex
	tag     string
	err     error
	checked time.Time
}

// NewUpdater is the updater on a Pi set up by install.sh or deploy.sh: the
// script beside the binary, the state file in ~/hindsight, and the user
// unit started with systemctl. It returns nil -- no Update button -- where
// the script isn't installed: a Mac, the demo, CI.
func NewUpdater(repo string) *Updater {
	exe, err := os.Executable()
	if err != nil {
		return nil
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return nil
	}
	bin := filepath.Dir(exe)
	if fi, err := os.Stat(filepath.Join(bin, "hindsight-update")); err != nil || fi.IsDir() {
		return nil
	}
	api := "https://api.github.com"
	// The same override deploy/hindsight-update reads, for testing against a
	// stand-in for GitHub.
	if v := os.Getenv("UPDATE_GITHUB_API"); v != "" {
		api = strings.TrimRight(v, "/")
	}
	return &Updater{
		LatestURL: api + "/repos/" + repo + "/releases/latest",
		StateFile: filepath.Join(filepath.Dir(bin), "update.json"),
		Start: func(tag string) error {
			// --no-block: the unit takes minutes and restarts us; the
			// request only needs to know it was queued.
			out, err := exec.Command("systemctl", "--user", "start", "--no-block",
				"hindsight-update@"+tag+".service").CombinedOutput()
			if err != nil {
				return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
			}
			return nil
		},
		Client:   &http.Client{Timeout: 8 * time.Second},
		CacheFor: 10 * time.Minute,
		Repo:     repo,
	}
}

// SetUpdater turns the Update button on. nil leaves it off.
func (a *API) SetUpdater(u *Updater) { a.updater = u }

// releaseTag is every tag release.yml makes: vYYYY.MM.DD.N. The updater
// script checks the same shape before it builds a path or a URL from one.
var releaseTag = regexp.MustCompile(`^v[0-9A-Za-z._-]+$`)

// newerRelease reports whether latest is a newer release than running. A
// build that isn't a release (deploy.sh's "dev") can't be compared, so any
// release counts as newer: installing it is how you get onto releases.
func newerRelease(latest, running string) bool {
	if latest == "" || latest == running {
		return false
	}
	l, okL := releaseParts(latest)
	r, okR := releaseParts(running)
	if !okL {
		return false
	}
	if !okR {
		return true
	}
	for i := range l {
		if i >= len(r) {
			return true
		}
		if l[i] != r[i] {
			return l[i] > r[i]
		}
	}
	return false
}

func releaseParts(tag string) ([]int, bool) {
	if !strings.HasPrefix(tag, "v") {
		return nil, false
	}
	fields := strings.Split(tag[1:], ".")
	out := make([]int, len(fields))
	for i, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			return nil, false
		}
		out[i] = n
	}
	return out, true
}

// latest is the newest release's tag, from GitHub or from the last answer
// while it's fresh. refresh asks again regardless. The ask isn't tied to the
// request that prompted it: a phone that navigates away mid-ask mustn't leave
// a cancelled answer cached for everyone.
func (u *Updater) latest(refresh bool) (string, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	keep := u.CacheFor
	if u.err != nil && keep > time.Minute {
		keep = time.Minute
	}
	if !refresh && !u.checked.IsZero() && time.Since(u.checked) < keep {
		return u.tag, u.err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	u.tag, u.err = u.ask(ctx)
	u.checked = time.Now()
	return u.tag, u.err
}

func (u *Updater) ask(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.LatestURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := u.Client.Do(req)
	if err != nil {
		return "", errors.New("couldn't reach GitHub: is the Pi online?")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub answered %d", resp.StatusCode)
	}
	var body struct {
		Tag string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || !releaseTag.MatchString(body.Tag) {
		return "", errors.New("GitHub's answer had no release in it")
	}
	return body.Tag, nil
}

// UpdateState is the updater script's progress, as it writes it.
type UpdateState struct {
	// State is queued (written here, as the unit is started), checking,
	// downloading, installing, rolling_back, done, rolled_back or failed.
	State   string `json:"state"`
	Tag     string `json:"tag"`
	From    string `json:"from"`
	Message string `json:"message"`
	At      string `json:"at"`
}

// inFlight says an update is under way: a working state, written recently.
// The time matters because a run killed outright (the Pi lost power) leaves
// its last state behind for good.
func (s *UpdateState) inFlight(now time.Time) bool {
	if s == nil {
		return false
	}
	switch s.State {
	case "queued", "checking", "downloading", "installing", "rolling_back":
	default:
		return false
	}
	at, err := time.Parse(time.RFC3339, s.At)
	return err == nil && now.Sub(at) < 15*time.Minute
}

// queue writes the queued state the page follows from, stamped with this
// machine's clock; the script then overwrites it with its own steps. The page
// tells this run's states from last time's by that stamp, not by the
// phone's clock, which needn't agree with the Pi's.
func (u *Updater) queue(tag, from string, at time.Time) error {
	b, _ := json.Marshal(UpdateState{State: "queued", Tag: tag, From: from,
		Message: "waiting for the updater to start", At: at.UTC().Format(time.RFC3339)})
	tmp := u.StateFile + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, u.StateFile)
}

func (u *Updater) state() *UpdateState {
	b, err := os.ReadFile(u.StateFile)
	if err != nil {
		return nil
	}
	var s UpdateState
	if json.Unmarshal(b, &s) != nil || s.State == "" {
		return nil
	}
	return &s
}

type updateResponse struct {
	Running   string `json:"running"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
	// Notes is the latest release's page on GitHub.
	Notes  string       `json:"notes,omitempty"`
	Update *UpdateState `json:"update"`
}

func (a *API) handleUpdateGet(w http.ResponseWriter, r *http.Request) {
	u := a.updater
	if u == nil {
		writeErr(w, http.StatusNotFound, "updates aren't set up on this install")
		return
	}
	resp := updateResponse{Running: a.cfg.Version, Update: u.state()}
	tag, err := u.latest(r.URL.Query().Get("refresh") == "1")
	if err != nil {
		resp.Error = err.Error()
	}
	resp.Latest = tag
	if tag != "" && u.Repo != "" {
		resp.Notes = "https://github.com/" + u.Repo + "/releases/tag/" + tag
	}
	resp.Available = newerRelease(tag, a.cfg.Version)
	writeJSON(w, http.StatusOK, resp)
}

// busy names what an update would cut short, or "" if nothing would. The
// ring is lost to a restart however it goes; these are the things lost
// halfway.
func (a *API) busy() string {
	if a.busyHook != nil {
		return a.busyHook()
	}
	if a.saver != nil && a.saver.Saving() {
		return "a take is saving"
	}
	a.phones.mu.Lock()
	phones := len(a.phones.sessions)
	a.phones.mu.Unlock()
	if phones > 0 {
		return "a phone is recording"
	}
	if a.tape != nil {
		if a.tape.Recording() != nil {
			return "the tape is recording"
		}
		if a.tape.Live().Playing {
			return "the tape is playing"
		}
	}
	return ""
}

func (a *API) handleUpdatePost(w http.ResponseWriter, r *http.Request) {
	u := a.updater
	if u == nil {
		writeErr(w, http.StatusNotFound, "updates aren't set up on this install")
		return
	}
	var body struct {
		Tag string `json:"tag"`
	}
	// No body (chunked or not) means the latest.
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeErr(w, http.StatusBadRequest, "bad JSON")
		return
	}
	tag := body.Tag
	if tag == "" {
		latest, err := u.latest(false)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		tag = latest
	}
	if !releaseTag.MatchString(tag) {
		writeErr(w, http.StatusBadRequest, "not a release tag")
		return
	}
	if s := u.state(); s.inFlight(time.Now()) {
		writeErr(w, http.StatusConflict, "an update is already under way")
		return
	}
	if why := a.busy(); why != "" {
		writeErr(w, http.StatusConflict, "not now: "+why)
		return
	}
	now := time.Now().Truncate(time.Second)
	if err := u.queue(tag, a.cfg.Version, now); err != nil {
		writeErr(w, http.StatusInternalServerError, "couldn't write the update's state: "+err.Error())
		return
	}
	if err := u.Start(tag); err != nil {
		_ = os.Remove(u.StateFile)
		writeErr(w, http.StatusInternalServerError, "couldn't start the update: "+err.Error())
		return
	}
	// since is this machine's clock: the page compares the script's stamps
	// with it, never with its own.
	writeJSON(w, http.StatusAccepted, map[string]string{"tag": tag, "since": now.UTC().Format(time.RFC3339)})
}
