package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The crate (step B1, docs/superpowers/specs/2026-10-07-crate-design.md): the
// pieces you keep, between a take and a tape. A kept clip is what a tape clip
// is -- a window onto an immutable WAV in the pool -- with a name, where it
// came from and when. The crate is off every screen (decision 0009): what
// still fills it is a buffer replaced unused (grab.go, keepBoard), and a take's
// span kept (KeepTake); a range's Insert can still take a clip from it
// (timeedit.go). The takes list never changes, and MAX_SAVES's pruning never
// touches the crate: a clip outlives the take it came from. The crate is a
// root for clean-up, as the clipboard is.

// CrateTrashDays is how long a clip deleted from the crate can be brought
// back before it's gone for good.
const CrateTrashDays = 7

// CrateClip is one kept clip.
type CrateClip struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	File     string      `json:"file"`
	Src      int64       `json:"src"`
	Frames   int64       `json:"frames"`
	Reversed *Reversal   `json:"reversed,omitempty"`
	BPM      float64     `json:"bpm,omitempty"` // the take's tempo, or the tape's, if it had one
	Source   CrateSource `json:"source"`
	Created  time.Time   `json:"created"`
	Deleted  *time.Time  `json:"deleted,omitempty"`
}

// CrateSource says where a kept clip came from.
type CrateSource struct {
	Kind string `json:"kind"`           // take, ring, tape or clipboard
	Take string `json:"take,omitempty"` // the take's file, for a take
	From int64  `json:"from,omitempty"` // its span, in the take's (or the ring's) frames
	To   int64  `json:"to,omitempty"`
	Tape string `json:"tape,omitempty"` // the tape's id, for a tape clip
	What string `json:"what"`           // in words: "Tuesday jam, 0:42–1:10"
}

// Crate is crate.json.
type Crate struct {
	Clips []CrateClip `json:"clips"`
}

// clip is a crate clip as a tape clip, to drop or play.
func (k CrateClip) clip() Clip {
	return Clip{File: k.File, Src: k.Src, Frames: k.Frames, Reversed: k.Reversed, Source: "crate"}
}

func (c *Crate) files(into map[string]bool) {
	if c == nil {
		return
	}
	for _, k := range c.Clips {
		k.clip().poolFiles(into)
	}
}

func (s *Store) cratePath() string { return filepath.Join(s.dir, "crate.json") }

// LoadCrate reads the crate; an empty one when there's none yet.
func (s *Store) LoadCrate() (*Crate, error) {
	b, err := os.ReadFile(s.cratePath())
	if errors.Is(err, fs.ErrNotExist) {
		return &Crate{Clips: []CrateClip{}}, nil
	}
	if err != nil {
		return nil, err
	}
	var c Crate
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("crate: %w", err)
	}
	if c.Clips == nil {
		c.Clips = []CrateClip{}
	}
	return &c, nil
}

// SaveCrate replaces crate.json.
func (s *Store) SaveCrate(c *Crate) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	defer s.bump()
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return writeSynced(s.cratePath(), b)
}

var ErrNoSuchCrateClip = errors.New("no such clip in the crate")

// changeCrate reads the crate, lets fn change it, and saves it, one change at
// a time.
func (e *Engine) changeCrate(fn func(c *Crate) error) error {
	e.crateMu.Lock()
	defer e.crateMu.Unlock()
	c, err := e.store.LoadCrate()
	if err != nil {
		return err
	}
	if err := fn(c); err != nil {
		return err
	}
	return e.store.SaveCrate(c)
}

// CrateList is the crate, newest first, without what was deleted. With q,
// only the clips whose name holds it (any case); with take, only those kept
// from that take. Clips deleted more than CrateTrashDays ago are let go of
// for good here; clean-up then frees their audio.
func (e *Engine) CrateList(q, take string) ([]CrateClip, error) {
	c, err := e.store.LoadCrate()
	if err != nil {
		return nil, err
	}
	stale := func(k CrateClip) bool {
		return k.Deleted != nil && time.Since(*k.Deleted) > CrateTrashDays*24*time.Hour
	}
	for _, k := range c.Clips {
		if stale(k) {
			err := e.changeCrate(func(c *Crate) error {
				kept := c.Clips[:0]
				for _, k := range c.Clips {
					if !stale(k) {
						kept = append(kept, k)
					}
				}
				c.Clips = kept
				return nil
			})
			if err != nil {
				return nil, err
			}
			break
		}
	}
	q = strings.ToLower(strings.TrimSpace(q))
	out := []CrateClip{}
	for _, k := range c.Clips {
		if k.Deleted != nil || (q != "" && !strings.Contains(strings.ToLower(k.Name), q)) || (take != "" && k.Source.Take != take) {
			continue
		}
		out = append(out, k)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Created.After(out[b].Created) })
	return out, nil
}

// CrateClip finds a kept clip, deleted or not.
func (e *Engine) CrateClip(id string) (CrateClip, error) {
	c, err := e.store.LoadCrate()
	if err != nil {
		return CrateClip{}, err
	}
	for _, k := range c.Clips {
		if k.ID == id {
			return k, nil
		}
	}
	return CrateClip{}, ErrNoSuchCrateClip
}

// newCrateID makes a kept clip's id: "k" and eight hex characters.
func newCrateID() string { return "k" + NewClipID()[1:] }

func (e *Engine) addToCrate(k CrateClip) (CrateClip, error) {
	k.ID = newCrateID()
	k.Created = time.Now()
	return k, e.changeCrate(func(c *Crate) error {
		c.Clips = append(c.Clips, k)
		return nil
	})
}

// clock reads frames as m:ss.
func clock(frames int64, sr int) string {
	s := frames / int64(sr)
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}

// KeepTake keeps frames [from, to) of a take: its pair written into the pool
// with handles, named for the take (name, as the page shows it) and where
// in it the span starts.
func (e *Engine) KeepTake(take, file, name string, from, to int64, pick []int) (CrateClip, error) {
	// No longer than a track: it could never be dropped.
	if err := e.tooLong(to - from); err != nil {
		return CrateClip{}, err
	}
	k, err := e.takeClip(take, file, fmt.Sprintf("%s · %s", name, clock(from, e.store.SampleRate())), name, from, to, pick)
	if err != nil {
		return CrateClip{}, err
	}
	return e.addToCrate(k)
}

// takeClip copies a take's span into the pool as a crate clip, not yet kept.
func (e *Engine) takeClip(take, file, clipName, takeName string, from, to int64, pick []int) (CrateClip, error) {
	c, err := e.copyTake(take, from, to, pick, "keep")
	if err != nil {
		return CrateClip{}, err
	}
	sr := e.store.SampleRate()
	k := CrateClip{File: c.File, Src: c.Src, Frames: c.Frames, Name: clipName,
		Source: CrateSource{Kind: "take", Take: file, From: from, To: to, What: fmt.Sprintf("%s, %s–%s", takeName, clock(from, sr), clock(to, sr))}}
	if m := audio.ReadMeta(take); m.BPM != nil {
		k.BPM = *m.BPM
	}
	return k, nil
}
