package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
)

func send(t *testing.T, r *mux.Router, method, url, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeFlags(t *testing.T, w *httptest.ResponseRecorder) flagResponse {
	t.Helper()
	var resp flagResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return resp
}

func TestPostFlagAddsOneWithAnID(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_f.wav", 48000)
	w := send(t, r, http.MethodPost, "/api/take/flags?file=jam_f.wav", `{"frame":4800,"label":" the drop "}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	resp := decodeFlags(t, w)
	if resp.Flag == nil || resp.Flag.ID == "" || resp.Flag.Frame != 4800 || resp.Flag.Label != "the drop" {
		t.Errorf("flag = %+v", resp.Flag)
	}
	if len(resp.Flags) != 1 {
		t.Errorf("flags = %+v", resp.Flags)
	}
	if resp.CueError != "" {
		t.Errorf("cue_error = %q on a real take", resp.CueError)
	}
	cues, err := audio.ReadCues(dir + "/jam_f.wav")
	if err != nil || len(cues) != 1 || cues[0] != 4800 {
		t.Errorf("cues = %v, %v; want the flag mirrored into the WAV", cues, err)
	}
}

func TestPatchAndDeleteAddressOneFlag(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_f.wav", 48000)
	a := decodeFlags(t, send(t, r, http.MethodPost, "/api/take/flags?file=jam_f.wav", `{"frame":100}`)).Flag
	b := decodeFlags(t, send(t, r, http.MethodPost, "/api/take/flags?file=jam_f.wav", `{"frame":200}`)).Flag

	w := send(t, r, http.MethodPatch, "/api/take/flags?file=jam_f.wav&id="+a.ID, `{"frame":300,"label":"moved"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("patch status = %d: %s", w.Code, w.Body)
	}
	got := decodeFlags(t, w).Flags
	if len(got) != 2 || got[0].ID != b.ID || got[1].ID != a.ID || got[1].Frame != 300 || got[1].Label != "moved" {
		t.Errorf("after patch = %+v", got)
	}

	w = send(t, r, http.MethodDelete, "/api/take/flags?file=jam_f.wav&id="+b.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("delete status = %d: %s", w.Code, w.Body)
	}
	got = decodeFlags(t, w).Flags
	if len(got) != 1 || got[0].ID != a.ID {
		t.Errorf("after delete = %+v", got)
	}
}

func TestFlagEndpointsRejectBadInput(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_f.wav", 1000)
	cases := []struct {
		method, url, body string
		want              int
	}{
		{http.MethodPost, "/api/take/flags?file=jam_f.wav", `{}`, http.StatusBadRequest},
		{http.MethodPost, "/api/take/flags?file=jam_f.wav", `{"frame":-1}`, http.StatusBadRequest},
		{http.MethodPost, "/api/take/flags?file=jam_f.wav", `{"frame":1000}`, http.StatusBadRequest},
		{http.MethodPost, "/api/take/flags?file=../x.wav", `{"frame":1}`, http.StatusBadRequest},
		{http.MethodPost, "/api/take/flags?file=jam_missing.wav", `{"frame":1}`, http.StatusNotFound},
		{http.MethodPatch, "/api/take/flags?file=jam_f.wav", `{"frame":1}`, http.StatusBadRequest},
		{http.MethodPatch, "/api/take/flags?file=jam_f.wav&id=rnope0000", `{"frame":1}`, http.StatusNotFound},
		{http.MethodDelete, "/api/take/flags?file=jam_f.wav&id=rnope0000", ``, http.StatusNotFound},
	}
	for _, c := range cases {
		if w := send(t, r, c.method, c.url, c.body); w.Code != c.want {
			t.Errorf("%s %s %s: status = %d, want %d (%s)", c.method, c.url, c.body, w.Code, c.want, w.Body)
		}
	}
}

// A flag written before ids existed is addressable by its legacy id.
func TestLegacyFlagsAreAddressable(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "jam_f.wav", 48000)
	if err := audio.WriteMeta(wav, audio.Meta{Flags: []audio.Flag{{Frame: 4800}}}); err != nil {
		t.Fatal(err)
	}
	if w := send(t, r, http.MethodDelete, "/api/take/flags?file=jam_f.wav&id=f4800", ""); w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if n := len(audio.ReadMeta(wav).Flags); n != 0 {
		t.Errorf("flags left = %d", n)
	}
}

// Two devices adding flags at once both keep theirs.
func TestConcurrentFlagPostsAllSurvive(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "jam_f.wav", 48000)
	const n = 20
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := `{"frame":` + strconv.Itoa(100*(i+1)) + `}`
			if w := send(t, r, http.MethodPost, "/api/take/flags?file=jam_f.wav", body); w.Code != http.StatusOK {
				t.Errorf("post %d: %d", i, w.Code)
			}
		}(i)
	}
	wg.Wait()
	if got := len(audio.ReadMeta(wav).Flags); got != n {
		t.Errorf("flags = %d, want %d", got, n)
	}
	if cues, err := audio.ReadCues(wav); err != nil || len(cues) != n {
		t.Errorf("cues = %d (%v), want %d", len(cues), err, n)
	}
}

