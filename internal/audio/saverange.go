package audio

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// Saving any span of the ring, not just the newest N seconds: what the
// ribbon's selection and a flag's "Save from here to now" need. The window
// is absolute ring frames, the clock flags use, and it may end in the past.

// rangeMargin is how far inside the ring's oldest frame a span is allowed to
// start. The ring overwrites its oldest audio as it records, and a save that
// starts right at the edge would lose that race before its first chunk.
const rangeMargin = 0.25 // seconds

// SavedRange describes a span saved by SaveRange.
type SavedRange struct {
	Name    string
	From    uint64 // the absolute frames actually saved: [From, To)
	To      uint64
	Clamped bool // the start had aged out of the ring, so it starts later
	Seconds float64
}

// SaveRange saves the absolute ring frames [from, to) as a take. to == 0
// means "now", the newest frame. A start the ring no longer holds is moved to
// the oldest it does, and reported. The take is named, and dated, by when its
// last frame was played, so it sorts among the others by when it happened;
// its tempo is read over its own times, through the clock bridge, not over
// the last N seconds.
func (s *Saver) SaveRange(from, to uint64) (SavedRange, error) {
	cfg := s.cap.cfg
	ring := s.cap.Ring()
	oldest, total := ring.Window()
	if total == 0 {
		return SavedRange{}, ErrNoAudio
	}
	if to == 0 || to > total {
		to = total
	}
	out := SavedRange{From: from, To: to, Clamped: from < oldest}
	// Once the ring is full it overwrites its oldest frames as it records,
	// so a span starting at the very edge keeps a small margin from it.
	margin := uint64(rangeMargin * float64(cfg.SampleRate))
	if oldest > 0 && out.From < oldest+margin {
		out.From = oldest + margin
	} else if out.From < oldest {
		out.From = oldest
	}
	if out.To <= out.From {
		return out, fmt.Errorf("%w: that span is no longer in the buffer", ErrRangeGone)
	}
	frames := out.To - out.From

	// Low on disk: the trash first, as for a capture (see EnsureFree).
	if free, _ := s.FreeGB(); free < cfg.MinFreeGB {
		if free = EnsureFree(cfg.OutputDir, cfg.MinFreeGB); free < cfg.MinFreeGB {
			return out, fmt.Errorf("%w: %.2f GB free, need %.2f GB", ErrLowDisk, free, cfg.MinFreeGB)
		}
	}

	// When the span's ends were played, on the wall clock.
	endAt := s.wallAt(out.To)
	startAt := s.wallAt(out.From)
	takeFlags := flagsForWindow(s.cap.Flags().Active(total, uint64(cfg.RingFrames())), out.From, out.To)

	s.mu.Lock()
	s.saving = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.saving = false
		s.mu.Unlock()
	}()

	name, wavPath, err := freeTakeName(cfg.OutputDir, endAt)
	if err != nil {
		return out, fmt.Errorf("name take: %w", err)
	}
	out.Name = name
	tmpPath := PartPath(wavPath)
	pick := cfg.OutChannels()

	started := time.Now()
	ww, err := createWAV(tmpPath, int(frames), len(pick), cfg.SampleRate)
	if err != nil {
		os.Remove(tmpPath)
		return out, fmt.Errorf("write wav: %w", err)
	}
	err = ring.Range(out.From, out.To, pick, ww.write)
	peaks, pyr, cerr := ww.close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmpPath)
		if errors.Is(err, ErrRangeGone) {
			return out, fmt.Errorf("%w: the ring overwrote it while it was being saved", ErrRangeGone)
		}
		return out, fmt.Errorf("write wav: %w", err)
	}
	out.Seconds = float64(frames) / float64(cfg.SampleRate)
	log.Printf("[*] saved %s from the ring — %.1fs ending %s ago, %d ch, %s in %s",
		name, out.Seconds, time.Since(endAt).Round(time.Second), len(pick),
		sizeOf(tmpPath), time.Since(started).Round(time.Millisecond))

	if err := WritePeaks(peaksPath(wavPath), peaks); err != nil {
		log.Printf("[!] peaks for %s: %v", name, err)
	}
	if err := pyr.write(wavPath, cfg.SampleRate); err != nil {
		log.Printf("[!] peaks pyramid for %s: %v", name, err)
	}
	stampCreated(wavPath, endAt)
	stampFlagsAt(wavPath, tmpPath, takeFlags)
	stampTempo(wavPath, s.tempoSource(), endAt, endAt.Sub(startAt))
	exportMIDI(s.midiExporter(), MIDIExportRequest{
		WavPath:    wavPath,
		StartFrame: out.From,
		Frames:     int(frames),
		SampleRate: cfg.SampleRate,
		Bridge:     s.cap.Bridge(),
		SavedAt:    endAt,
	})

	if err := os.Rename(tmpPath, wavPath); err != nil {
		os.Remove(tmpPath)
		RemoveTake(cfg.OutputDir, name)
		return out, fmt.Errorf("finish wav: %w", err)
	}
	s.mu.Lock()
	s.lastSaved = name
	s.mu.Unlock()

	s.afterSave(wavPath, len(pick), name)
	return out, nil
}

