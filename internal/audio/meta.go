package audio

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MetaVersion is the sidecar schema version. Bump it only for a change that
// older readers cannot tolerate.
const MetaVersion = 1

// Trim is the take's selection -- the waveform page's region -- in frames.
// Frames rather than seconds so the bounds are sample-exact and survive as
// integers, and so they line up with the RIFF cue points other tools use. The
// page saves it here and restores it when the take is opened again.
type Trim struct {
	StartFrame int64 `json:"start_frame"`
	EndFrame   int64 `json:"end_frame"`
}

// Flag marks a moment of interest inside a take, in frames from its first
// frame. Frames rather than seconds so the mark is sample-exact, survives as an
// integer, and lines up with the RIFF cue points other tools read.
//
// Label is the owner's name for the moment. It is mirrored into the WAV as a
// LIST/adtl "labl" record so DAWs show it beside the marker.
//
// ID is what the flag endpoints address it by, so an edit or a delete names
// one flag rather than replacing the whole list -- which is what let two
// devices undo each other's flags. A flag written before ids existed has
// none on disk and reads as its legacy id, "f<frame>" (see EnsureFlagIDs).
type Flag struct {
	ID    string `json:"id,omitempty"`
	Frame int64  `json:"frame"`
	Label string `json:"label,omitempty"`
}

// LegacyFlagID is the id a flag with none on disk reads as. It is derived
// from the frame so it is stable across reads before anything is written;
// new flags get NewFlagID's "r" ids, which can never collide with it. (Two
// legacy ids can: see EnsureFlagIDs.)
func LegacyFlagID(frame int64) string { return "f" + strconv.FormatInt(frame, 10) }

// NewFlagID returns a fresh flag id: "r" and eight random hex characters.
func NewFlagID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand does not fail on Linux; the clock is a good enough
		// fallback for an id that only has to be unique within one take.
		return fmt.Sprintf("r%08x", uint32(time.Now().UnixNano()))
	}
	return "r" + hex.EncodeToString(b[:])
}

// EnsureFlagIDs returns a copy of flags in which every flag has an id: the
// ones that had none get their legacy id. If that id is already taken -- a
// legacy flag that has since moved keeps "f<old frame>", and a new id-less
// flag can land on that old frame -- it gets "f<frame>_2", "_3" and so on,
// in list order, so the answer is the same on every read.
func EnsureFlagIDs(in []Flag) []Flag {
	if len(in) == 0 {
		return in
	}
	out := make([]Flag, len(in))
	copy(out, in)
	used := make(map[string]bool, len(out))
	for _, f := range out {
		if f.ID != "" {
			used[f.ID] = true
		}
	}
	for i := range out {
		if out[i].ID != "" {
			continue
		}
		base := LegacyFlagID(out[i].Frame)
		id := base
		for n := 2; used[id]; n++ {
			id = base + "_" + strconv.Itoa(n)
		}
		used[id] = true
		out[i].ID = id
	}
	return out
}

// ValidFlagID reports whether id is one this code could have made: a new
// flag's "r" and eight hex characters, or a legacy "f<frame>" with an
// optional "_N". Ids sent by clients are checked against it, so a script
// can't store an arbitrary string as an id.
func ValidFlagID(id string) bool {
	if len(id) == 9 && id[0] == 'r' {
		for _, c := range id[1:] {
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return false
			}
		}
		return true
	}
	if len(id) < 2 || len(id) > 26 || id[0] != 'f' {
		return false
	}
	num, suffix, hasSuffix := strings.Cut(id[1:], "_")
	if _, err := strconv.ParseUint(num, 10, 63); err != nil {
		return false
	}
	if hasSuffix {
		if n, err := strconv.Atoi(suffix); err != nil || n < 2 {
			return false
		}
	}
	return true
}

// flagKey is what NormalizeFlags dedupes on: the id, or for a flag with none,
// its frame -- which is exactly the pre-id behaviour, kept for old sidecars
// and old clients. The two are kept apart, so a flag with no id at frame F is
// never taken for a moved legacy flag whose id still reads "f<F>".
func flagKey(f Flag) string {
	if f.ID != "" {
		return f.ID
	}
	return "\x00" + strconv.FormatInt(f.Frame, 10)
}

