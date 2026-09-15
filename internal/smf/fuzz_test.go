package smf

import "testing"

// FuzzDecode feeds arbitrary bytes to the decoder: it must return an error
// or a file, never panic, and anything it does decode must re-encode and
// decode again to the same event list.
func FuzzDecode(f *testing.F) {
	valid := &File{Tracks: []Track{
		{Events: []Event{TrackName(0, "c"), TimeSignature(0, 4, 4), Tempo(0, 500000), Marker(960, "m")}},
		{Events: []Event{TrackName(0, "n ch1"), Channel(0, 0x90, 60, 100), Channel(480, 0x80, 60, 0), Channel(480, 0xC0, 3, 0)}},
	}}
	f.Add(valid.Encode())
	f.Add([]byte("MThd\x00\x00\x00\x06\x00\x01\x00\x01\x03\xc0MTrk\x00\x00\x00\x04\x00\xff\x2f\x00"))
	f.Add([]byte("MThd"))
	f.Fuzz(func(t *testing.T, in []byte) {
		file, err := Decode(in)
		if err != nil {
			return
		}
		again, err := Decode(file.Encode())
		if err != nil {
			t.Fatalf("re-decode: %v", err)
		}
		if len(again.Tracks) != len(file.Tracks) {
			t.Fatalf("tracks %d -> %d", len(file.Tracks), len(again.Tracks))
		}
		for i := range file.Tracks {
			a, b := file.Tracks[i].Events, again.Tracks[i].Events
			// The encoder appends its own end-of-track, so compare
			// everything before it.
			for len(a) > 0 && a[len(a)-1].Meta == MetaEndOfTrack && a[len(a)-1].IsMeta() {
				a = a[:len(a)-1]
			}
			for len(b) > 0 && b[len(b)-1].Meta == MetaEndOfTrack && b[len(b)-1].IsMeta() {
				b = b[:len(b)-1]
			}
			if len(a) != len(b) {
				t.Fatalf("track %d: %d events -> %d", i, len(a), len(b))
			}
			for j := range a {
				if a[j].Tick != b[j].Tick || a[j].Status != b[j].Status || a[j].Meta != b[j].Meta ||
					a[j].D1&0x7F != b[j].D1 || (dataBytes(a[j].Status) == 2 && a[j].D2&0x7F != b[j].D2) {
					t.Fatalf("track %d event %d: %+v -> %+v", i, j, a[j], b[j])
				}
			}
		}
	})
}