func TestGetTakeReturnsOneTake(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "jam_2026-09-14_201342.wav", 48000)
	if err := audio.WriteMeta(wav, audio.Meta{Label: "chorus idea", Flags: []audio.Flag{{Frame: 10}}}); err != nil {
		t.Fatal(err)
	}
	w := do(t, r, http.MethodGet, "/api/take?file=jam_2026-09-14_201342.wav")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var got audio.Take
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Label != "chorus idea" || got.Duration != 1 || len(got.Flags) != 1 || got.Flags[0].ID != "f10" {
		t.Errorf("take = %+v", got)
	}
	if w := do(t, r, http.MethodGet, "/api/take?file=jam_nope.wav"); w.Code != http.StatusNotFound {
		t.Errorf("missing take: status = %d", w.Code)
	}
}

func TestJamsAnswers304UntilSomethingChanges(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_a.wav", 4800)
	w := do(t, r, http.MethodGet, "/api/jams")
	etag := w.Header().Get("ETag")
	if w.Code != http.StatusOK || etag == "" {
		t.Fatalf("first GET: %d, etag %q", w.Code, etag)
	}
	get := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/jams", nil)
		req.Header.Set("If-None-Match", etag)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := get(); code != http.StatusNotModified {
		t.Errorf("unchanged list: %d, want 304", code)
	}
	if w := patch(t, r, "jam_a.wav", `{"label":"x"}`); w.Code != http.StatusOK {
		t.Fatalf("patch: %d", w.Code)
	}
	if code := get(); code != http.StatusOK {
		t.Errorf("after a label change: %d, want 200", code)
	}
}

func TestTrimPastTheEndIsRefused(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_t.wav", 1000)
	if w := patch(t, r, "jam_t.wav", `{"trim":{"start_frame":0,"end_frame":1001}}`); w.Code != http.StatusBadRequest {
		t.Errorf("trim past the end: %d, want 400", w.Code)
	}
	if w := patch(t, r, "jam_t.wav", `{"trim":{"start_frame":0,"end_frame":1000}}`); w.Code != http.StatusOK {
		t.Errorf("trim to the end: %d, want 200", w.Code)
	}
}

func TestRendersTakeTurns(t *testing.T) {
	a := New(&config.Config{OutputDir: t.TempDir()}, nil, nil, nil, nil)
	t.Cleanup(a.WaitBackground) // a preview encode must not outlive the takes folder
	release, ok := a.acquireRender(context.Background())
	if !ok {
		t.Fatal("the first render should get the slot at once")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, ok := a.acquireRender(ctx); ok {
		t.Fatal("a second render got the slot while the first held it")
	}
	release()
	if release2, ok := a.acquireRender(context.Background()); !ok {
		t.Fatal("the slot was not given back")
	} else {
		release2()
	}
}

func TestPostFlagTakesTheClientsIDOnce(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_c.wav", 48000)
	for i := 0; i < 2; i++ { // the second is a retry: one flag, same answer
		w := send(t, r, http.MethodPost, "/api/take/flags?file=jam_c.wav", `{"id":"r0123abcd","frame":100}`)
		if w.Code != http.StatusOK {
			t.Fatalf("post %d: status = %d: %s", i, w.Code, w.Body)
		}
		resp := decodeFlags(t, w)
		if resp.Flag == nil || resp.Flag.ID != "r0123abcd" || len(resp.Flags) != 1 {
			t.Fatalf("post %d: %+v", i, resp)
		}
	}
	// The page labels the flag straight after adding it, by that id.
	w := send(t, r, http.MethodPatch, "/api/take/flags?file=jam_c.wav&id=r0123abcd", `{"label":"drop"}`)
	if w.Code != http.StatusOK || decodeFlags(t, w).Flag.Label != "drop" {
		t.Errorf("label by the client's id: %d %s", w.Code, w.Body)
	}
	for _, bad := range []string{`"f100"`, `"r123"`, `"RABCDEF01"`, `"r0123abcg"`, `"../x"`} {
		w := send(t, r, http.MethodPost, "/api/take/flags?file=jam_c.wav", `{"id":`+bad+`,"frame":5}`)
		if w.Code != http.StatusBadRequest {
			t.Errorf("id %s: status = %d, want 400", bad, w.Code)
		}
	}
}

func TestWholeArrayPatchAnswersWithIDsAndDropsJunkOnes(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_w.wav", 48000)
	w := patch(t, r, "jam_w.wav", `{"flags":[{"frame":10},{"id":"<script>","frame":20},{"id":"r0000beef","frame":30}]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var resp struct{ Flags []audio.Flag }
	json.Unmarshal(w.Body.Bytes(), &resp)
	got := []string{}
	for _, f := range resp.Flags {
		got = append(got, f.ID)
	}
	if want := []string{"f10", "f20", "r0000beef"}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("ids = %v, want %v", got, want)
	}
	m := audio.ReadMeta(dir + "/jam_w.wav")
	for i, f := range m.Flags {
		if f.ID != resp.Flags[i].ID {
			t.Errorf("stored id %q, answered %q", f.ID, resp.Flags[i].ID)
		}
	}
}

func TestEditsToADeletedTakeLeaveNoSidecar(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "jam_d.wav", 48000)
	// Hold the take's lock, as an edit in flight would, while the take is
	// deleted underneath: the edit that was waiting must not recreate it.
	unlock := audio.LockTake(wav)
	done := make(chan *httptest.ResponseRecorder)
	go func() {
		done <- send(t, r, http.MethodPost, "/api/take/flags?file=jam_d.wav", `{"frame":10}`)
	}()
	time.Sleep(50 * time.Millisecond)
	os.Remove(wav)
	unlock()
	if w := <-done; w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
	if _, err := os.Stat(strings.TrimSuffix(wav, ".wav") + ".meta.json"); err == nil {
		t.Error("an edit recreated the sidecar of a deleted take")
	}
}
