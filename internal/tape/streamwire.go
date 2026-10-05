package tape

import (
	"encoding/binary"
	"errors"
	"math"
)

// The stream to a browser: the tape's mix as stereo PCM16, a packet at a
// time, each stamped with where it is on the tape.

// PacketHeader is the bytes before a packet's samples: "HSTR", the version,
// flags (bit 0: playing), two reserved, the output frame of its first sample
// and the tape position there.
const PacketHeader = 24

const (
	packetVersion = 1
	flagPlaying   = 1
)

var ErrBadPacket = errors.New("not a stream packet")

// Packet is one decoded packet.
type Packet struct {
	Frame   uint64
	Pos     int64
	Playing bool
	PCM     []int16 // stereo, interleaved
}

// MixStereo sums the two buses to stereo, as the Sidekick's faders at unity
// would: left is A.L + B.L, right A.R + B.R, clipped. src is OutChannels
// wide; dst takes two samples a frame. It doesn't allocate: the device's
// thread calls it.
func MixStereo(dst []int16, src []int32) {
	n := len(src) / OutChannels
	for i := 0; i < n; i++ {
		s := src[i*OutChannels : i*OutChannels+4]
		dst[2*i] = clip16((int64(s[0]) + int64(s[2])) >> 16)
		dst[2*i+1] = clip16((int64(s[1]) + int64(s[3])) >> 16)
	}
}

func clip16(v int64) int16 {
	switch {
	case v > math.MaxInt16:
		return math.MaxInt16
	case v < math.MinInt16:
		return math.MinInt16
	}
	return int16(v)
}

// EncodePacket appends a packet to dst.
func EncodePacket(dst []byte, frame uint64, pos int64, playing bool, pcm []int16) []byte {
	var h [PacketHeader]byte
	copy(h[0:4], "HSTR")
	h[4] = packetVersion
	if playing {
		h[5] = flagPlaying
	}
	binary.LittleEndian.PutUint64(h[8:16], frame)
	binary.LittleEndian.PutUint64(h[16:24], uint64(pos))
	dst = append(dst, h[:]...)
	for _, v := range pcm {
		dst = binary.LittleEndian.AppendUint16(dst, uint16(v))
	}
	return dst
}

// DecodePacket reads a packet (tests, and anything that listens in Go).
func DecodePacket(b []byte) (Packet, error) {
	if len(b) < PacketHeader || string(b[0:4]) != "HSTR" || b[4] != packetVersion || (len(b)-PacketHeader)%4 != 0 {
		return Packet{}, ErrBadPacket
	}
	p := Packet{
		Frame:   binary.LittleEndian.Uint64(b[8:16]),
		Pos:     int64(binary.LittleEndian.Uint64(b[16:24])),
		Playing: b[5]&flagPlaying != 0,
	}
	body := b[PacketHeader:]
	p.PCM = make([]int16, len(body)/2)
	for i := range p.PCM {
		p.PCM[i] = int16(binary.LittleEndian.Uint16(body[2*i:]))
	}
	return p, nil
}
