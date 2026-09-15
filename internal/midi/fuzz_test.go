package midi

import "testing"

// FuzzParser feeds arbitrary bytes through the parser. The properties: it
// never panics, every emitted message has a status byte and 7-bit data, and
// every realtime byte reported really was a realtime byte.
func FuzzParser(f *testing.F) {
	f.Add([]byte{0x90, 60, 100, 0x80, 60, 0})
	f.Add([]byte{0x90, 0xF8, 60, 0xF8, 100})
	f.Add([]byte{0xF0, 0x7E, 0x7F, 0x09, 0x01, 0xF7, 0x90, 60, 100})
	f.Add([]byte{0xF2, 0x10, 0x20, 61, 50})
	f.Add([]byte{0xC1, 5, 0xD1, 99, 0xE0, 0x00, 0x40})
	f.Fuzz(func(t *testing.T, in []byte) {
		p := &Parser{
			OnMessage: func(s, d1, d2 byte) {
				if s < 0x80 || s == 0xF0 || s == 0xF7 || s >= 0xF8 {
					t.Fatalf("emitted status %#x", s)
				}
				if d1&0x80 != 0 || d2&0x80 != 0 {
					t.Fatalf("emitted data byte with the high bit set: %#x %#x %#x", s, d1, d2)
				}
			},
			OnRealtime: func(b byte) {
				if b < 0xF8 {
					t.Fatalf("reported %#x as realtime", b)
				}
			},
		}
		for _, b := range in {
			p.Feed(b)
		}
	})
}
