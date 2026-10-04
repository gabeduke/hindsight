package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
)

type undoAnswer struct {
	Undone  string         `json:"undone"`
	Skipped string         `json:"skipped"`
	Take    *audio.Take    `json:"take"`
	Undo    audio.UndoInfo `json:"undo"`
}

func decodeAs[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return v
}

func TestEditsCanBeUndoneOneAtATime(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_u.wav", 48000)

	w := patch(t, r, "jam_u.wav", `{"label":"verse"}`)
	resp := decodeAs[struct{ Undo audio.UndoInfo }](t, w.Body.Bytes())
	if resp.Undo.Count != 1 || resp.Undo.Next != "rename" || resp.Undo.Op == "" {
		t.Fatalf("undo after a rename = %+v", resp.Undo)
	}
	// Starring is not an operation.
	patch(t, r, "jam_u.wav", `{"starred":true}`)
	// A flag, by the per-flag endpoint.
	fw := send(t, r, http.MethodPost, "/api/take/flags?file=jam_u.wav", `{"frame":100}`)
	if got := decodeFlags(t, fw).Undo; got.Count != 2 || got.Next != "flag added" {
		t.Fatalf("undo after a flag = %+v", got)
	}

	// GET /api/take says what Undo would do.
	g := decodeAs[takeResponse](t, do(t, r, http.MethodGet, "/api/take?file=jam_u.wav").Body.Bytes())
	if g.Undo.Count != 2 || g.Undo.Next != "flag added" || g.Label != "verse" {
		t.Fatalf("GET = %+v", g)
	}

	u := decodeAs[undoAnswer](t, postJSON(t, r, "/api/take/undo?file=jam_u.wav", "").Body.Bytes())
	if u.Undone != "flag added" || u.Take == nil || len(u.Take.Flags) != 0 || u.Undo.Count != 1 {
		t.Fatalf("first undo = %+v", u)
	}
	// The cue chunk follows the flags back.
	if cues, err := audio.ReadCues(filepath.Join(dir, "jam_u.wav")); err != nil || len(cues) != 0 {
		t.Fatalf("cues = %v %v, want none after undoing the only flag", cues, err)
	}
	u = decodeAs[undoAnswer](t, postJSON(t, r, "/api/take/undo?file=jam_u.wav", "").Body.Bytes())
	if u.Undone != "rename" || u.Take.Label != "" || !u.Take.Starred {
		t.Fatalf("second undo = %+v, want the name gone and the star kept", u)
	}
	if w := postJSON(t, r, "/api/take/undo?file=jam_u.wav", ""); w.Code != http.StatusConflict {
		t.Fatalf("undo with nothing left = %d, want 409", w.Code)
	}
}

func TestAToastsUndoNamesItsOwnStep(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_t.wav", 48000)
	add := decodeFlags(t, send(t, r, http.MethodPost, "/api/take/flags?file=jam_t.wav", `{"frame":10,"label":"drop"}`))
	del := decodeFlags(t, send(t, r, http.MethodDelete, "/api/take/flags?file=jam_t.wav&id="+add.Flag.ID, ""))
	if del.Undo.Op == "" || del.Undo.Next != "flag deleted" {
		t.Fatalf("delete's undo = %+v", del.Undo)
	}
	patch(t, r, "jam_t.wav", `{"bpm":100}`) // a later edit
	u := decodeAs[undoAnswer](t, postJSON(t, r, "/api/take/undo?file=jam_t.wav&op="+del.Undo.Op, "").Body.Bytes())
	if u.Undone != "flag deleted" || len(u.Take.Flags) != 1 || u.Take.Flags[0].Label != "drop" {
		t.Fatalf("undo by op = %+v", u)
	}
	if u.Take.BPM == nil || *u.Take.BPM != 100 {
		t.Fatal("undoing the delete touched the later tempo")
	}
}

