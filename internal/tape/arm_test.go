package tape

import (
	"encoding/json"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
)

// Multi-arm (docs/superpowers/specs/2026-10-15-rig-design.md): RecTracks
// replaces RecTrack, which is still kept as the first armed track so older
// pages read and write it as they always did.

// loadFixture puts a tape.json written before multi-arm into a store, edited
// by fix, and loads it.
func loadFixture(t *testing.T, name string, fix func(string) string) *Tape {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	s := newTestStore(t)
	var probe struct{ ID string }
	json.Unmarshal(b, &probe)
	dir := filepath.Join(s.Dir(), "tapes", probe.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tape.json"), []byte(fix(string(b))), 0o644); err != nil {
		t.Fatal(err)
	}
	tp, err := s.Load(probe.ID)
	if err != nil {
		t.Fatal(err)
	}
	return tp
}

func same(s string) string { return s }

func TestATapeWrittenBeforeMultiArmLoadsWithItsTrackArmed(t *testing.T) {
	// Written by the code before rec_tracks: rec_track 3.
	tp := loadFixture(t, "tape-rec-track-3.json", same)
	if !slices.Equal(tp.RecTracks, []int{3}) || tp.RecTrack != 3 {
		t.Fatalf("rec_track 3 loaded as RecTracks %v RecTrack %d, want [3] and 3", tp.RecTracks, tp.RecTrack)
	}
	if got := strings.Join(tp.Inputs, ","); got != ",ch1,ch2" {
		t.Fatalf("inputs %q", got)
	}
	// None armed: -1.
	tp = loadFixture(t, "tape-none-armed.json", same)
	if len(tp.RecTracks) != 0 || tp.RecTrack != NoRecTrack {
		t.Fatalf("rec_track -1 loaded as RecTracks %v RecTrack %d, want none", tp.RecTracks, tp.RecTrack)
	}
	// Never chosen: rec_track absent was track 1.
	tp = loadFixture(t, "tape-rec-track-3.json", func(s string) string { return strings.Replace(s, ` "rec_track": 3,`+"\n", "", 1) })
	if !slices.Equal(tp.RecTracks, []int{1}) || tp.RecTrack != 1 {
		t.Fatalf("no rec_track loaded as RecTracks %v RecTrack %d, want [1] and 1", tp.RecTracks, tp.RecTrack)
	}
	// A track the tape doesn't have is dropped.
	tp = loadFixture(t, "tape-rec-track-3.json", func(s string) string {
		return strings.Replace(s, ` "rec_track": 3,`, ` "rec_track": 3, "rec_tracks": [2, 9, 2],`, 1)
	})
	if !slices.Equal(tp.RecTracks, []int{2}) || tp.RecTrack != 2 {
		t.Fatalf("rec_tracks [2 9 2] loaded as %v / %d, want [2] and 2", tp.RecTracks, tp.RecTrack)
	}
}

func TestArmingKeepsTheFirstArmedTrackAsRecTrack(t *testing.T) {
	tp := NewTape("x", "x", 48000, 48000*60, 4, time.Now())
	if !slices.Equal(tp.Armed(), []int{1}) {
		t.Fatalf("a new tape arms %v, want track 1 as before", tp.Armed())
	}
	if err := tp.SetArmed([]int{3, 2, 3}); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(tp.RecTracks, []int{2, 3}) || tp.RecTrack != 2 {
		t.Fatalf("armed %v rec_track %d, want [2 3] and 2", tp.RecTracks, tp.RecTrack)
	}
	b, _ := json.Marshal(tp)
	var raw map[string]any
	json.Unmarshal(b, &raw)
	if raw["rec_track"] != float64(2) || len(raw["rec_tracks"].([]any)) != 2 {
		t.Fatalf("written as rec_track %v rec_tracks %v", raw["rec_track"], raw["rec_tracks"])
	}
	if err := tp.SetArmed(nil); err != nil || tp.RecTrack != NoRecTrack || len(tp.RecTracks) != 0 {
		t.Fatalf("none armed: %v %d %v", err, tp.RecTrack, tp.RecTracks)
	}
	if err := tp.SetArmed([]int{5}); err == nil {
		t.Fatal("arming a track the tape doesn't have should be refused")
	}
	// What an older page writes still means one track.
	tp.SetRecTrack(4)
	if !slices.Equal(tp.RecTracks, []int{4}) {
		t.Fatalf("rec_track 4 arms %v, want just [4]", tp.RecTracks)
	}
	tp.SetRecTrack(NoRecTrack)
	if len(tp.RecTracks) != 0 {
		t.Fatalf("rec_track -1 leaves %v armed", tp.RecTracks)
	}
}

