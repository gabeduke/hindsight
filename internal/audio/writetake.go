package audio

import (
	"fmt"
	"log"
	"os"
	"time"
)

// WriteTake writes a new take of frames frames, channels wide, into dir:
// fill hands it the audio, interleaved, chunk by chunk, through write. It is
// written under a .part name and renamed into place last, as a save and a
// cut are, so the list never shows one half-written; its peaks, its peaks
// pyramid and its sidecar (m, with Created set to now if it has none) are
// written first, under the take's own name. It answers the take's file name.
// On any failure nothing is left behind.
//
// It is how a take is made from audio that isn't the ring's or another
// take's: the Studio's buffer kept as a take (internal/tape).
func WriteTake(dir string, now time.Time, frames int64, channels, sampleRate int, fill func(write func([]int32) error) error, m Meta) (string, error) {
	if frames <= 0 || channels <= 0 {
		return "", fmt.Errorf("%w: nothing to write", ErrRange)
	}
	name, path, err := freeTakeName(dir, now)
	if err != nil {
		return "", err
	}
	tmp := PartPath(path)
	fail := func(err error) (string, error) {
		os.Remove(tmp)
		RemoveTake(dir, name)
		return "", err
	}
	ww, err := createWAV(tmp, int(frames), channels, sampleRate)
	if err != nil {
		return fail(err)
	}
	err = fill(ww.write)
	peaks, pyr, cerr := ww.close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		return fail(err)
	}
	if err := WritePeaks(peaksPath(path), peaks); err != nil {
		log.Printf("[!] peaks for %s: %v", name, err)
	}
	if err := pyr.write(path, sampleRate); err != nil {
		log.Printf("[!] peaks pyramid for %s: %v", name, err)
	}
	if m.Created == nil {
		created := now
		m.Created = &created
	}
	if err := WriteMeta(path, m); err != nil {
		return fail(fmt.Errorf("sidecar: %w", err))
	}
	if err := os.Rename(tmp, path); err != nil {
		return fail(fmt.Errorf("finish wav: %w", err))
	}
	return name, nil
}
