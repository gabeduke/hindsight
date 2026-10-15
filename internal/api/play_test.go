package api

import (
	"encoding/json"
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
	LeadMS *int64   `json:"lead_ms"`
	Pad    string   `json:"pad"`
	On     bool     `json:"on"`
	InMS   *int64   `json:"in_ms"`
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

func sendPlay(t *testing.T, c *websocket.Conn, v map[string]string) {
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
	sendPlay(t, c, map[string]string{"t": "press", "pad": "stop", "q": "16th"})
	f.waitFor(t, "press stop 16th")
	sendPlay(t, c, map[string]string{"t": "press", "pad": "stop", "q": "16th"}) // a repeat is the same hold
	sendPlay(t, c, map[string]string{"t": "release", "pad": "stop"})
	f.waitFor(t, "press stop 16th", "release stop")
}

func TestTwoPlayersHoldingAPadKeepItUntilBothLetGo(t *testing.T) {
	f, url, api := newPlayAPIWith(t)
	a, _ := dialPlay(t, url)
	b, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]string{"t": "press", "pad": "break", "q": "16th"})
	f.waitFor(t, "press break 16th")
	sendPlay(t, b, map[string]string{"t": "press", "pad": "break", "q": "16th"})
	holders(t, api, "break", 2)
	sendPlay(t, a, map[string]string{"t": "release", "pad": "break"})
	holders(t, api, "break", 1)
	f.waitFor(t, "press break 16th") // b still holds it
	sendPlay(t, b, map[string]string{"t": "release", "pad": "break"})
	f.waitFor(t, "press break 16th", "release break")
}

func TestAPlayerWhoGoesLetsGoOfWhatTheyHeld(t *testing.T) {
	f, url, api := newPlayAPIWith(t)
	a, _ := dialPlay(t, url)
	b, _ := dialPlay(t, url)
	sendPlay(t, a, map[string]string{"t": "press", "pad": "break", "q": "16th"})
	sendPlay(t, a, map[string]string{"t": "press", "pad": "stop", "q": "16th"})
	f.waitFor(t, "press break 16th", "press stop 16th")
	sendPlay(t, b, map[string]string{"t": "press", "pad": "break", "q": "16th"})
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
	sendPlay(t, c, map[string]string{"t": "press", "pad": "stop", "q": "16th"})
	m := readPlay(t, c)
	if m.T != "refused" || m.Pad != "stop" || m.Why != tape.ErrMixingDown.Error() {
		t.Fatalf("got %+v", m)
	}
	// A refused press holds nothing: letting go of it asks nothing of the engine.
	sendPlay(t, c, map[string]string{"t": "release", "pad": "stop"})
	time.Sleep(50 * time.Millisecond)
	f.waitFor(t)
}
