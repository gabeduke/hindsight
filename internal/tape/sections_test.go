package tape

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/smf"
)

func section(t *testing.T, e *Engine, req EditRequest) Section {
	t.Helper()
	res, err := e.EditOp(e.LoadedID(), req)
	if err != nil {
		t.Fatalf("%s: %v", req.Op, err)
	}
	if res.Section == nil {
		t.Fatalf("%s answered no section", req.Op)
	}
	return *res.Section
}

func str(s string) *string { return &s }
func i64(n int64) *int64   { return &n }

func TestSectionsSitOnBarLinesAndDontOverlap(t *testing.T) {
	e, _, tp, _ := firstLoop(t) // a grid of one 96000-frame bar
	verse := section(t, e, EditRequest{Op: "section-add", Name: str(" Verse "), At: i64(1000), End: i64(4*96000 - 2000)})
	if verse.Name != "Verse" || verse.At != 0 || verse.End != 4*96000 || verse.ID == "" {
		t.Fatalf("verse = %+v: on bar lines, its name trimmed", verse)
	}
	// Less than a bar is a bar.
	ch := section(t, e, EditRequest{Op: "section-add", Name: str("Chorus"), Color: str("blue"), At: i64(4 * 96000), End: i64(4*96000 + 10)})
	if ch.At != 4*96000 || ch.End != 5*96000 || ch.Color != "blue" {
		t.Fatalf("chorus = %+v", ch)
	}
	// Overlapping, nameless, an unknown colour, or past the end: refused.
	for _, req := range []EditRequest{
		{Op: "section-add", Name: str("Drop"), At: i64(2 * 96000), End: i64(6 * 96000)},
		{Op: "section-add", Name: str("  "), At: i64(10 * 96000), End: i64(11 * 96000)},
		{Op: "section-add", Name: str("Drop"), Color: str("mauve"), At: i64(10 * 96000), End: i64(11 * 96000)},
		{Op: "section-add", Name: str("Drop"), At: i64(e.Loaded().Length), End: i64(e.Loaded().Length + 96000)},
		{Op: "section-add", Name: str("Drop"), At: i64(10 * 96000)},
	} {
		if _, err := e.EditOp(tp.ID, req); err == nil {
			t.Fatalf("%+v was let through", req)
		}
	}
	if n := len(e.Loaded().Sections); n != 2 {
		t.Fatalf("%d sections after refusals", n)
	}
}

func TestASectionIsRenamedMovedAndRemovedEachOneUndo(t *testing.T) {
	e, _, tp, _ := firstLoop(t)
	v := section(t, e, EditRequest{Op: "section-add", Name: str("Verse"), At: i64(0), End: i64(2 * 96000)})
	c := section(t, e, EditRequest{Op: "section-add", Name: str("Chorus"), At: i64(4 * 96000), End: i64(6 * 96000)})
	got := section(t, e, EditRequest{Op: "section-set", Section: v.ID, Name: str("Intro"), Color: str("green"), End: i64(3*96000 + 20)})
	if got.Name != "Intro" || got.Color != "green" || got.End != 3*96000 || got.At != 0 {
		t.Fatalf("set = %+v", got)
	}
	// Into the chorus: refused.
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-set", Section: v.ID, End: i64(5 * 96000)}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a resize into the next = %v", err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-remove", Section: c.ID}); err != nil {
		t.Fatal(err)
	}
	if s := e.Loaded().Sections; len(s) != 1 || s[0].ID != v.ID {
		t.Fatalf("after the remove: %+v", s)
	}
	for i := 0; i < 2; i++ {
		e.Undo(tp.ID, false)
	}
	if s := e.Loaded().Sections; len(s) != 2 || s[0].Name != "Verse" || s[0].End != 2*96000 {
		t.Fatalf("two undos: %+v", s)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-remove", Section: "nope"}); !errors.Is(err, ErrNoSuchSection) {
		t.Fatalf("remove no section = %v", err)
	}
}