// wallAt is when an absolute ring frame was played, on the wall clock (with
// a monotonic reading, so the tempo source can compare it). From the clock
// bridge when it knows; otherwise counted back from now at the sample rate,
// which is exact for audio that arrived without a dropout.
func (s *Saver) wallAt(frame uint64) time.Time {
	now := time.Now()
	if ns, ok := s.cap.Bridge().NSAt(frame); ok {
		return now.Add(time.Duration(ns - mono.Now()))
	}
	total := s.cap.Ring().TotalFrames()
	if frame > total {
		frame = total
	}
	back := float64(total-frame) / float64(s.cap.cfg.SampleRate)
	return now.Add(-time.Duration(back * float64(time.Second)))
}

// wavWriter writes a 32-bit WAV whose length is known up front, chunk by
// chunk, building the whole-take peaks and the pyramid as it goes.
type wavWriter struct {
	f          *os.File
	w          *bufio.Writer
	outCh      int
	sampleRate int
	frames     int
	frame      int
	pk         *peakAccumulator
	pyr        *pyramidAcc
}

func createWAV(path string, frames, outCh, sampleRate int) (*wavWriter, error) {
	if frames <= 0 || outCh <= 0 {
		return nil, fmt.Errorf("no audio frames to write")
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	if err := writeWAVHeader(w, uint32(frames*outCh*4), outCh, sampleRate, 32); err != nil {
		f.Close()
		return nil, err
	}
	return &wavWriter{f: f, w: w, outCh: outCh, sampleRate: sampleRate, frames: frames,
		pk: newPeakAccumulator(outCh, frames), pyr: newPyramidAcc(outCh, int64(frames))}, nil
}

// write appends interleaved frames of outCh channels.
func (ww *wavWriter) write(samples []int32) error {
	var scratch [4]byte
	for i, s := range samples {
		oc := i % ww.outCh
		if ww.frame >= ww.frames {
			return fmt.Errorf("more audio than the header says")
		}
		binary.LittleEndian.PutUint32(scratch[:], uint32(s))
		if _, err := ww.w.Write(scratch[:]); err != nil {
			return err
		}
		ww.pk.add(oc, ww.frame, float32(float64(s)/2147483648.0))
		ww.pyr.add(oc, int64(ww.frame), s)
		if oc == ww.outCh-1 {
			ww.frame++
		}
	}
	return nil
}

// close finishes the file: flushed, synced and closed. A file shorter than
// its header is an error.
func (ww *wavWriter) close() (*PeakData, *pyramidAcc, error) {
	err := ww.w.Flush()
	if err == nil {
		err = ww.f.Sync()
	}
	if cerr := ww.f.Close(); err == nil {
		err = cerr
	}
	if err == nil && ww.frame != ww.frames {
		err = fmt.Errorf("wrote %d of %d frames", ww.frame, ww.frames)
	}
	if err != nil {
		return nil, nil, err
	}
	return ww.pk.finish(ww.sampleRate, ww.frames), ww.pyr, nil
}
