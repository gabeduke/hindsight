package audio

import (
	"math"
)

// Level, for Normalize on share (step C5): how loud a span of a take is at
// its loudest, and the gain that brings that to NormalizePeakDB.

// NormalizePeakDB is where Normalize puts a span's loudest moment: a decibel
// under full scale, room for the MP3 encoder to overshoot.
const NormalizePeakDB = -1.0

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

// LevelOf is frames [from, to) of a take's Level, from its peaks pyramid
// (built at save, so no audio is read; without one, RangePeaks reads the
// WAV), on the channels a share plays: the configured pair of a take with
// more than two, else its own.
func LevelOf(wavPath string, saveChannels []int, from, to int64) (Level, error) {
	info, err := ReadWAVInfo(wavPath)
	if err != nil {
		return Level{}, err
	}
	pd, err := RangePeaks(wavPath, from, to, 1)
	if err != nil {
		return Level{}, err
	}
	chans := SlicePick(info, saveChannels)
	if chans == nil {
		chans = []int{0, 1}
	}
	peak := 0.0
	for _, c := range chans {
		if c < len(pd.Data) {
			for _, v := range pd.Data[c] {
				peak = math.Max(peak, math.Abs(float64(v)))
			}
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
	gain := math.Min(NormalizePeakDB-db, MaxNormalizeGainDB)
	return Level{PeakDB: math.Round(db*10) / 10, GainDB: math.Round(gain*10) / 10}
}
