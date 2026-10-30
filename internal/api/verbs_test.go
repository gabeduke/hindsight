package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/gabeduke/hindsight/internal/tape"
)

// errorOf is a refused route's words.
func errorOf(t *testing.T, w interface{ Bytes() []byte }) string {
	t.Helper()
	var b struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(w.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	return b.Error
}

// A DROP from a controller lands where the Studio's DROP key says it will:
// the next bar line inside the loop, over what is there, never refused for
// room (F7). The controller kept the rule from before F7, the first free
// span, so a second DROP went after the first instead of over it, and a
// full loop said NO ROOM ON TRACK.
func TestAControllersDropLandsWhereTheStudiosDropKeySays(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	a, eng := bufferAPIs[r], bufferEngines[r]
	verbs := piVerbs{a}
	if _, err := verbs.Verb("grab", ""); err != nil {
		t.Fatal(err)
	}
	for press := 1; press <= 2; press++ {
		before := eng.Loaded()
		c := before.State.Cue.Clips[len(before.State.Cue.Clips)-1]
		at, _, _ := tape.DropPlace(before.State, before.Length, c.Frames, eng.Live().Heard)
		d, err := verbs.Verb("drop", "")
		if err != nil || d.track != 1 {
			t.Fatalf("DROP %d: %+v, %v", press, d, err)
		}
		clips := eng.Loaded().State.Tracks[0].Clips
		if len(clips) != 1 || clips[0].At != at {
			t.Fatalf("DROP %d: track 1 is %+v, want one clip at %d, over what was there", press, clips, at)
		}
	}
}

// A CATCH from a controller goes onto every armed track, each from its own
// input, as the Studio's Catch: so it refuses as the tablet does when one of
// them can't. It used to catch onto the first armed track alone.
func TestAControllersCatchIsTheTabletsCatchOntoEveryArmedTrack(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	q := "?id=" + id
	a, eng := bufferAPIs[r], bufferEngines[r]
	want(t, send(t, r, http.MethodPatch, "/api/tapes"+q, `{"rec_tracks":[1,3],"inputs":[{"n":1,"source":"aux"}]}`), http.StatusOK, "arm 1 and 3")
	// Track 3's input is one the Pi had when it was chosen and hasn't now.
	if err := eng.Edit(id, "", func(tp *tape.Tape, _ *tape.State) error { return tp.SetInput(3, "gone") }); err != nil {
		t.Fatal(err)
	}
	if pairs := a.Verbs().armedPairs(eng.Loaded()); len(pairs) != 2 || pairs[1] != (tape.Pair{Track: 3, Source: "gone"}) {
		t.Fatalf("armed pairs %+v", pairs)
	}
	// The tablet's body: recordBody (lib/rig/arm.js), every armed track.
	w := send(t, r, http.MethodPost, "/api/tapes/catch"+q, `{"track":1,"source":"aux","pairs":[{"track":1,"source":"aux"},{"track":3,"source":"gone"}],"pass":1}`)
	want(t, w, http.StatusBadRequest, "the tablet's CATCH")
	_, err := piVerbs{a}.Verb("catch", "")
	if !errors.Is(err, tape.ErrBadParameter) || err.Error() != errorOf(t, w.Body) {
		t.Fatalf("the controller's CATCH: %v, want the tablet's %q", err, errorOf(t, w.Body))
	}
}

// KEEP with nothing to keep from refuses alike from the tablet and a
// controller. The route reached for the saver without looking.
func TestKeepWithNoRingRefusesAlikeEverywhere(t *testing.T) {
	r, _ := newBufferAPI(t)
	w := send(t, r, http.MethodPost, "/api/trigger?seconds=30", "")
	want(t, w, http.StatusConflict, "KEEP with no saver")
	_, err := piVerbs{bufferAPIs[r]}.Verb("keep", "")
	if !errors.Is(err, errNothingToKeep) || errorOf(t, w.Body) != err.Error() {
		t.Fatalf("the controller's KEEP: %v; the tablet's %q", err, errorOf(t, w.Body))
	}
	want(t, send(t, r, http.MethodPost, "/api/trigger?from=0&to=100", ""), http.StatusConflict, "a span with no saver")
}

// The transport refuses alike: a play with no output, and a request it can't
// read, which a controller never sends.
func TestTheTransportRefusesAlikeEverywhere(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	q := "?id=" + id
	w := send(t, r, http.MethodPost, "/api/tapes/transport"+q, `{"action":"play"}`)
	want(t, w, http.StatusConflict, "play with no output")
	_, err := piVerbs{bufferAPIs[r]}.Verb("transport", "start")
	if !errors.Is(err, errNoAudioOut) || errorOf(t, w.Body) != err.Error() {
		t.Fatalf("the controller's ▶: %v; the tablet's %q", err, errorOf(t, w.Body))
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport"+q, `{"action":"rewind"}`), http.StatusBadRequest, "no such action")
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport"+q, `{"action":"play","quantum":"16th"}`), http.StatusBadRequest, "no such quantum")
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id=nope", `{"action":"stop"}`), http.StatusConflict, "another tape")
}

// DROP pressed bare refuses what the Studio's DROP key won't do: no armed
// track, an empty lane.
func TestABareDropRefusesAsTheDropKey(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	v := bufferAPIs[r].Verbs()
	if _, _, err := v.DropArmed(); !errors.Is(err, errNothingToDrop) {
		t.Fatalf("an empty lane: %v", err)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[]}`), http.StatusOK, "disarm")
	if _, _, err := v.DropArmed(); !errors.Is(err, errNotArmed) {
		t.Fatalf("nothing armed: %v", err)
	}
	if _, _, err := (Verbs{&API{}}).DropArmed(); !errors.Is(err, errTapeOff) {
		t.Fatalf("no tape: %v", err)
	}
}
