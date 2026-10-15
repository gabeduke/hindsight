package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// controlsAPI is a play API (play_test.go's fake engine) with a tape
// directory for controls.json, and its router.
func controlsAPI(t *testing.T, dir string) (*fakeTricks, string, *API, http.Handler) {
	t.Helper()
	cfg := &config.Config{OutputDir: t.TempDir(), TapeDir: dir, SampleRate: 48000, SaveChannels: []int{0, 1}}
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
	return f, "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/tapes/play", a, r
}

// A controller's note is a press on the render head, quantised as a page's
// is, and its note-off (a note-on at velocity 0 too) the release.
func TestAControllersNoteBecomesAQuantisedPress(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	a.ControlMIDI("Keystation 49", 0x90, 43, 100) // G2: STOP
	f.waitFor(t, "press stop 16th")
	holders(t, a, "stop", 1)
	a.ControlMIDI("Keystation 49", 0x90, 43, 0)
	f.waitFor(t, "press stop 16th", "release stop")
	holders(t, a, "stop", 0)

	// The quantum the Pi's bindings name.
	a.controls.mu.Lock()
	a.controlsLocked().Quantum = "8th"
	a.controls.mu.Unlock()
	a.ControlMIDI("Keystation 49", 0x90, 40, 100)
	f.waitFor(t, "press stop 16th", "release stop", "press break 8th")
}

// A controller holds as a page does: one more holder, so a pad held by both
// sounds until both let go, and a port that goes lets go of what it held.
func TestAControllerIsOneMoreHolder(t *testing.T) {
	f, url, a, _ := controlsAPI(t, t.TempDir())
	page, _ := dialPlay(t, url)
	sendPlay(t, page, map[string]any{"t": "press", "pad": "break", "q": "16th"})
	f.waitFor(t, "press break 16th")
	a.ControlMIDI("Keystation 49", 0x90, 40, 100)
	a.ControlMIDI("Keystation 49", 0x90, 38, 100) // track 3, its alone
	holders(t, a, "break", 2)
	f.waitFor(t, "press break 16th", "press track3 16th")
	if got := a.heldBy("Keystation 49"); !slices.Equal(got, []string{"break", "track3"}) {
		t.Fatalf("held by the controller: %v", got)
	}
	a.ControllerGone("Keystation 49") // unplugged
	holders(t, a, "break", 1)
	f.waitFor(t, "press break 16th", "press track3 16th", "release track3")
	sendPlay(t, page, map[string]any{"t": "release", "pad": "break"})
	f.waitFor(t, "press break 16th", "press track3 16th", "release track3", "release break")
}

