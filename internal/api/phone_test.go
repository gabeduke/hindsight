package api

import (
	"encoding/binary"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

func newPhoneServer(t *testing.T, grace time.Duration) (*httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	a := New(&config.Config{OutputDir: dir, SaveChannels: []int{0, 1}}, nil, nil, nil, nil)
	a.phoneGrace = grace
	r := mux.NewRouter()
	a.SetupRoutes(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, dir
}

func dialPhone(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/phone", nil)
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	return c
}

type phoneMsg struct {
	Type    string  `json:"type"`
	Next    uint32  `json:"next"`
	Name    string  `json:"name"`
	Seconds float64 `json:"seconds"`
	Partial bool    `json:"partial"`
	Reason  string  `json:"reason"`
	Error   string  `json:"error"`
}

func readPhone(t *testing.T, c *websocket.Conn) phoneMsg {
	t.Helper()
	var m phoneMsg
	if err := c.ReadJSON(&m); err != nil {
		t.Fatalf("read: %v", err)
	}
	return m
}

func startPhone(t *testing.T, c *websocket.Conn, id string, rate int) phoneMsg {
	t.Helper()
	if err := c.WriteJSON(map[string]any{"type": "start", "id": id, "rate": rate}); err != nil {
		t.Fatal(err)
	}
	return readPhone(t, c)
}

// phoneChunk is chunk seq of a test signal: 4800 stereo frames of a ramp
// that differs per chunk, so a chunk out of place or missing shows.
func phoneChunk(seq int) []float32 {
	s := make([]float32, 2*4800)
	for i := 0; i < 4800; i++ {
		v := float32(math.Sin(float64(seq*4800+i) * 0.01))
		s[2*i], s[2*i+1] = 0.5*v, -0.5*v
	}
	return s
}

func sendChunk(t *testing.T, c *websocket.Conn, seq int) {
	t.Helper()
	s := phoneChunk(seq)
	b := make([]byte, 4+4*len(s))
	binary.LittleEndian.PutUint32(b, uint32(seq))
	for i, v := range s {
		binary.LittleEndian.PutUint32(b[4+4*i:], math.Float32bits(v))
	}
	if err := c.WriteMessage(websocket.BinaryMessage, b); err != nil {
		t.Fatal(err)
	}
}

// waitForPreview lets the background ffmpeg finish before the temp dir is
// removed.
func waitForPreview(dir, name string) {
	p := filepath.Join(dir, strings.TrimSuffix(name, ".wav")+"_preview.mp3")
	for i := 0; i < 100; i++ {
		if _, err := os.Stat(p); err == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func checkPhoneTake(t *testing.T, dir, name string, chunks int) {
	t.Helper()
	path := filepath.Join(dir, name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Frames() != int64(chunks*4800) {
		t.Fatalf("frames = %d, want %d", info.Frames(), chunks*4800)
	}
	var got []int32
	audio.ReadFrames(path, 0, info.Frames(), 1<<14, func(b []int32, _ int64) error {
		got = append(got, b...)
		return nil
	})
	for seq := 0; seq < chunks; seq++ {
		want := phoneChunk(seq)
		for i, v := range want {
			g := float64(got[seq*9600+i]) / 2147483648
			if math.Abs(g-float64(v)) > 1e-9 {
				t.Fatalf("chunk %d sample %d = %v, want %v", seq, i, g, v)
			}
		}
	}
}

func TestPhoneRecordingSurvivesADropoutAndReordering(t *testing.T) {
	srv, dir := newPhoneServer(t, time.Minute)
	const id = "phone-test-0001"

	c := dialPhone(t, srv)
	if m := startPhone(t, c, id, 48000); m.Type != "ready" || m.Next != 0 || m.Name == "" {
		t.Fatalf("start = %+v", m)
	}
	for seq := 0; seq < 4; seq++ {
		sendChunk(t, c, seq)
		if m := readPhone(t, c); m.Type != "ack" || m.Next != uint32(seq+1) {
			t.Fatalf("ack = %+v", m)
		}
	}
	// Two more go out, then the Wi-Fi drops before their acks come back.
	sendChunk(t, c, 4)
	sendChunk(t, c, 5)
	c.Close()

	// Nothing is listed while recording.
	time.Sleep(100 * time.Millisecond)
	if takes, _ := audio.ListTakes(dir); len(takes) != 0 {
		t.Fatalf("listed mid-recording: %+v", takes)
	}

	c = dialPhone(t, srv)
	defer c.Close()
	m := startPhone(t, c, id, 48000)
	if m.Type != "ready" || m.Next < 4 || m.Next > 6 {
		t.Fatalf("resume = %+v", m)
	}
	// The phone resends everything not acknowledged -- 4 and 5, whether or
	// not they landed -- then the rest, some out of order.
	for _, seq := range []int{4, 5, 8, 7, 6, 9} {
		sendChunk(t, c, seq)
		if m := readPhone(t, c); m.Type != "ack" {
			t.Fatalf("ack = %+v", m)
		}
	}
	if err := c.WriteJSON(map[string]any{"type": "stop", "chunks": 10}); err != nil {
		t.Fatal(err)
	}
	m = readPhone(t, c)
	if m.Type != "saved" || m.Name == "" || m.Partial || m.Reason != "stop" || m.Seconds != 1 {
		t.Fatalf("saved = %+v", m)
	}
	checkPhoneTake(t, dir, m.Name, 10)
	if meta := audio.ReadMeta(filepath.Join(dir, m.Name)); meta.Label != "Phone" {
		t.Errorf("label = %q", meta.Label)
	}
	waitForPreview(dir, m.Name)
}

func TestStopWaitsForChunksStillOnTheirWay(t *testing.T) {
	srv, dir := newPhoneServer(t, time.Minute)
	c := dialPhone(t, srv)
	defer c.Close()
	startPhone(t, c, "phone-test-0002", 48000)
	sendChunk(t, c, 0)
	readPhone(t, c)
	sendChunk(t, c, 2) // 1 is late
	readPhone(t, c)
	c.WriteJSON(map[string]any{"type": "stop", "chunks": 3})
	sendChunk(t, c, 1)
	if m := readPhone(t, c); m.Type != "ack" || m.Next != 3 {
		// The ack for 1 comes first, then saved.
		t.Fatalf("ack = %+v", m)
	}
	m := readPhone(t, c)
	if m.Type != "saved" || m.Partial {
		t.Fatalf("saved = %+v", m)
	}
	checkPhoneTake(t, dir, m.Name, 3)
	waitForPreview(dir, m.Name)
}

func TestAPhoneThatNeverComesBackLeavesAPartialTake(t *testing.T) {
	srv, dir := newPhoneServer(t, 200*time.Millisecond)
	const id = "phone-test-0003"
	c := dialPhone(t, srv)
	startPhone(t, c, id, 48000)
	sendChunk(t, c, 0)
	readPhone(t, c)
	c.Close()

	var takes []audio.Take
	for i := 0; i < 50 && len(takes) == 0; i++ {
		time.Sleep(50 * time.Millisecond)
		takes, _ = audio.ListTakes(dir)
	}
	if len(takes) != 1 || takes[0].Label != "Phone (partial)" {
		t.Fatalf("takes = %+v", takes)
	}
	// The phone, back at last, is told how it ended.
	c = dialPhone(t, srv)
	defer c.Close()
	if m := startPhone(t, c, id, 48000); m.Type != "saved" || !m.Partial || m.Name != takes[0].Name {
		t.Errorf("late start = %+v", m)
	}
	waitForPreview(dir, takes[0].Name)
}

func TestPhoneRefusesABadStart(t *testing.T) {
	srv, _ := newPhoneServer(t, time.Minute)
	for _, start := range []map[string]any{
		{"type": "start", "id": "x", "rate": 48000},               // id too short
		{"type": "begin", "id": "phone-test-0004", "rate": 48000}, // not a start
		{"type": "start", "id": "phone-test-0005", "rate": 100},   // no such rate
	} {
		c := dialPhone(t, srv)
		if err := c.WriteJSON(start); err != nil {
			t.Fatal(err)
		}
		if m := readPhone(t, c); m.Type != "error" || m.Error == "" {
			t.Errorf("%v: got %+v, want an error", start, m)
		}
		c.Close()
	}
}

func TestPhoneStopWithNothingRecordedSavesNothing(t *testing.T) {
	srv, dir := newPhoneServer(t, time.Minute)
	c := dialPhone(t, srv)
	defer c.Close()
	startPhone(t, c, "phone-test-0006", 48000)
	c.WriteJSON(map[string]any{"type": "stop", "chunks": 0})
	if m := readPhone(t, c); m.Type != "saved" || m.Name != "" {
		t.Errorf("saved = %+v, want no take", m)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("left %d file(s)", len(entries))
	}
}