func TestUndoSkipsWhatChangedSince(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "jam_s.wav", 48000)
	patch(t, r, "jam_s.wav", `{"label":"mine"}`)
	m := audio.ReadMeta(wav)
	m.Label = "edited by hand"
	audio.WriteMeta(wav, m)
	u := decodeAs[undoAnswer](t, postJSON(t, r, "/api/take/undo?file=jam_s.wav", "").Body.Bytes())
	if u.Skipped != "rename" || u.Take.Label != "edited by hand" {
		t.Fatalf("undo = %+v, want a skipped rename and the hand edit kept", u)
	}
}

func TestDeleteGoesToTheTrashAndComesBack(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_d.wav", 4800)
	patch(t, r, "jam_d.wav", `{"label":"keeper"}`)

	if w := do(t, r, http.MethodDelete, "/api/delete?file=jam_d.wav"); w.Code != http.StatusOK {
		t.Fatalf("delete = %d", w.Code)
	}
	if w := do(t, r, http.MethodGet, "/api/take?file=jam_d.wav"); w.Code != http.StatusNotFound {
		t.Fatalf("deleted take still answers %d", w.Code)
	}
	tr := decodeAs[trashResponse](t, do(t, r, http.MethodGet, "/api/trash").Body.Bytes())
	if tr.KeepDays != 7 || len(tr.Takes) != 1 || tr.Takes[0].Label != "keeper" || tr.Takes[0].Reason != "deleted" {
		t.Fatalf("trash = %+v", tr)
	}

	w := postJSON(t, r, "/api/trash/restore?file=jam_d.wav", "")
	got := decodeAs[audio.Take](t, w.Body.Bytes())
	if w.Code != http.StatusOK || got.Label != "keeper" || !got.Starred {
		t.Fatalf("restore = %d %+v, want it back and starred", w.Code, got)
	}
	if w := postJSON(t, r, "/api/trash/restore?file=jam_d.wav", ""); w.Code != http.StatusNotFound {
		t.Fatalf("second restore = %d, want 404", w.Code)
	}
	// Undo history comes back with the take.
	g := decodeAs[takeResponse](t, do(t, r, http.MethodGet, "/api/take?file=jam_d.wav").Body.Bytes())
	if g.Undo.Count != 1 {
		t.Fatalf("restored take's undo = %+v", g.Undo)
	}
}

func TestTrashCanBeEmptiedOneOrAll(t *testing.T) {
	r, dir := newTestAPI(t)
	for _, n := range []string{"jam_a.wav", "jam_b.wav", "jam_c.wav"} {
		writeTake(t, dir, n)
		do(t, r, http.MethodDelete, "/api/delete?file="+n)
	}
	if w := do(t, r, http.MethodDelete, "/api/trash?file=jam_a.wav"); w.Code != http.StatusOK {
		t.Fatalf("purge one = %d", w.Code)
	}
	if n := len(decodeAs[trashResponse](t, do(t, r, http.MethodGet, "/api/trash").Body.Bytes()).Takes); n != 2 {
		t.Fatalf("trash holds %d, want 2", n)
	}
	if w := do(t, r, http.MethodDelete, "/api/trash?all=1"); w.Code != http.StatusOK {
		t.Fatalf("empty = %d", w.Code)
	}
	if n := len(decodeAs[trashResponse](t, do(t, r, http.MethodGet, "/api/trash").Body.Bytes()).Takes); n != 0 {
		t.Fatalf("trash holds %d after emptying", n)
	}
	for _, bad := range []string{"..wav", ".jam_x.wav.part", "../x.wav"} {
		if w := do(t, r, http.MethodDelete, "/api/trash?file="+bad); w.Code != http.StatusBadRequest {
			t.Errorf("purge %q = %d, want 400", bad, w.Code)
		}
	}
}

