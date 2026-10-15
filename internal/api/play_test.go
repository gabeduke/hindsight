package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// fakeTricks stands in for the engine: it records presses and releases, and
// the test says when a pad was heard.
type fakeTricks struct {
	mu     sync.Mutex
	calls  []string
	events []tape.TrickEvent
	moves  []tape.TrickEvent
	seq    uint64
	refuse map[string]error
}

func (f *fakeTricks) Press(pad, q string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.refuse[pad]; err != nil {
		return err
	}
	f.calls = append(f.calls, "press "+pad+" "+q)
	return nil
}

func (f *fakeTricks) PressAmount(pad, q string, v float64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.refuse[pad]; err != nil {
		return err
	}
	f.calls = append(f.calls, fmt.Sprintf("press %s %s %v", pad, q, v))
	return nil
}

func (f *fakeTricks) Set(pad string, v float64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.refuse[pad]; err != nil {
		return err
	}
	f.calls = append(f.calls, fmt.Sprintf("set %s %v", pad, v))
	return nil
}

func (f *fakeTricks) PreviewMod(mod string, v float64, owner string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fmt.Sprintf("preview %s %v by %s", mod, v, owner))
	return nil
}

// EndPreview is asked of the engine, which lets the preview go only if
// owner set it last (tape's TestAModsPreviewIsLetGoOnlyByWhoeverSetItLast).
func (f *fakeTricks) EndPreview(mod, owner string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, fmt.Sprintf("end %s by %s", mod, owner))
	return nil
}

func (f *fakeTricks) Release(pad string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, "release "+pad)
	return nil
}

func (f *fakeTricks) TrickEventsSince(seq uint64) ([]tape.TrickEvent, uint64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []tape.TrickEvent
	for _, e := range f.events {
		if e.Seq > seq {
			out = append(out, e)
		}
	}
	return out, f.seq
}

func (f *fakeTricks) MovesSince(seq uint64) ([]tape.TrickEvent, uint64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []tape.TrickEvent
	for _, e := range f.moves {
		if e.Seq > seq {
			out = append(out, e)
		}
	}
	return out, uint64(len(f.moves))
}

func (f *fakeTricks) TrickLead() (time.Duration, bool) { return 212 * time.Millisecond, true }

// HeardIn says output frame o is heard in o ms, so a test picks the answer.
func (f *fakeTricks) HeardIn(o uint64) (time.Duration, bool) {
	return time.Duration(o) * time.Millisecond, true
}

func (f *fakeTricks) heard(pad string, on bool, inMS uint64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	f.events = append(f.events, tape.TrickEvent{Seq: f.seq, Pad: pad, On: on, Out: inMS, Pos: 15000})
}

func (f *fakeTricks) log() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

