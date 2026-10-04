package audio

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func ptrF(v float64) *float64 { return &v }
func ptrI(v int64) *int64     { return &v }

// edit applies fn to a take's sidecar the way the API does -- read, change,
// write, record -- and returns the op id recorded.
func edit(t *testing.T, wav string, at time.Time, fn func(m *Meta)) string {
	t.Helper()
	before := ReadMeta(wav)
	m := before
	m.Flags = EnsureFlagIDs(m.Flags)
	fn(&m)
	if err := WriteMeta(wav, m); err != nil {
		t.Fatal(err)
	}
	id, err := RecordHistory(wav, before, m, at)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func undo(t *testing.T, wav, op string) (Op, error) {
	t.Helper()
	m := ReadMeta(wav)
	got, err := Undo(wav, &m, op)
	if err == nil {
		if werr := WriteMeta(wav, m); werr != nil {
			t.Fatal(werr)
		}
	}
	return got, err
}

func TestDiffMetaNamesEachChange(t *testing.T) {
	before := Meta{Label: "a", BPM: ptrF(120), Flags: []Flag{{ID: "r00000001", Frame: 10}, {ID: "r00000002", Frame: 20}}}
	after := Meta{Label: "b", BPM: ptrF(120), Trim: &Trim{StartFrame: 1, EndFrame: 9}, Starred: true,
		Flags: []Flag{{ID: "r00000001", Frame: 15}, {ID: "r00000003", Frame: 30}}}
	var whats []string
	for _, op := range DiffMeta(before, after) {
		whats = append(whats, op.What)
	}
	want := []string{"rename", "selection", "flag moved", "flag added", "flag deleted"}
	if len(whats) != len(want) {
		t.Fatalf("ops = %v, want %v (starring is not an operation)", whats, want)
	}
	for i := range want {
		if whats[i] != want[i] {
			t.Fatalf("ops = %v, want %v", whats, want)
		}
	}
}

func TestUndoStepsBackOneChangeAtATime(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_u.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	edit(t, wav, t0, func(m *Meta) { m.Label = "verse" })
	edit(t, wav, t0.Add(5*time.Second), func(m *Meta) { m.BPM = ptrF(96) })

	if info := HistoryInfo(wav); info.Count != 2 || info.Next != "tempo" {
		t.Fatalf("info = %+v, want 2 steps, next tempo", info)
	}
	if op, err := undo(t, wav, ""); err != nil || op.What != "tempo" {
		t.Fatalf("first undo = %v %v, want tempo", op.What, err)
	}
	if m := ReadMeta(wav); m.BPM != nil || m.Label != "verse" {
		t.Fatalf("after one undo: bpm %v label %q", m.BPM, m.Label)
	}
	if op, err := undo(t, wav, ""); err != nil || op.What != "rename" {
		t.Fatalf("second undo = %v %v, want rename", op.What, err)
	}
	if m := ReadMeta(wav); m.Label != "" {
		t.Fatalf("label = %q after undoing the rename", m.Label)
	}
	if _, err := undo(t, wav, ""); !errors.Is(err, ErrNothingToUndo) {
		t.Fatalf("third undo: %v, want nothing to undo", err)
	}
	if _, err := os.Stat(historyPath(wav)); !errors.Is(err, os.ErrNotExist) {
		t.Error("an empty log should leave no file")
	}
}

func TestUndoSkipsAChangeMadeSinceElsewhere(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_c.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	edit(t, wav, t0, func(m *Meta) { m.Label = "mine" })
	// Another device renames it without going through this log (a script,
	// or an older build): the field no longer holds what the op left.
	m := ReadMeta(wav)
	m.Label = "theirs"
	WriteMeta(wav, m)

	op, err := undo(t, wav, "")
	if !errors.Is(err, ErrUndoClash) || op.What != "rename" {
		t.Fatalf("undo = %q %v, want a skipped rename", op.What, err)
	}
	if got := ReadMeta(wav).Label; got != "theirs" {
		t.Fatalf("label = %q, want theirs untouched", got)
	}
	if HistoryInfo(wav).Count != 0 {
		t.Error("a skipped op should leave the log")
	}
}

func TestUndoByIDUndoesThatOneEvenAfterLaterEdits(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_f.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	edit(t, wav, t0, func(m *Meta) { m.Flags = []Flag{{ID: "r0000000a", Frame: 100, Label: "drop"}} })
	del := edit(t, wav, t0.Add(5*time.Second), func(m *Meta) { m.Flags = nil })
	edit(t, wav, t0.Add(10*time.Second), func(m *Meta) { m.BPM = ptrF(120) })

	// The toast's Undo names the delete; the tempo since is left alone.
	if op, err := undo(t, wav, del); err != nil || op.What != "flag deleted" {
		t.Fatalf("undo = %q %v", op.What, err)
	}
	m := ReadMeta(wav)
	if len(m.Flags) != 1 || m.Flags[0].Label != "drop" || m.Flags[0].Frame != 100 {
		t.Fatalf("flags = %+v, want the deleted flag back", m.Flags)
	}
	if m.BPM == nil || *m.BPM != 120 {
		t.Fatal("undoing the delete touched the tempo")
	}
	if info := HistoryInfo(wav); info.Count != 2 || info.Next != "tempo" {
		t.Fatalf("info = %+v", info)
	}
}

func TestQuickChangesToOneThingAreOneStep(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_q.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	// A held nudge: the selection's end, again and again.
	for i := int64(1); i <= 5; i++ {
		edit(t, wav, t0.Add(time.Duration(i)*300*time.Millisecond), func(m *Meta) {
			m.Trim = &Trim{StartFrame: 0, EndFrame: 1000 + i*480}
		})
	}
	if info := HistoryInfo(wav); info.Count != 1 {
		t.Fatalf("count = %d, want one step for one held nudge", info.Count)
	}
	undo(t, wav, "")
	if m := ReadMeta(wav); m.Trim != nil {
		t.Fatalf("trim = %+v, want the selection gone as before the first nudge", m.Trim)
	}
	// Apart in time, two steps.
	edit(t, wav, t0.Add(10*time.Second), func(m *Meta) { m.DownbeatFrame = ptrI(10) })
	edit(t, wav, t0.Add(20*time.Second), func(m *Meta) { m.DownbeatFrame = ptrI(20) })
	if info := HistoryInfo(wav); info.Count != 2 {
		t.Fatalf("count = %d, want two steps", info.Count)
	}
}

func TestARemovalIsAlwaysItsOwnStep(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_r.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	// Added and deleted a second apart: the delete's toast must still have
	// something to undo.
	edit(t, wav, t0, func(m *Meta) { m.Flags = []Flag{{ID: "r0000000b", Frame: 5}} })
	del := edit(t, wav, t0.Add(time.Second), func(m *Meta) { m.Flags = nil })
	edit(t, wav, t0.Add(1500*time.Millisecond), func(m *Meta) { m.Trim = &Trim{StartFrame: 1, EndFrame: 9} })
	clr := edit(t, wav, t0.Add(1800*time.Millisecond), func(m *Meta) { m.Trim = nil })
	if info := HistoryInfo(wav); info.Count != 4 {
		t.Fatalf("count = %d, want four steps", info.Count)
	}
	if _, err := undo(t, wav, clr); err != nil {
		t.Fatal(err)
	}
	if _, err := undo(t, wav, del); err != nil {
		t.Fatal(err)
	}
	m := ReadMeta(wav)
	if m.Trim == nil || len(m.Flags) != 1 {
		t.Fatalf("meta = %+v, want the selection and the flag back", m)
	}
}

func TestTheLogKeepsTheNewestFifty(t *testing.T) {
	wav := filepath.Join(t.TempDir(), "jam_l.wav")
	os.WriteFile(wav, []byte("x"), 0o644)
	t0 := time.Now()
	for i := 0; i < HistoryMax+10; i++ {
		edit(t, wav, t0.Add(time.Duration(i)*time.Minute), func(m *Meta) { m.BPM = ptrF(float64(60 + i)) })
	}
	ops := ReadHistory(wav)
	if len(ops) != HistoryMax {
		t.Fatalf("len = %d, want %d", len(ops), HistoryMax)
	}
	if string(ops[len(ops)-1].After) != "119" {
		t.Errorf("newest after = %s, want 119", ops[len(ops)-1].After)
	}
}
