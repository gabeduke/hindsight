package audio

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ErrTooShort is a region that would be nothing but fades.
var ErrTooShort = errors.New("region shorter than two fades")

// CutRequest names a region of a source take, in the source's frames.
type CutRequest struct {
	Source     string // filename of the source take, e.g. jam_2026-09-10_221441.wav
	StartFrame int64
	EndFrame   int64
	Label      string // optional; defaults to "<source label or stem> · <span>"
}

// Cut writes frames [StartFrame, EndFrame) of the source as a new take in
// dir with a 3ms declick fade at each edge, plus its peaks file and a
// sidecar that inherits the source's BPM and the flags inside the region,
// rebased. It streams, so memory is one block whatever the region length.
// The source is never modified. The preview mp3 is the caller's job (it
// needs ffmpeg and the capture config); see MakePreview.
//
// Returns the new take's filename. On any failure after the file is created,
// the partial WAV is removed so a half-written take never appears in the list.
func Cut(dir string, req CutRequest, now time.Time) (string, error) {
	srcPath := filepath.Join(dir, filepath.Base(req.Source))
	info, err := ReadWAVInfo(srcPath)
	if err != nil {
		return "", err
	}
	if info.BitsPerSample != 32 {
		return "", ErrBitDepth
	}
	if req.StartFrame < 0 || req.EndFrame <= req.StartFrame || req.EndFrame > info.Frames() {
		return "", fmt.Errorf("%w: [%d, %d) of %d frames", ErrRange, req.StartFrame, req.EndFrame, info.Frames())
	}
	fade := FadeFrames(info.SampleRate)
	total := req.EndFrame - req.StartFrame
	if total < 2*fade+1 {
		return "", ErrTooShort
	}

	name, outPath, err := freeTakeName(dir, now)
	if err != nil {
		return "", err
	}
	// Written under a temporary name and renamed into place last, like a
	// save, so the list never shows a cut that is still being written.
	tmpPath := PartPath(outPath)
	fail := func(err error) (string, error) {
		os.Remove(tmpPath)
		RemoveTake(dir, name)
		return "", err
	}
	if err := writeCutWAV(srcPath, tmpPath, outPath, info, req.StartFrame, req.EndFrame, fade); err != nil {
		return fail(err)
	}

	srcMeta := ReadMeta(srcPath)
	m := Meta{Version: MetaVersion}
	m.Label = strings.TrimSpace(req.Label)
	if m.Label == "" {
		base := cutLabelBase(srcMeta.Label)
		if base == "" {
			base = strings.TrimSuffix(filepath.Base(req.Source), ".wav")
		}
		m.Label = base + " · " + spanLabel(req.StartFrame, req.EndFrame, info.SampleRate)
	}
	if srcMeta.BPM != nil {
		bpm := *srcMeta.BPM
		m.BPM = &bpm
		m.TempoFrom = srcMeta.TempoFrom
	}
	// The owner's drum/notes choices and bar grid come along: losing them was
	// a cut quietly undoing work done on the source.
	if len(srcMeta.LaneKinds) > 0 {
		m.LaneKinds = make(map[string]string, len(srcMeta.LaneKinds))
		for k, v := range srcMeta.LaneKinds {
			m.LaneKinds[k] = v
		}
	}
	if db, ok := cutDownbeat(srcMeta, req.StartFrame, req.EndFrame, info.SampleRate); ok {
		m.DownbeatFrame = &db
	}
	m.Source = &CutSource{Name: filepath.Base(req.Source), StartFrame: req.StartFrame, EndFrame: req.EndFrame}
	var flags []Flag
	for _, f := range srcMeta.Flags {
		if f.Frame >= req.StartFrame && f.Frame < req.EndFrame {
			flags = append(flags, Flag{Frame: f.Frame - req.StartFrame, Label: f.Label})
		}
	}
	created := now
	m.Created = &created
	if err := WriteMeta(outPath, m); err != nil {
		return fail(fmt.Errorf("sidecar: %w", err))
	}
	// stampFlagsAt writes the flags into the sidecar and the cue chunk, and
	// never fails the take (it logs), matching a save.
	stampFlagsAt(outPath, tmpPath, flags)
	if err := os.Rename(tmpPath, outPath); err != nil {
		return fail(fmt.Errorf("finish wav: %w", err))
	}
	log.Printf("[*] cut %s from %s [%d, %d) — %.1fs", name, req.Source, req.StartFrame, req.EndFrame,
		float64(total)/float64(info.SampleRate))
	return name, nil
}

