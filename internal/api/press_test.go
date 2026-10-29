package api

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/surface"
)

// presses reads what the tablets were told, once every press so far has
// answered.
func (r *bannerRig) presses(ch <-chan keyPress) []keyPress {
	r.t.Helper()
	r.settle(true)
	var out []keyPress
	for {
		select {
		case p := <-ch:
			out = append(out, p)
		default:
			return out
		}
	}
}

// Every press on the keyboard is told to the tablets as it is put on the
// keyboard's screen: its words, its role, what it lit, the track it put a
// clip on, and when its second began.
func TestEachKeyboardPressIsToldToTheTablets(t *testing.T) {
	r := newBannerRig(t)
	ch, cancel := r.a.presses.subscribe()
	defer cancel()
	playing := false
	r.verbs.inner = cannedVerbs(func(id, rt string) (verbDone, error) {
		switch id {
		case "transport":
			playing = !playing
			if playing {
				return verbDone{log: "play", says: "PLAY"}, nil
			}
			return verbDone{log: "stop", says: "STOP"}, nil
		case "keep":
			return verbDone{log: "kept", says: keptWords(keepSeconds)}, nil
		case "catch":
			return verbDone{log: "caught", says: caughtWords(7.6), track: 3}, nil
		case "grab":
			return verbDone{log: "grabbed", says: grabbedWords(grabBars, "BARS")}, nil
		case "drop":
			return verbDone{log: "dropped", says: droppedWords(2), track: 2}, nil
		}
		return verbDone{}, errors.New("NOT IN THIS TEST")
	})
	at := r.clock.now().UnixMilli()
	for _, c := range []struct {
		status, note byte
		want         keyPress
	}{
		{playOn, playBtn, keyPress{Words: "PLAY", Role: "play", Lit: []string{"play"}}},
		{playOn, playBtn, keyPress{Words: "STOP", Role: "stop", Lit: []string{"play"}}},
		{playOn, recBtn, keyPress{Words: "KEPT 30 S", Role: "rec", Lit: []string{"rec"}}},
		{padOn, 50, keyPress{Words: "CAUGHT 8 S", Role: "verb", Lit: []string{"track"}, Track: 3}},
		{padOn, 51, keyPress{Words: "GRABBED 4 BARS", Role: "verb", Lit: []string{}}},
		{padOn, 52, keyPress{Words: "DROPPED ON T2", Role: "verb", Lit: []string{"track"}, Track: 2}},
	} {
		r.a.ControlMIDI("SMK-37", c.status, c.note, 127)
		r.a.ControlMIDI("SMK-37", c.status-0x10, c.note, 0)
		c.want.AtMS = at
		if got := r.presses(ch); !reflect.DeepEqual(got, []keyPress{c.want}) {
			t.Fatalf("%s: told %+v, want %+v", c.want.Words, got, c.want)
		}
		r.pump()
		r.take()
	}
}

// A refused press is told in the refused role, lighting nothing: it changed
// nothing. Another controller's presses are not the keyboard's, and say
// nothing to the tablets.
func TestARefusedKeyboardPressIsToldAndAnotherControllersIsNot(t *testing.T) {
	r := newBannerRig(t)
	ch, cancel := r.a.presses.subscribe()
	defer cancel()
	r.a.ControlMIDI("Keystation 49", 0xFA, 0, 0) // Start
	r.a.ControlMIDI("Keystation 49", 0x90, 53, 100)
	if got := r.presses(ch); len(got) != 0 {
		t.Fatalf("another controller's presses told the tablets %+v", got)
	}
	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	want := keyPress{Words: "NO TAPE LOADED", Role: "refused", Lit: []string{}, AtMS: r.clock.now().UnixMilli()}
	if got := r.presses(ch); !reflect.DeepEqual(got, []keyPress{want}) {
		t.Fatalf("a refused PLAY told %+v, want %+v", got, want)
	}
}

// The role a press is told in is the colour it has on the keyboard.
func TestAPressRoleIsItsBannerColour(t *testing.T) {
	colours := map[string]surface.Colour{
		rolePlay: surface.Green, roleStop: surface.Text, roleRec: surface.Red,
		roleVerb: surface.White, roleRefused: surface.Amber,
	}
	all := []says{refused("grab", errNotArmed), refused("grab", errors.New("new"))}
	for _, id := range []string{"transport", "keep", "catch", "grab", "drop"} {
		for _, w := range []string{"PLAY", "STOP", "X"} {
			all = append(all, did(id, verbDone{says: w}), did(id, verbDone{says: w, track: 1}))
		}
	}
	for _, s := range all {
		if c, ok := colours[s.role]; !ok || c != s.colour {
			t.Errorf("%q: role %q, colour %d", s.words, s.role, s.colour)
		}
	}
}

// The changes socket says a press the moment it is made, with the revision,
// in the shape docs/architecture/push.md gives it.
func TestTheChangesSocketSaysAKeyboardPress(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	makeLoadedTape(t, r)
	c := dialChanges(t, r)
	hello := readChanges(t, c, time.Second)
	if hello.Press != nil {
		t.Fatalf("the hello carried a press: %+v", hello.Press)
	}
	// Wait for the socket to be subscribed: a press published before then
	// is no one's. The hello is sent after the subscription, so it has been.
	p := says{words: "DROPPED ON T2", role: roleVerb, lit: []string{litTrack}, track: 2}.press(time.UnixMilli(1234))
	start := time.Now()
	a.presses.publish(p)
	for {
		_ = c.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		_, raw, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("no press within 300 ms: %v", err)
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		if m["press"] == nil {
			continue // a nudge from the load settling
		}
		if string(m["press"]) != `{"words":"DROPPED ON T2","role":"verb","lit":["track"],"track":2,"at_ms":1234}` {
			t.Fatalf("press = %s", m["press"])
		}
		if m["rev"] == nil || m["at_ms"] == nil {
			t.Fatalf("the press came without the revision: %s", raw)
		}
		if took := time.Since(start); took > 300*time.Millisecond {
			t.Fatalf("the press took %v", took)
		}
		return
	}
}