// busAAt is what the test loop's bus A carries for a constant 0.5 clip on
// track 1 at its -6 dB: CH1's tap hears exactly that.
func playedOnBusA(t *testing.T, data []int32, at int64) bool {
	t.Helper()
	want := 0.5 * math.Pow(10, DefaultTrackGainDB/20.0)
	got := float64(data[2*at]) / 2147483647
	return math.Abs(got-want) < 0.01
}

func TestACatchFillsEveryArmedTrackFromItsOwnInputAsOneUndo(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 96000*3+2000)
	undo0, _ := e.UndoDepth()
	res, err := e.CatchPairs(tp.ID, CatchRequest{Pass: 1, Pairs: []Pair{{Track: 2, Source: "aux"}, {Track: 3, Source: "ch1"}}})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.Tracks, []int{2, 3}) || len(res.Clips) != 2 {
		t.Fatalf("caught onto %v (%d clips), want tracks 2 and 3", res.Tracks, len(res.Clips))
	}
	loaded := e.Loaded()
	t2, t3 := loaded.Tracks[1].Clips, loaded.Tracks[2].Clips
	if len(t2) != 1 || len(t3) != 1 {
		t.Fatalf("track 2 has %d clips, track 3 %d; want one each", len(t2), len(t3))
	}
	// One span: both where the pass was played.
	if t2[0].At != 0 || t3[0].At != 0 || t2[0].Frames != 96000 || t3[0].Frames != 96000 {
		t.Fatalf("clips %+v and %+v, want the same pass", t2[0], t3[0])
	}
	// Each from its own input: aux is the instrument, CH1's tap the tape's
	// bus A -- and so not clean.
	if t2[0].Source != "aux" || !t2[0].Clean || t3[0].Source != "ch1" || t3[0].Clean {
		t.Fatalf("sources %s/%v and %s/%v", t2[0].Source, t2[0].Clean, t3[0].Source, t3[0].Clean)
	}
	d2 := readPool(t, e.store, t2[0].File)
	if d2[2*t2[0].Src] != auxAt(192000) {
		t.Fatalf("track 2 holds ring frame %d, want aux from 192000", d2[2*t2[0].Src]/1000)
	}
	d3 := readPool(t, e.store, t3[0].File)
	if !playedOnBusA(t, d3, t3[0].Src) {
		t.Fatalf("track 3 holds %d, want what bus A played into CH1", d3[2*t3[0].Src])
	}
	// One undo step, and one undo takes both off.
	if u, _ := e.UndoDepth(); u != undo0+1 {
		t.Fatalf("undo depth %d → %d, want one step", undo0, u)
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if l := e.Loaded(); len(l.Tracks[1].Clips) != 0 || len(l.Tracks[2].Clips) != 0 {
		t.Fatal("one undo should take both catches off")
	}
}

