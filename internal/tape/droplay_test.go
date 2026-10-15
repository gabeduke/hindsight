package tape

import (
	"reflect"
	"testing"
)

// F7 of the flow spec: DROP lands over what is there and one undo takes it
// back. The Studio's page needs no new route for that -- the existing drop
// already clears the span it lands on, as one edit -- and this pins what the
// page relies on: a drop over a clip replaces it, takes one undo step, and
// the clip comes back whole with that one undo. (It passes on the code as it
// was: nothing in Go changed for F7.)
func TestADropOverAClipReplacesItAndOneUndoBringsItBack(t *testing.T) {
	e, _, tp := barLoop(t) // track 1 holds a 4-bar clip, 0 to 192000
	before := append([]Clip(nil), track(e, 1)...)
	if len(before) != 1 || before[0].At != 0 || before[0].Frames != 192000 {
		t.Fatalf("the loop's clip is %+v", before)
	}
	grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true}) // one bar
	undoBefore, _ := e.UndoDepth()

	at := int64(48000)
	if _, err := e.DropClipboardAt(tp.ID, 1, false, &at); err != nil {
		t.Fatalf("a drop over a full track was refused: %v", err)
	}
	undoAfter, _ := e.UndoDepth()
	if undoAfter != undoBefore+1 {
		t.Fatalf("the drop took %d undo steps, want 1", undoAfter-undoBefore)
	}
	after := track(e, 1)
	covered := false
	for _, c := range after {
		if c.At == at && c.Frames == 48000 {
			covered = true
		}
		if c.At < at+48000 && c.At+c.Frames > at && !(c.At == at && c.Frames == 48000) {
			t.Fatalf("a clip is still under the drop: %+v in %+v", c, after)
		}
	}
	if !covered {
		t.Fatalf("the buffer did not land at %d: %+v", at, after)
	}

	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if got := track(e, 1); !reflect.DeepEqual(got, before) {
		t.Fatalf("one undo left %+v, want the clip it replaced back whole: %+v", got, before)
	}
}
