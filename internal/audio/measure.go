package audio

import (
	"errors"
	"fmt"
	"log"
	"math"
	"path/filepath"

	"github.com/gabeduke/hindsight/internal/tempo"
)

// measureWindowSeconds is the most of a take MeasureTempo reads: two minutes
// from its middle, enough for a reading precise to a few hundredths of a BPM
// and little enough for the Pi to do in a second or two after a save.
const measureWindowSeconds = 120

// measureTempo is MeasureTempo, swapped out by the tests that check a save
// runs it.
var measureTempo = MeasureTempo

var errTempoChanged = errors.New("the tempo changed while it was measured")

// MeasureTempo measures a take's tempo from its audio and keeps it as the
// take's BPM, from TempoFromAudio, with the BPM the save stamped (the MIDI
// clock's) as the hint. Audio with no steady pulse changes nothing, and nor
// does a measurement that finishes after the BPM was edited: an edit always
// wins. Like stampTempo it runs after the take is safely on disk, and a
// failure or a panic costs only the measurement.
func MeasureTempo(wavPath string) {
	defer func() {
		if p := recover(); p != nil {
			log.Printf("[!] tempo: measuring %s panicked: %v", filepath.Base(wavPath), p)
		}
	}()
	before := ReadMeta(wavPath).BPM
	hint := 0.0
	if before != nil {
		hint = *before
	}
	x, sr, err := readMiddle(wavPath, measureWindowSeconds)
	if err != nil {
		log.Printf("[!] tempo: %s: %v", filepath.Base(wavPath), err)
		return
	}
	bpm, ok := measure(x, sr, hint)
	if !ok {
		log.Printf("[*] %s — no steady pulse to measure", filepath.Base(wavPath))
		return
	}
	keepMeasured(wavPath, before, bpm)
}

// measure is tempo.Measure, rounded to the two decimals takes keep.
func measure(x []float32, sampleRate int, hint float64) (float64, bool) {
	r, ok := tempo.Measure(x, sampleRate, hint)
	if !ok {
		return 0, false
	}
	return math.Round(r.BPM*100) / 100, true
}

// keepMeasured writes a measured BPM if the take's BPM is still before.
func keepMeasured(wavPath string, before *float64, bpm float64) {
	_, err := UpdateMeta(wavPath, func(m *Meta) error {
		if (m.BPM == nil) != (before == nil) || (m.BPM != nil && *m.BPM != *before) {
			return errTempoChanged
		}
		m.BPM, m.TempoFrom = &bpm, TempoFromAudio
		return nil
	})
	switch {
	case errors.Is(err, errTempoChanged):
		log.Printf("[*] %s — measured %.2f BPM, but it was edited meanwhile; kept the edit", filepath.Base(wavPath), bpm)
	case err != nil:
		log.Printf("[!] tempo for %s: %v", filepath.Base(wavPath), err)
	default:
		log.Printf("[*] %s — %.2f BPM, measured", filepath.Base(wavPath), bpm)
	}
}

// readMiddle reads up to seconds of a take from its middle, mixed to mono.
func readMiddle(path string, seconds float64) ([]float32, int, error) {
	info, err := ReadWAVInfo(path)
	if err != nil {
		return nil, 0, err
	}
	if info.Channels < 1 {
		return nil, 0, fmt.Errorf("no channels")
	}
	n := info.Frames()
	from, to := int64(0), n
	if want := int64(seconds * float64(info.SampleRate)); n > want {
		from = (n - want) / 2
		to = from + want
	}
	ch := info.Channels
	x := make([]float32, 0, to-from)
	_, err = ReadFrames(path, from, to, 1<<14, func(b []int32, _ int64) error {
		for i := 0; i+ch <= len(b); i += ch {
			s := 0.0
			for c := 0; c < ch; c++ {
				s += float64(b[i+c])
			}
			x = append(x, float32(s/float64(ch)/2147483648.0))
		}
		return nil
	})
	return x, info.SampleRate, err
}
