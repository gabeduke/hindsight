package audio

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A take's operation log: what Undo walks back through.
//
// Each change a person makes to a take's sidecar -- a rename, a selection, a
// tempo, the downbeat, the lanes, a flag added, moved, renamed or deleted --
// is kept as an Op with the field's value before and after. Undo puts the
// "before" back, but only while the field still holds the "after": so undoing
// on one device can't overwrite a change made since on another. The log is
// the newest HistoryMax operations, in <stem>.history.json beside the take.
//
// Callers hold the take's lock (LockTake) for every function here that reads
// or writes the log, as they do for the sidecar itself.

// HistoryMax is how many operations a take's log keeps.
const HistoryMax = 50

// coalesceWindow is how close together two changes to the same thing must be
// to count as one step: a held nudge, or In then Out in quick succession.
const coalesceWindow = 2 * time.Second

// MaxTakeFlags bounds what a single take may carry; an Undo that would bring
// back a flag past it is skipped.
const MaxTakeFlags = 512

// Op is one undoable change to a take.
type Op struct {
	ID     string          `json:"id"`
	At     time.Time       `json:"at"`
	Client string          `json:"client,omitempty"`  // the device that made it; see RecordHistory
	Field  string          `json:"field"`             // label, trim, bpm, downbeat_frame, lane_kinds, flags, flag
	FlagID string          `json:"flag_id,omitempty"` // for field "flag"
	What   string          `json:"what"`              // what Undo will say it undid: "rename", "flag moved"
	Before json.RawMessage `json:"before"`
	After  json.RawMessage `json:"after"`
}

// ErrUndoClash reports an operation whose field has changed since: undoing it
// would overwrite someone else's change, so it is skipped instead.
var ErrUndoClash = errors.New("changed since")

// ErrNothingToUndo reports an empty log, or an op id that isn't in it.
var ErrNothingToUndo = errors.New("nothing to undo")

func historyPath(wav string) string { return strings.TrimSuffix(wav, ".wav") + ".history.json" }

// ReadHistory loads a take's log, oldest first. Missing or unreadable reads as
// empty: the log is a convenience, and losing it must never block an edit.
func ReadHistory(wav string) []Op {
	b, err := os.ReadFile(historyPath(wav))
	if err != nil {
		return nil
	}
	var ops []Op
	if json.Unmarshal(b, &ops) != nil {
		return nil
	}
	return ops
}

// writeHistory replaces the log atomically, keeping the newest HistoryMax.
// An empty log removes the file.
func writeHistory(wav string, ops []Op) error {
	if len(ops) > HistoryMax {
		ops = ops[len(ops)-HistoryMax:]
	}
	p := historyPath(wav)
	if len(ops) == 0 {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	b, err := json.Marshal(ops)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".meta-*.tmp") // swept like a sidecar's
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, p)
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}

// DiffMeta lists what a person changed between two versions of a sidecar, as
// operations without ids or times. Star, created, source and version are not
// operations.
func DiffMeta(before, after Meta) []Op {
	var ops []Op
	field := func(name, what string, b, a any) {
		bj, aj := mustJSON(b), mustJSON(a)
		if !bytes.Equal(bj, aj) {
			ops = append(ops, Op{Field: name, What: what, Before: bj, After: aj})
		}
	}
	field("label", "rename", before.Label, after.Label)
	field("trim", "selection", before.Trim, after.Trim)
	field("bpm", "tempo", before.BPM, after.BPM)
	field("downbeat_frame", "downbeat", before.DownbeatFrame, after.DownbeatFrame)
	field("lane_kinds", "lanes", before.LaneKinds, after.LaneKinds)

	// Flags one by one, by id, so undoing one flag's move can't touch another.
	bf := EnsureFlagIDs(NormalizeFlags(before.Flags))
	af := EnsureFlagIDs(NormalizeFlags(after.Flags))
	old := make(map[string]Flag, len(bf))
	for _, f := range bf {
		old[f.ID] = f
	}
	seen := make(map[string]bool, len(af))
	for _, f := range af {
		seen[f.ID] = true
		o, had := old[f.ID]
		switch {
		case !had:
			ops = append(ops, Op{Field: "flag", FlagID: f.ID, What: "flag added", Before: json.RawMessage("null"), After: mustJSON(f)})
		case o != f:
			what := "flag moved"
			if o.Frame == f.Frame {
				what = "flag renamed"
			}
			ops = append(ops, Op{Field: "flag", FlagID: f.ID, What: what, Before: mustJSON(o), After: mustJSON(f)})
		}
	}
	for _, f := range bf {
		if !seen[f.ID] {
			ops = append(ops, Op{Field: "flag", FlagID: f.ID, What: "flag deleted", Before: mustJSON(f), After: json.RawMessage("null")})
		}
	}
	return ops
}

