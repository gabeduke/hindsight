# MIDI Lanes and DAW Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a take's captured MIDI as lanes under the waveform, sharing its zoom, region and playhead, and let a region leave as a zip of WAV plus re-based MIDI.

**Architecture:** One new read endpoint, `GET /api/midi`, decodes the take's `.mid` in Go and returns notes in frames; a browser module paints one canvas lane per track from the wave view's viewport. The existing cut-MIDI logic is refactored into a bytes-returning function that both the file-writing cut and a new streaming `GET /api/bundle` zip share. A new optional sidecar field overrides the server's drum guess per track.

**Tech Stack:** Go 1.2x (`gorilla/mux`, `archive/zip`, `internal/smf`, `internal/midi`), vanilla ES modules with `node --test`, canvas 2D, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-09-15-midi-lanes-design.md`

## Global Constraints

- Branch `midi-lanes`; never push to `main` from a task, a push to `main` cuts a release.
- Go tests: `CGO_ENABLED=0 go test ./...` (a default build needs PortAudio's C library and fails before running).
- Node tests: `node --test 'web/static/lib/wave/*.test.js'`.
- No webfonts, no new dependencies, no build step for the UI; files under `web/static` are served as-is.
- Colours come from `styles.css` tokens: bg `#0b1120`, panel `#131c2e`, panel-2 `#1a2437`, line `#26324a`, ink `#eef2f8`, ink-dim `#8b9ab4`, ink-faint `#5d6b85`, accent `#34d399`, accent-dk `#0f7f5f`, warn `#fbbf24`. Track colours: drums `#fbbf24`, then `#34d399`, `#3b9dd4`, `#f87171`, `#a78bfa` cycling.
- Region shade in lanes is exactly `rgba(52,211,153,0.14)` with 2px `--accent` edges; cursor is a 1px `--ink` line.
- Lane heights: melodic 56px, drums 36px, collapsed 18px. Velocity is opacity `0.3 + 0.7·v/127`.
- `MetaVersion` is **not** bumped: `lane_kinds` is additive.
- Commit messages: imperative subject line, no "feat:" prefix, matching `git log`. End every commit with the attribution lines the session supplies.

---

## File structure

| File | Responsibility |
|---|---|
| `internal/bundle/notes.go` (new) | Decode a take's `.mid` into notes in frames; drum classification |
| `internal/bundle/notes_test.go` (new) | Tests for the above against an in-memory SMF fixture |
| `internal/bundle/cut.go` (modify) | `RegionMIDI` extracted from `CutMIDI`; `CutMIDI` calls it |
| `internal/bundle/exporter_test.go` (modify) | One new test that `RegionMIDI` and `CutMIDI` agree |
| `internal/audio/meta.go` (modify) | `LaneKinds` field |
| `internal/audio/save.go` (modify) | `lane_kinds` on the takes listing |
| `internal/audio/cut.go` (modify) | `WriteRegion32` extracted from `writeCutWAV` |
| `internal/audio/cut_test.go` (modify) | Test for `WriteRegion32` |
| `internal/api/api.go` (modify) | Routes; `lane_kinds` in PATCH |
| `internal/api/midi.go` (new) | `handleMIDI` and `handleBundle` |
| `internal/api/midi_test.go` (new) | Endpoint tests |
| `web/static/lib/wave/lanes.js` (new) | Pure lane geometry plus the `Lanes` DOM/canvas class |
| `web/static/lib/wave/lanes.test.js` (new) | Geometry tests |
| `web/static/lib/wave/share.js` (modify) | `shareOrDownload` takes a MIME type |
| `web/static/lib/wave/page.js` (modify) | Fetch notes, wire lanes, action row, bundle button |
| `web/static/wave.html` (modify) | Lanes container, new buttons |
| `web/static/styles.css` (modify) | Lane styles, 860px export priority |
| `web/static/sw.js` (modify) | Shell list gains `lanes.js`, cache bumped |
| `docs/api.md` (modify) | Two new endpoints, the new PATCH field |

---

### Task 1: Decode notes in frames, and classify drums

**Files:**
- Create: `internal/bundle/notes.go`
- Test: `internal/bundle/notes_test.go`

**Interfaces:**
- Consumes: `smf.Decode(b []byte) (*smf.File, error)`, `midi.FromConductor(track smf.Track, ppq uint16) *midi.TempoMap`, `(*midi.TempoMap).Seconds(tick uint64) float64`, `(*midi.TempoMap).BPMAt(sec float64) float64`, `audio.MIDIPath(wav string) string`, `audio.ManifestPath(wav string) string`, `audio.ReadWAVInfo(path) (audio.WAVInfo, error)`.
- Produces:
  ```go
  type Note struct { S, E int64; P, V int }              // json: s, e, p, v
  type NoteTrack struct { Name, Device string; Channel int; Kind string; Notes []Note }
  type TempoPoint struct { Frame int64; BPM float64 }
  type NotesResponse struct { PPQ int; SampleRate int; Frames int64; Tempo []TempoPoint; DownbeatFrame int64; Tracks []NoteTrack }
  var ErrNoMIDI, ErrBadMIDI error
  func Notes(wavPath string) (*NotesResponse, error)
  func classify(channel int, notes []Note, framesPerBeat float64) string  // "drums" | "notes"
  ```

- [ ] **Step 1: Write the failing tests**

```go
// internal/bundle/notes_test.go
package bundle

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/smf"
)

// fixtureMIDI is a two-track file at 120 BPM for its first two beats and
// 60 BPM after: a quarter is 0.5 s, then 1 s. PPQ 480.
func fixtureMIDI(t *testing.T) []byte {
	t.Helper()
	f := &smf.File{PPQ: 480}
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "Hindsight tempo"),
		smf.TimeSignature(0, 4, 4),
		smf.Tempo(0, smf.USPerQuarter(120)),
		smf.Tempo(960, smf.USPerQuarter(60)),
		smf.EndOfTrack(4*960),
	}})
	// bento ch1: a note on beat 1 and a note on beat 3 (after the tempo change).
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "bento ch1"),
		smf.Channel(0, 0x90, 60, 100),
		smf.Channel(240, 0x80, 60, 0),
		smf.Channel(960, 0x90, 64, 64),
		smf.Channel(1440, 0x80, 64, 0),
		// A note-on with no note-off: must end at the take's last frame.
		smf.Channel(1920, 0x90, 67, 10),
		smf.EndOfTrack(4 * 960),
	}})
	return f.Encode()
}

func writeTakeWithMIDI(t *testing.T, mid []byte) string {
	t.Helper()
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_test.wav")
	writeWAVHeader(t, wav, rate) // 2 s of stereo at 48k, from exporter_test.go
	if mid != nil {
		if err := os.WriteFile(audio.MIDIPath(wav), mid, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return wav
}

func TestNotesConvertsTicksToFramesAcrossATempoChange(t *testing.T) {
	wav := writeTakeWithMIDI(t, fixtureMIDI(t))
	n, err := Notes(wav)
	if err != nil {
		t.Fatal(err)
	}
	if n.PPQ != 480 || n.SampleRate != rate || n.Frames != 2*rate {
		t.Fatalf("header = %+v", n)
	}
	if len(n.Tracks) != 1 || n.Tracks[0].Name != "bento ch1" || n.Tracks[0].Device != "bento" || n.Tracks[0].Channel != 1 {
		t.Fatalf("tracks = %+v", n.Tracks)
	}
	got := n.Tracks[0].Notes
	// beat 1 at 120: 0 .. 0.25 s ; beat 3 = 1.0 s at 120 for 2 beats, then 60 BPM: 1.0 .. 1.5 s
	want := []Note{
		{S: 0, E: rate / 4, P: 60, V: 100},
		{S: rate, E: rate + rate/2, P: 64, V: 64},
		{S: 2 * rate, E: 2 * rate, P: 67, V: 10}, // tick 1920 = 2.0 s; hanging, closed at the end
	}
	if len(got) != len(want) {
		t.Fatalf("notes = %+v\nwant %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("note %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if len(n.Tempo) != 2 || n.Tempo[0] != (TempoPoint{0, 120}) || n.Tempo[1] != (TempoPoint{rate, 60}) {
		t.Errorf("tempo = %+v", n.Tempo)
	}
}

func TestNotesWithoutAMIDIFileIsErrNoMIDI(t *testing.T) {
	wav := writeTakeWithMIDI(t, nil)
	if _, err := Notes(wav); !errors.Is(err, ErrNoMIDI) {
		t.Fatalf("err = %v, want ErrNoMIDI", err)
	}
}

func TestNotesWithACorruptMIDIFileIsErrBadMIDI(t *testing.T) {
	wav := writeTakeWithMIDI(t, []byte("MThd garbage"))
	if _, err := Notes(wav); !errors.Is(err, ErrBadMIDI) {
		t.Fatalf("err = %v, want ErrBadMIDI", err)
	}
}

func TestNotesReadsTheDownbeatFromTheManifest(t *testing.T) {
	wav := writeTakeWithMIDI(t, fixtureMIDI(t))
	os.WriteFile(audio.ManifestPath(wav), []byte(`{"version":1,"downbeat":{"seconds":0.5,"tick":240,"source":"midi-start"}}`), 0o644)
	n, err := Notes(wav)
	if err != nil {
		t.Fatal(err)
	}
	if n.DownbeatFrame != rate/2 {
		t.Errorf("downbeat_frame = %d, want %d", n.DownbeatFrame, rate/2)
	}
}

func TestClassify(t *testing.T) {
	fpb := 24000.0 // frames per beat at 120 BPM, 48k
	short := func(p, n int) []Note {
		out := make([]Note, n)
		for i := range out {
			out[i] = Note{S: int64(i) * 4800, E: int64(i)*4800 + 2400, P: 36 + (i % p), V: 100} // a tenth of a beat
		}
		return out
	}
	long := func(p, n int) []Note {
		out := make([]Note, n)
		for i := range out {
			out[i] = Note{S: int64(i) * 48000, E: int64(i)*48000 + 24000, P: 36 + (i % p), V: 100} // a whole beat
		}
		return out
	}
	cases := []struct {
		name  string
		ch    int
		notes []Note
		want  string
	}{
		{"channel 10 is drums whatever it plays", 10, long(30, 40), "drums"},
		{"few pitches, short notes", 1, short(4, 40), "drums"},
		{"few pitches, long notes: a bass line", 2, long(4, 40), "notes"},
		{"many pitches, short notes: an arpeggio", 3, short(24, 40), "notes"},
		{"exactly sixteen pitches still counts as drums", 1, short(16, 64), "drums"},
		{"empty track is notes", 1, nil, "notes"},
	}
	for _, c := range cases {
		if got := classify(c.ch, c.notes, fpb); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/bundle/ -run 'TestNotes|TestClassify' -v`