func TestCatchingTheLastBarsFillsEveryArmedTrackAndTwoTracksCanShareATap(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 192000, 1, 4, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 192000+64000)
	res, err := e.CatchPairs(tp.ID, CatchRequest{Bars: 2, Pairs: []Pair{{Track: 2, Source: "aux"}, {Track: 4, Source: "aux"}}})
	if err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	// Across the seam: two pieces on each track, the same file on both.
	if len(l.Tracks[1].Clips) != 2 || len(l.Tracks[3].Clips) != 2 || !slices.Equal(res.Tracks, []int{2, 4}) {
		t.Fatalf("track 2 %d clips, track 4 %d; want the catch split on both", len(l.Tracks[1].Clips), len(l.Tracks[3].Clips))
	}
	if l.Tracks[1].Clips[0].File != l.Tracks[3].Clips[0].File {
		t.Fatal("two tracks on one tap should share its one recording")
	}
}

func TestCatchRefusesTwoInputsForOneTrack(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1})
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 96000*2+2000)
	if _, err := e.CatchPairs(tp.ID, CatchRequest{Pass: 1, Pairs: []Pair{{Track: 2, Source: "aux"}, {Track: 2, Source: "ch1"}}}); err == nil {
		t.Fatal("two inputs onto one track should be refused")
	}
	if _, err := e.CatchPairs(tp.ID, CatchRequest{Pass: 1, Pairs: []Pair{{Track: 2, Source: "aux"}, {Track: 3, Source: "nope"}}}); err == nil {
		t.Fatal("an unknown input should be refused, and nothing caught")
	}
	if n := len(e.Loaded().Tracks[1].Clips); n != 0 {
		t.Fatalf("a refused catch left %d clips on track 2", n)
	}
}

func TestAPunchRecordsEveryArmedTrackFromItsOwnInputAsOneUndo(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 30000)
	r, err := e.RecordPairs(tp.ID, []Pair{{Track: 2, Source: "aux"}, {Track: 3, Source: "ch1"}}, false)
	if err != nil || r.State != "on" || r.Track != 2 || r.Source != "aux" || len(r.Pairs) != 2 {
		t.Fatalf("Record = %+v %v, want on, track 2 first, both pairs", r, err)
	}
	sink.play(t, 96000*3)
	undo0, _ := e.UndoDepth()
	kept, err := e.EndRecording(tp.ID, false)
	if err != nil || kept == nil {
		t.Fatal(err)
	}
	if kept.Track != 2 || !slices.Equal(kept.Tracks, []int{2, 3}) || len(kept.Clips) != 2 {
		t.Fatalf("kept %+v, want tracks 2 and 3", kept)
	}
	l := e.Loaded()
	a, b := l.Tracks[1].Clips, l.Tracks[2].Clips
	if len(a) != 1 || len(b) != 1 || a[0].At != b[0].At || a[0].Frames != b[0].Frames || a[0].Frames != 96000 {
		t.Fatalf("track 2 %+v, track 3 %+v: want the same pass on both", a, b)
	}
	if d := readPool(t, e.store, a[0].File); d[2*a[0].Src] != auxAt(192000) {
		t.Fatalf("track 2 kept ring frame %d, want aux from 192000", d[2*a[0].Src]/1000)
	}
	if d := readPool(t, e.store, b[0].File); !playedOnBusA(t, d, b[0].Src) {
		t.Fatal("track 3 should hold what CH1 heard: bus A")
	}
	if u, _ := e.UndoDepth(); u != undo0+1 {
		t.Fatalf("undo depth %d → %d, want one step", undo0, u)
	}
	// ● armed while stopped, then ▶: both tracks again.
	e.Undo(tp.ID, false)
	if l := e.Loaded(); len(l.Tracks[1].Clips)+len(l.Tracks[2].Clips) != 0 {
		t.Fatal("one undo should take both parts off")
	}
}