// waitFor polls the fake's log until it equals want.
func (f *fakeTricks) waitFor(t *testing.T, want ...string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		got := f.log()
		if strings.Join(got, "|") == strings.Join(want, "|") {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the engine was asked %q, want %q", got, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func newPlayAPI(t *testing.T) (*fakeTricks, string) {
	f, url, _ := newPlayAPIWith(t)
	return f, url
}

// holders waits until pad is held by n connections, as the server counts:
// two players' messages travel on separate sockets, so their order is the
// server's, not the test's.
func holders(t *testing.T, a *API, pad string, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		a.playHolds.mu.Lock()
		got := a.playHolds.n[pad]
		a.playHolds.mu.Unlock()
		if got == n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s held by %d, want %d", pad, got, n)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func newPlayAPIWith(t *testing.T) (*fakeTricks, string, *API) {
	t.Helper()
	cfg := &config.Config{OutputDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	a := New(cfg, nil, nil, nil, nil)
	a.SetTape(tape.NewEngine(tape.Options{Store: store}))
	f := &fakeTricks{}
	a.playFake = f
	r := mux.NewRouter()
	a.SetupRoutes(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return f, "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/tapes/play", a
}

type playMsg struct {
	T      string   `json:"t"`
	Pads   []string `json:"pads"`
	Mods   []string `json:"mods"`
	LeadMS *int64   `json:"lead_ms"`
	Pad    string   `json:"pad"`
	On     bool     `json:"on"`
	InMS   *int64   `json:"in_ms"`
	V      *float64 `json:"v"`
	Move   bool     `json:"move"`
	Why    string   `json:"why"`
}

func dialPlay(t *testing.T, url string) (*websocket.Conn, playMsg) {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c, readPlay(t, c)
}

func readPlay(t *testing.T, c *websocket.Conn) playMsg {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var m playMsg
	if err := c.ReadJSON(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func sendPlay(t *testing.T, c *websocket.Conn, v map[string]any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatal(err)
	}
}

func TestPlaySaysHelloAndPassesPressesOn(t *testing.T) {
	f, url := newPlayAPI(t)
	c, hello := dialPlay(t, url)
	if hello.T != "hello" || hello.LeadMS == nil || *hello.LeadMS != 212 || len(hello.Pads) != len(tape.Pads()) {
		t.Fatalf("hello = %+v", hello)
	}
	sendPlay(t, c, map[string]any{"t": "press", "pad": "stop", "q": "16th"})
	f.waitFor(t, "press stop 16th")
	sendPlay(t, c, map[string]any{"t": "press", "pad": "stop", "q": "16th"}) // a repeat is the same hold
	sendPlay(t, c, map[string]any{"t": "release", "pad": "stop"})
	f.waitFor(t, "press stop 16th", "release stop")
}

func TestTwoPlayersHoldingAPadKeepItUntilBothLetGo(t *testing.T) {
	f, url, api := newPlayAPIWith(t)
	a, _ := dialPlay(t, url)
	b, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]any{"t": "press", "pad": "break", "q": "16th"})
	f.waitFor(t, "press break 16th")
	sendPlay(t, b, map[string]any{"t": "press", "pad": "break", "q": "16th"})
	holders(t, api, "break", 2)
	sendPlay(t, a, map[string]any{"t": "release", "pad": "break"})
	holders(t, api, "break", 1)
	f.waitFor(t, "press break 16th") // b still holds it
	sendPlay(t, b, map[string]any{"t": "release", "pad": "break"})
	f.waitFor(t, "press break 16th", "release break")
}

func TestAPlayerWhoGoesLetsGoOfWhatTheyHeld(t *testing.T) {
	f, url, api := newPlayAPIWith(t)
	a, _ := dialPlay(t, url)
	b, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]any{"t": "press", "pad": "break", "q": "16th"})
	sendPlay(t, a, map[string]any{"t": "press", "pad": "stop", "q": "16th"})
	f.waitFor(t, "press break 16th", "press stop 16th")
	sendPlay(t, b, map[string]any{"t": "press", "pad": "break", "q": "16th"})
	holders(t, api, "break", 2)
	a.Close() // a's phone drops off the Wi-Fi
	// Its STOP goes; the BREAK b is still holding stays.
	f.waitFor(t, "press break 16th", "press stop 16th", "release stop")
}

func TestPlayTellsThePageWhenAPadWillBeHeard(t *testing.T) {
	f, url := newPlayAPI(t)
	f.heard("chop", true, 999) // before the page came: not news to it
	c, _ := dialPlay(t, url)
	f.heard("stop", true, 187)
	m := readPlay(t, c)
	if m.T != "at" || m.Pad != "stop" || !m.On || m.InMS == nil || *m.InMS != 187 {
		t.Fatalf("got %+v, want stop heard in 187 ms", m)
	}
}

func TestPlaySaysWhyAPressWasRefused(t *testing.T) {
	f, url := newPlayAPI(t)
	f.refuse = map[string]error{"stop": tape.ErrMixingDown}
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "press", "pad": "stop", "q": "16th"})
	m := readPlay(t, c)
	if m.T != "refused" || m.Pad != "stop" || m.Why != tape.ErrMixingDown.Error() {
		t.Fatalf("got %+v", m)
	}
	// A refused press holds nothing: letting go of it asks nothing of the engine.
	sendPlay(t, c, map[string]any{"t": "release", "pad": "stop"})
	time.Sleep(50 * time.Millisecond)
	f.waitFor(t)
}

func TestPlayPassesAmountsOn(t *testing.T) {
	f, url := newPlayAPI(t)
	c, hello := dialPlay(t, url)
	if len(hello.Mods) != len(tape.Mods()) {
		t.Fatalf("hello = %+v: want the mods listed", hello)
	}
	sendPlay(t, c, map[string]any{"t": "press", "pad": "filter", "q": "16th", "v": 0.8})
	sendPlay(t, c, map[string]any{"t": "set", "pad": "filter", "v": 0.25})
	sendPlay(t, c, map[string]any{"t": "set", "pad": "filter"}) // no amount: nothing to do
	sendPlay(t, c, map[string]any{"t": "release", "pad": "filter"})
	f.waitFor(t, "press filter 16th 0.8", "set filter 0.25", "release filter")
}