Expected: FAIL to compile: `undefined: Notes`, `undefined: classify`, `undefined: Note`.

- [ ] **Step 3: Write the implementation**

```go
// internal/bundle/notes.go
package bundle

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"sort"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/smf"
)

// ErrNoMIDI is a take with no .mid beside it.
var ErrNoMIDI = errors.New("take has no MIDI")

// ErrBadMIDI is a .mid that exists but does not decode.
var ErrBadMIDI = errors.New("MIDI file does not decode")

// Note is one note in the take's frames.
type Note struct {
	S int64 `json:"s"` // first frame
	E int64 `json:"e"` // frame after the last
	P int   `json:"p"` // MIDI pitch 0..127
	V int   `json:"v"` // velocity 1..127
}

// NoteTrack is one (device, channel) track of the .mid, as BuildSMF lays
// them out, with the server's drum/notes guess.
type NoteTrack struct {
	Name    string `json:"name"`
	Device  string `json:"device"`
	Channel int    `json:"channel"` // 1..16
	Kind    string `json:"kind"`    // "drums" or "notes"
	Notes   []Note `json:"notes"`
}

// TempoPoint is a tempo in force from Frame onwards.
type TempoPoint struct {
	Frame int64   `json:"frame"`
	BPM   float64 `json:"bpm"`
}

// NotesResponse is GET /api/midi.
type NotesResponse struct {
	PPQ           int          `json:"ppq"`
	SampleRate    int          `json:"sample_rate"`
	Frames        int64        `json:"frames"`
	Tempo         []TempoPoint `json:"tempo"`
	DownbeatFrame int64        `json:"downbeat_frame"`
	Tracks        []NoteTrack  `json:"tracks"`
}

// KindDrums and KindNotes are the two lane kinds.
const (
	KindDrums = "drums"
	KindNotes = "notes"
)

// maxDrumPitches is how many distinct pitches a track may use and still be
// guessed as drums: a pad grid, not a keyboard.
const maxDrumPitches = 16

// Notes decodes the take's .mid into notes on the take's frame timeline.
// Kind is the classifier's guess; the caller applies any sidecar override.
func Notes(wavPath string) (*NotesResponse, error) {
	b, err := os.ReadFile(audio.MIDIPath(wavPath))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNoMIDI
		}
		return nil, err
	}
	f, err := smf.Decode(b)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadMIDI, err)
	}
	info, err := audio.ReadWAVInfo(wavPath)
	if err != nil {
		return nil, err
	}
	rate := float64(info.SampleRate)
	frames := info.Frames()
	toFrame := func(sec float64) int64 {
		fr := int64(math.Round(sec * rate))
		if fr < 0 {
			return 0
		}
		if fr > frames {
			return frames
		}
		return fr
	}

	out := &NotesResponse{PPQ: int(f.PPQ), SampleRate: info.SampleRate, Frames: frames, Tempo: []TempoPoint{}, Tracks: []NoteTrack{}}
	if len(f.Tracks) == 0 {
		return out, nil
	}
	tempo := midi.FromConductor(f.Tracks[0], f.PPQ)
	for _, ev := range f.Tracks[0].Events {
		if us := ev.Tempo(); us != 0 {
			out.Tempo = append(out.Tempo, TempoPoint{Frame: toFrame(tempo.Seconds(ev.Tick)), BPM: 60e6 / float64(us)})
		}
	}

	var manifest Manifest
	if mb, err := os.ReadFile(audio.ManifestPath(wavPath)); err == nil {
		_ = json.Unmarshal(mb, &manifest)
	}
	if manifest.Downbeat != nil {
		out.DownbeatFrame = toFrame(manifest.Downbeat.Sec)
	}

	// Frames per beat at the take's middle, for the classifier.
	midBPM := tempo.BPMAt(float64(frames) / rate / 2)
	if midBPM <= 0 {
		midBPM = midi.FallbackBPM
	}
	framesPerBeat := rate * 60 / midBPM

	for _, tr := range f.Tracks[1:] {
		nt := decodeTrack(tr, tempo, toFrame, frames)
		if nt.Name == "" && len(nt.Notes) == 0 {
			continue
		}
		nt.Kind = classify(nt.Channel, nt.Notes, framesPerBeat)
		out.Tracks = append(out.Tracks, nt)
	}
	return out, nil
}

// decodeTrack pairs note-ons with note-offs. A note still sounding at the
// end of the file closes at the take's last frame.
func decodeTrack(tr smf.Track, tempo *midi.TempoMap, toFrame func(float64) int64, frames int64) NoteTrack {
	nt := NoteTrack{Notes: []Note{}, Channel: 0}
	type key struct{ ch, p int }
	open := map[key]Note{}
	for _, ev := range tr.Events {
		if ev.IsMeta() {
			if nt.Name == "" && ev.Meta == smf.MetaTrackName {
				nt.Name = ev.Text()
			}
			continue
		}
		kind := ev.Status & 0xF0
		if kind != 0x90 && kind != 0x80 {
			continue
		}
		ch := int(ev.Status&0x0F) + 1
		if nt.Channel == 0 {
			nt.Channel = ch
		}
		k := key{ch, int(ev.D1)}
		fr := toFrame(tempo.Seconds(ev.Tick))
		if kind == 0x90 && ev.D2 > 0 {
			if prev, ok := open[k]; ok { // retriggered without an off: close the first here
				prev.E = fr
				nt.Notes = append(nt.Notes, prev)
			}
			open[k] = Note{S: fr, P: int(ev.D1), V: int(ev.D2)}
			continue
		}
		if n, ok := open[k]; ok {
			n.E = fr
			nt.Notes = append(nt.Notes, n)
			delete(open, k)
		}
	}
	for _, n := range open {
		n.E = frames
		nt.Notes = append(nt.Notes, n)
	}
	sort.Slice(nt.Notes, func(i, j int) bool {
		if nt.Notes[i].S != nt.Notes[j].S {
			return nt.Notes[i].S < nt.Notes[j].S
		}
		return nt.Notes[i].P < nt.Notes[j].P
	})
	nt.Device = trackChannel.ReplaceAllString(nt.Name, "")
	return nt
}

// classify guesses a lane kind. Channel 10 is drums by convention.
// Otherwise a track is drums only when it uses few distinct pitches AND its
// notes are short: a sparse bass line has few pitches but long notes, a fast
// arpeggio has short notes but many pitches, and neither is a drum track.
func classify(channel int, notes []Note, framesPerBeat float64) string {
	if channel == 10 {
		return KindDrums
	}
	if len(notes) == 0 {
		return KindNotes
	}
	pitches := map[int]bool{}
	lens := make([]int64, 0, len(notes))
	for _, n := range notes {
		pitches[n.P] = true
		lens = append(lens, n.E-n.S)
	}
	if len(pitches) > maxDrumPitches {
		return KindNotes
	}
	sort.Slice(lens, func(i, j int) bool { return lens[i] < lens[j] })
	p90 := lens[(len(lens)*9)/10]
	if float64(p90) < framesPerBeat/4 {
		return KindDrums
	}
	return KindNotes
}
```

`smf.MetaTrackName`: check the constant's name in `internal/smf/smf.go` (the meta type `0x03`); if it is spelled differently, use that spelling. `trackChannel` is the regexp already declared in `cut.go`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/bundle/ -v`
Expected: PASS, including the pre-existing exporter tests.

- [ ] **Step 5: Commit**

```bash
git add internal/bundle/notes.go internal/bundle/notes_test.go
git commit -m "Decode a take's MIDI into notes in frames, and guess which lanes are drums"
```

---

### Task 2: The `lane_kinds` sidecar field, on PATCH and on the listing

**Files:**
- Modify: `internal/audio/meta.go:73-101` (the `Meta` struct)
- Modify: `internal/audio/save.go:474` (the listing struct, and where it is filled near line 515)
- Modify: `internal/api/api.go:792-900` (`handleTakePatch`)
- Test: `internal/api/api_test.go`

**Interfaces:**
- Produces: `Meta.LaneKinds map[string]string` (`json:"lane_kinds,omitempty"`); the takes listing carries `lane_kinds`; `PATCH /api/take` accepts `lane_kinds` as a full replacement, `null` clears.

- [ ] **Step 1: Write the failing tests**

Append to `internal/api/api_test.go`:

