package api

import (
	"encoding/json"
	"net/http"
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

// pullSink is a device the test pulls by hand.
type pullSink struct {
	mu   sync.Mutex
	pull func([]int32)
}

func (s *pullSink) Open(_ int, p func([]int32)) (string, error) {
	s.mu.Lock()
	s.pull = p
	s.mu.Unlock()
	return "test", nil
}
func (s *pullSink) Close() {}
func (s *pullSink) play(frames int) {
	for i := 0; i < frames; i += 960 {
		s.mu.Lock()
		p := s.pull
		s.mu.Unlock()
		p(make([]int32, 960*tape.OutChannels))
	}
}

func newStreamServer(t *testing.T) (*httptest.Server, *tape.Engine, *pullSink) {
	t.Helper()
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	dev := &pullSink{}
	eng := tape.NewEngine(tape.Options{Store: store, Sink: tape.NewOutput(dev)})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	a := New(&config.Config{OutputDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}, nil, nil, nil, nil)
	a.SetTape(eng)
	t.Cleanup(a.WaitBackground)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, eng, dev
}

func dialStream(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/tapes/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	t.Cleanup(func() { c.Close() })
	return c
}

func putOutput(t *testing.T, srv *httptest.Server, mode string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/tapes/output", strings.NewReader(`{"mode":"`+mode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

func readJSON(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	for {
		mt, b, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if mt == websocket.TextMessage {
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			return m
		}
	}
}

func TestTheStreamSaysHelloAndCarriesPackets(t *testing.T) {
	srv, _, dev := newStreamServer(t)
	if code := putOutput(t, srv, "phone"); code != 200 {
		t.Fatalf("PUT output: %d", code)
	}
	c := dialStream(t, srv)
	if m := readJSON(t, c); m["type"] != "hello" || m["rate"] != float64(48000) || m["mode"] != "phone" {
		t.Fatalf("hello: %v", m)
	}
	dev.play(9600)
	for {
		mt, b, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if mt == websocket.BinaryMessage {
			if _, err := tape.DecodePacket(b); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
}

func TestTheFillReportIsTheDelay(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	putOutput(t, srv, "phone")
	c := dialStream(t, srv)
	readJSON(t, c)
	if err := c.WriteMessage(websocket.TextMessage, []byte(`{"type":"fill","ms":805}`)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for eng.Live().Stream.DelayMS != 805 {
		if time.Now().After(deadline) {
			t.Fatalf("delay %d", eng.Live().Stream.DelayMS)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestASecondListenerTakesTheStream(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	putOutput(t, srv, "phone")
	first := dialStream(t, srv)
	readJSON(t, first)
	second := dialStream(t, srv)
	readJSON(t, second)
	if m := readJSON(t, first); m["type"] != "moved" {
		t.Fatalf("first got %v", m)
	}
	if n := eng.Live().Stream.Listeners; n != 1 {
		t.Fatalf("%d listeners", n)
	}
}

func TestAStalledListenerNeverHoldsUpTheTape(t *testing.T) {
	srv, _, dev := newStreamServer(t)
	putOutput(t, srv, "phone")
	c := dialStream(t, srv)
	readJSON(t, c) // then never read again
	done := make(chan struct{})
	go func() { dev.play(48000 * 30); close(done) }() // 30 s of audio, pulled as fast as it goes
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the device's pulls waited on a listener that stopped reading")
	}
}

func TestASilentPhoneIsDroppedPromptly(t *testing.T) {
	srv, eng, _ := newStreamServer(t)
	putOutput(t, srv, "phone")
	c := dialStream(t, srv)
	readJSON(t, c)
	if n := eng.Live().Stream.Listeners; n != 1 {
		t.Fatalf("%d listeners", n)
	}
	// The page reports its fill every 500 ms; a phone that says nothing for
	// 2 s has gone, and the Pi must notice in time for its drop-pause.
	start := time.Now()
	c.SetReadDeadline(start.Add(4 * time.Second))
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			break
		}
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("dropped after %v", d)
	}
	deadline := time.Now().Add(time.Second)
	for eng.Live().Stream.Listeners != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("%d listeners", eng.Live().Stream.Listeners)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestTheOutputEndpointRefusesAndExplains(t *testing.T) {
	srv, _, _ := newStreamServer(t)
	if code := putOutput(t, srv, "radio"); code != 400 {
		t.Fatalf("unknown mode: %d", code)
	}
	r, _ := newTapeAPI(t) // no output at all
	w := send(t, r, http.MethodPut, "/api/tapes/output", `{"mode":"phone"}`)
	want(t, w, http.StatusConflict, "no stream")
}
