package tape

import (
	"math"
	"testing"
)

func TestMixStereoSumsTheBusesAndClips(t *testing.T) {
	half := int32(math.MaxInt32 / 2)
	src := []int32{
		half, -half, half, -half, // A and B both at half: sums to full scale, clipped
		1 << 16, 2 << 16, 3 << 16, 4 << 16, // small: A.L+B.L = 4, A.R+B.R = 6 (in int16 steps)
		math.MaxInt32, math.MinInt32, math.MaxInt32, math.MinInt32, // overflow: must clip
	}
	dst := make([]int16, 6)
	MixStereo(dst, src)
	if dst[0] != math.MaxInt16 || dst[1] != math.MinInt16 {
		t.Fatalf("full scale should clip: %v", dst[:2])
	}
	if dst[2] != 4 || dst[3] != 6 {
		t.Fatalf("left = A.L + B.L, right = A.R + B.R: %v", dst[2:])
	}
	if dst[4] != math.MaxInt16 || dst[5] != math.MinInt16 {
		t.Fatalf("overflow should clip: %v", dst[4:])
	}
}

func TestAPacketRoundTrips(t *testing.T) {
	pcm := []int16{1, -1, 300, -300}
	b := EncodePacket(nil, 123456789, 4242, true, pcm)
	if len(b) != PacketHeader+len(pcm)*2 || string(b[:4]) != "HSTR" || b[4] != 1 || b[5] != 1 {
		t.Fatalf("header: % x", b[:8])
	}
	p, err := DecodePacket(b)
	if err != nil {
		t.Fatal(err)
	}
	if p.Frame != 123456789 || p.Pos != 4242 || !p.Playing || len(p.PCM) != 4 || p.PCM[3] != -300 {
		t.Fatalf("%+v", p)
	}
	stopped, _ := DecodePacket(EncodePacket(nil, 1, -1, false, nil))
	if stopped.Playing || stopped.Pos != -1 {
		t.Fatalf("stopped: %+v", stopped)
	}
}

func TestABadPacketIsRefused(t *testing.T) {
	for _, b := range [][]byte{nil, []byte("HSTR"), append([]byte("XXXX"), make([]byte, 20)...)} {
		if _, err := DecodePacket(b); err == nil {
			t.Fatalf("% x should be refused", b)
		}
	}
}