```go
func TestPatchTakeSetsAndClearsLaneKinds(t *testing.T) {
	r, dir := newTestAPI(t)
	writeTake(t, dir, "a.wav")

	w := patch(t, r, "a.wav", `{"lane_kinds":{"bento ch1":"drums","KeyStep 37 ch1":"notes"}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	m := audio.ReadMeta(filepath.Join(dir, "a.wav"))
	if m.LaneKinds["bento ch1"] != "drums" || m.LaneKinds["KeyStep 37 ch1"] != "notes" {
		t.Fatalf("lane_kinds = %v", m.LaneKinds)
	}
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if lk, _ := body["lane_kinds"].(map[string]any); lk["bento ch1"] != "drums" {
		t.Errorf("response lane_kinds = %v", body["lane_kinds"])
	}

	// A label edit leaves it alone.
	patch(t, r, "a.wav", `{"label":"x"}`)
	if m := audio.ReadMeta(filepath.Join(dir, "a.wav")); len(m.LaneKinds) != 2 {
		t.Errorf("label patch changed lane_kinds: %v", m.LaneKinds)
	}

	w = patch(t, r, "a.wav", `{"lane_kinds":null}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if m := audio.ReadMeta(filepath.Join(dir, "a.wav")); m.LaneKinds != nil {
		t.Errorf("null did not clear lane_kinds: %v", m.LaneKinds)
	}
}

func TestPatchTakeRejectsAnUnknownLaneKind(t *testing.T) {
	r, dir := newTestAPI(t)
	writeTake(t, dir, "a.wav")
	w := patch(t, r, "a.wav", `{"lane_kinds":{"bento ch1":"piano"}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", w.Code)
	}
	if m := audio.ReadMeta(filepath.Join(dir, "a.wav")); m.LaneKinds != nil {
		t.Errorf("a rejected patch wrote lane_kinds: %v", m.LaneKinds)
	}
}

func TestPatchTakeCapsLaneKindsAtSixtyFour(t *testing.T) {
	r, dir := newTestAPI(t)
	writeTake(t, dir, "a.wav")
	var sb strings.Builder
	sb.WriteString(`{"lane_kinds":{`)
	for i := 0; i < 65; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		fmt.Fprintf(&sb, `"t%d":"drums"`, i)
	}
	sb.WriteString(`}}`)
	if w := patch(t, r, "a.wav", sb.String()); w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", w.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/api/ -run 'LaneKind' -v`
Expected: FAIL to compile: `m.LaneKinds undefined`.

- [ ] **Step 3: Add the field, the listing column, and the PATCH branch**

In `internal/audio/meta.go`, after the `Flags` field of `Meta`:

```go
	// LaneKinds overrides the notes endpoint's drum/notes guess per track,
	// keyed by SMF track name ("bento ch1"). Optional and additive, like
	// BPM and Flags, so it needs no MetaVersion bump.
	LaneKinds map[string]string `json:"lane_kinds,omitempty"`
```

In `internal/audio/save.go`, find the listing struct that carries `HasMIDI bool \`json:"has_midi"\`` (line 474) and add, next to the other sidecar fields it copies from `Meta` (label, starred, bpm, flags, downbeat_frame):

```go
	LaneKinds map[string]string `json:"lane_kinds,omitempty"`
```

and where those fields are filled from the read `Meta` (near line 515, the same literal that sets `HasMIDI: exists(MIDIPath(full))`), add `LaneKinds: m.LaneKinds,` using whatever variable holds the `Meta` there.

In `internal/api/api.go`, `handleTakePatch`: add to the `body` struct

```go
		LaneKinds json.RawMessage `json:"lane_kinds"`
```

and after the flags block, before `audio.WriteMeta`:

```go
	// RawMessage like flags: absent, null and a map are three states. A
	// submitted map replaces the take's overrides wholesale.
	if body.LaneKinds != nil {
		if string(body.LaneKinds) == "null" {
			m.LaneKinds = nil
		} else {
			var lk map[string]string
			if err := json.Unmarshal(body.LaneKinds, &lk); err != nil {
				writeErr(w, http.StatusBadRequest, "invalid lane_kinds")
				return
			}
			if len(lk) > maxLaneKinds {
				writeErr(w, http.StatusBadRequest,
					fmt.Sprintf("a take may carry at most %d lane overrides", maxLaneKinds))
				return
			}
			clean := make(map[string]string, len(lk))
			for name, kind := range lk {
				if kind != bundle.KindDrums && kind != bundle.KindNotes {
					writeErr(w, http.StatusBadRequest, "lane_kinds values must be \"drums\" or \"notes\"")
					return
				}
				if name = sanitizeLabel(name); name != "" {
					clean[name] = kind
				}
			}
			if len(clean) == 0 {
				clean = nil
			}
			m.LaneKinds = clean
		}
	}
```

Add `const maxLaneKinds = 64` next to `maxTakeFlags` (line 251), and `"github.com/gabeduke/hindsight/internal/bundle"` to the imports. The response at the end of the handler encodes the merged `Meta`; confirm it is the whole struct (so `lane_kinds` appears) rather than a hand-built map, and if it is a hand-built map add `"lane_kinds": m.LaneKinds`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/api/ ./internal/audio/ -v -run 'Patch|Meta'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/audio/meta.go internal/audio/save.go internal/api/api.go internal/api/api_test.go
git commit -m "Let a take's sidecar override which MIDI lanes are drums"
```

---

### Task 3: `GET /api/midi`

**Files:**
- Create: `internal/api/midi.go`
- Modify: `internal/api/api.go:79-92` (`SetupRoutes`)
- Test: `internal/api/midi_test.go`

**Interfaces:**
- Consumes: `bundle.Notes`, `bundle.ErrNoMIDI`, `bundle.ErrBadMIDI`, `audio.ReadMeta`, `a.safeTakeName`, `writeJSON`, `writeErr`.
- Produces: route `GET|HEAD /api/midi?file=` returning `bundle.NotesResponse` with sidecar `lane_kinds` applied to each track's `kind`.

- [ ] **Step 1: Write the failing tests**

```go
// internal/api/midi_test.go
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/smf"
)

// midiFixture is one track, "bento ch1", four short notes on four pads at
// 120 BPM: the classifier calls it drums.
func midiFixture() []byte {
	f := &smf.File{PPQ: 480}
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "Hindsight tempo"),
		smf.Tempo(0, smf.USPerQuarter(120)),
		smf.EndOfTrack(1920),
	}})
	tr := smf.Track{Events: []smf.Event{smf.TrackName(0, "bento ch1")}}
	for i := 0; i < 4; i++ {
		tick := uint64(i) * 480
		tr.Events = append(tr.Events,
			smf.Channel(tick, 0x90, byte(36+i), 100),
			smf.Channel(tick+48, 0x80, byte(36+i), 0))
	}
	tr.Events = append(tr.Events, smf.EndOfTrack(1920))
	f.Tracks = append(f.Tracks, tr)
	return f.Encode()
}

func TestMIDIReturnsNotesInFrames(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "a.wav", 48000*2)
	os.WriteFile(audio.MIDIPath(wav), midiFixture(), 0o644)

	w := do(t, r, http.MethodGet, "/api/midi?file=a.wav")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}
	var body struct {
		SampleRate int `json:"sample_rate"`
		Tracks     []struct {
			Name  string `json:"name"`
			Kind  string `json:"kind"`
			Notes []struct{ S, E int64; P, V int } `json:"notes"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.SampleRate != 48000 || len(body.Tracks) != 1 || body.Tracks[0].Kind != "drums" {
		t.Fatalf("body = %s", w.Body)
	}
	n := body.Tracks[0].Notes
	if len(n) != 4 || n[1].S != 24000 || n[1].E != 26400 || n[1].P != 37 {
		t.Errorf("notes = %+v", n)
	}
}

func TestMIDIAppliesTheSidecarOverride(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "a.wav", 48000*2)
	os.WriteFile(audio.MIDIPath(wav), midiFixture(), 0o644)
	if w := patch(t, r, "a.wav", `{"lane_kinds":{"bento ch1":"notes"}}`); w.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", w.Code, w.Body)
	}
	w := do(t, r, http.MethodGet, "/api/midi?file=a.wav")
	var body struct {
		Tracks []struct{ Kind string } `json:"tracks"`
	}
	json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Tracks) != 1 || body.Tracks[0].Kind != "notes" {
		t.Errorf("override not applied: %s", w.Body)
	}
}

func TestMIDIStatuses(t *testing.T) {
	r, dir := newTestAPI(t)
	if w := do(t, r, http.MethodGet, "/api/midi?file=../a.wav"); w.Code != http.StatusBadRequest {
		t.Errorf("traversal: %d", w.Code)
	}
	if w := do(t, r, http.MethodGet, "/api/midi?file=missing.wav"); w.Code != http.StatusNotFound {
		t.Errorf("missing take: %d", w.Code)
	}
	wav := writeRealTake(t, dir, "nomidi.wav", 48000)
	if w := do(t, r, http.MethodGet, "/api/midi?file=nomidi.wav"); w.Code != http.StatusNotFound {
		t.Errorf("no .mid: %d", w.Code)
	}
	os.WriteFile(audio.MIDIPath(wav), []byte("MThd nope"), 0o644)
	if w := do(t, r, http.MethodGet, "/api/midi?file=nomidi.wav"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("corrupt .mid: %d", w.Code)
	}
	_ = filepath.Base
}
```

`writeRealTake` and `do` already exist in `api_test.go`. `writeRealTake` writes a genuine WAV; confirm it writes a 32-bit header (it is used for cue tests on real takes) so `ReadWAVInfo` reports the right frame count.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/api/ -run 'TestMIDI' -v`
Expected: FAIL with 404s from the mux (`status 404` where 200 was wanted), or "no route".

- [ ] **Step 3: Write the handler and register it**

```go
// internal/api/midi.go
// The take page's MIDI: notes in frames, and the region bundle.
package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/bundle"
)

// handleMIDI serves the take's .mid decoded to notes on the take's frame
// timeline, so the page can draw lanes with the wave view's own math. The
// sidecar's lane_kinds overrides the classifier per track.
func (a *API) handleMIDI(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	wav := filepath.Join(a.cfg.OutputDir, name)
	if _, err := os.Stat(wav); err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	notes, err := bundle.Notes(wav)
	switch {
	case errors.Is(err, bundle.ErrNoMIDI):
		writeErr(w, http.StatusNotFound, "this take has no MIDI")
		return
	case errors.Is(err, bundle.ErrBadMIDI):
		writeErr(w, http.StatusUnprocessableEntity, "the MIDI file does not decode")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not read MIDI")
		return
	}
	if kinds := audio.ReadMeta(wav).LaneKinds; len(kinds) > 0 {
		for i := range notes.Tracks {
			if k, ok := kinds[notes.Tracks[i].Name]; ok {
				notes.Tracks[i].Kind = k
			}
		}
	}
	// A take's .mid never changes after it is written. A lane_kinds edit is
	// applied locally by the page, so a cached kind going stale is harmless.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	writeJSON(w, http.StatusOK, notes)
}
```

In `SetupRoutes`, after the `/api/render` line:

```go
	r.HandleFunc("/api/midi", a.handleMIDI).Methods(http.MethodGet, http.MethodHead)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/api/ -v -run 'TestMIDI'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/midi.go internal/api/api.go internal/api/midi_test.go
git commit -m "GET /api/midi: a take's notes in frames, for the lanes"
```

---

### Task 4: `RegionMIDI` and `WriteRegion32`, the bundle's two halves

**Files:**
- Modify: `internal/bundle/cut.go:38-220` (`CutMIDI`)
- Modify: `internal/audio/cut.go:103-150` (`writeCutWAV`)
- Test: `internal/bundle/exporter_test.go`, `internal/audio/cut_test.go`

**Interfaces:**
- Produces:
  ```go
  // internal/bundle
  func RegionMIDI(srcWav, dstName string, startFrame, endFrame int64) (mid []byte, manifest *Manifest, err error)
  // mid == nil && err == nil means the source has no MIDI, or nothing in the region.
  // internal/audio
  func WriteRegion32(w io.Writer, path string, from, to int64) error
  ```

- [ ] **Step 1: Write the failing tests**

Append to `internal/bundle/exporter_test.go`:

```go
// RegionMIDI is CutMIDI's inside: the bytes it returns are the bytes CutMIDI
// writes, so the streaming bundle and the file-writing cut cannot diverge.
func TestRegionMIDIMatchesCutMIDI(t *testing.T) {
	r := newRig(t, 60)
	r.clock(10.5, 40, 120, true)
	r.note(2, 14.0, 0, 64, 90)
	r.note(2, 16.0, 0, 64, 0)
	r.note(2, 17.0, 0, 67, 80)
	r.note(2, 17.25, 0, 67, 0)
	ex := New(r.src, 0, "EP-136")
	if err := ex.Export(r.request(10, 30)); err != nil {
		t.Fatal(err)
	}
	writeWAVHeader(t, r.wav, rate)

	mid, m, err := RegionMIDI(r.wav, "jam_cut.wav", 5*rate, 10*rate)
	if err != nil || mid == nil || m == nil {
		t.Fatalf("RegionMIDI: mid=%d bytes manifest=%v err=%v", len(mid), m, err)
	}
	if m.Take != "jam_cut.wav" || m.MIDI != "jam_cut.mid" || m.Source == nil || m.Source.StartFrame != 5*rate {
		t.Errorf("manifest = %+v", m)
	}

	dst := filepath.Join(r.dir, "jam_cut.wav")
	os.WriteFile(dst, []byte("wav"), 0o644)
	if err := ex.CutMIDI(r.wav, dst, 5*rate, 10*rate); err != nil {
		t.Fatal(err)
	}
	written, err := os.ReadFile(audio.MIDIPath(dst))
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != string(mid) {
		t.Errorf("CutMIDI wrote %d bytes, RegionMIDI returned %d; they must be identical", len(written), len(mid))
	}
}

func TestRegionMIDIWithNoSourceMIDIReturnsNothing(t *testing.T) {
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_test.wav")
	writeWAVHeader(t, wav, rate)
	mid, m, err := RegionMIDI(wav, "jam_cut.wav", 0, rate)
	if err != nil || mid != nil || m != nil {
		t.Fatalf("got mid=%v manifest=%v err=%v, want all nil", mid, m, err)
	}
}
```

Append to `internal/audio/cut_test.go` (read its existing helpers first; it has a way to write a real 32-bit source take, use that instead of inventing one):

```go
func TestWriteRegion32StreamsTheSameBytesACutWrites(t *testing.T) {
	dir := t.TempDir()
	// Use the file's existing helper that writes a 32-bit stereo take with a
	// known signal; name it src.
	src := writeTestTake(t, dir, "src.wav", 48000) // <- replace with the helper this file already has
	from, to := int64(1000), int64(30000)

	name, err := Cut(dir, CutRequest{Source: "src.wav", StartFrame: from, EndFrame: to}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	cut, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := WriteRegion32(&buf, src, from, to); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), cut) {
		t.Fatalf("stream is %d bytes, cut file is %d; they must be identical", buf.Len(), len(cut))
	}
}

