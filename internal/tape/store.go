package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// The store is TAPE_DIR:
//
//	audio/                 one pool for every tape and the clipboard; files never change
//	tapes/<id>/tape.json   one tape
//
// tape.json is rewritten after every operation: to a temporary file, synced,
// renamed, and the folder synced, so a power cut leaves the old version or
// the new one, never half of either.

var (
	ErrNoSuchTape = errors.New("no such tape")
	idPattern     = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9-]{1,40}(_[0-9]+)?$`)
	poolPattern   = regexp.MustCompile(`^audio/[A-Za-z0-9_.-]+\.wav$`)
)

// Store holds the tapes and the audio pool.
type Store struct {
	dir        string
	sampleRate int
	tracks     int
	length     int64 // frames a track holds

	mu sync.Mutex // one writer of tape.json files and pool names at a time
}

// OpenStore opens (and makes) a tape store.
func OpenStore(dir string, sampleRate, tracks int, lengthSeconds int) (*Store, error) {
	if tracks < 1 || tracks > 16 || sampleRate <= 0 || lengthSeconds <= 0 {
		return nil, fmt.Errorf("%w: store settings", ErrBadParameter)
	}
	for _, d := range []string{dir, filepath.Join(dir, "audio"), filepath.Join(dir, "tapes")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	return &Store{dir: dir, sampleRate: sampleRate, tracks: tracks, length: int64(lengthSeconds) * int64(sampleRate)}, nil
}

// Dir is the store's folder.
func (s *Store) Dir() string { return s.dir }

// SampleRate is the rate every tape and pool file in the store is at.
func (s *Store) SampleRate() int { return s.sampleRate }

// AudioPath is where a clip's file is, from its relative name; "" for a name
// that isn't a pool file.
func (s *Store) AudioPath(rel string) string {
	if !poolPattern.MatchString(rel) {
		return ""
	}
	return filepath.Join(s.dir, filepath.FromSlash(rel))
}

// NewPoolFile reserves a pool file name: <prefix>_<time>.wav, or _2, _3 for
// a second in the same second, so an immutable file is never overwritten. It
// returns the relative name and the path of the reserved (empty) file.
func (s *Store) NewPoolFile(prefix string, at time.Time) (rel, path string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ts := at.Format("2006-01-02_150405")
	for n := 1; n < 1000; n++ {
		name := fmt.Sprintf("%s_%s.wav", prefix, ts)
		if n > 1 {
			name = fmt.Sprintf("%s_%s_%d.wav", prefix, ts, n)
		}
		rel = "audio/" + name
		path = filepath.Join(s.dir, "audio", name)
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", "", err
		}
		f.Close()
		return rel, path, nil
	}
	return "", "", errors.New("no free pool name")
}

func (s *Store) tapeDir(id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", ErrNoSuchTape
	}
	return filepath.Join(s.dir, "tapes", id), nil
}

// slug turns a name into an id's tail: lowercase letters, digits and dashes.
func slug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case !dash && b.Len() > 0:
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= 40 {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "tape"
	}
	return out
}

// Create makes a new, empty tape. With bpm > 0 it starts with that tempo's
// grid of bars (default 4), and the loop set to it.
func (s *Store) Create(name string, bpm float64, bars int, now time.Time) (*Tape, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	name = strings.TrimSpace(name)
	if name == "" {
		name = now.Format("Jan 2 15:04")
	}
	base := now.Format("2006-01-02") + "_" + slug(name)
	id := base
	for n := 2; ; n++ {
		_, err := os.Stat(filepath.Join(s.dir, "tapes", id))
		if errors.Is(err, fs.ErrNotExist) {
			break
		}
		if err != nil {
			return nil, err
		}
		id = fmt.Sprintf("%s_%d", base, n)
	}
	t := NewTape(id, name, s.sampleRate, s.length, s.tracks, now)
	if bpm > 0 {
		if bars <= 0 {
			bars = 4
		}
		if bpm < 20 || bpm > 400 || bars > 64 {
			return nil, fmt.Errorf("%w: tempo 20–400 BPM, up to 64 bars", ErrBadParameter)
		}
		g := GridFor(bpm, bars, s.sampleRate)
		t.Grid = &g
		t.Loop = Loop{In: 0, Out: g.Frames, On: true}
	}
	if err := t.State.validate(t.Length); err != nil {
		return nil, fmt.Errorf("%w: that loop is longer than a track", err)
	}
	dir := filepath.Join(s.dir, "tapes", id)
	if err := os.Mkdir(dir, 0o755); err != nil {
		return nil, err
	}
	if err := s.writeLocked(t); err != nil {
		os.RemoveAll(dir) // no folder without its tape.json
		return nil, err
	}
	return t, nil
}

// Load reads a tape.
func (s *Store) Load(id string) (*Tape, error) {
	dir, err := s.tapeDir(id)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(dir, "tape.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNoSuchTape
	}
	if err != nil {
		return nil, err
	}
	var t Tape
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, fmt.Errorf("tape %s: %w", id, err)
	}
	if t.Version > Version {
		return nil, fmt.Errorf("tape %s was written by a newer version", id)
	}
	t.ID = id
	// A tape made when tracks were shorter is as long as they are now: the
	// length is a limit, and raising it moves nothing. A longer one keeps its
	// own.
	if t.Length < s.length {
		t.Length = s.length
	}
	for i := range t.Tracks {
		if t.Tracks[i].Clips == nil {
			t.Tracks[i].Clips = []Clip{}
		}
	}
	return &t, nil
}

// Remember notes which tape is loaded, so a restart loads it again.
func (s *Store) Remember(id string) error {
	if _, err := s.tapeDir(id); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeSynced(filepath.Join(s.dir, "loaded"), []byte(id+"\n"))
}

// Remembered is the tape Remember last noted, if it's still there; else the
// most recently changed one; else "".
func (s *Store) Remembered() string {
	if b, err := os.ReadFile(filepath.Join(s.dir, "loaded")); err == nil {
		id := strings.TrimSpace(string(b))
		if dir, err := s.tapeDir(id); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "tape.json")); err == nil {
				return id
			}
		}
	}
	if list, err := s.List(); err == nil && len(list) > 0 {
		return list[0].ID
	}
	return ""
}

// Save writes a tape.json atomically.
func (s *Store) Save(t *Tape) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writeLocked(t)
}

func (s *Store) writeLocked(t *Tape) error {
	dir, err := s.tapeDir(t.ID)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(t, "", " ")
	if err != nil {
		return err
	}
	return writeSynced(filepath.Join(dir, "tape.json"), b)
}

// writeSynced writes path through a synced temporary file, then syncs the
// folder, so the rename itself survives a power cut.
func writeSynced(path string, b []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tape-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
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
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
	return nil
}

// Summary is a tape as the browser lists it.
type Summary struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Created  time.Time `json:"created"`
	BPM      float64   `json:"bpm,omitempty"`
	Bars     int       `json:"bars,omitempty"`
	Seconds  float64   `json:"seconds"` // how far the material runs
	Clips    int       `json:"clips"`
	SizeMB   float64   `json:"size_mb"` // the pool audio it uses
	Modified time.Time `json:"modified"`
}

// List describes every tape, newest first.
func (s *Store) List() ([]Summary, error) {
	entries, err := os.ReadDir(filepath.Join(s.dir, "tapes"))
	if err != nil {
		return nil, err
	}
	var out []Summary
	for _, e := range entries {
		if !e.IsDir() || !idPattern.MatchString(e.Name()) {
			continue
		}
		t, err := s.Load(e.Name())
		if err != nil {
			continue
		}
		sum := Summary{ID: t.ID, Name: t.Name, Created: t.Created, Seconds: float64(t.MaterialEnd()) / float64(t.SampleRate)}
		if fi, err := os.Stat(filepath.Join(s.dir, "tapes", e.Name(), "tape.json")); err == nil {
			sum.Modified = fi.ModTime()
		}
		if t.Grid != nil {
			sum.BPM = round2(t.Grid.BPM(t.SampleRate))
			sum.Bars = t.Grid.Bars
		}
		files := map[string]bool{}
		for _, tr := range t.Tracks {
			sum.Clips += len(tr.Clips)
			for _, c := range tr.Clips {
				files[c.File] = true
			}
		}
		var size int64
		for f := range files {
			if fi, err := os.Stat(s.AudioPath(f)); err == nil {
				size += fi.Size()
			}
		}
		sum.SizeMB = float64(size) / (1 << 20)
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified.After(out[j].Modified) })
	return out, nil
}

func round2(v float64) float64 { return float64(int64(v*100+0.5)) / 100 }

// Delete removes a tape. Its audio stays in the pool until a clean-up finds
// nothing using it, so a clone's audio is never lost with the original.
func (s *Store) Delete(id string) error {
	dir, err := s.tapeDir(id)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, "tape.json")); err != nil {
		return ErrNoSuchTape
	}
	return os.RemoveAll(dir)
}

// Clone makes a new tape that shares this one's audio: only tape.json is
// copied, so it's instant and costs nothing. Its undo history starts fresh.
func (s *Store) Clone(id, name string, now time.Time) (*Tape, error) {
	src, err := s.Load(id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		name = src.Name + " copy"
	}
	t, err := s.Create(name, 0, 0, now)
	if err != nil {
		return nil, err
	}
	t.State = src.State.clone()
	t.Click = src.Click
	if err := s.Save(t); err != nil {
		return nil, err
	}
	return t, nil
}

// Cleanup removes pool audio that no tape, no tape's undo history, the
// clipboard, the crate and nothing in keep refers to. It runs after a tape is deleted,
// and when asked.
func (s *Store) Cleanup(keep []string) (removed int, freedMB float64, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	used := map[string]bool{}
	for _, k := range keep {
		used[k] = true
	}
	// The clipboard is a root too. One that can't be read might hold any
	// copy, so every copy is kept until it's cleared.
	c, cerr := s.LoadClipboard()
	c.files(used)
	// So is the crate, its deleted clips too until they're let go of. One
	// that can't be read might keep anything: nothing is cleaned up.
	k, err := s.LoadCrate()
	if err != nil {
		return 0, 0, fmt.Errorf("the crate can't be read, so nothing was cleaned up: %w", err)
	}
	k.files(used)
	entries, err := os.ReadDir(filepath.Join(s.dir, "tapes"))
	if err != nil {
		return 0, 0, err
	}
	for _, e := range entries {
		if !e.IsDir() || !idPattern.MatchString(e.Name()) {
			continue
		}
		t, err := s.Load(e.Name())
		if errors.Is(err, ErrNoSuchTape) {
			continue // a folder with no tape.json: nothing in it uses audio
		}
		if err != nil {
			// A tape that can't be read might still use anything: keep it all.
			return 0, 0, fmt.Errorf("tape %s can't be read, so nothing was cleaned up: %w", e.Name(), err)
		}
		for _, st := range append(append([]State{t.State}, t.History...), t.Future...) {
			st.files(used)
		}
	}
	pool, err := os.ReadDir(filepath.Join(s.dir, "audio"))
	if err != nil {
		return 0, 0, err
	}
	for _, e := range pool {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".wav") || used["audio/"+name] {
			continue
		}
		if cerr != nil && strings.HasPrefix(name, "copy_") {
			continue
		}
		p := filepath.Join(s.dir, "audio", name)
		if fi, err := os.Stat(p); err == nil {
			// A file reserved a moment ago, still being written, isn't
			// garbage yet.
			if time.Since(fi.ModTime()) < time.Minute {
				continue
			}
			freedMB += float64(fi.Size()) / (1 << 20)
		}
		if os.Remove(p) == nil {
			removed++
			os.Remove(strings.TrimSuffix(p, ".wav") + ".peaks.json")
		}
	}
	return removed, freedMB, nil
}