func TestArmingSeveralTracksThenPlayingCountsInAndRecordsThemAll(t *testing.T) {
	e, sink, tp := tempoEngine(t, 4)
	e.SetMeta(tp.ID, func(t *Tape) error { t.Click = false; return nil })
	if r, err := e.RecordPairs(tp.ID, []Pair{{Track: 1, Source: "aux"}, {Track: 4, Source: "main"}}, false); err != nil || r.State != "armed" {
		t.Fatalf("Record while stopped = %+v %v, want armed", r, err)
	}
	if _, err := e.Transport(tp.ID, Action{Kind: "play"}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	sink.play(t, 96000+1000)
	sink.play(t, 96000*2+30000)
	kept, err := e.Transport(tp.ID, Action{Kind: "stop"})
	if err != nil || kept == nil {
		t.Fatalf("stop = %v %v", kept, err)
	}
	if !slices.Equal(kept.Tracks, []int{1, 4}) {
		t.Fatalf("kept onto %v, want 1 and 4", kept.Tracks)
	}
	l := e.Loaded()
	if len(l.Tracks[0].Clips) != 1 || len(l.Tracks[3].Clips) != 1 || l.Tracks[3].Clips[0].Source != "main" {
		t.Fatalf("track 1 %+v, track 4 %+v", l.Tracks[0].Clips, l.Tracks[3].Clips)
	}
}

func TestTwoTapsMakeTheFirstLoopOnEveryArmedTrack(t *testing.T) {
	s := newTestStore(t)
	c := &fakeCap{ring: audio.NewRing(48000*20, 8), bridge: audio.NewClockBridge(1024, 48000)}
	t0 := mono.Now() - int64(8*time.Second)
	for f := int64(0); f <= 8*48000; f += 2048 {
		c.bridge.Record(t0+f*1e9/48000, uint64(f))
	}
	r := rand.New(rand.NewSource(7))
	in := make([]int32, 8*48000*8)
	for _, hit := range []int{48000, 168000} {
		for i := 0; i < 4000; i++ {
			v := int32((r.Float64() - 0.5) * math.Exp(-float64(i)/500) * 1.6e9)
			in[(hit+i)*8+6], in[(hit+i)*8+7] = v, v     // aux
			in[(hit+i)*8+4], in[(hit+i)*8+5] = v/2, v/2 // CH2, quieter
		}
	}
	c.ring.WriteFrames(in)
	e := NewEngine(Options{Store: s, Capture: c})
	tp, _ := s.Create("free", 0, 0, time.Now())
	e.Load(tp.ID)
	at := func(f int64) int64 { return t0 + f*1e9/48000 }
	pairs := []Pair{{Track: 1, Source: "aux"}, {Track: 2, Source: "ch2"}}
	if res, err := e.TapPairs(tp.ID, pairs, at(48000+4800)); err != nil || res.Stage != "first" {
		t.Fatalf("first tap = %+v %v", res, err)
	}
	undo0, _ := e.UndoDepth()
	res, err := e.TapPairs(tp.ID, pairs, at(168000-1440))
	if err != nil || res.Stage != "loop" {
		t.Fatalf("second tap = %+v %v", res, err)
	}
	l := e.Loaded()
	a, b := l.Tracks[0].Clips, l.Tracks[1].Clips
	if len(a) != 1 || len(b) != 1 || a[0].Frames != b[0].Frames || a[0].Source != "aux" || b[0].Source != "ch2" {
		t.Fatalf("track 1 %+v, track 2 %+v: want the same loop on both, each from its own input", a, b)
	}
	if !slices.Equal(res.Tracks, []int{1, 2}) {
		t.Fatalf("tap answered tracks %v", res.Tracks)
	}
	if u, _ := e.UndoDepth(); u != undo0+1 {
		t.Fatalf("undo depth %d → %d, want one step", undo0, u)
	}
	da, db := readPool(t, e.store, a[0].File), readPool(t, e.store, b[0].File)
	if da[2*a[0].Src] == 0 || db[2*b[0].Src] != da[2*a[0].Src]/2 {
		t.Fatalf("track 2 should hold CH2's half of the hit: %d vs %d", db[2*b[0].Src], da[2*a[0].Src])
	}
}
