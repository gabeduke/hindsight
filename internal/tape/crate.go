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
// came from and when. Keeping a span of a take or of the ring writes its
// audio into the pool, with handles; keeping a tape clip or the clipboard
// keeps a reference and copies nothing. The takes list never changes, and
// MAX_SAVES's pruning never touches the crate: a clip outlives the take it
// came from. The crate is a root for clean-up, as the clipboard is.

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

func (e *Engine) addToCrate(k CrateClip) (CrateClip, error) {
	k.ID = "k" + NewClipID()[1:]
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
	c, err := e.copyTake(take, from, to, pick, "keep")
	if err != nil {
		return CrateClip{}, err
	}
	sr := e.store.SampleRate()
	k := CrateClip{File: c.File, Src: c.Src, Frames: c.Frames,
		Name:   fmt.Sprintf("%s · %s", name, clock(from, sr)),
		Source: CrateSource{Kind: "take", Take: file, From: from, To: to, What: fmt.Sprintf("%s, %s–%s", name, clock(from, sr), clock(to, sr))}}
	if m := audio.ReadMeta(take); m.BPM != nil {
		k.BPM = *m.BPM
	}
	return e.addToCrate(k)
}

// KeepRing keeps ring frames [from, to) of a source (to < 0: up to now), as
// CopyRing copies them to the clipboard.
func (e *Engine) KeepRing(from, to int64, source string) (CrateClip, bool, error) {
	c, src, clamped, err := e.ringClip(from, to, source, "keep")
	if err != nil {
		return CrateClip{}, false, err
	}
	k := CrateClip{File: c.File, Src: c.Src, Frames: c.Frames,
		Name:   fmt.Sprintf("The ribbon (%s) · %s", src, time.Now().Format("15:04")),
		Source: CrateSource{Kind: "ring", From: from, To: from + c.Frames, What: fmt.Sprintf("the ribbon (%s), %.1f s", src, float64(c.Frames)/float64(e.store.SampleRate()))}}
	k, err = e.addToCrate(k)
	return k, clamped, err
}

// KeepTapeClip keeps a clip of the loaded tape, by reference: the same audio,
// nothing copied.
func (e *Engine) KeepTapeClip(id, clipID string) (CrateClip, error) {
	t := e.Loaded()
	if t == nil {
		return CrateClip{}, ErrNoTape
	}
	if t.ID != id {
		return CrateClip{}, ErrWrongTape
	}
	tr, c, err := t.Clip(clipID)
	if err != nil {
		return CrateClip{}, err
	}
	sr := t.SampleRate
	what := fmt.Sprintf("%s, track %d at %s", t.Name, tr.N, clock(c.At, sr))
	if t.Grid != nil {
		what = fmt.Sprintf("%s, track %d at bar %d", t.Name, tr.N, t.Grid.BarAt(c.At)+1)
	}
	k := CrateClip{File: c.File, Src: c.Src, Frames: c.Frames, Reversed: c.Reversed,
		Name:   fmt.Sprintf("%s · track %d", t.Name, tr.N),
		Source: CrateSource{Kind: "tape", Tape: t.ID, What: what}}
	if t.Grid != nil {
		k.BPM = t.Grid.BPM(sr)
	}
	return e.addToCrate(k)
}

// KeepClipboard keeps what's on the clipboard, by reference. A kept clip is
// one window onto one file, so the clipboard must hold one clip.
func (e *Engine) KeepClipboard() (CrateClip, error) {
	b, err := e.Clipboard()
	if err != nil {
		return CrateClip{}, err
	}
	if b.Empty() {
		return CrateClip{}, ErrEmptyClipboard
	}
	var one []Clip
	for _, tr := range b.Tracks {
		one = append(one, tr...)
	}
	if len(one) != 1 || one[0].At != 0 || one[0].Frames != b.Frames {
		return CrateClip{}, fmt.Errorf("%w: the clipboard holds %d clips; keep them one at a time, from the tape", ErrBadParameter, len(one))
	}
	c := one[0]
	k := CrateClip{File: c.File, Src: c.Src, Frames: c.Frames, Reversed: c.Reversed, BPM: b.BPM,
		Name:   fmt.Sprintf("%s · %s", b.From, clock(c.Frames, e.store.SampleRate())),
		Source: CrateSource{Kind: "clipboard", What: b.From}}
	return e.addToCrate(k)
}

// RenameCrateClip names a kept clip.
func (e *Engine) RenameCrateClip(id, name string) (CrateClip, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 {
		return CrateClip{}, fmt.Errorf("%w: a name of 1 to 120 characters", ErrBadParameter)
	}
	return e.updateCrateClip(id, func(k *CrateClip) { k.Name = name })
}

// DeleteCrateClip puts a kept clip in the trash: it's gone from the crate,
// and comes back with RestoreCrateClip for CrateTrashDays.
func (e *Engine) DeleteCrateClip(id string) (CrateClip, error) {
	now := time.Now()
	return e.updateCrateClip(id, func(k *CrateClip) { k.Deleted = &now })
}

// RestoreCrateClip brings a deleted clip back.
func (e *Engine) RestoreCrateClip(id string) (CrateClip, error) {
	return e.updateCrateClip(id, func(k *CrateClip) { k.Deleted = nil })
}

func (e *Engine) updateCrateClip(id string, fn func(k *CrateClip)) (CrateClip, error) {
	var out CrateClip
	err := e.changeCrate(func(c *Crate) error {
		for i := range c.Clips {
			if c.Clips[i].ID == id {
				fn(&c.Clips[i])
				out = c.Clips[i]
				return nil
			}
		}
		return ErrNoSuchCrateClip
	})
	return out, err
}

// DropCrate drops a kept clip onto the loaded tape as a drop of the clipboard
// would: at the playhead on the track, replacing what's under it, or as an
// empty tape's first loop. It answers as DropClipboard does.
func (e *Engine) DropCrate(id, crateID string, track int) (Dropped, error) {
	k, err := e.CrateClip(crateID)
	if err != nil {
		return Dropped{}, err
	}
	if k.Deleted != nil {
		return Dropped{}, ErrNoSuchCrateClip
	}
	b := &Clipboard{Tracks: [][]Clip{{k.clip()}}, Frames: k.Frames, BPM: k.BPM, From: k.Name}
	return e.dropBoard(b, id, track, false)
}

// CrateWAV is a kept clip as a 16-bit WAV, to play or share.
func (e *Engine) CrateWAV(id string) (*ClipWAV, error) {
	k, err := e.CrateClip(id)
	if err != nil {
		return nil, err
	}
	return e.clipWAV(k.clip(), k.Name, 0)
}
