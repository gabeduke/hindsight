package tape

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

// Store.Load reads a tape.json once. It used to decode the whole file a
// second time, only to learn whether "rec_tracks" was in it: +60% on every
// load, and a load is what GET /api/tapes does for every tape on the Pi.

// BenchmarkStoreLoad is Store.Load of a tape with a long undo history, the
// shape that makes the file large.
func BenchmarkStoreLoad(b *testing.B) {
	s, err := OpenStore(b.TempDir(), 48000, 4, 60)
	if err != nil {
		b.Fatal(err)
	}
	tp, err := s.Create("Bench", 96, 4, time.Now())
	if err != nil {
		b.Fatal(err)
	}
	for tr := range tp.Tracks {
		for i := 0; i < 8; i++ {
			tp.Tracks[tr].Clips = append(tp.Tracks[tr].Clips, Clip{
				ID: fmt.Sprintf("c%d-%d", tr, i), File: fmt.Sprintf("audio/catch_%d_%d.wav", tr, i),
				Frames: 48000, At: int64(i) * 48000, GainDB: -3, Source: "ch1",
			})
		}
	}
	for i := 0; i < 100; i++ {
		tp.History = append(tp.History, tp.State.clone())
	}
	if err := s.Save(tp); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Load(tp.ID); err != nil {
			b.Fatal(err)
		}
	}
}

// What a tape.json's "rec_tracks" says is one of four things, and the second
// and third are not the same: a list, an empty list (the person disarmed
// everything), null and no key at all (written before there could be several:
// "rec_track" says which). Load tells them apart from the one decode.
func TestLoadTellsAnEmptyRecTracksFromNoRecTracks(t *testing.T) {
	// The fixture is a pre-multi-arm tape with "rec_track": 3.
	with := func(rt string) func(string) string {
		return func(s string) string {
			return strings.Replace(s, ` "rec_track": 3,`, ` "rec_track": 3, "rec_tracks": `+rt+`,`, 1)
		}
	}
	cases := []struct {
		name      string
		fix       func(string) string
		want      []int
		wantFirst int
	}{
		{"a list is the armed tracks, and rec_track is ignored", with("[2, 4]"), []int{2, 4}, 2},
		{"an empty list is none armed, whatever rec_track says", with("[]"), nil, NoRecTrack},
		{"null is no rec_tracks: rec_track says", with("null"), []int{3}, 3},
		{"no key is no rec_tracks: rec_track says", same, []int{3}, 3},
	}
	for _, c := range cases {
		tp := loadFixture(t, "tape-rec-track-3.json", c.fix)
		if !slices.Equal(tp.RecTracks, c.want) || tp.RecTrack != c.wantFirst {
			t.Errorf("%s: loaded as RecTracks %v RecTrack %d, want %v and %d", c.name, tp.RecTracks, tp.RecTrack, c.want, c.wantFirst)
		}
	}
}
