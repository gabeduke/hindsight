package audio

import (
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// write16BitWAV hand-crafts a minimal 16-bit PCM WAV, since WriteWAV only
// ever produces 32-bit files.
func write16BitWAV(t *testing.T, path string, frames, channels, sampleRate int) {
	t.Helper()
	le := binary.LittleEndian
	dataBytes := uint32(frames * channels * 2)
	var hdr [44]byte
	copy(hdr[0:4], "RIFF")
	le.PutUint32(hdr[4:8], dataBytes+36)
	copy(hdr[8:12], "WAVE")
	copy(hdr[12:16], "fmt ")
	le.PutUint32(hdr[16:20], 16)
	le.PutUint16(hdr[20:22], 1)
	le.PutUint16(hdr[22:24], uint16(channels))
	le.PutUint32(hdr[24:28], uint32(sampleRate))
	le.PutUint32(hdr[28:32], uint32(sampleRate*channels*2))
	le.PutUint16(hdr[32:34], uint16(channels*2))
	le.PutUint16(hdr[34:36], 16)
	copy(hdr[36:40], "data")
	le.PutUint32(hdr[40:44], dataBytes)
	buf := append(hdr[:], make([]byte, dataBytes)...)
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestWriteSlice16ProducesAFadedSixteenBitWAV(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_s.wav")
	data := make([]int32, 48000*2)
	for i := range data {
		data[i] = 1 << 30 // half scale
	}
	if _, err := WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := WriteSlice16(&buf, p, 1000, 3000, nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	if int64(len(b)) != SliceBytes(WAVInfo{Channels: 2, SampleRate: 48000, BitsPerSample: 32}, 1000, 3000, nil) {
		t.Errorf("len = %d, want SliceBytes = %d", len(b), SliceBytes(WAVInfo{Channels: 2, SampleRate: 48000, BitsPerSample: 32}, 1000, 3000, nil))
	}
	le := binary.LittleEndian
	if string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" || le.Uint16(b[34:36]) != 16 || le.Uint16(b[22:24]) != 2 {
		t.Fatalf("bad header: bits=%d ch=%d", le.Uint16(b[34:36]), le.Uint16(b[22:24]))
	}
	if le.Uint32(b[40:44]) != 2000*2*2 {
		t.Errorf("data size = %d, want %d", le.Uint32(b[40:44]), 2000*2*2)
	}
	// Frame 0 silent, mid exactly half scale in 16-bit (1<<14), last faded.
	s := func(frame int) int16 { return int16(le.Uint16(b[44+frame*4:])) }
	if s(0) != 0 || s(1000) != 1<<14 || s(1999) >= 1<<14 || s(1999) == 0 {
		t.Errorf("samples: first=%d mid=%d last=%d", s(0), s(1000), s(1999))
	}
}

func TestWriteSlice16Limits(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_s.wav")
	if _, err := WriteWAV(p, make([]int32, 48000*61*2), 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := WriteSlice16(&buf, p, 0, 48000*60+1, nil); !errors.Is(err, ErrTooLong) {
		t.Errorf("61s: err = %v, want ErrTooLong", err)
	}
	if err := WriteSlice16(&buf, p, 48000*61-10, 48000*61+1, nil); !errors.Is(err, ErrRange) {
		t.Errorf("past end: err = %v, want ErrRange", err)
	}
}

func TestWriteSlice16RejectsNonThirtyTwoBitTakes(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_16.wav")
	write16BitWAV(t, p, 100, 2, 48000)
	var buf bytes.Buffer
	if err := WriteSlice16(&buf, p, 0, 10, nil); !errors.Is(err, ErrBitDepth) {
		t.Errorf("err = %v, want ErrBitDepth", err)
	}
}

// An 8-channel take auditions the configured pair, not all eight: the loop
// must sound like the share, which pans out the same pair.
func TestWriteSlice16PicksTheConfiguredPair(t *testing.T) {
	p := filepath.Join(t.TempDir(), "jam_8ch.wav")
	data := make([]int32, 1000*8)
	for i := 0; i < 1000; i++ {
		for c := 0; c < 8; c++ {
			data[i*8+c] = int32(c+1) << 24 // channel c carries a constant c+1
		}
	}
	if _, err := WriteWAV(p, data, 8, []int{0, 1, 2, 3, 4, 5, 6, 7}, 48000); err != nil {
		t.Fatal(err)
	}
	info, _ := ReadWAVInfo(p)
	pick := SlicePick(info, []int{2, 3})
	if len(pick) != 2 || pick[0] != 2 || pick[1] != 3 {
		t.Fatalf("pick = %v, want [2 3]", pick)
	}
	var buf bytes.Buffer
	if err := WriteSlice16(&buf, p, 400, 600, pick); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	if int64(len(b)) != SliceBytes(info, 400, 600, pick) {
		t.Fatalf("len = %d, want %d", len(b), SliceBytes(info, 400, 600, pick))
	}
	if ch := binary.LittleEndian.Uint16(b[22:24]); ch != 2 {
		t.Errorf("channels in header = %d, want 2", ch)
	}
	// A 200-frame slice sits entirely inside the 144-frame fades, which scale
	// both channels alike, so check that the levels kept their sign and order:
	// channel 3's constant, then channel 4's larger one.
	mid := 44 + 100*4
	l := int16(binary.LittleEndian.Uint16(b[mid:]))
	r := int16(binary.LittleEndian.Uint16(b[mid+2:]))
	if !(l > 0 && r > l) {
		t.Errorf("mid frame = %d, %d; want channel 3's level then channel 4's (larger)", l, r)
	}
}

func TestSlicePickLeavesStereoAlone(t *testing.T) {
	if p := SlicePick(WAVInfo{Channels: 2}, []int{0, 1}); p != nil {
		t.Errorf("pick = %v, want nil for a stereo take", p)
	}
}