func TestExportZipsSeveralTakesWithTheirSidecars(t *testing.T) {
	r, dir := newTestAPI(t)
	a := writeRealTake(t, dir, "jam_a.wav", 4800)
	writeRealTake(t, dir, "jam_b.wav", 4800)
	patch(t, r, "jam_a.wav", `{"label":"one"}`)
	os.WriteFile(audio.MIDIPath(a), []byte("MThd"), 0o644)

	w := do(t, r, http.MethodGet, "/api/export?file=jam_a.wav&file=jam_b.wav&file=jam_a.wav")
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("export = %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
		if f.Name == "jam_a.wav" {
			rc, _ := f.Open()
			got, _ := io.ReadAll(rc)
			want, _ := os.ReadFile(a)
			if !bytes.Equal(got, want) {
				t.Error("the WAV in the zip differs from the take")
			}
			if f.Method != zip.Store {
				t.Error("audio should be stored, not deflated")
			}
		}
	}
	sort.Strings(names)
	want := []string{"jam_a.meta.json", "jam_a.mid", "jam_a.wav", "jam_b.wav"}
	if len(names) != len(want) {
		t.Fatalf("zip holds %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("zip holds %v, want %v", names, want)
		}
	}

	if w := do(t, r, http.MethodGet, "/api/export?file=jam_a.wav&file=jam_nope.wav"); w.Code != http.StatusNotFound {
		t.Errorf("export with a missing take = %d, want 404", w.Code)
	}
	if w := do(t, r, http.MethodGet, "/api/export"); w.Code != http.StatusBadRequest {
		t.Errorf("export of nothing = %d, want 400", w.Code)
	}
}

func sendAs(t *testing.T, r http.Handler, client, method, url, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(clientHeader, client)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// The guide's check: rename on one device, again on another, ↶ on the first.
func TestOneDevicesUndoLeavesAnothersChange(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "jam_2d.wav", 4800)
	sendAs(t, r, "phone", http.MethodPatch, "/api/take?file=jam_2d.wav", `{"label":"phone's"}`)
	sendAs(t, r, "tablet", http.MethodPatch, "/api/take?file=jam_2d.wav", `{"label":"tablet's"}`)

	g := decodeAs[takeResponse](t, sendAs(t, r, "phone", http.MethodGet, "/api/take?file=jam_2d.wav", "").Body.Bytes())
	if g.Undo.Count != 1 || g.Undo.Next != "rename" {
		t.Fatalf("the phone's undo = %+v, want its own one rename", g.Undo)
	}
	u := decodeAs[undoAnswer](t, sendAs(t, r, "phone", http.MethodPost, "/api/take/undo?file=jam_2d.wav", "").Body.Bytes())
	if u.Skipped != "rename" || u.Take.Label != "tablet's" {
		t.Fatalf("phone undo = %+v, want skipped and the tablet's name kept", u)
	}
	u = decodeAs[undoAnswer](t, sendAs(t, r, "tablet", http.MethodPost, "/api/take/undo?file=jam_2d.wav", "").Body.Bytes())
	if u.Undone != "rename" || u.Take.Label != "phone's" {
		t.Fatalf("tablet undo = %+v", u)
	}
	// A bad client id is no client: a script, which undoes anyone's.
	if clientOf(httptest.NewRequest(http.MethodGet, "/", nil)) != "" {
		t.Fatal("no header should be no client")
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(clientHeader, "../../etc")
	if clientOf(req) != "" {
		t.Fatal("a malformed client id should be ignored")
	}
}

func TestDeleteRefusesANameStillInTheTrash(t *testing.T) {
	r, dir := newTestAPI(t)
	writeTake(t, dir, "jam_x.wav")
	do(t, r, http.MethodDelete, "/api/delete?file=jam_x.wav")
	writeTake(t, dir, "jam_x.wav") // put there by hand
	if w := do(t, r, http.MethodDelete, "/api/delete?file=jam_x.wav"); w.Code != http.StatusConflict {
		t.Fatalf("delete = %d, want 409", w.Code)
	}
}