// A page that comes while the controller holds a pad hears it in hello.
func TestHelloSaysWhatsHeld(t *testing.T) {
	f, url, a, _ := controlsAPI(t, t.TempDir())
	a.ControlMIDI("Keystation 49", 0x90, 37, 100)
	f.waitFor(t, "press track2 16th")
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var hello struct {
		T    string   `json:"t"`
		Held []string `json:"held"`
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := c.ReadJSON(&hello); err != nil {
		t.Fatal(err)
	}
	if hello.T != "hello" || !slices.Equal(hello.Held, []string{"track2"}) {
		t.Fatalf("hello = %+v", hello)
	}
}

// The latch (a sustain pedal) keeps what's let go held until it lifts; All
// Notes Off lets go of everything the controller holds.
func TestTheLatchAndAllNotesOff(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	p := "Keystation 49"
	a.ControlMIDI(p, 0xB0, 64, 127)
	a.ControlMIDI(p, 0x90, 41, 100)
	a.ControlMIDI(p, 0x80, 41, 0)
	f.waitFor(t, "press reverse 16th")
	holders(t, a, "reverse", 1)
	a.ControlMIDI(p, 0xB0, 64, 0)
	f.waitFor(t, "press reverse 16th", "release reverse")

	a.ControlMIDI(p, 0x90, 36, 100)
	a.ControlMIDI(p, 0x90, 42, 100)
	f.waitFor(t, "press reverse 16th", "release reverse", "press track1 16th", "press chop 16th")
	a.ControlMIDI(p, 0xB0, 123, 0)
	holders(t, a, "track1", 0)
	holders(t, a, "chop", 0)
}

// fakeVerbs records the commands a controller ran.
type fakeVerbs struct {
	mu  sync.Mutex
	ran []string
}

func (v *fakeVerbs) Verb(id, rt string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.ran = append(v.ran, strings.TrimSuffix(id+" "+rt, " "))
	return id, nil
}

func (v *fakeVerbs) wait(t *testing.T, want ...string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		v.mu.Lock()
		got := slices.Clone(v.ran)
		v.mu.Unlock()
		if slices.Equal(got, want) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ran %q, want %q", got, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// The verbs run on the Pi, on the press: no page is needed for one.
func TestAControllersVerbsRunOnThePi(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	v := &fakeVerbs{}
	a.controls.verbs = v
	p := "Keystation 49"
	for _, n := range []byte{50, 51, 52, 53} { // C3 catch, C♯3 grab, D3 drop, D♯3 keep
		a.ControlMIDI(p, 0x90, n, 100)
		a.ControlMIDI(p, 0x80, n, 0)
	}
	a.ControlMIDI(p, 0xFA, 0, 0) // Start
	// Two queues (TestKeepAndTheTransportDontWaitForAGrab): each in its order.
	deadline := time.Now().Add(2 * time.Second)
	for {
		v.mu.Lock()
		got := slices.Clone(v.ran)
		v.mu.Unlock()
		if len(got) == 5 {
			at := func(s string) int { return slices.Index(got, s) }
			if at("grab") > at("drop") || at("catch") > at("keep") || at("keep") > at("transport start") || slices.Contains(got, "") {
				t.Fatalf("ran %q, out of order", got)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ran %q", got)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// The SMK-37 starts on its own profile: its pads on channel 10, so its keys
// don't run verbs. Anything else starts at note 36 on any channel.
func TestAKnownControllerShipsAProfile(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	a.ControlMIDI("SMK-37", 0x90, 43, 100) // channel 1: its keys
	time.Sleep(30 * time.Millisecond)
	f.waitFor(t)
	a.ControlMIDI("SMK-37", 0x99, 43, 100) // channel 10: its pads
	f.waitFor(t, "press stop 16th")
}

// learn binds the next note or CC from that controller -- and nothing from
// another -- and says so on the socket; it's in controls.json after.
func TestLearnBindsOnlyFromThatController(t *testing.T) {
	dir := t.TempDir()
	f, url, a, _ := controlsAPI(t, dir)
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "learn", "action": "stop", "port": "SMK-37"})
	waitLearning(t, a)
	a.ControlMIDI("Keystation 49", 0x90, 72, 100) // another controller: plays, teaches nothing
	f.waitFor(t)
	a.ControlMIDI("SMK-37", 0x99, 72, 100)
	var m struct {
		T, Action, Port string
		MIDI            Binding `json:"midi"`
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := c.ReadJSON(&m); err != nil {
		t.Fatal(err)
	}
	if m.T != "learned" || m.Action != "stop" || m.Port != "SMK-37" || m.MIDI.Note == nil || *m.MIDI.Note != 72 || m.MIDI.Ch != 10 {
		t.Fatalf("got %+v", m)
	}
	f.waitFor(t) // the note that taught it didn't also play
	a.ControlMIDI("SMK-37", 0x99, 72, 0)
	a.ControlMIDI("SMK-37", 0x99, 72, 100)
	f.waitFor(t, "press stop 16th")
	// Its old pad, G2 on channel 10, is no longer STOP's...
	a.ControlMIDI("SMK-37", 0x99, 72, 0)
	a.ControlMIDI("SMK-37", 0x99, 43, 100)
	time.Sleep(30 * time.Millisecond)
	f.waitFor(t, "press stop 16th", "release stop")
	// ...and the other controller's map is its own.
	a.ControlMIDI("Keystation 49", 0x90, 43, 100)
	f.waitFor(t, "press stop 16th", "release stop", "press stop 16th")
	raw, err := os.ReadFile(filepath.Join(dir, "controls.json"))
	if err != nil || !strings.Contains(string(raw), `"SMK-37"`) {
		t.Fatalf("controls.json: %s %v", raw, err)
	}
}

func waitLearning(t *testing.T, a *API) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		a.controls.mu.Lock()
		l := a.controls.learn
		a.controls.mu.Unlock()
		if l != nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("learn never started")
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// Nothing played in the wait: refused, and the next note plays as before.
func TestLearnIsRefusedWhenNothingMoves(t *testing.T) {
	f, url, a, _ := controlsAPI(t, t.TempDir())
	a.controls.learnWait = 50 * time.Millisecond
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "learn", "action": "stop"})
	var m struct{ T, Learn, Why string }
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := c.ReadJSON(&m); err != nil {
		t.Fatal(err)
	}
	if m.T != "refused" || m.Learn != "stop" || !strings.Contains(m.Why, "no controller") {
		t.Fatalf("got %+v", m)
	}
	a.ControlMIDI("SMK-37", 0x99, 43, 100)
	f.waitFor(t, "press stop 16th")
}

// controls.json round-trips: what's PUT is what's GOT, and what a new
// process reads.
func TestControlsJSONRoundTrips(t *testing.T) {
	dir := t.TempDir()
	_, _, _, r := controlsAPI(t, dir)
	body := `{"quantum":"8th","controllers":{"Keystation 49":{"stop":[{"note":72,"ch":2}],"filter":[{"note":47},{"cc":74,"as":"amount"}],"latch":[{"cc":64}],"transport":[{"rt":"start"},{"rt":"stop"}]}}}`
	req := httptest.NewRequest(http.MethodPut, "/api/tapes/controls", strings.NewReader(body))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	get := func(h http.Handler) map[string]any {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tapes/controls", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET: %d %s", rec.Code, rec.Body)
		}
		var v map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	first := get(r)
	_, _, _, again := controlsAPI(t, dir) // a restart: the file, read fresh
	second := get(again)
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if !bytes.Equal(a, b) {
		t.Fatalf("after a restart:\n%s\nwant\n%s", b, a)
	}
	var want, got map[string]any
	json.Unmarshal([]byte(body), &want)
	ctl := second["controllers"].([]any)[0].(map[string]any)
	if second["quantum"] != "8th" || ctl["name"] != "Keystation 49" || ctl["learned"] != true {
		t.Fatalf("got %s", b)
	}
	gb, _ := json.Marshal(ctl["bindings"])
	wb, _ := json.Marshal(want["controllers"].(map[string]any)["Keystation 49"])
	json.Unmarshal(gb, &got)
	if !jsonEqual(gb, wb) {
		t.Fatalf("bindings %s, want %s", gb, wb)
	}

	// null puts a controller back to its profile; nonsense is refused.
	for _, bad := range []string{`{"controllers":{"x":{"nope":[{"note":1}]}}}`, `{"controllers":{"x":{"stop":[{"note":128}]}}}`,
		`{"controllers":{"x":{"stop":[{"note":1,"cc":2}]}}}`, `{"quantum":"7th"}`} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls", strings.NewReader(bad)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls", strings.NewReader(`{"controllers":{"Keystation 49":null}}`)))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "Keystation") {
		t.Fatalf("null: %d %s", rec.Code, rec.Body)
	}
}

func jsonEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return bytes.Equal(xa, ya)
}

// The Pi's defaults are controls.js's: every action, its kind and its MIDI,
// read out of the page's own list.
func TestControlsMatchThePage(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "web", "static", "lib", "play", "controls.js"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	body = body[strings.Index(body, "export const CONTROLS = ["):strings.Index(body, "\n];")]
	kinds := map[string]string{"HELD": kindHeld, "AMOUNT": kindAmount, "LATCHED": kindLatched, "COMMAND": kindCommand, "MODIFIER": kindModifier}
	entry := regexp.MustCompile(`\{ id: '([^']+)', kind: ([A-Z]+),[^\n]*?midi: \[([^\]]*)\]`)
	part := regexp.MustCompile(`note\((\d+)\)|cc\((\d+)(, 'amount')?\)|\{ bend: true \}|\{ program: true \}|\{ rt: '(\w+)' \}`)
	var page []controlAction
	for _, m := range entry.FindAllStringSubmatch(body, -1) {
		c := controlAction{ID: m[1], Kind: kinds[m[2]]}
		for _, p := range part.FindAllStringSubmatch(m[3], -1) {
			switch {
			case p[1] != "":
				n, _ := strconv.Atoi(p[1])
				c.MIDI = append(c.MIDI, bn(n))
			case p[2] != "":
				n, _ := strconv.Atoi(p[2])
				if p[3] != "" {
					c.MIDI = append(c.MIDI, bamount(n))
				} else {
					c.MIDI = append(c.MIDI, bcc(n))
				}
			case strings.Contains(p[0], "bend"):
				c.MIDI = append(c.MIDI, Binding{Bend: true})
			case strings.Contains(p[0], "program"):
				c.MIDI = append(c.MIDI, Binding{Program: true})
			default:
				c.MIDI = append(c.MIDI, brt(p[4]))
			}
		}
		page = append(page, c)
	}
	if len(page) != len(controlActions) {
		t.Fatalf("controls.js has %d actions, the Pi %d", len(page), len(controlActions))
	}
	for i, c := range page {
		pa, _ := json.Marshal(c)
		pi, _ := json.Marshal(controlActions[i])
		if !bytes.Equal(pa, pi) {
			t.Errorf("action %d:\n page %s\n   Pi %s", i, pa, pi)
		}
	}
}