// spanLabel names a region of a source take for a cut's label: "0:42–1:10",
// with tenths of a second when the region is under ten seconds long, where
// whole seconds would often read the same at both ends.
func spanLabel(from, to int64, sampleRate int) string {
	if sampleRate <= 0 {
		return ""
	}
	tenths := to-from < int64(10*sampleRate)
	f := func(frame int64) string {
		if tenths {
			d := frame * 10 / int64(sampleRate)
			return fmt.Sprintf("%d:%02d.%d", d/600, d/10%60, d%10)
		}
		s := frame / int64(sampleRate)
		return fmt.Sprintf("%d:%02d", s/60, s%60)
	}
	return f(from) + "–" + f(to)
}

// cutLabelBase is the part of a source's label a cut builds on: everything
// before a trailing " · <span>" a previous cut added, so a cut of a cut reads
// "riff · 0:05–0:10" rather than piling spans up.
func cutLabelBase(label string) string {
	label = strings.TrimSpace(label)
	if i := strings.LastIndex(label, " · "); i >= 0 && spanLabelRE.MatchString(label[i+len(" · "):]) {
		return label[:i]
	}
	return label
}

// spanLabelRE matches exactly what spanLabel writes, so a label the owner
// typed that merely ends in something like " · 1–2" is left alone.
var spanLabelRE = regexp.MustCompile(`^\d+:\d{2}(\.\d)?–\d+:\d{2}(\.\d)?$`)

// cutDownbeat carries the source's downbeat onto a cut of [from, to). With a
// tempo, it is the first bar line at or after the cut's start, so the cut's
// grid lines up with the source's; without one, only a downbeat inside the
// region can be carried, at its own position.
func cutDownbeat(src Meta, from, to int64, sampleRate int) (int64, bool) {
	if src.DownbeatFrame == nil {
		return 0, false
	}
	db := *src.DownbeatFrame
	if src.BPM != nil && *src.BPM > 0 && sampleRate > 0 {
		bar := 4 * 60 / *src.BPM * float64(sampleRate)
		k := math.Ceil(float64(from-db) / bar)
		at := int64(math.Round(float64(db) + k*bar - float64(from)))
		if at < 0 {
			at = 0
		}
		if at < to-from {
			return at, true
		}
		return 0, false
	}
	if db >= from && db < to {
		return db - from, true
	}
	return 0, false
}

// writeRegion32 streams frames [from, to) of srcPath through the fades to w
// as a 32-bit WAV with a canonical 44-byte header. acc and pyr may be nil.
func writeRegion32(w io.Writer, srcPath string, info WAVInfo, from, to, fade int64, acc *peakAccumulator, pyr *pyramidAcc) error {
	total := to - from
	ch := info.Channels
	bw := bufio.NewWriterSize(w, 1<<18)
	if err := writeWAVHeader(bw, uint32(total*int64(ch)*4), ch, info.SampleRate, 32); err != nil {
		return err
	}
	le := binary.LittleEndian
	var raw [4]byte
	_, err := ReadFrames(srcPath, from, to, 1<<14, func(block []int32, first int64) error {
		rel := first - from
		applyFades(block, rel, total, ch, fade)
		n := len(block) / ch
		for i := 0; i < n; i++ {
			for c := 0; c < ch; c++ {
				v := block[i*ch+c]
				le.PutUint32(raw[:], uint32(v))
				if _, err := bw.Write(raw[:]); err != nil {
					return err
				}
				if acc != nil {
					acc.add(c, int(rel)+i, float32(float64(v)/2147483648.0))
				}
				if pyr != nil {
					pyr.add(c, rel+int64(i), v)
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

// WriteRegion32 streams frames [from, to) of a take to w as a complete
// 32-bit WAV with the same 3ms fades a cut applies: byte-identical to what
// POST /api/cut would write for the region, minus the peaks file. This is
// the DAW bundle's audio.
func WriteRegion32(w io.Writer, path string, from, to int64) error {
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
	fade := FadeFrames(info.SampleRate)
	if to-from < 2*fade+1 {
		return ErrTooShort
	}
	return writeRegion32(w, path, info, from, to, fade, nil, nil)
}

// writeCutWAV streams the region through the fades into a canonical 44-byte
// header WAV at tmpPath, and writes the peaks and the peaks pyramid under
// finalPath's names, where the WAV will be renamed to.
func writeCutWAV(srcPath, tmpPath, finalPath string, info WAVInfo, from, to, fade int64) error {
	total := to - from
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	defer f.Close()
	acc := newPeakAccumulator(info.Channels, int(total))
	pyr := newPyramidAcc(info.Channels, total)
	if err := writeRegion32(f, srcPath, info, from, to, fade, acc, pyr); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := WritePeaks(peaksPath(finalPath), acc.finish(info.SampleRate, int(total))); err != nil {
		log.Printf("[!] peaks for %s: %v", filepath.Base(finalPath), err)
	}
	if err := pyr.write(finalPath, info.SampleRate); err != nil {
		log.Printf("[!] peaks pyramid for %s: %v", filepath.Base(finalPath), err)
	}
	return nil
}
