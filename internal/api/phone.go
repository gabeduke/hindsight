package api

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gorilla/websocket"
)

// GET /api/phone is a WebSocket a phone records into. The protocol:
//
//	phone → {"type":"start","id":"<recording id>","rate":48000,"first":0}
//	Pi    → {"type":"ready","next":0,"name":"jam_….wav"}
//	phone → binary: uint32 LE chunk number, then interleaved stereo float32 LE
//	Pi    → {"type":"ack","next":N}       every chunk before N is on disk
//	phone → {"type":"stop","chunks":N}    N chunks were sent in all
//	Pi    → {"type":"saved","name":"…","seconds":S,"partial":false,"reason":"stop"}
//
// The id is made by the phone and names the recording, not the connection:
// after a dropout the phone reconnects, sends the same start, gets "ready"
// with the chunk the Pi is waiting for, and resends from there. "first" is
// the oldest chunk the phone still holds; it matters only when the Pi has
// lost the recording (a restart), and then the take starts there, partial,
// rather than waiting forever for chunks the phone no longer has. A
// recording whose phone never comes back is finished as a partial take after
// phoneGrace. "saved" with an empty name means nothing was recorded.
// Failures are {"type":"error","error":"…"}.

const (
	// defaultPhoneGrace is how long a recording waits for its phone to
	// reconnect before it is finished as a partial take.
	defaultPhoneGrace = 10 * time.Minute
	// phoneKeepResult is how long a finished recording's result is kept,
	// for a phone that reconnects to ask how it ended.
	phoneKeepResult = 10 * time.Minute
	// maxPhoneRecordings bounds recordings in progress at once.
	maxPhoneRecordings = 8
	// phoneDiskCheckEvery is how many chunks pass between free-space checks:
	// about five seconds of audio at the page's tenth-of-a-second chunks.
	phoneDiskCheckEvery = 50
	// A tenth of a second at 192 kHz stereo float is 150 KB.
	maxPhoneChunkBytes = 256 << 10
)

var phoneIDRE = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

type phoneResult struct {
	Type    string  `json:"type"`
	Name    string  `json:"name"`
	Seconds float64 `json:"seconds"`
	Partial bool    `json:"partial"`
	Reason  string  `json:"reason"`
}

type phoneSession struct {
	take *audio.PhoneTake

	mu        sync.Mutex
	conn      *websocket.Conn // the phone's current connection, if any
	gen       int             // bumped per connection, so a stale one can't detach a newer
	stopAt    int64           // chunks the phone says it sent; -1 until Stop
	chunks    int             // chunks received, for the disk checks
	finishing bool            // set once; result follows when done closes
	done      chan struct{}
	result    phoneResult
	grace     *time.Timer
}

type phoneRegistry struct {
	mu       sync.Mutex
	sessions map[string]*phoneSession
}

func (a *API) handlePhone(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[!] phone websocket upgrade: %v", err)
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxPhoneChunkBytes)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })

	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(pingPeriod)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				// WriteControl is safe alongside the reader's writes.
				if conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)) != nil {
					return
				}
			}
		}
	}()

	send := func(v any) bool {
		_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
		return conn.WriteJSON(v) == nil
	}
	fail := func(msg string) {
		send(map[string]string{"type": "error", "error": msg})
	}

	// The first message names the recording.
	var start struct {
		Type  string `json:"type"`
		ID    string `json:"id"`
		Rate  int    `json:"rate"`
		First uint32 `json:"first"`
	}
	mt, msg, err := conn.ReadMessage()
	if err != nil {
		return
	}
	if mt != websocket.TextMessage || json.Unmarshal(msg, &start) != nil || start.Type != "start" || !phoneIDRE.MatchString(start.ID) {
		fail("expected a start message with a recording id")
		return
	}

	s, gen, errMsg := a.attachPhone(start.ID, start.Rate, start.First, conn)
	if errMsg != "" {
		fail(errMsg)
		return
	}
	s.mu.Lock()
	finishing := s.finishing
	s.mu.Unlock()
	if finishing {
		<-s.done
		send(s.result)
		return
	}
	if !send(map[string]any{"type": "ready", "next": s.take.Next(), "name": s.take.Name()}) {
		a.detachPhone(start.ID, s, gen)
		return
	}

	for {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			a.detachPhone(start.ID, s, gen)
			return
		}
		switch mt {
		case websocket.BinaryMessage:
			if len(msg) < 4 || (len(msg)-4)%(audio.PhoneChannels*4) != 0 {
				fail("a chunk is a uint32 number and whole stereo float32 frames")
				continue
			}
			seq := binary.LittleEndian.Uint32(msg)
			samples := make([]float32, (len(msg)-4)/4)
			for i := range samples {
				samples[i] = math.Float32frombits(binary.LittleEndian.Uint32(msg[4+4*i:]))
			}
			next, werr := s.take.Write(seq, samples)
			switch {
			case errors.Is(werr, audio.ErrPhoneFinished):
				// A stale connection, or audio after the end: say how it ended.
				send(a.finishPhone(start.ID, s, false, "stop", nil))
				return
			case errors.Is(werr, audio.ErrPhoneTooLong):
				send(a.finishPhone(start.ID, s, false, "limit", nil))
				return
			case werr != nil:
				log.Printf("[!] phone take %s: %v", s.take.Name(), werr)
				send(a.finishPhone(start.ID, s, true, "error", nil))
				return
			}
			if !send(map[string]any{"type": "ack", "next": next}) {
				a.detachPhone(start.ID, s, gen)
				return
			}
			s.mu.Lock()
			s.chunks++
			check := s.chunks%phoneDiskCheckEvery == 0
			stopAt := s.stopAt
			s.mu.Unlock()
			if check {
				if free := audio.EnsureFree(a.cfg.OutputDir, a.cfg.MinFreeGB); free < a.cfg.MinFreeGB {
					send(a.finishPhone(start.ID, s, false, "disk", nil))
					return
				}
			}
			if stopAt >= 0 && int64(next) >= stopAt {
				send(a.finishPhone(start.ID, s, false, "stop", nil))
				return
			}
		case websocket.TextMessage:
			var m struct {
				Type   string `json:"type"`
				Chunks int64  `json:"chunks"`
			}
			if json.Unmarshal(msg, &m) != nil || m.Type != "stop" || m.Chunks < 0 {
				fail("expected a stop message")
				continue
			}
			s.mu.Lock()
			s.stopAt = m.Chunks
			s.mu.Unlock()
			if int64(s.take.Next()) >= m.Chunks {
				send(a.finishPhone(start.ID, s, false, "stop", nil))
				return
			}
			// Otherwise the missing chunks are on their way; the binary case
			// finishes once they're in.
		}
	}
}

