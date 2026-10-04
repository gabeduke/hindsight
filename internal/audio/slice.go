// internal/audio/slice.go
package audio

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// MaxSliceSeconds caps an audition slice. 60s of stereo decodes to ~23MB of
// float32 in a browser, which a phone handles; the page auditions longer
// regions through the mp3 preview instead.
const MaxSliceSeconds = 60

// ErrTooLong is a slice over MaxSliceSeconds.
var ErrTooLong = errors.New("slice longer than the audition cap")

// SliceBytes is the byte length of the WAV WriteSlice16 emits for [from, to)
// with the given channel pick (nil means every channel).
func SliceBytes(info WAVInfo, from, to int64, pick []int) int64 {
	ch := info.Channels
	if pick != nil {
		ch = len(pick)
	}
	return 44 + (to-from)*int64(ch)*2
}

// SlicePick is the channels an audition slice plays: for a take with more
// than two channels, the configured pair -- the same pair the preview and a
// shared render use, so what loops is what gets shared -- and otherwise nil,
// meaning all of them.
func SlicePick(info WAVInfo, saveChannels []int) []int {
	if info.Channels <= 2 {
		return nil
	}
	l, r := 0, 1
	if len(saveChannels) > 0 {
		l, r = saveChannels[0], saveChannels[0]
	}
	if len(saveChannels) > 1 {
		r = saveChannels[1]
	}
	if l < 0 || l >= info.Channels || r < 0 || r >= info.Channels {
		return []int{0, 1}
	}
	return []int{l, r}
}

// WriteSlice16 writes frames [from, to) of a take to w as a complete 16-bit
// PCM WAV with the same 3ms fades a cut applies, so what the page auditions
// is exactly what a cut will produce. 16-bit because browsers -- iOS Safari
// in particular -- do not reliably decode 32-bit integer WAV; the audition
// is not archival. Conversion is an arithmetic shift, no dither.
//
// pick chooses which of the take's channels go into the slice, in order; nil
// means all of them (see SlicePick).
func WriteSlice16(w io.Writer, path string, from, to int64, pick []int) error {
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
	if to-from > int64(MaxSliceSeconds*info.SampleRate) {
		return ErrTooLong
	}
	ch := info.Channels
	for _, c := range pick {
		if c < 0 || c >= ch {
			return fmt.Errorf("channel %d out of range for a %d-channel take", c+1, ch)
		}
	}
	outCh := ch
	if pick != nil {
		outCh = len(pick)
	}
	total := to - from
	fade := FadeFrames(info.SampleRate)

	bw := bufio.NewWriterSize(w, 1<<16)
	le := binary.LittleEndian
	dataBytes := uint32(total * int64(outCh) * 2)
	if err := writeWAVHeader(bw, dataBytes, outCh, info.SampleRate, 16); err != nil {
		return err
	}

	var s [2]byte
	put := func(v int32) error {
		le.PutUint16(s[:], uint16(int16(v>>16)))
		_, err := bw.Write(s[:])
		return err
	}
	_, err = ReadFrames(path, from, to, 1<<14, func(block []int32, first int64) error {
		applyFades(block, first-from, total, ch, fade)
		if pick == nil {
			for _, v := range block {
				if err := put(v); err != nil {
					return err
				}
			}
			return nil
		}
		for i := 0; i+ch <= len(block); i += ch {
			for _, c := range pick {
				if err := put(block[i+c]); err != nil {
					return err
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