func TestWriteRegion32RejectsABadRange(t *testing.T) {
	dir := t.TempDir()
	src := writeTestTake(t, dir, "src.wav", 48000)
	var buf bytes.Buffer
	if err := WriteRegion32(&buf, src, 10, 5); !errors.Is(err, ErrRange) {
		t.Errorf("inverted: %v", err)
	}
	if err := WriteRegion32(&buf, src, 0, 48000*2); !errors.Is(err, ErrRange) {
		t.Errorf("past the end: %v", err)
	}
	if err := WriteRegion32(&buf, src, 0, 10); !errors.Is(err, ErrTooShort) {
		t.Errorf("too short: %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/bundle/ ./internal/audio/ -run 'RegionMIDI|WriteRegion32' -v`
Expected: FAIL to compile: `undefined: RegionMIDI`, `undefined: WriteRegion32`.

- [ ] **Step 3: Extract `RegionMIDI` from `CutMIDI`**

In `internal/bundle/cut.go`, rename the body of `CutMIDI` into a package function. `CutMIDI` becomes:

```go
// CutMIDI implements audio.MIDICutter: when a region of a take is cut into
// a new take, the region of its .mid goes with it. The work is RegionMIDI's;
// this only writes the two files beside the cut.
func (e *Exporter) CutMIDI(srcWav, dstWav string, startFrame, endFrame int64) error {
	mid, m, err := RegionMIDI(srcWav, filepath.Base(dstWav), startFrame, endFrame)
	if err != nil || mid == nil {
		return err
	}
	if err := writeAtomic(audio.MIDIPath(dstWav), mid); err != nil {
		return err
	}
	mb, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomic(audio.ManifestPath(dstWav), mb); err != nil {
		return err
	}
	// ...keep whatever CutMIDI did after writing the manifest today (the
	// DownbeatFrame it stamps into the cut's sidecar via audio.ReadMeta /
	// WriteMeta) exactly as it is, reading m.Downbeat and m.SampleRate.
	return nil
}
```

Then `RegionMIDI`:

```go
// RegionMIDI re-bases the region [startFrame, endFrame) of the source's .mid
// so the region's first frame is tick 0, with the source's tempo lane over
// that stretch, notes sounding at the start clipped to it and notes still
// sounding at the end closed there. dstName is the take name the manifest
// will describe ("jam_cut.wav"). A source with no .mid, or a region with
// nothing in it, returns (nil, nil, nil).
func RegionMIDI(srcWav, dstName string, startFrame, endFrame int64) ([]byte, *Manifest, error) {
	// ...the former CutMIDI body from `srcMID := audio.MIDIPath(srcWav)` down to
	// the manifest literal, with these substitutions:
	//   - every early `return nil` that meant "nothing to do" becomes `return nil, nil, nil`
	//   - every `return err` becomes `return nil, nil, err`
	//   - drop the `writeAtomic(audio.MIDIPath(dstWav), out.Encode())` call; keep `encoded := out.Encode()`
	//   - in the Manifest literal: Take: dstName, MIDI: strings.TrimSuffix(dstName, ".wav") + ".mid"
	//   - drop the manifest writeAtomic and the sidecar DownbeatFrame stamp (CutMIDI keeps those)
	//   - end with `return encoded, &m, nil`
}
```

Read the current `CutMIDI` from line 38 to its end before moving anything: the manifest's `Devices` loop and the `TempoBPM` block are part of what moves. The existing test `TestCutMIDICarriesTheRegion` must still pass unchanged; it checks the sidecar `DownbeatFrame`, so that stamp stays in `CutMIDI`.

- [ ] **Step 4: Extract `WriteRegion32` from `writeCutWAV`**

In `internal/audio/cut.go`, split the streaming part out so both callers share it:

```go
// writeRegion32 streams frames [from, to) of srcPath through the fades to w
// as a 32-bit WAV with a canonical 44-byte header. acc may be nil.
func writeRegion32(w io.Writer, srcPath string, info WAVInfo, from, to, fade int64, acc *peakAccumulator) error {
	total := to - from
	ch := info.Channels
	bw := bufio.NewWriterSize(w, 1<<18)
	if err := writeWAVHeader(bw, uint32(total*int64(ch)*4), ch, info.SampleRate, 32); err != nil {
		return err
	}
	le := binary.LittleEndian
	var raw [4]byte
	_, err := ReadFrames(srcPath, from, to, 1<<14, func(block []int32, first int64) error {
		rel := first - from
		applyFades(block, rel, total, ch, fade)
		n := len(block) / ch
		for i := 0; i < n; i++ {
			for c := 0; c < ch; c++ {
				v := block[i*ch+c]
				le.PutUint32(raw[:], uint32(v))
				if _, err := bw.Write(raw[:]); err != nil {
					return err
				}
				if acc != nil {
					acc.add(c, int(rel)+i, float32(float64(v)/2147483648.0))
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return bw.Flush()
}

// WriteRegion32 streams frames [from, to) of a take to w as a complete
// 32-bit WAV with the same 3ms fades a cut applies: byte-identical to what
// POST /api/cut would write for the region, minus the peaks file. This is
// the DAW bundle's audio.
func WriteRegion32(w io.Writer, path string, from, to int64) error {
	info, err := ReadWAVInfo(path)
	if err != nil {
		return err
	}
	if info.BitsPerSample != 32 {
		return ErrBitDepth
	}
	if from < 0 || to <= from || to > info.Frames() {
		return fmt.Errorf("%w: [%d, %d) of %d frames", ErrRange, from, to, info.Frames())
	}
	fade := FadeFrames(info.SampleRate)
	if to-from < 2*fade+1 {
		return ErrTooShort
	}
	return writeRegion32(w, path, info, from, to, fade, nil)
}
```

and `writeCutWAV` becomes:

```go
func writeCutWAV(srcPath, outPath string, info WAVInfo, from, to, fade int64) error {
	total := to - from
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	acc := newPeakAccumulator(info.Channels, int(total))
	if err := writeRegion32(f, srcPath, info, from, to, fade, acc); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := WritePeaks(peaksPath(outPath), acc.finish(info.SampleRate, int(total))); err != nil {
		log.Printf("[!] peaks for %s: %v", filepath.Base(outPath), err)
	}
	return nil
}
```

Add `"io"` to the imports.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/bundle/ ./internal/audio/ -v`
Expected: PASS, including `TestCutMIDICarriesTheRegion` and every existing cut test.

- [ ] **Step 6: Commit**

```bash
git add internal/bundle/cut.go internal/bundle/exporter_test.go internal/audio/cut.go internal/audio/cut_test.go
git commit -m "Split the cut's MIDI and WAV writers so a bundle can stream them"
```

---

### Task 5: `GET /api/bundle`

**Files:**
- Modify: `internal/api/midi.go`
- Modify: `internal/api/api.go:79-92` (`SetupRoutes`)
- Test: `internal/api/midi_test.go`

**Interfaces:**
- Consumes: `audio.WriteRegion32`, `bundle.RegionMIDI`, `audio.RenderFilename(base, from, to, sampleRate, whole) string` (returns a `.mp3` name), `asciiOnly`, `audio.MaxRenderSeconds`, `audio.FadeFrames`.
- Produces: `GET /api/bundle?file=&from=&to=` streaming `application/zip`; header `X-Hindsight-Midi: none` when the zip holds only the WAV.

- [ ] **Step 1: Write the failing tests**

Append to `internal/api/midi_test.go`:

```go
import ( "archive/zip"; "bytes"; "strings" ) // merge into the file's import block

func TestBundleZipsWavMidAndManifest(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "a.wav", 48000*2)
	os.WriteFile(audio.MIDIPath(wav), midiFixture(), 0o644)
	patch(t, r, "a.wav", `{"label":"tuesday"}`)

	w := do(t, r, http.MethodGet, "/api/bundle?file=a.wav&from=0&to=48000")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="tuesday 0.00-1.00.zip"`) {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if w.Header().Get("X-Hindsight-Midi") != "" {
		t.Errorf("X-Hindsight-Midi set on a bundle that has MIDI")
	}
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]int64{}
	for _, f := range zr.File {
		names[f.Name] = int64(f.UncompressedSize64)
	}
	if len(names) != 3 {
		t.Fatalf("entries = %v, want wav + mid + manifest", names)
	}
	if names["tuesday.wav"] != 44+48000*2*4 {
		t.Errorf("wav entry = %v", names)
	}
	if names["tuesday.mid"] == 0 || names["tuesday.manifest.json"] == 0 {
		t.Errorf("mid/manifest missing or empty: %v", names)
	}
}

func TestBundleWithoutMIDIIsWavOnlyAndSaysSo(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "a.wav", 48000*2)
	w := do(t, r, http.MethodGet, "/api/bundle?file=a.wav&from=0&to=96000")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if w.Header().Get("X-Hindsight-Midi") != "none" {
		t.Errorf("X-Hindsight-Midi = %q, want none", w.Header().Get("X-Hindsight-Midi"))
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), `filename="a.zip"`) {
		t.Errorf("whole-take name: %q", w.Header().Get("Content-Disposition"))
	}
	zr, _ := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if len(zr.File) != 1 || zr.File[0].Name != "a.wav" {
		t.Errorf("entries = %v", zr.File)
	}
}

func TestBundleValidation(t *testing.T) {
	r, dir := newTestAPI(t)
	writeRealTake(t, dir, "a.wav", 48000*2)
	for _, q := range []string{
		"file=a.wav&from=5&to=5",
		"file=a.wav&from=0&to=200000",
		"file=a.wav&from=0&to=10",
		"file=a.wav&from=x&to=10",
	} {
		if w := do(t, r, http.MethodGet, "/api/bundle?"+q); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", q, w.Code)
		}
	}
	if w := do(t, r, http.MethodGet, "/api/bundle?file=nope.wav&from=0&to=100"); w.Code != http.StatusNotFound {
		t.Errorf("missing: %d", w.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `CGO_ENABLED=0 go test ./internal/api/ -run 'TestBundle' -v`
Expected: FAIL: 404 from the mux where 200 was expected.

- [ ] **Step 3: Write the handler**

Append to `internal/api/midi.go` (add `"archive/zip"`, `"encoding/json"`, `"fmt"`, `"log"`, `"net/url"`, `"strconv"`, `"strings"` to its imports):

```go
// handleBundle streams a zip of the region as a DAW opens it: the audio at
// its native depth with the cut's fades, the MIDI re-based to the region,
// and the manifest. Nothing is written to disk.
func (a *API) handleBundle(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	q := r.URL.Query()
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil || from < 0 || to <= from {
		writeErr(w, http.StatusBadRequest, "need integer 0 <= from < to")
		return
	}
	path := filepath.Join(a.cfg.OutputDir, name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if info.BitsPerSample != 32 {
		writeErr(w, http.StatusBadRequest, "only 32-bit takes can be bundled")
		return
	}
	if to > info.Frames() {
		writeErr(w, http.StatusBadRequest, "range is past the end of the take")
		return
	}
	if to-from < 2*audio.FadeFrames(info.SampleRate)+1 {
		writeErr(w, http.StatusBadRequest, "region is too short to bundle")
		return
	}
	if to-from > int64(audio.MaxRenderSeconds*info.SampleRate) {
		writeErr(w, http.StatusBadRequest, audio.ErrRenderTooLong.Error())
		return
	}

	base := audio.ReadMeta(path).Label
	if base == "" {
		base = strings.TrimSuffix(name, ".wav")
	}
	whole := from == 0 && to == info.Frames()
	// RenderFilename builds "<base> <m.ss>-<m.ss>.mp3" with a whitelisted
	// character set; the bundle is the same name with a zip suffix.
	zipName := strings.TrimSuffix(audio.RenderFilename(base, from, to, info.SampleRate, whole), ".mp3") + ".zip"
	asciiName := strings.TrimSuffix(audio.RenderFilename(asciiOnly(base), from, to, info.SampleRate, whole), ".mp3") + ".zip"
	stem := strings.TrimSuffix(audio.RenderFilename(base, 0, 0, info.SampleRate, true), ".mp3")

	// The MIDI first: it is small, and knowing whether there is any lets the
	// header say so before the first byte of audio goes out.
	mid, manifest, err := bundle.RegionMIDI(path, stem+".wav", from, to)
	if err != nil {
		log.Printf("bundle %s [%d,%d): midi: %v", name, from, to, err)
		mid, manifest = nil, nil
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`, asciiName, url.PathEscape(zipName)))
	w.Header().Set("Cache-Control", "no-store")
	if mid == nil {
		w.Header().Set("X-Hindsight-Midi", "none")
	}

	zw := zip.NewWriter(w)
	// Audio is stored, not deflated: PCM does not compress and the Pi's
	// CPU is better spent elsewhere.
	wavEntry, err := zw.CreateHeader(&zip.FileHeader{Name: stem + ".wav", Method: zip.Store})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "bundle failed")
		return
	}
	if err := audio.WriteRegion32(wavEntry, path, from, to); err != nil {
		// Headers are gone; the client sees a truncated zip. Log it.
		log.Printf("bundle %s [%d,%d): wav: %v", name, from, to, err)
		return
	}
	if mid != nil {
		if e, err := zw.Create(stem + ".mid"); err == nil {
			e.Write(mid)
		}
		if mb, err := json.MarshalIndent(manifest, "", "  "); err == nil {
			if e, err := zw.Create(stem + ".manifest.json"); err == nil {
				e.Write(mb)
			}
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("bundle %s: close: %v", name, err)
	}
}
```

Check `audio.RenderFilename` with `whole=true` really yields `<base>.mp3` regardless of `from`/`to` (read `internal/audio/render.go:73`); if it takes the frames into account for the whole-take name, compute `stem` as `strings.TrimSuffix(audio.RenderFilename(base, 0, info.Frames(), info.SampleRate, true), ".mp3")`.

In `SetupRoutes`, after the `/api/midi` line:

```go
	r.HandleFunc("/api/bundle", a.handleBundle).Methods(http.MethodGet)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `CGO_ENABLED=0 go test ./internal/api/ -v -run 'TestBundle|TestMIDI'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/api/midi.go internal/api/api.go internal/api/midi_test.go
git commit -m "GET /api/bundle: a region as WAV plus re-based MIDI in one zip"
```

---

### Task 6: Lane geometry, as pure functions

**Files:**
- Create: `web/static/lib/wave/lanes.js`
- Test: `web/static/lib/wave/lanes.test.js`

**Interfaces:**
- Consumes: `frameToX(frame, view)` from `./geometry.js`; `view = { start, fpp, width }`.
- Produces:
  ```js
  export const LANE_H = { notes: 56, drums: 36, collapsed: 18 };
  export const DRUM_COLOR = '#fbbf24';
  export const MELODIC_COLORS = ['#34d399', '#3b9dd4', '#f87171', '#a78bfa'];
  export function laneColors(tracks)            // -> string[] parallel to tracks
  export function laneLayout(track, collapsed)  // -> { h, rows:[{top,h,tint}], rowH, lo, hi, pitchRow:Map|null }
  export function noteRects(track, layout, view) // -> [{x, w, y, h, alpha}] culled to the view
  export function alphaFor(v)                   // 0.3 + 0.7 * v / 127
  ```

- [ ] **Step 1: Write the failing tests**

```js
// web/static/lib/wave/lanes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_H, DRUM_COLOR, MELODIC_COLORS, laneColors, laneLayout, noteRects, alphaFor } from './lanes.js';

const melodic = { name: 'bento ch2', kind: 'notes', notes: [
  { s: 0, e: 4800, p: 60, v: 127 },
  { s: 9600, e: 14400, p: 62, v: 64 },
  { s: 96000, e: 100800, p: 64, v: 1 }, // off-screen in the views below
] };
const drums = { name: 'bento ch1', kind: 'drums', notes: [
  { s: 0, e: 480, p: 36, v: 127 },
  { s: 4800, e: 5280, p: 38, v: 64 },
  { s: 9600, e: 10080, p: 36, v: 127 },
] };
// 10 frames per px, 390px wide: 3900 frames visible... make it 48000 visible.
const view = { start: 0, fpp: 48000 / 390, width: 390 };

test('velocity is opacity', () => {
  assert.equal(alphaFor(127), 1);
  assert.ok(Math.abs(alphaFor(0) - 0.3) < 1e-9);
});

test('drums are amber, melodic tracks cycle, drums do not consume a melodic colour', () => {
  const c = laneColors([drums, melodic, { ...melodic, name: 'x' }]);
  assert.deepEqual(c, [DRUM_COLOR, MELODIC_COLORS[0], MELODIC_COLORS[1]]);
  const five = laneColors([melodic, melodic, melodic, melodic, melodic]);
  assert.equal(five[4], MELODIC_COLORS[0]);
});

test('a melodic layout spans the track\'s pitch range with C rows tinted', () => {
  const L = laneLayout(melodic, false);
  assert.equal(L.h, LANE_H.notes);
  assert.equal(L.lo, 60); assert.equal(L.hi, 64);
  assert.equal(L.rowH, LANE_H.notes / 5);
  // one row per pitch; only C (60) is tinted
  assert.equal(L.rows.length, 5);
  assert.deepEqual(L.rows.filter((r) => r.tint).map((r) => r.top), [4 * L.rowH]);
});

test('a melodic row is never thinner than 4px', () => {
  const wide = { kind: 'notes', notes: [{ s: 0, e: 1, p: 20, v: 1 }, { s: 0, e: 1, p: 100, v: 1 }] };
  assert.equal(laneLayout(wide, false).rowH, 4);
});

test('a drum layout has one row per distinct pitch, lowest at the bottom', () => {
  const L = laneLayout(drums, false);
  assert.equal(L.h, LANE_H.drums);
  assert.equal(L.rows.length, 2);
  assert.equal(L.rowH, LANE_H.drums / 2);
  assert.equal(L.pitchRow.get(36), 1); // bottom row index 1 of 2 (top = 0)
  assert.equal(L.pitchRow.get(38), 0);
});

test('collapsed is 18px with no rows', () => {
  const L = laneLayout(melodic, true);
  assert.equal(L.h, LANE_H.collapsed);
  assert.equal(L.rows.length, 0);
});

test('melodic note rects sit in their pitch row and are culled to the view', () => {
  const L = laneLayout(melodic, false);
  const r = noteRects(melodic, L, view);
  assert.equal(r.length, 2);            // the third note is past 48000
  assert.equal(r[0].x, 0);
  assert.equal(r[0].w, 4800 / view.fpp);
  assert.equal(r[0].y, (64 - 60) * L.rowH); // pitch 60 is the bottom row
  assert.equal(r[0].h, L.rowH);
  assert.equal(r[0].alpha, 1);
  assert.equal(r[1].y, (64 - 62) * L.rowH);
});

test('a note is at least 2px wide', () => {
  const tiny = { kind: 'notes', notes: [{ s: 0, e: 1, p: 60, v: 127 }] };
  const r = noteRects(tiny, laneLayout(tiny, false), view);
  assert.equal(r[0].w, 2);
});

test('a note overlapping the left edge is kept', () => {
  const late = { start: 2400, fpp: view.fpp, width: 390 };
  const r = noteRects(melodic, laneLayout(melodic, false), late);
  assert.equal(r[0].x, -2400 / view.fpp);
});

test('drum ticks are 2px wide with velocity as height, sitting on the row floor', () => {
  const L = laneLayout(drums, false);
  const r = noteRects(drums, L, view);
  assert.equal(r.length, 3);
  const full = r[0], half = r[1];
  assert.equal(full.w, 2);
  assert.ok(Math.abs(full.h - L.rowH * (0.25 + 0.7)) < 1e-9);
  assert.ok(Math.abs(full.y + full.h - L.h) < 1e-9);          // pitch 36: bottom row, floor at h
  assert.ok(Math.abs(half.h - L.rowH * (0.25 + 0.7 * 64 / 127)) < 1e-9);
  assert.ok(Math.abs(half.y + half.h - L.rowH) < 1e-9);       // pitch 38: top row, floor at rowH
});

test('collapsed rects fill 15%..85% of the strip', () => {
  const L = laneLayout(melodic, true);
  const r = noteRects(melodic, L, view);
  assert.equal(r[0].y, 0.15 * LANE_H.collapsed);
  assert.equal(r[0].h, 0.7 * LANE_H.collapsed);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/static/lib/wave/lanes.test.js`
Expected: FAIL, `Cannot find module './lanes.js'`.

- [ ] **Step 3: Write the geometry**

```js
// web/static/lib/wave/lanes.js
// MIDI lanes under the waveform: one per (device, channel) track of the
// take's .mid, painted from the wave view's own viewport so a note sits
// exactly under its audio at every zoom. The geometry here is pure and
// tested; the Lanes class at the bottom owns the DOM and the canvases.
import { frameToX, gridLines } from './geometry.js';

export const LANE_H = { notes: 56, drums: 36, collapsed: 18 };
export const DRUM_COLOR = '#fbbf24';
export const MELODIC_COLORS = ['#34d399', '#3b9dd4', '#f87171', '#a78bfa'];
const MIN_ROW_PX = 4;
const MIN_NOTE_PX = 2;
const DRUM_TICK_PX = 2;

export function alphaFor(v) { return 0.3 + 0.7 * (v / 127); }

/** Drums are always amber; melodic tracks take the palette in order. */
export function laneColors(tracks) {
  let m = 0;
  return tracks.map((t) => (t.kind === 'drums' ? DRUM_COLOR : MELODIC_COLORS[m++ % MELODIC_COLORS.length]));
}

/**
 * Where the rows are for one lane. Melodic: one row per semitone across the
 * track's pitch range, hi at the top, C rows tinted. Drums: one row per
 * distinct pitch, lowest at the bottom. Collapsed: a bare strip.
 */
export function laneLayout(track, collapsed) {
  if (collapsed) return { h: LANE_H.collapsed, rows: [], rowH: LANE_H.collapsed, lo: 0, hi: 0, pitchRow: null };
  const ps = track.notes.map((n) => n.p);
  if (track.kind === 'drums') {
    const distinct = [...new Set(ps)].sort((a, b) => a - b);
    const n = Math.max(1, distinct.length);
    const rowH = LANE_H.drums / n;
    const pitchRow = new Map();
    // lowest pitch -> bottom row (index n-1)
    distinct.forEach((p, i) => pitchRow.set(p, n - 1 - i));
    const rows = Array.from({ length: n }, (_, i) => ({ top: i * rowH, h: rowH, tint: i % 2 === 1 }));
    return { h: LANE_H.drums, rows, rowH, lo: distinct[0] ?? 0, hi: distinct[n - 1] ?? 0, pitchRow };
  }
  const lo = ps.length ? Math.min(...ps) : 60;
  const hi = ps.length ? Math.max(...ps) : 60;
  const span = hi - lo + 1;
  const rowH = Math.max(MIN_ROW_PX, LANE_H.notes / span);
  const rows = [];
  for (let p = hi; p >= lo; p--) rows.push({ top: (hi - p) * rowH, h: rowH, tint: p % 12 === 0 });
  return { h: LANE_H.notes, rows, rowH, lo, hi, pitchRow: null };
}

/** Rects for the notes inside the view, in CSS px of the lane body. */
export function noteRects(track, layout, view) {
  const first = view.start;
  const last = view.start + view.width * view.fpp;
  const out = [];
  const collapsed = layout.rows.length === 0 && layout.pitchRow === null && layout.h === LANE_H.collapsed;
  for (const n of track.notes) {
    if (n.e < first || n.s > last) continue;
    const x = frameToX(n.s, view);
    const alpha = alphaFor(n.v);
    if (collapsed) {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: 0.15 * layout.h, h: 0.7 * layout.h, alpha });
    } else if (track.kind === 'drums') {
      const row = layout.pitchRow.get(n.p) ?? layout.rows.length - 1;
      const floor = (row + 1) * layout.rowH;
      const h = layout.rowH * (0.25 + 0.7 * (n.v / 127));
      out.push({ x, w: DRUM_TICK_PX, y: floor - h, h, alpha });
    } else {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: (layout.hi - n.p) * layout.rowH, h: layout.rowH, alpha });
    }
  }
  return out;
}
```

(The `Lanes` class is Task 7; leave the file ending here for now. `gridLines` is imported now so Task 7 does not touch the import line.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'web/static/lib/wave/*.test.js'`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/wave/lanes.js web/static/lib/wave/lanes.test.js
git commit -m "Lane geometry: rows, note rects and colours for the MIDI lanes"
```

---

### Task 7: The `Lanes` class, wired into the take page

**Files:**
- Modify: `web/static/lib/wave/lanes.js` (append the class)
- Modify: `web/static/lib/wave/page.js` (fetch, construct, draw, kind patch)
- Modify: `web/static/wave.html` (container)
- Modify: `web/static/styles.css` (lane styles, after the `#flag-sheet input` rule)
- Modify: `web/static/sw.js` (shell list, cache name)

**Interfaces:**
- Consumes: Task 6's functions; `gridLines(view, grid)`, `frameToX`; page `state` (`region`, `cursor`, `grid`), `view.view`.
- Produces:
  ```js
  new Lanes({ container, tracks, storageKey, getState, getView, onKindChange })
  lanes.draw(); lanes.setKind(name, kind); lanes.destroy();
  ```

- [ ] **Step 1: Append the class to `lanes.js`**

```js
// ---------------------------------------------------------------- DOM

const HOLD_MS = 500;
const HOLD_MOVE = 8;

/**
 * One card per track: a header (swatch, name, meta, chevron) and a canvas
 * body. Tap the header to collapse; hold it to flip drums/notes.
 */
export class Lanes {
  constructor({ container, tracks, storageKey, getState, getView, onKindChange }) {
    this.container = container;
    this.tracks = tracks;
    this.storageKey = storageKey;
    this.getState = getState;
    this.getView = getView;
    this.onKindChange = onKindChange;
    this.collapsed = {};
    try { this.collapsed = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    this.cards = [];
    this.raf = 0;
    this.ac = new AbortController();
    this.ro = new ResizeObserver(() => this.draw());
    this.build();
    this.ro.observe(container);
  }

  destroy() {
    this.ac.abort();
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.container.replaceChildren();
  }

  build() {
    this.container.replaceChildren();
    this.cards = [];
    const colors = laneColors(this.tracks);
    this.tracks.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'lane';
      const head = document.createElement('div');
      head.className = 'lane-head';
      const swatch = document.createElement('span');
      swatch.className = 'lane-swatch';
      swatch.style.background = colors[i];
      const name = document.createElement('span');
      name.className = 'lane-name';
      name.textContent = t.name;
      const meta = document.createElement('span');
      meta.className = 'lane-meta mono';
      const chev = document.createElement('span');
      chev.className = 'lane-chev';
      head.append(swatch, name, meta, chev);
      const body = document.createElement('canvas');
      body.className = 'lane-body';
      card.append(head, body);
      this.container.appendChild(card);
      const c = { track: t, color: colors[i], card, head, meta, chev, body, ctx: body.getContext('2d') };
      this.cards.push(c);
      this.wireHeader(c);
      this.applyCollapse(c);
    });
  }

  applyCollapse(c) {
    const collapsed = !!this.collapsed[c.track.name];
    c.card.classList.toggle('collapsed', collapsed);
    c.chev.textContent = collapsed ? '▸' : '▾';
    const kind = c.track.kind === 'drums' ? 'triggers' : 'piano roll';
    c.meta.textContent = `${c.track.notes.length} notes · ${kind}`;
    c.body.style.height = `${laneLayout(c.track, collapsed).h}px`;
  }

  wireHeader(c) {
    const sig = { signal: this.ac.signal };
    let hold = 0, held = false, x0 = 0, y0 = 0;
    c.head.addEventListener('pointerdown', (e) => {
      held = false; x0 = e.clientX; y0 = e.clientY;
      hold = setTimeout(() => {
        held = true;
        const kind = c.track.kind === 'drums' ? 'notes' : 'drums';
        this.setKind(c.track.name, kind);
        this.onKindChange?.(c.track.name, kind);
      }, HOLD_MS);
    }, sig);
    c.head.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > HOLD_MOVE) clearTimeout(hold);
    }, sig);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      c.head.addEventListener(ev, () => clearTimeout(hold), sig);
    }
    c.head.addEventListener('click', () => {
      if (held) { held = false; return; } // the hold already acted
      this.collapsed[c.track.name] = !this.collapsed[c.track.name];
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.collapsed)); } catch {}
      this.applyCollapse(c);
      this.draw();
    }, sig);
  }

  /** Flip a track's kind locally: colour, rows and meta follow. */
  setKind(name, kind) {
    const c = this.cards.find((k) => k.track.name === name);
    if (!c) return;
    c.track.kind = kind;
    const colors = laneColors(this.tracks);
    this.cards.forEach((k, i) => { k.color = colors[i]; k.head.querySelector('.lane-swatch').style.background = colors[i]; });
    this.applyCollapse(c);
    this.draw();
  }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  paint() {
    const view = this.getView();
    const st = this.getState();
    const dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(this.container);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;
    for (const c of this.cards) {
      const r = c.body.getBoundingClientRect();
      if (r.width <= 0) continue;
      const W = r.width, H = r.height;
      if (c.body.width !== Math.round(W * dpr) || c.body.height !== Math.round(H * dpr)) {
        c.body.width = Math.round(W * dpr); c.body.height = Math.round(H * dpr);
      }
      const ctx = c.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = col('--bg', '#0b1120');
      ctx.fillRect(0, 0, W, H);
      const layout = laneLayout(c.track, !!this.collapsed[c.track.name]);
      // Rows
      for (const row of layout.rows) {
        if (!row.tint) continue;
        ctx.fillStyle = col('--panel-2', '#1a2437');
        ctx.fillRect(0, row.top, W, row.h);
      }
      // Bar lines, from the same call the wave makes.
      for (const g of gridLines(view, st.grid)) {
        ctx.fillStyle = g.bar ? col('--line', '#26324a') : 'rgba(255,255,255,0.06)';
        ctx.fillRect(Math.round(frameToX(g.frame, view)), 0, 1, H);
      }
      // Notes
      ctx.fillStyle = c.color;
      for (const n of noteRects(c.track, layout, { ...view, width: W })) {
        ctx.globalAlpha = n.alpha;
        ctx.fillRect(n.x, n.y, n.w, n.h);
      }
      ctx.globalAlpha = 1;
      // Region: the wave's exact shade and edges.
      if (st.region) {
        const x0 = frameToX(st.region.start, view), x1 = frameToX(st.region.end, view);
        ctx.fillStyle = 'rgba(52,211,153,0.14)';
        ctx.fillRect(x0, 0, x1 - x0, H);
        ctx.fillStyle = col('--accent', '#34d399');
        for (const x of [x0, x1]) ctx.fillRect(Math.round(x) - 1, 0, 2, H);
      }
      // Cursor
      if (st.cursor != null) {
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.fillRect(Math.round(frameToX(st.cursor, view)), 0, 1, H);
      }
    }
  }
}
```

- [ ] **Step 2: Add the container to `wave.html`**

Between `<canvas id="wave-canvas" ...>` and `<div class="wave-row action">`:

```html
  <!-- One lane per MIDI track, built by lib/wave/lanes.js when the take has
       a .mid; stays empty and takes no space otherwise. -->
  <div id="lanes" class="lanes" hidden></div>
```

- [ ] **Step 3: Style the lanes**

Append to `styles.css`, before the `@media (min-width: 900px)` rule at the end:

```css
/* ---------- MIDI lanes ---------- */
/* Capped so four lanes never push the transport off a phone; scrolls inside. */
.lanes { display: flex; flex-direction: column; gap: 6px; max-height: 40vh; overflow-y: auto; }
.lane { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); overflow: hidden; flex: none; }
.lane-head {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px; min-height: 26px;
  cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  touch-action: manipulation;
}
.lane-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.lane-name { font-size: 12px; font-weight: 600; white-space: nowrap; }
.lane-meta { font-size: 10px; color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lane-chev { margin-left: auto; color: var(--ink-faint); font-size: 12px; }
.lane-body { display: block; width: 100%; border-top: 1px solid var(--panel-2); touch-action: pan-y; }
```

- [ ] **Step 4: Wire the page**

In `page.js`:

Add to the imports:

```js
import { Lanes } from './lanes.js';
```

After `overview = new Overview({...})` and before `const previewUrl`, declare:

```js
  // Lanes arrive after the page is up: a take without MIDI never blocks on
  // them, and a take with MIDI paints its wave first.
  let lanes = null;
```

Change `redraw()` to:

```js
  function redraw() { view.draw(); if (overview) overview.draw(); if (lanes) lanes.draw(); }
```

In `emit`, the `viewChange` case becomes:

```js
      case 'viewChange': if (overview) overview.draw(); if (lanes) lanes.draw(); break;
```

(`regionChange` and `seek` already call `redraw()`, and the clock's `onTick` calls `redraw()`, so those paths are covered.)

After `view.fitAll();` near the bottom of `main()`, add:

```js
  loadLanes();
```

and define, just above the `// --- keyboard` section:

```js
  // --- MIDI lanes -----------------------------------------------------------
  async function loadLanes() {
    let res;
    try {
      res = await fetch(`/api/midi?file=${encodeURIComponent(file)}`);
    } catch {
      toast('Could not load MIDI', 'bad');
      return;
    }
    if (res.status === 404) return; // no MIDI beside this take: nothing to show
    if (res.status === 422) {
      const t = document.createElement('div');
      t.className = 'toast bad';
      t.append('This take\'s MIDI file does not decode. ');
      const a = document.createElement('a');
      a.href = `/api/download?file=${encodeURIComponent(take.midi_name || file.replace(/\.wav$/, '.mid'))}&dl=1`;
      a.textContent = 'Download the raw .mid';
      t.appendChild(a);
      $('toasts').appendChild(t);
      setTimeout(() => t.remove(), 8000);
      return;
    }
    if (!res.ok) { toast('Could not load MIDI', 'bad'); return; }
    const notes = await res.json();
    if (!notes.tracks || !notes.tracks.length) return;
    const container = $('lanes');
    container.hidden = false;
    lanes = new Lanes({
      container,
      tracks: notes.tracks,
      storageKey: `wave.lanes.${file}`,
      getState: () => state,
      getView: () => view.view,
      onKindChange: (name, kind) => {
        laneKinds[name] = kind;
        patch({ lane_kinds: laneKinds }).catch((e) => toast(`Could not save lane kind: ${e.message}`, 'bad'));
      },
    });
    lanes.draw();
  }
  const laneKinds = { ...(take.lane_kinds || {}) };
```

Add `if (lanes) lanes.destroy();` to the `pagehide` handler's teardown list.

- [ ] **Step 5: Add `lanes.js` to the service worker shell**

In `sw.js`: change `const CACHE = 'hindsight-shell-v4';` to `'hindsight-shell-v5'` and add `'/lib/wave/lanes.js',` after `'/lib/wave/share.js',`.

- [ ] **Step 6: Check it in demo mode**

```bash
RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight-lanes PORT=15173 CGO_ENABLED=0 go run ./cmd/hindsight --demo
```

Wait 20 s, then `curl -X POST 'http://127.0.0.1:15173/api/trigger?seconds=10'`, open `http://127.0.0.1:15173/wave.html?file=<name from the response>` in a browser at 390px wide. Verify: lanes appear under the wave; pinch or wheel zoom keeps notes under their audio; a region shades both; Play moves the cursor in both; tapping a header collapses it; holding a header flips the meta text between "piano roll" and "triggers" and the swatch colour changes; reloading keeps the collapse and the kind. `curl 'http://127.0.0.1:15173/api/jams' | jq '.[0].lane_kinds'` shows the override.

- [ ] **Step 7: Run all tests and commit**

Run: `node --test 'web/static/lib/wave/*.test.js' && CGO_ENABLED=0 go test ./...`
Expected: PASS.

```bash
git add web/static/lib/wave/lanes.js web/static/lib/wave/page.js web/static/wave.html web/static/styles.css web/static/sw.js
git commit -m "Draw the take's MIDI as lanes under the waveform"
```

---

### Task 8: The action row: Share MP3 with its length, and the DAW bundle

**Files:**
- Modify: `web/static/wave.html` (the `.wave-row.action` block)
- Modify: `web/static/lib/wave/share.js` (`shareOrDownload` type parameter)
- Modify: `web/static/lib/wave/page.js` (`updateActionRow`, share label, bundle handler)
- Modify: `web/static/styles.css` (860px rule)
- Test: `web/static/lib/wave/share.test.js`

**Interfaces:**
- Consumes: `fmtTime(frame, sampleRate)` from `./geometry.js`; `GET /api/bundle`.
- Produces: `shareOrDownload(blob, filename, title, type = 'audio/mpeg')`.

- [ ] **Step 1: Write the failing test**

Append to `web/static/lib/wave/share.test.js` (read the file's existing fakes for `navigator.share` first and reuse them):

```js
test('shareOrDownload shares a zip with the type it is given', async () => {
  const seen = [];
  globalThis.isSecureContext = true;
  globalThis.navigator = {
    canShare: () => true,
    share: async ({ files }) => { seen.push(files[0].type); },
  };
  globalThis.File = class { constructor(parts, name, opts) { this.name = name; this.type = opts.type; } };
  const r = await shareOrDownload(new Blob(['x']), 'a.zip', 'a', 'application/zip');
  assert.equal(r, 'shared');
  assert.deepEqual(seen, ['application/zip']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test web/static/lib/wave/share.test.js`
Expected: FAIL, `seen` is `['audio/mpeg']`.

- [ ] **Step 3: Thread the type through `shareOrDownload`**

In `share.js`:

```js
export async function shareOrDownload(blob, filename, title, type = 'audio/mpeg') {
  if (canShareFiles()) {
    try {
      const file = new File([blob], filename, { type });
```

(the rest unchanged).

- [ ] **Step 4: Rebuild the action row**

In `wave.html`, replace the `.wave-row.action` block with:

```html
  <div class="wave-row action">
    <button id="play" class="icon-btn" type="button">Play</button>
    <button id="bundle" class="icon-btn" type="button">DAW bundle</button>
    <button id="share" class="icon-btn primary" type="button">Share MP3</button>
    <button id="region-clear" class="region-x" type="button" aria-label="Clear region" hidden>×</button>
  </div>
```

In `page.js`:

- Add `fmtTime` to the `./geometry.js` import if it is not already there (it is: `barBeat, fmtTime, ...`).
- Delete the line in `updateActionRow` that sets `$('region-text').textContent` and add at the end of `updateActionRow`:

```js
    setShareLabel();
```

- Replace the `shareLabel` constant and the `shareBtn.textContent = shareLabel;` line with:

```js
  const shareVerb = canShareFiles() ? 'Share' : 'Download';
  function setShareLabel() {
    const r = state.region;
    shareBtn.textContent = `${shareVerb} MP3 · ${r ? fmtTime(r.end - r.start, sr) : 'whole take'}`;
  }
```

  and in the share handler's `finally`, replace `shareBtn.textContent = shareLabel;` with `setShareLabel();`. Where the handler says `if (result === 'downloaded' && shareLabel === 'Share')`, use `shareVerb`.

- Add the bundle handler after the share handler:

```js
  // --- DAW bundle -------------------------------------------------------------
  // The region as a DAW opens it: WAV plus the re-based MIDI, in one zip.
  const bundleBtn = $('bundle');
  const wide = window.matchMedia('(min-width: 860px)');
  function setBundleLabel() { bundleBtn.textContent = wide.matches ? 'Download DAW bundle' : 'DAW bundle'; }
  setBundleLabel();
  wide.addEventListener('change', setBundleLabel);
  bundleBtn.addEventListener('click', async () => {
    if (!state.region && total > MAX_SHARE_SECONDS * sr) {
      toast(`Pick a region first — the whole take is over ${MAX_SHARE_SECONDS / 60} minutes`, 'bad');
      return;
    }
    const from = state.region ? state.region.start : 0;
    const to = state.region ? state.region.end : total;
    bundleBtn.disabled = true;
    bundleBtn.textContent = 'Bundling…';
    try {
      const res = await fetch(`/api/bundle?file=${encodeURIComponent(file)}&from=${from}&to=${to}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `status ${res.status}`);
      }
      const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      const filename = m ? m[1] : `${safeStem(take.label || file.replace(/\.wav$/, ''))}.zip`;
      const blob = await res.blob();
      if (blob.size < 100) throw new Error('bundle failed, try again');
      await shareOrDownload(blob, filename, filename.replace(/\.zip$/, ''), 'application/zip');
      if (res.headers.get('X-Hindsight-Midi') === 'none') toast('Bundled the audio only — this take has no MIDI');
    } catch (e) {
      toast(`Bundle failed: ${e.message}`, 'bad');
    } finally {
      bundleBtn.disabled = false;
      setBundleLabel();
    }
  });
```

- [ ] **Step 5: Flip the primary at 860px**

Append to `styles.css`, after the lane rules:

```css
/* On a bench-sized screen the DAW is the destination and the MP3 the
   afterthought; on a phone it is the other way round. Same buttons, same
   places, only the weight moves. */
.wave-row.action #share { flex: 1.4; }
.wave-row.action #bundle { flex: 1; color: var(--ink-dim); }
@media (min-width: 860px) {
  .wave-row.action #bundle { flex: 1.5; background: var(--accent-dk); color: var(--ink); border-color: var(--accent-dk); }
  .wave-row.action #share { flex: 1; background: var(--panel); color: var(--ink-dim); border-color: var(--line); }
}
```

Check `.icon-btn` (line 619) sets `flex: none` or similar; if it does, the `flex` values above need `!important` or a more specific selector, so prefer the id selectors shown, which already win on specificity.

- [ ] **Step 6: Check it in demo mode**

Same demo as Task 7. At 390px: Play, "DAW bundle", "Share MP3 · whole take"; select a region and the share label shows its length; tap DAW bundle and a zip downloads whose name matches the label; unzip it and confirm three files, and that the `.wav` opens. At 1024px: the bundle button is green and reads "Download DAW bundle", Share MP3 is grey. Delete `/tmp/hindsight-lanes/*.mid` for one take and confirm the toast says the zip has no MIDI.

- [ ] **Step 7: Run all tests and commit**

Run: `node --test 'web/static/lib/wave/*.test.js' && CGO_ENABLED=0 go test ./...`

```bash
git add web/static/wave.html web/static/lib/wave/share.js web/static/lib/wave/share.test.js web/static/lib/wave/page.js web/static/styles.css
git commit -m "Share MP3 says how long it is; DAW bundle beside it, leading on a wide screen"
```

---

### Task 9: Docs, and the Pi

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/configuration.md` only if it lists sidecar fields (grep `downbeat_frame` to find out)
- Modify: `README.md` only where it lists the take page's buttons (grep `Share`)

- [ ] **Step 1: Document the endpoints**

In `docs/api.md`, change "Fourteen routes" to "Sixteen routes" in the opening line, add two rows to the table after `/api/render`:

```markdown
| `GET /api/midi?file=` | The take's `.mid` decoded to notes in frames, one track per device and channel, for the lanes |
| `GET /api/bundle?file=&from=&to=` | A zip of the region: WAV with the cut's fades, the MIDI re-based to it, and its manifest |
```

Add `lane_kinds` to the PATCH field table:

```markdown
| `lane_kinds` | `{"<track name>": "drums"\|"notes"}` or `null` | A full replacement of the take's per-lane overrides for `GET /api/midi`'s drum guess. At most 64 entries; keys sanitized like labels; `null` clears |
```

Add two sections after `## GET /api/render`:

````markdown
## `GET /api/midi?file=`

The take's `.mid` decoded server-side into notes on the take's frame
timeline, so the take page draws lanes with the same math it draws the
waveform with.

```json
{
  "ppq": 960, "sample_rate": 48000, "frames": 1440000,
  "tempo": [{ "frame": 0, "bpm": 82 }],
  "downbeat_frame": 0,
  "tracks": [
    { "name": "bento ch1", "device": "bento", "channel": 1, "kind": "drums",
      "notes": [{ "s": 4800, "e": 9600, "p": 36, "v": 100 }] }
  ]
}
```

`s` and `e` are start and end frames, `p` the pitch, `v` the velocity. Notes
are sorted by `s`; a note still sounding at the end of the file ends at the
take's last frame. `kind` is `drums` for channel 10, or for a track with at
most 16 distinct pitches whose notes are mostly shorter than a quarter of a
beat; the sidecar's `lane_kinds` overrides it per track. Served immutable,
like peaks: a take's `.mid` never changes.

| Status | When |
|---|---|
| 400 | Missing or bad `file` |
| 404 | No such take, or no `.mid` beside it |
| 422 | The `.mid` does not decode |

## `GET /api/bundle?file=&from=&to=`

Streams frames `[from, to)` as a zip a DAW opens in one drop:
`<stem>.wav` at the take's native 32-bit depth with the cut's 3ms fades,
`<stem>.mid` re-based so the region's first frame is tick 0 with the tempo
lane over that stretch, and `<stem>.manifest.json`. Nothing is written to
disk. Named `<label or stem> <m.ss>-<m.ss>.zip`, or `<label or stem>.zip`
for the whole take. A take without a `.mid` bundles the WAV alone and the
response carries `X-Hindsight-Midi: none`.

| Status | When |
|---|---|
| 400 | Bad `file`, non-integer or inverted frames, past the end, over 10 minutes, shorter than two fades, or a non-32-bit take |
| 404 | No such take |
````

- [ ] **Step 2: Deploy to the Pi and check a real take**

```bash
./deploy.sh
```

(Go changed, so the full deploy.) Then on the phone, open a take that has MIDI (any capture since 2026-09-15 with bento playing): lanes show `bento ch1..ch4` with the drums track amber. Hold a header to flip a mis-guessed lane. Tap DAW bundle, share the zip to the laptop, drop the WAV and MID into GarageBand at bar 1 and confirm they line up.

- [ ] **Step 3: Commit**

```bash
git add docs/api.md
git commit -m "Document GET /api/midi, GET /api/bundle and lane_kinds"
```

---

## Self-review

**Spec coverage.** Notes endpoint: Tasks 1, 3. Drum classification: Task 1. Sidecar field and PATCH: Task 2. Lanes module, rows, colours, collapse, region and cursor: Tasks 6, 7. Kind override from a long-press: Task 7. DAW bundle and the `RegionMIDI` refactor: Tasks 4, 5. Action row and 860px flip: Task 8. Errors (404 silent, 422 with link, bundle toast, PATCH failure toast): Tasks 7, 8. Testing (Go tables, Node geometry, demo, Pi): every task's steps 1 and 6, and Task 9. Docs: Task 9. Out of scope items are absent.

**Type consistency.** `bundle.Note{S,E,P,V}`, `NoteTrack{Name,Device,Channel,Kind,Notes}`, `RegionMIDI(srcWav, dstName, start, end) ([]byte, *Manifest, error)`, `audio.WriteRegion32(w, path, from, to)`, `Lanes({container, tracks, storageKey, getState, getView, onKindChange})`, `shareOrDownload(blob, filename, title, type)` are spelled the same in every task that uses them.

**Known checks left to the implementer**, each called out inline: the spelling of `smf.MetaTrackName`; whether `writeRealTake` writes a 32-bit header; the name of `cut_test.go`'s real-take helper; whether `RenderFilename` with `whole=true` ignores the frames; whether the PATCH response encodes the whole `Meta`.