func TestSectionsWithoutATempoGoWhereTheyreDrawn(t *testing.T) {
	e, _, tp := newEngine(t)
	sc := section(t, e, EditRequest{Op: "section-add", Name: str("Jam"), At: i64(1234), End: i64(56789)})
	if sc.At != 1234 || sc.End != 56789 {
		t.Fatalf("no tempo: %+v", sc)
	}
	_ = tp
}

func TestSectionsAreMarkersInTheExport(t *testing.T) {
	e, _, tp, _ := firstLoop(t)
	section(t, e, EditRequest{Op: "section-add", Name: str("Verse"), At: i64(0), End: i64(96000)})
	section(t, e, EditRequest{Op: "section-add", Name: str("Chorus"), At: i64(96000), End: i64(2 * 96000)})
	x, err := e.Export(tp.ID)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := x.WriteZip(&buf, nil); err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	var mid []byte
	for _, f := range zr.File {
		if f.Name == "test/test.mid" {
			r, _ := f.Open()
			mid, _ = io.ReadAll(r)
		}
	}
	f, err := smf.Decode(mid)
	if err != nil {
		t.Fatal(err)
	}
	var markers []string
	last := uint64(0)
	for _, ev := range f.Tracks[0].Events {
		if ev.Tick < last {
			t.Fatal("events out of order")
		}
		last = ev.Tick
		if ev.IsMeta() && ev.Meta == smf.MetaMarker {
			markers = append(markers, ev.Text())
		}
	}
	// The loop's In and Out, each section where it starts, and the end of
	// the last: the chorus runs past the audio, and the track ends after it.
	want := map[string]bool{"In": true, "Out": true, "Verse": true, "Chorus": true, "End of Chorus": true}
	if len(markers) != len(want) {
		t.Fatalf("markers = %v", markers)
	}
	for _, m := range markers {
		if !want[m] {
			t.Fatalf("markers = %v", markers)
		}
	}
}

func TestSectionNamesAreCountedInCharacters(t *testing.T) {
	e, _, tp, _ := firstLoop(t)
	long := strings.Repeat("é", MaxSectionName) // 80 bytes, 40 characters
	sc := section(t, e, EditRequest{Op: "section-add", Name: str(long + "​\n"), At: i64(0), End: i64(96000)})
	if sc.Name != long {
		t.Fatalf("name = %q: control and format characters go", sc.Name)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-add", Name: str(long + "é"), At: i64(96000), End: i64(2 * 96000)}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("41 characters = %v", err)
	}
}

func TestOnAnyTempoSectionsSitOnItsBarLines(t *testing.T) {
	e, _, tp := newEngine(t)
	g := GridFor(84, 4, 48000) // a bar is 137142.857… frames
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Grid = &g; return nil })
	sc := section(t, e, EditRequest{Op: "section-add", Name: str("Verse"), At: i64(140000), End: i64(400000)})
	if sc.At != g.BarStart(1) || sc.End != g.BarStart(3) {
		t.Fatalf("at 84 BPM: %+v, want %d–%d", sc, g.BarStart(1), g.BarStart(3))
	}
	// Moving one edge leaves the other: only what's sent moves.
	moved := section(t, e, EditRequest{Op: "section-set", Section: sc.ID, End: i64(560000)})
	if moved.At != sc.At || moved.End != g.BarStart(4) {
		t.Fatalf("moved = %+v", moved)
	}
	// An edge past the other is refused, not turned into a bar.
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-set", Section: sc.ID, At: i64(900000)}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("start past the end = %v", err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "section-add", Name: str("x"), At: i64(900000), End: i64(800000)}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("an add backwards = %v", err)
	}
	// A change to what it already is adds no undo step.
	steps := len(e.Loaded().History)
	section(t, e, EditRequest{Op: "section-set", Section: sc.ID, Name: str("Verse")})
	if n := len(e.Loaded().History); n != steps {
		t.Fatalf("a set that changed nothing added %d undo steps", n-steps)
	}
}