// A controller in the Pi, end to end: a FIFO standing in for its rawmidi
// node, read by the real watcher, played on the bus; unplugged, its pad
// lets go.
func TestAControllerThroughTheWatcher(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	root := t.TempDir()
	cards := filepath.Join(root, "cards")
	os.WriteFile(cards, []byte(" 3 [SMK37          ]: USB-Audio - SMK-37\n                      M-VAVE SMK-37 at usb-xhci-hcd.0-2, full speed\n"), 0o644)
	snd := filepath.Join(root, "snd")
	os.MkdirAll(snd, 0o755)
	node := filepath.Join(snd, "midiC3D0")
	if err := syscall.Mkfifo(node, 0o666); err != nil {
		t.Fatal(err)
	}
	w := midi.NewWatcher(midi.Policy{Capture: false, Controllers: []string{"SMK"}}, midi.NewClock(1000), nil)
	w.CardsPath, w.SndDir = cards, snd
	w.Poll, w.DrainWindow = 20*time.Millisecond, 20*time.Millisecond
	w.SetControlSink(a)
	a.SetControllers(w)
	w.Start()
	defer w.Stop()
	// Opened without blocking, so a watcher that never opens the node fails
	// the test instead of hanging it.
	var wr *os.File
	deadline := time.Now().Add(3 * time.Second)
	for {
		f, err := os.OpenFile(node, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			wr = f
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the watcher never opened the controller: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	deadline = time.Now().Add(3 * time.Second)
	for !strings.Contains(controlsBody(t, a), `"connected":true`) {
		if time.Now().After(deadline) {
			t.Fatal("the controller never showed as connected")
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(60 * time.Millisecond) // past the drain window
	wr.Write([]byte{0x99, 40, 100})   // a pad: BREAK
	f.waitFor(t, "press break 16th")
	holders(t, a, "break", 1)
	os.Remove(node)
	wr.Close()
	f.waitFor(t, "press break 16th", "release break")
	holders(t, a, "break", 0)
}

func controlsBody(t *testing.T, a *API) string {
	b, _ := json.Marshal(a.controlsView())
	return string(b)
}

// The punch-in FX from a controller: velocity is the amount at the press,
// the mod wheel and aftertouch move it while held, and the pitch wheel is
// the bend -- pressed as it leaves the centre, let go as it comes back.
func TestAControllerPlaysTheFXWithItsAmounts(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	const port = "Keystation 49"
	a.ControlMIDI(port, 0xD0, 127, 0)   // aftertouch with nothing held: nothing
	a.ControlMIDI(port, 0x90, 47, 127)  // FILTER at full velocity
	a.ControlMIDI(port, 0xB0, 1, 0)     // the mod wheel opens it
	a.ControlMIDI(port, 0xD0, 127, 0)   // channel aftertouch: what it holds
	a.ControlMIDI(port, 0xA0, 47, 0)    // poly aftertouch on FILTER's key
	a.ControlMIDI(port, 0xA0, 48, 127)  // and on a key it isn't holding: nothing
	a.ControlMIDI(port, 0x80, 47, 0)    // let go
	a.ControlMIDI(port, 0xE0, 127, 127) // the wheel up
	a.ControlMIDI(port, 0xE0, 0, 0)     // down
	a.ControlMIDI(port, 0xE0, 0, 64)    // back to the centre
	f.waitFor(t, "press filter 16th 1", "set filter 0", "set filter 1", "set filter 0",
		"release filter", "press bend now 1", "set bend -1", "release bend")
	if held := a.heldBy(port); len(held) != 0 {
		t.Fatalf("still held: %v", held)
	}
}

// An FX keeps the note that pressed it through a rebind: that key's
// aftertouch still moves FILTER, and its note-off lets FILTER go, though the
// bindings give the key to ECHO by then.
func TestAnFXFollowsTheNoteThatPressedItThroughARebind(t *testing.T) {
	f, _, a, r := controlsAPI(t, t.TempDir())
	const port = "Keystation 49"
	a.ControlMIDI(port, 0x90, 47, 127) // FILTER at full velocity
	f.waitFor(t, "press filter 16th 1")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls",
		strings.NewReader(`{"controllers":{"Keystation 49":{"echo":[{"note":47}],"filter":[{"note":60}]}}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	a.ControlMIDI(port, 0xA0, 47, 0) // aftertouch on that key: still FILTER's
	a.ControlMIDI(port, 0x80, 47, 0) // and its note-off lets FILTER go
	f.waitFor(t, "press filter 16th 1", "set filter 0", "release filter")
	if held := a.heldBy(port); len(held) != 0 {
		t.Fatalf("still held: %v", held)
	}
}

// An FX keeps P3's per-key bookkeeping: bound to two keys it sounds until
// the last lets go, its velocity from the key that pressed it first, and
// aftertouch moves it all the while; under the pedal it waits for the
// pedal's own lift. The wheel's bend, let go and bent again, presses again.
func TestAnFXHeldByTwoKeysOrThePedalLetsGoOnlyByTheRightRelease(t *testing.T) {
	f, _, a, r := controlsAPI(t, t.TempDir())
	const port = "Keystation 49"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls",
		strings.NewReader(`{"controllers":{"Keystation 49":{"filter":[{"note":47},{"note":60}],"latch":[{"cc":64}],"bend":[{"bend":true}]}}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	a.ControlMIDI(port, 0x90, 47, 127) // B2: FILTER
	a.ControlMIDI(port, 0x90, 60, 64)  // C4: FILTER too
	a.ControlMIDI(port, 0x80, 47, 0)   // B2 up: C4 still holds it
	a.ControlMIDI(port, 0xD0, 0, 0)    // aftertouch: still FILTER's
	a.ControlMIDI(port, 0x80, 60, 0)   // C4 up: now it lets go
	f.waitFor(t, "press filter 16th 1", "set filter 0", "release filter")

	a.ControlMIDI(port, 0xB0, 64, 127) // the pedal down
	a.ControlMIDI(port, 0x90, 47, 127) // FILTER
	a.ControlMIDI(port, 0x80, 47, 0)   // up, under the pedal: it waits
	a.ControlMIDI(port, 0xD0, 127, 0)  // and aftertouch still moves it
	time.Sleep(30 * time.Millisecond)
	f.waitFor(t, "press filter 16th 1", "set filter 0", "release filter", "press filter 16th 1", "set filter 1")
	a.ControlMIDI(port, 0xB0, 64, 0) // the pedal's own lift lets it go
	f.waitFor(t, "press filter 16th 1", "set filter 0", "release filter", "press filter 16th 1", "set filter 1", "release filter")

	a.ControlMIDI(port, 0xE0, 127, 127) // the wheel up
	a.ControlMIDI(port, 0xE0, 0, 64)    // home
	a.ControlMIDI(port, 0xE0, 127, 127) // and up again: a new press
	a.ControlMIDI(port, 0xE0, 0, 64)
	f.waitFor(t, "press filter 16th 1", "set filter 0", "release filter", "press filter 16th 1", "set filter 1", "release filter",
		"press bend now 1", "release bend", "press bend now 1", "release bend")
	if held := a.heldBy(port); len(held) != 0 {
		t.Fatalf("still held: %v", held)
	}
}

// A controller's mod wheel and aftertouch move the FX that controller
// holds, latched ones included -- never one another hand is playing.
func TestAControllersAmountsMoveOnlyTheFXItHolds(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	const port, other = "Keystation 49", "Other"
	a.ControlMIDI(other, 0x90, 47, 127) // another controller holds FILTER
	f.waitFor(t, "press filter 16th 1")
	a.ControlMIDI(port, 0xB0, 1, 0)    // this one's mod wheel, holding nothing
	a.ControlMIDI(port, 0xD0, 127, 0)  // and its aftertouch: nothing
	a.ControlMIDI(other, 0xB0, 1, 127) // the one holding it moves it
	f.waitFor(t, "press filter 16th 1", "set filter 1")
	a.ControlMIDI(other, 0x80, 47, 0)
	f.waitFor(t, "press filter 16th 1", "set filter 1", "release filter")

	a.ControlMIDI(port, 0xB0, 64, 127) // the pedal down
	a.ControlMIDI(port, 0x90, 48, 127) // ECHO, let go under it
	a.ControlMIDI(port, 0x80, 48, 0)
	a.ControlMIDI(port, 0xB0, 1, 0) // the wheel is FILTER's, which this one doesn't hold
	time.Sleep(30 * time.Millisecond)
	a.ControlMIDI(port, 0xD0, 127, 0) // aftertouch moves the latched ECHO
	f.waitFor(t, "press filter 16th 1", "set filter 1", "release filter", "press echo 16th 1", "set echo 1")
	a.ControlMIDI(port, 0xB0, 64, 0)
}

// logLines collects what the package logs, for counting.
type logLines struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logLines) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *logLines) count(sub string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Count(l.b.String(), sub)
}

// A pitch wheel in a mixdown: every message asks again, and is refused
// again, but the log says so once -- not a hundred lines a second -- and
// once more for the next refusal after one that went through.
func TestARefusedBendIsLoggedOncePerRefusal(t *testing.T) {
	f, _, a, _ := controlsAPI(t, t.TempDir())
	var lines logLines
	log.SetOutput(&lines)
	defer log.SetOutput(os.Stderr)
	f.mu.Lock()
	f.refuse = map[string]error{"bend": tape.ErrMixingDown}
	f.mu.Unlock()
	const port = "Keystation 49"
	for i := 0; i < 100; i++ {
		a.ControlMIDI(port, 0xE0, 0, byte(70+i%50)) // the wheel moving, off centre
	}
	if n := lines.count("bend refused"); n != 1 {
		t.Fatalf("logged %d times, want once:\n%s", n, lines.b.String())
	}
	f.mu.Lock()
	f.refuse = nil
	f.mu.Unlock()
	a.ControlMIDI(port, 0xE0, 0, 100) // the mixdown over: it bends
	a.ControlMIDI(port, 0xE0, 0, 64)  // and back
	f.mu.Lock()
	f.refuse = map[string]error{"bend": tape.ErrMixingDown}
	f.mu.Unlock()
	for i := 0; i < 10; i++ {
		a.ControlMIDI(port, 0xE0, 0, 100)
	}
	if n := lines.count("bend refused"); n != 2 {
		t.Fatalf("logged %d times, want twice:\n%s", n, lines.b.String())
	}
}

// The tape mods from a controller: CC 21–24 preview as the knob turns and
// save once it's still; a program change picks a formula.
func TestAControllersKnobsAndProgramsSetTheTapesMods(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	tp, err := a.tape.Store().Create("knobs", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.tape.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	a.controls.knobQuiet = 30 * time.Millisecond
	const port = "Keystation 49"
	for _, v := range []byte{20, 60, 127} {
		a.ControlMIDI(port, 0xB0, 23, v) // DRIVE
	}
	deadline := time.Now().Add(2 * time.Second)
	for s := a.tape.Loaded().Style; s == nil || s.Drive != 1; s = a.tape.Loaded().Style {
		if time.Now().After(deadline) {
			t.Fatalf("the knob was never saved: %+v", s)
		}
		time.Sleep(5 * time.Millisecond)
	}
	a.ControlMIDI(port, 0xC0, 2, 0) // program 2: FERRIC
	if s := a.tape.Loaded().Style; s.Formula != tape.FormulaFerric || s.Drive != 0.3 {
		t.Fatalf("after program 2: %+v", s)
	}
	a.ControlMIDI(port, 0xC0, 9, 0) // no formula of that number: nothing
	if s := a.tape.Loaded().Style; s.Formula != tape.FormulaFerric {
		t.Fatalf("after program 9: %+v", s)
	}
}

// A note-off lets go of the pad its note-on pressed, whatever the bindings
// say by then: a PUT that moves BREAK, or a learn whose teaching note-off
// would otherwise let the old pad go early.
func TestANoteOffLetsGoOfWhatItsNoteOnPressed(t *testing.T) {
	f, url, a, r := controlsAPI(t, t.TempDir())
	p := "Keystation 49"
	a.ControlMIDI(p, 0x90, 40, 100) // E2: BREAK
	f.waitFor(t, "press break 16th")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls",
		strings.NewReader(`{"controllers":{"Keystation 49":{"break":[{"note":47}],"stop":[{"note":43}]}}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	a.ControlMIDI(p, 0x80, 40, 0) // E2 up: BREAK lets go
	f.waitFor(t, "press break 16th", "release break")

	a.ControlMIDI(p, 0x90, 43, 100) // G2 holds STOP
	f.waitFor(t, "press break 16th", "release break", "press stop 16th")
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "learn", "action": "stop", "port": p})
	waitLearning(t, a)
	a.ControlMIDI(p, 0x90, 72, 100) // C5 teaches STOP
	a.ControlMIDI(p, 0x80, 72, 0)   // its note-off: nothing
	time.Sleep(30 * time.Millisecond)
	holders(t, a, "stop", 1)
	a.ControlMIDI(p, 0x80, 43, 0) // G2 up: now STOP lets go
	holders(t, a, "stop", 0)
}

// The controller's CATCH keeps the page's guards: the jam room only (the
// engine's own jamOnly), an armed track, and the catch mode -- the Pi's own,
// in controls.json, since the page's Layer / Replace is each device's.
func TestTheControllersCatchKeepsThePagesGuards(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	res, err := http.Post(srv.URL+"/api/tapes", "application/json", strings.NewReader(`{"name":"c"}`))
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("new tape: %v %v", err, res.StatusCode)
	}
	var made struct{ ID string }
	json.NewDecoder(res.Body).Decode(&made)
	res.Body.Close()
	if res, err := http.Post(srv.URL+"/api/tapes/load?id="+made.ID, "application/json", nil); err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("load: %v", err)
	}
	a := New(&config.Config{OutputDir: t.TempDir(), TapeDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}, nil, nil, nil, nil)
	a.SetTape(eng)
	tp := eng.Loaded()
	if tp == nil {
		t.Fatal("no tape loaded")
	}

	req, err := a.catchRequest(tp)
	if err != nil || req.Replace || req.Track != 1 || req.Pass != 1 {
		t.Fatalf("layer by default: %+v %v", req, err)
	}
	rec := httptest.NewRecorder()
	r := mux.NewRouter()
	a.SetupRoutes(r)
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls", strings.NewReader(`{"catch":"replace"}`)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"catch":"replace"`) {
		t.Fatalf("PUT catch: %d %s", rec.Code, rec.Body)
	}
	if req, _ := a.catchRequest(tp); !req.Replace {
		t.Fatalf("replace mode not honoured: %+v", req)
	}

	if code := putOutput(t, srv, "phone"); code != http.StatusOK {
		t.Fatalf("output phone: %d", code)
	}
	if _, err := (piVerbs{a}).Verb("catch", ""); !errors.Is(err, tape.ErrNeedsJamRoom) {
		t.Fatalf("a catch while the tape plays on a phone: %v, want %v", err, tape.ErrNeedsJamRoom)
	}
}

// slowGrab holds GRAB for as long as the test says: the bar after it.
type slowGrab struct {
	fakeVerbs
	gate chan struct{}
}

func (v *slowGrab) Verb(id, rt string) (string, error) {
	if id == "grab" {
		<-v.gate
	}
	return v.fakeVerbs.Verb(id, rt)
}

// KEEP and the transport don't wait behind a GRAB's bar: KEEP would keep a
// later 30 s, and Stop would stop late. DROP still waits for the GRAB
// before it.
func TestKeepAndTheTransportDontWaitForAGrab(t *testing.T) {
	_, _, a, _ := controlsAPI(t, t.TempDir())
	v := &slowGrab{gate: make(chan struct{})}
	a.controls.verbs = v
	p := "Keystation 49"
	a.ControlMIDI(p, 0x90, 51, 100) // GRAB, waiting for its bar
	a.ControlMIDI(p, 0x90, 52, 100) // DROP: after it
	a.ControlMIDI(p, 0x90, 53, 100) // KEEP: now
	a.ControlMIDI(p, 0xFC, 0, 0)    // Stop: now
	v.wait(t, "keep", "transport stop")
	close(v.gate)
	v.wait(t, "keep", "transport stop", "grab", "drop")
}

// A pedal lifted while MIDI LEARN waits lifts the latch it put down: learn
// takes only presses, and the latch goes with the key that put it down.
func TestAPedalLiftedWhileLearningLiftsTheLatch(t *testing.T) {
	f, url, a, _ := controlsAPI(t, t.TempDir())
	p := "Keystation 49"
	a.ControlMIDI(p, 0xB0, 64, 127) // the pedal down
	a.ControlMIDI(p, 0x90, 41, 100) // REV tapped: latched
	a.ControlMIDI(p, 0x80, 41, 0)
	f.waitFor(t, "press reverse 16th")
	c, _ := dialPlay(t, url)
	sendPlay(t, c, map[string]any{"t": "learn", "action": "stop", "port": p})
	waitLearning(t, a)
	a.ControlMIDI(p, 0xB0, 64, 0) // the pedal up: the latch lifts, nothing learned
	f.waitFor(t, "press reverse 16th", "release reverse")
	a.controls.mu.Lock()
	still := a.controls.learn != nil
	a.controls.mu.Unlock()
	if !still {
		t.Fatal("learn took the pedal's lift")
	}
	a.ControlMIDI(p, 0x90, 72, 100) // a press teaches it
	var m struct{ T, Action string }
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := c.ReadJSON(&m); err != nil || m.T != "learned" || m.Action != "stop" {
		t.Fatalf("got %+v %v", m, err)
	}
}

// Two keys bound to one pad: it sounds until the last of them lets go.
func TestTwoKeysOnOnePadHoldItUntilBothLetGo(t *testing.T) {
	f, _, a, r := controlsAPI(t, t.TempDir())
	p := "Keystation 49"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/tapes/controls",
		strings.NewReader(`{"controllers":{"Keystation 49":{"stop":[{"note":43},{"note":72}]}}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	a.ControlMIDI(p, 0x90, 43, 100)
	a.ControlMIDI(p, 0x90, 72, 100)
	f.waitFor(t, "press stop 16th")
	a.ControlMIDI(p, 0x80, 43, 0)
	time.Sleep(30 * time.Millisecond)
	holders(t, a, "stop", 1)
	f.waitFor(t, "press stop 16th")
	a.ControlMIDI(p, 0x80, 72, 0)
	f.waitFor(t, "press stop 16th", "release stop")
}