// RecordHistory appends what changed between before and after to the take's
// log, and returns the id of the newest operation it recorded or extended
// ("" when nothing changed). client names the device that made the change
// ("" for a script): each device's Undo walks back through its own changes,
// so one device can't undo another's. A change that continues the newest
// operation -- the same device and field, within coalesceWindow, starting
// where it ended, and neither adding nor removing -- extends it instead of
// adding a step. The caller holds the take's lock.
func RecordHistory(wav string, before, after Meta, now time.Time, client string) (string, error) {
	diff := DiffMeta(before, after)
	if len(diff) == 0 {
		return "", nil
	}
	ops := ReadHistory(wav)
	id := ""
	for _, d := range diff {
		if n := len(ops); n > 0 {
			last := &ops[n-1]
			// Adding and removing never merge: a removal gets a toast with its
			// own Undo, and that Undo must have a step to undo.
			grows := string(d.Before) == "null" || string(d.After) == "null"
			gap := now.Sub(last.At) // negative after a clock that went back: no merge
			if !grows && last.Client == client && last.Field == d.Field && last.FlagID == d.FlagID &&
				gap >= 0 && gap < coalesceWindow && bytes.Equal(last.After, d.Before) {
				last.After, last.At = d.After, now
				if last.What != "flag added" { // added, then moved, is still an add
					last.What = d.What
				}
				id = last.ID
				if bytes.Equal(last.Before, last.After) {
					// Back where it started: nothing left to undo.
					ops = ops[:n-1]
					id = ""
				}
				continue
			}
		}
		d.ID, d.At, d.Client = NewFlagID(), now, client // the same short random id a flag uses
		ops = append(ops, d)
		id = d.ID
	}
	return id, writeHistory(wav, ops)
}

// UndoInfo is what a page needs to offer Undo: how many steps there are, and
// what the next one will undo.
type UndoInfo struct {
	Count int    `json:"count"`
	Next  string `json:"next,omitempty"`
	Op    string `json:"op,omitempty"` // the operation the request just recorded, if any
}

// mine reports whether op is one client's to undo: a page undoes its own
// device's changes; a script ("") undoes anyone's.
func mine(op Op, client string) bool { return client == "" || op.Client == client }

// HistoryInfo summarises a take's log for one device's page: how many of the
// changes are its own, and what its Undo would undo next.
func HistoryInfo(wav, client string) UndoInfo {
	var info UndoInfo
	for _, op := range ReadHistory(wav) {
		if mine(op, client) {
			info.Count++
			info.Next = op.What
		}
	}
	return info
}

// PlanUndo reverses one operation of the take's log in m -- client's newest,
// or the one named by opID -- and returns it with the log as it should be
// afterwards. Nothing is written: the caller writes m, then the log
// (SaveHistory), so a failed write leaves the step to try again. When the
// field no longer holds what the operation left there, m is untouched and
// ErrUndoClash returned; the log without the operation is still returned, to
// be saved. The caller holds the take's lock.
func PlanUndo(wav string, m *Meta, opID, client string) (Op, []Op, error) {
	ops := ReadHistory(wav)
	i := len(ops) - 1
	for ; i >= 0; i-- {
		if opID != "" && ops[i].ID == opID || opID == "" && mine(ops[i], client) {
			break
		}
	}
	if i < 0 {
		return Op{}, ops, ErrNothingToUndo
	}
	op := ops[i]
	rest := append(append([]Op(nil), ops[:i]...), ops[i+1:]...)
	return op, rest, applyUndo(m, op)
}

// SaveHistory replaces a take's log; see PlanUndo. The caller holds the
// take's lock.
func SaveHistory(wav string, ops []Op) error { return writeHistory(wav, ops) }

// applyUndo puts op.Before back into m if the field still holds op.After.
func applyUndo(m *Meta, op Op) error {
	cur := func(v any) bool { return bytes.Equal(mustJSON(v), op.After) }
	set := func(dst any) error { return json.Unmarshal(op.Before, dst) }
	switch op.Field {
	case "label":
		if !cur(m.Label) {
			return ErrUndoClash
		}
		var v string
		if err := set(&v); err != nil {
			return err
		}
		m.Label = v
	case "trim":
		if !cur(m.Trim) {
			return ErrUndoClash
		}
		var v *Trim
		if err := set(&v); err != nil {
			return err
		}
		m.Trim = v
	case "bpm":
		if !cur(m.BPM) {
			return ErrUndoClash
		}
		var v *float64
		if err := set(&v); err != nil {
			return err
		}
		m.BPM = v
	case "downbeat_frame":
		if !cur(m.DownbeatFrame) {
			return ErrUndoClash
		}
		var v *int64
		if err := set(&v); err != nil {
			return err
		}
		m.DownbeatFrame = v
	case "lane_kinds":
		if !cur(m.LaneKinds) {
			return ErrUndoClash
		}
		var v map[string]string
		if err := set(&v); err != nil {
			return err
		}
		m.LaneKinds = v
	case "flag":
		flags := EnsureFlagIDs(NormalizeFlags(m.Flags))
		at := -1
		for i, f := range flags {
			if f.ID == op.FlagID {
				at = i
			}
		}
		var now any // the flag as it stands, or nil when it's gone
		if at >= 0 {
			now = flags[at]
		}
		if !cur(now) {
			return ErrUndoClash
		}
		var prev *Flag
		if err := set(&prev); err != nil {
			return err
		}
		switch {
		case prev == nil && at >= 0: // undo an add
			flags = append(flags[:at], flags[at+1:]...)
		case prev != nil && at >= 0: // undo a move or rename
			flags[at] = *prev
		case prev != nil: // undo a delete
			if len(flags) >= MaxTakeFlags {
				return ErrUndoClash
			}
			flags = append(flags, *prev)
		}
		m.Flags = NormalizeFlags(flags)
	default:
		return ErrUndoClash
	}
	return nil
}