func TestAModPreviewGoesBackWhenItsLetGoOrThePlayerGoes(t *testing.T) {
	f, url := newPlayAPI(t)
	a, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]any{"t": "set", "pad": "mod.wow", "v": 0.5})
	sendPlay(t, a, map[string]any{"t": "set", "pad": "mod.age", "v": 0.2})
	sendPlay(t, a, map[string]any{"t": "release", "pad": "mod.wow"})
	f.waitFor(t, "preview mod.wow 0.5 by page:1", "preview mod.age 0.2 by page:1", "end mod.wow by page:1")
	a.Close() // the page goes mid-drag: its other preview goes with it
	f.waitFor(t, "preview mod.wow 0.5 by page:1", "preview mod.age 0.2 by page:1", "end mod.wow by page:1", "end mod.age by page:1")
}

func TestPlaySaysWhyASetWasRefused(t *testing.T) {
	f, url := newPlayAPI(t)
	f.refuse = map[string]error{"stop": tape.ErrNoAmount}
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "set", "pad": "stop", "v": 0.5})
	if m := readPlay(t, c); m.T != "refused" || m.Pad != "stop" || m.Why != tape.ErrNoAmount.Error() {
		t.Fatalf("got %+v", m)
	}
}

func TestPlayTellsThePageAnAmount(t *testing.T) {
	f, url := newPlayAPI(t)
	c, _ := dialPlay(t, url)
	f.mu.Lock()
	v := 0.4
	f.moves = append(f.moves, tape.TrickEvent{Seq: uint64(len(f.moves) + 1), Pad: "filter", On: true, Out: 90, V: &v, Move: true})
	f.mu.Unlock()
	m := readPlay(t, c)
	if m.T != "at" || m.Pad != "filter" || m.V == nil || *m.V != 0.4 || !m.Move || m.InMS == nil || *m.InMS != 90 {
		t.Fatalf("got %+v", m)
	}
}

func TestAFloodOfSetsDoesntStopThePlayer(t *testing.T) {
	// Far past the 30 a second a page sends: every one is taken, and a
	// release after them still lets go.
	f, url := newPlayAPI(t)
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "press", "pad": "echo", "q": "now", "v": 1})
	for i := 0; i < 2000; i++ {
		sendPlay(t, c, map[string]any{"t": "set", "pad": "echo", "v": float64(i%10) / 10})
	}
	sendPlay(t, c, map[string]any{"t": "release", "pad": "echo"})
	deadline := time.Now().Add(5 * time.Second)
	for {
		got := f.log()
		if len(got) == 2002 && got[len(got)-1] == "release echo" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d calls, the last %q", len(got), got[len(got)-1])
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestEachPlayerPreviewsAndLetsGoAsItself(t *testing.T) {
	// The engine has one preview a mod and lets it go only for whoever set
	// it last; each page asks as itself, so a page that goes can't clear the
	// preview another page, or a controller, is moving now.
	f, url := newPlayAPI(t)
	a, _ := dialPlay(t, url)
	b, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]any{"t": "set", "pad": "mod.wow", "v": 0.3})
	f.waitFor(t, "preview mod.wow 0.3 by page:1")
	sendPlay(t, b, map[string]any{"t": "set", "pad": "mod.wow", "v": 0.7})
	f.waitFor(t, "preview mod.wow 0.3 by page:1", "preview mod.wow 0.7 by page:2")
	a.Close()
	f.waitFor(t, "preview mod.wow 0.3 by page:1", "preview mod.wow 0.7 by page:2", "end mod.wow by page:1")
	b.Close()
	f.waitFor(t, "preview mod.wow 0.3 by page:1", "preview mod.wow 0.7 by page:2", "end mod.wow by page:1", "end mod.wow by page:2")
}

func TestPlaySendsMovesAndReleasesInTheOrderTheyHappened(t *testing.T) {
	// A set and a release in one block: the page hears the move, then the
	// release -- never a release and then a stale move -- and a move says
	// nothing of on: only a press's or release's at lights a pad.
	f, url := newPlayAPI(t)
	c, _ := dialPlay(t, url)
	v := 0.6
	f.mu.Lock()
	f.seq++
	f.events = append(f.events, tape.TrickEvent{Seq: f.seq, Pad: "filter", On: false, Out: 100})
	f.moves = append(f.moves, tape.TrickEvent{Seq: uint64(len(f.moves) + 1), Pad: "filter", Out: 90, V: &v, Move: true})
	f.mu.Unlock()
	var got []map[string]any
	for len(got) < 2 {
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, b, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if m["t"] == "at" {
			got = append(got, m)
		}
	}
	if got[0]["move"] != true || got[1]["move"] == true || got[1]["on"] != false {
		t.Fatalf("got %v then %v: want the move, then the release", got[0], got[1])
	}
	if _, has := got[0]["on"]; has {
		t.Fatalf("a move says on: %v", got[0])
	}
}