// NormalizeFlags returns flags sorted by frame with duplicates and negative
// frames removed. Duplicates are flags with the same id; a flag without an id
// is a duplicate of another at the same frame, as before ids existed. The
// first occurrence wins, so a label already attached is not lost to a later
// bare mark. Two flags with different ids may share a frame.
func NormalizeFlags(in []Flag) []Flag {
	if len(in) == 0 {
		return nil
	}
	out := make([]Flag, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, f := range in {
		k := flagKey(f)
		if f.Frame < 0 || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, f)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Frame != out[j].Frame {
			return out[i].Frame < out[j].Frame
		}
		return flagKey(out[i]) < flagKey(out[j])
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// Origins a take's sidecar can name.
const (
	OriginPhone = "phone" // recorded from a phone's mic (phone.go)
	OriginTape  = "tape"  // a tape mixdown (internal/tape)
)

// CutSource is a cut's lineage: the take it was cut from and the frame range,
// in the source's frames.
type CutSource struct {
	Name       string `json:"name"`
	StartFrame int64  `json:"start_frame"`
	EndFrame   int64  `json:"end_frame"`
}

// Meta is the per-take sidecar. Every field but Version is optional: an absent
// sidecar means an unnamed, unstarred, untrimmed take, which is what keeps
// takes recorded before this feature valid without migration.
type Meta struct {
	Version int    `json:"version"`
	Label   string `json:"label,omitempty"`
	Starred bool   `json:"starred,omitempty"`
	Trim    *Trim  `json:"trim,omitempty"`

	// Tag is the id of one of the server-wide tags (tags.json): a named color
	// the owner sorts takes by. Empty means untagged. An id the list no
	// longer holds reads as untagged. Optional and additive, so it needs no
	// MetaVersion bump.
	Tag string `json:"tag,omitempty"`

	// DownbeatFrame is where bar 1 beat 1 falls, for the waveform page's
	// grid. Optional; absent means "unknown", and the page then starts the
	// grid at frame 0.
	DownbeatFrame *int64 `json:"downbeat_frame,omitempty"`

	// Source records where a cut came from. Nil for a take saved from the ring.
	Source *CutSource `json:"source,omitempty"`

	// Origin says what made the take when it wasn't the ring: OriginPhone or
	// OriginTape. Empty for a ring capture, and for any take saved before the
	// field existed. Optional and additive, so it needs no MetaVersion bump.
	Origin string `json:"origin,omitempty"`

	// BPM is the tempo the take was played at, read from the EP's MIDI clock
	// at save time and editable afterwards.
	//
	// A pointer because absent and zero are different states: no MIDI device,
	// no clock, or too short a window all mean "no tempo", and a take with a
	// tempo of 0 does not exist. The free-running clock does not reliably
	// match the loaded project tempo -- one idle window read 129.87
	// rock-steady against a project set to 92 -- so this is a starting point
	// the owner overrides, never a fact.
	BPM *float64 `json:"bpm,omitempty"`

	// TempoFrom says where BPM came from: TempoFromClock (the MIDI clock, at
	// save), TempoFromAudio (measured from the take), or TempoFromYou
	// (edited). Empty for a take saved before it was kept. Optional and
	// additive, like BPM.
	TempoFrom string `json:"tempo_from,omitempty"`

	// Flags mark moments of interest, in frames from the take's first frame.
	// Optional and additive, like BPM, so it needs no MetaVersion bump.
	Flags []Flag `json:"flags,omitempty"`

	// Created is when the take was saved or cut. The takes list
	// sorts and prunes by it. It used to be the WAV's modification time, but
	// editing a flag rewrites the WAV's cue chunk, which moved an old take to
	// the top of the list and out of the pruner's reach. A take that predates
	// the field falls back to the time in its jam_<ts> name (see TakeCreated).
	Created *time.Time `json:"created,omitempty"`

	// LaneKinds overrides the notes endpoint's drum/notes guess per track,
	// keyed by SMF track name ("bento ch1"). Optional and additive, like
	// BPM and Flags, so it needs no MetaVersion bump.
	LaneKinds map[string]string `json:"lane_kinds,omitempty"`
}

// Where a take's tempo came from: Meta.TempoFrom.
const (
	TempoFromClock = "clock"
	TempoFromAudio = "audio"
	TempoFromYou   = "you"
)

// ErrNewerSidecar reports a sidecar written by a build that knew fields this
// one does not. Rewriting it would drop them.
var ErrNewerSidecar = errors.New("sidecar was written by a newer version")

// metaPath returns the sidecar path for a take's wav path.
func metaPath(wav string) string { return strings.TrimSuffix(wav, ".wav") + ".meta.json" }

// ReadMeta loads a take's sidecar. A missing or unparseable sidecar yields
// defaults rather than an error, and the file is left alone: metadata is
// derived, disposable state, and losing it must never obscure the audio.
//
// Every error — missing file, permission denied, corrupt JSON — is swallowed
// rather than logged. ListTakes calls this for every take on every prune, and
// the polled takes list (TakeList) for every take whose files changed, so
// logging here would repeat the same line over and over for a condition that
// is usually just "no sidecar yet".
func ReadMeta(wav string) Meta {
	def := Meta{Version: MetaVersion}

	b, err := os.ReadFile(metaPath(wav))
	if err != nil {
		return def
	}
	var got Meta
	if err := json.Unmarshal(b, &got); err != nil {
		return def
	}
	// Only stamp a version onto a sidecar that predates the field. A sidecar
	// that already names a (possibly newer) version must keep it: downgrading
	// it here would make a later read-modify-write silently drop any fields
	// this build doesn't know about.
	if got.Version == 0 {
		got.Version = MetaVersion
	}
	return got
}

// WriteMeta writes a take's sidecar atomically. The UI polls the take list
// every five seconds, so a half-written file would be read eventually; a temp
// file plus rename makes that impossible.
func WriteMeta(wav string, m Meta) error {
	// Refuse to rewrite a sidecar written by a newer version: this code cannot
	// represent fields it does not know about, and silently dropping them
	// would be worse than failing.
	if m.Version > MetaVersion {
		return fmt.Errorf("%w: sidecar is version %d, this build writes %d", ErrNewerSidecar, m.Version, MetaVersion)
	}
	m.Version = MetaVersion
	// Ids are persisted on every write, so a legacy flag keeps the id it was
	// read with even after an edit moves its frame.
	m.Flags = EnsureFlagIDs(NormalizeFlags(m.Flags))

	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}

	p := metaPath(wav)
	tmp, err := os.CreateTemp(filepath.Dir(p), ".meta-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	// Harmless once the rename below succeeds; the safety net is for the
	// error paths, which must not litter the takes directory.
	defer os.Remove(name)

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// Match the 0644 of the sibling sidecars (.peaks.json, _preview.mp3):
	// CreateTemp defaults to 0600, and rename preserves that, which would
	// otherwise make this file uniquely inaccessible to anything else that
	// touches the takes directory (an rsync backup, another user over SSH).
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, p)
}

// takeNameLayout is the timestamp in a take's name: jam_2006-01-02_150405.wav,
// with an optional _N suffix when two takes landed in the same second.
const takeNameLayout = "2006-01-02_150405"

// TakeCreated decides when a take was made: the sidecar's Created if it has
// one, else the time in its jam_<ts> name (local time, as the name was
// written), else the file's modification time. The _N suffix of a same-second
// collision adds N milliseconds, so the later take sorts as the newer one.
func TakeCreated(name string, m Meta, modTime time.Time) time.Time {
	if m.Created != nil && !m.Created.IsZero() {
		return *m.Created
	}
	if t, ok := createdFromName(name); ok {
		return t
	}
	return modTime
}

func createdFromName(name string) (time.Time, bool) {
	s := strings.TrimSuffix(filepath.Base(name), ".wav")
	if !strings.HasPrefix(s, "jam_") {
		return time.Time{}, false
	}
	s = strings.TrimPrefix(s, "jam_")
	if len(s) < len(takeNameLayout) {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(takeNameLayout, s[:len(takeNameLayout)], time.Local)
	if err != nil {
		return time.Time{}, false
	}
	if rest := s[len(takeNameLayout):]; rest != "" {
		n, err := strconv.Atoi(strings.TrimPrefix(rest, "_"))
		if err != nil || !strings.HasPrefix(rest, "_") || n < 0 {
			return time.Time{}, false
		}
		t = t.Add(time.Duration(n) * time.Millisecond)
	}
	return t, true
}