// attachPhone finds or starts the recording id and makes conn its current
// connection. It returns the connection's generation, or a message for the
// phone when the recording can't start.
func (a *API) attachPhone(id string, rate int, first uint32, conn *websocket.Conn) (*phoneSession, int, string) {
	a.phones.mu.Lock()
	defer a.phones.mu.Unlock()
	if a.phones.sessions == nil {
		a.phones.sessions = map[string]*phoneSession{}
	}
	s, ok := a.phones.sessions[id]
	if !ok {
		active := 0
		for _, o := range a.phones.sessions {
			o.mu.Lock()
			if !o.finishing {
				active++
			}
			o.mu.Unlock()
		}
		if active >= maxPhoneRecordings {
			return nil, 0, "too many recordings at once"
		}
		if free := audio.EnsureFree(a.cfg.OutputDir, a.cfg.MinFreeGB); free < a.cfg.MinFreeGB {
			return nil, 0, "the Pi's disk is nearly full"
		}
		take, err := audio.StartPhoneTake(a.cfg.OutputDir, rate, time.Now(), first)
		if err != nil {
			log.Printf("[!] phone take: %v", err)
			return nil, 0, "could not start the recording: " + err.Error()
		}
		if first > 0 {
			log.Printf("[*] phone recording %s continues one the Pi lost, from chunk %d", take.Name(), first)
		} else {
			log.Printf("[*] phone recording %s started at %d Hz", take.Name(), rate)
		}
		s = &phoneSession{take: take, stopAt: -1, done: make(chan struct{})}
		a.phones.sessions[id] = s
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.grace != nil {
		s.grace.Stop()
		s.grace = nil
	}
	if s.conn != nil && s.conn != conn {
		s.conn.Close() // a half-open connection from before the dropout
	}
	s.conn = conn
	s.gen++
	return s, s.gen, ""
}

// detachPhone notes that a recording's connection has gone. If it was the
// current one, the recording waits phoneGrace for the phone to come back,
// then is finished as a partial take.
func (a *API) detachPhone(id string, s *phoneSession, gen int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.finishing || gen != s.gen {
		return
	}
	s.conn = nil
	grace := a.phoneGrace
	if grace <= 0 {
		grace = defaultPhoneGrace
	}
	s.grace = time.AfterFunc(grace, func() {
		// Only if no phone has come back since, checked in the same
		// critical section that commits to finishing.
		a.finishPhone(id, s, true, "disconnected", func() bool { return gen == s.gen && s.conn == nil })
	})
}

// finishPhone ends a recording once, and returns how it ended; a second
// caller waits for the first's result. guard, if given, is checked under the
// session's lock, and finishPhone does nothing (returning a zero result)
// when it says no.
func (a *API) finishPhone(id string, s *phoneSession, partial bool, reason string, guard func() bool) phoneResult {
	s.mu.Lock()
	if s.finishing {
		s.mu.Unlock()
		<-s.done
		return s.result
	}
	if guard != nil && !guard() {
		s.mu.Unlock()
		return phoneResult{}
	}
	s.finishing = true
	if s.grace != nil {
		s.grace.Stop()
		s.grace = nil
	}
	s.mu.Unlock()

	name, gotPartial, err := s.take.Finish(partial)
	res := phoneResult{Type: "saved", Name: name, Seconds: s.take.Seconds(), Partial: gotPartial, Reason: reason}
	if err != nil {
		log.Printf("[!] phone take %s: %v", s.take.Name(), err)
		res = phoneResult{Type: "saved", Name: name, Seconds: s.take.Seconds(), Partial: true, Reason: "error"}
	}
	s.result = res // published by closing done
	close(s.done)

	if name != "" {
		a.background(func() { audio.MakePreview(a.cfg, filepath.Join(a.cfg.OutputDir, name), audio.PhoneChannels) })
		a.background(func() { audio.MeasureTempo(filepath.Join(a.cfg.OutputDir, name)) })
		if a.saver != nil {
			a.background(func() { a.saver.Prune(name) })
		}
	}
	time.AfterFunc(phoneKeepResult, func() {
		a.phones.mu.Lock()
		if a.phones.sessions[id] == s {
			delete(a.phones.sessions, id)
		}
		a.phones.mu.Unlock()
	})
	return res
}
