package audio

import (
	"math"
)

// Level, for Normalize on share (step C5): how loud a span of a take is at
// its loudest, and the gain that brings that to NormalizePeakDB.

// NormalizePeakDB is where Normalize puts a span's loudest moment: 1.5 dB
// under full scale, room for the MP3 encoder to overshoot on a dense,
// saturated part.
const NormalizePeakDB = -1.5

// MaxNormalizeGainDB caps the boost: a near-silent take brought up 40 dB
// would be its noise floor, shared.
const MaxNormalizeGainDB = 24.0

// silentDB is a span with nothing in it: no gain at all.
const silentDB = -120.0

// Level is a span's peak on the pair a share or a preview plays, in dBFS,
// and the gain (dB, to the tenth) that takes it to NormalizePeakDB.
type Level struct {
	PeakDB float64 `json:"peak_db"`
	GainDB float64 `json:"gain_db"`
}

// LevelOf is frames [from, to) of a take's Level, on the channels a share
// plays: the configured pair of a take with more than two, else its own. The
// whole 256-frame buckets inside the span come from the peaks pyramid (built
// at save, so they read no audio); the part buckets at its two ends, under
// 256 frames each, from the WAV, so a loud entry just past Out doesn't count.
// Without a pyramid, RangePeaks reads the WAV for all of it.
func LevelOf(wavPath string, saveChannels []int, from, to int64) (Level, error) {
	info, err := ReadWAVInfo(wavPath)
	if err != nil {
		return Level{}, err
	}
	chans := SlicePick(info, saveChannels)
	if chans == nil {
		chans = []int{0, 1}
	}
	peak := 0.0
	read := func(a, b int64) error {
		if b <= a {
			return nil
		}
		pd, err := RangePeaks(wavPath, a, b, 1)
		if err != nil {
			return err
		}
		for _, c := range chans {
			if c < len(pd.Data) {
				for _, v := range pd.Data[c] {
					peak = math.Max(peak, math.Abs(float64(v)))
				}
			}
		}
		return nil
	}
	in := min((from+PyramidBase-1)/PyramidBase*PyramidBase, to) // the first bucket edge inside
	out := max(to/PyramidBase*PyramidBase, in)                  // the last
	for _, s := range [][2]int64{{from, in}, {in, out}, {out, to}} {
		if err := read(s[0], s[1]); err != nil {
			return Level{}, err
		}
	}
	return levelFor(peak), nil
}

// levelFor is the Level of a linear peak (1 is full scale).
func levelFor(peak float64) Level {
	if peak <= 0 {
		return Level{PeakDB: silentDB}
	}
	db := 20 * math.Log10(peak)
	gain := math.Round(math.Min(NormalizePeakDB-db, MaxNormalizeGainDB)*10) / 10
	if gain == 0 {
		gain = 0 // not -0, which would read "-0.0"
	}
	return Level{PeakDB: math.Round(db*10) / 10, GainDB: gain}
}
