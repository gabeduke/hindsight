// Package tempo finds the pulse in a recording: the tempo a take was played
// at, measured from its audio. Pure Go, no cgo, and nothing else from the
// app, so it is tested on synthetic audio alone.
//
// The design is docs/superpowers/specs/2026-10-04-tempo-from-recording-design.md.
package tempo

import "math"

// Result is a measured tempo.
type Result struct {
	BPM        float64 // quarter notes per minute
	Confidence float64 // 0..1: how strongly the audio repeats at that period
}

const (
	minBPM, maxBPM = 40.0, 240.0
	coarseMS       = 10   // the coarse envelope's hop
	fineMS         = 1    // the fine envelope's hop
	minConfidence  = 0.12 // below this, no tempo
	hintTolerance  = 0.08 // a hint this close to a reading picks it
	windowMS       = 40   // the energy window: longer than a low note's period, so a held bass doesn't ripple
	riseMS         = 10   // an attack is the rise in energy over this long
	peakCut        = 0.7  // the share of a peak's height its centre is taken over
	riseMin        = 0.1  // a rise in log energy smaller than this (0.4 dB) is no attack
)

// Measure finds the pulse in mono samples at sampleRate. hint is a tempo to
// prefer between readings of the same pulse (half or double time), or 0 for
// none. It answers false for audio with no steady pulse.
func Measure(samples []float32, sampleRate int, hint float64) (Result, bool) {
	// Reject sample rates too low to compute a hop; integer truncation would
	// result in zero-length windows, and the tempo scale would divide by zero.
	if sampleRate < 1000 {
		return Result{}, false
	}
	// Compute actual hop lengths in samples. Integer truncation on the hop
	// lengths is real; we account for it when converting back to BPM.
	fineHop := sampleRate * fineMS / 1000
	coarseHop := sampleRate * coarseMS / 1000
	// Both envelopes use the same long window, which keeps a held tone's
	// ripple out; they differ in hop.
	win, rise := sampleRate*windowMS/1000, sampleRate*riseMS/1000
	fine := envelope(samples, fineHop, win, rise)
	coarse := envelope(samples, coarseHop, win, rise)
	if len(coarse) < int(4*60/minBPM*1000/coarseMS) { // four slow beats at least
		return Result{}, false
	}
	// hopsPerMin for this sample rate: 60 seconds × sampleRate samples/second ÷ coarseHop samples/hop.
	hopsPerMin := 60.0 * float64(sampleRate) / float64(coarseHop)
	beat := coarseBeat(coarse, hint, hopsPerMin) // in coarse hops
	if beat <= 0 {
		return Result{}, false
	}
	// Refine at the fine hop: eight beats out first, then at 16, 32, ...
	// beats up to half the audio, each search centred on the beat so far,
	// and the beat fitted to all of them by least squares (lag = n × beat).
	// Convert from coarse to fine hops using the real ratio of hop lengths.
	per := float64(coarseHop) / float64(fineHop)
	t, conf := refine(fine, beat*per, 8, 0.02)
	if conf < minConfidence {
		return Result{}, false
	}
	sumNL, sumNN := 8*8*t, 64.0
	for n := 16.0; n*t <= float64(len(fine))/2; n *= 2 {
		tn, c := refine(fine, t, n, 0.004)
		if c < minConfidence {
			break
		}
		sumNL += n * n * tn
		sumNN += n * n
		t = sumNL / sumNN
	}
	// BPM from the fine hop's real duration: 60 seconds ÷ (beat period in seconds).
	bpm := 60.0 * float64(sampleRate) / (t * float64(fineHop))
	return Result{BPM: bpm, Confidence: conf}, true
}

// envelope is the onset strength every hop samples: the rise in log energy
// over the last win samples, measured across rise samples, ignoring rises
// under riseMin (a tone's ripple, not an attack), less its mean. All zeros
// means nothing in the audio rose.
func envelope(x []float32, hop, win, rise int) []float64 {
	if hop < 1 {
		hop = 1
	}
	n := len(x) / hop
	logs := make([]float64, n)
	sum := 0.0
	j := 0 // samples added to sum so far
	for i := 0; i < n; i++ {
		end := (i + 1) * hop
		for ; j < end; j++ {
			sum += float64(x[j]) * float64(x[j])
			if j >= win {
				sum -= float64(x[j-win]) * float64(x[j-win])
			}
		}
		if sum < 0 {
			sum = 0 // rounding
		}
		logs[i] = math.Log(sum/float64(win) + 1e-10)
	}
	// The rise is measured over rise samples, not hop to hop: at a fine hop,
	// an attack's rise through the window is spread over many hops, each too
	// small to pass riseMin alone.
	back := max(1, rise/hop)
	out := make([]float64, n)
	for i := back; i < n; i++ {
		if d := logs[i] - logs[i-back]; d > riseMin {
			out[i] = d
		}
	}
	mean := 0.0
	for _, v := range out {
		mean += v
	}
	mean /= float64(max(n, 1))
	for i := range out {
		out[i] -= mean
	}
	return out
}

// corr is the normalised correlation of env with itself lag hops on.
func corr(env []float64, lag int) float64 {
	if lag <= 0 || lag >= len(env) {
		return 0
	}
	a, b := env[:len(env)-lag], env[lag:]
	var ab, aa, bb float64
	for i := range a {
		ab += a[i] * b[i]
		aa += a[i] * a[i]
		bb += b[i] * b[i]
	}
	if aa == 0 || bb == 0 {
		return 0
	}
	return ab / math.Sqrt(aa*bb)
}

// coarseBeat picks the beat period, in hops, from the coarse envelope.
// Each candidate, in tenths of a hop -- a beat is rarely a whole number of
// hops, and its repeats drift off whole hops -- is scored by the audio
// repeating at 1, 2, 3 and 4 beats, weighted towards 120 BPM (an octave
// away counts e⁻¹, about 0.37) so that a period three beats long doesn't
// outscore the beat. A hint picks the best's half or double time when it
// names one, or else the best candidate near it scoring at least 0.8 of
// the best; with no hint, or one that matches nothing, the best's octave
// in 80–160 BPM wins.
func coarseBeat(env []float64, hint float64, hopsPerMin float64) float64 {
	lo, hi := hopsPerMin/maxBPM, hopsPerMin/minBPM
	maxLag := min(int(4*hi)+2, len(env)/2)
	ac := make([]float64, maxLag+1)
	for l := 1; l <= maxLag; l++ {
		ac[l] = corr(env, l)
	}
	at := func(l float64) float64 { // linear between lags
		i := int(l)
		if i+1 > maxLag || i < 1 {
			return 0
		}
		f := l - float64(i)
		return ac[i]*(1-f) + ac[i+1]*f
	}
	bpmOf := func(l float64) float64 { return hopsPerMin / l }
	score := func(l float64) float64 {
		oct := math.Log2(bpmOf(l) / 120)
		return (at(l) + at(2*l) + at(3*l) + at(4*l)) * math.Exp(-oct*oct)
	}
	bestIn := func(from, to float64) (float64, float64) {
		best, bestScore := 0.0, math.Inf(-1)
		for l := math.Max(from, lo); l <= math.Min(to, hi); l += 0.1 {
			if s := score(l); s > bestScore {
				best, bestScore = l, s
			}
		}
		return best, bestScore
	}
	best, bestScore := bestIn(lo, hi)
	if best == 0 || bestScore <= 0 {
		return 0
	}
	if hint > 0 {
		// The same pulse at half or double time, if the hint names one.
		for _, l := range []float64{best, best * 2, best / 2} {
			if math.Abs(bpmOf(l)-hint)/hint <= hintTolerance {
				return l
			}
		}
		// Else a strong peak near the hint: a pulse the comb nearly chose.
		l0 := hopsPerMin / hint
		if l, s := bestIn(l0*(1-hintTolerance), l0*(1+hintTolerance)); l > 0 && s >= 0.8*bestScore {
			return l
		}
	}
	for _, l := range []float64{best, best / 2, best * 2} {
		if b := bpmOf(l); b >= 80 && b < 160 {
			return l
		}
	}
	return best
}

// refine finds the correlation peak near n beats of t hops, within ±frac,
// and answers the beat it implies and the correlation there. The peak's
// position is the centre of mass of the correlation above 0.7 of its height
// round the best lag. With real timing spread the peak is broad; with parts
// that don't repeat exactly (a held bass, noise) it's lopsided; its upper
// part's centre is steadier than either a parabola or the whole peak's.
func refine(env []float64, t, n, frac float64) (float64, float64) {
	centre := t * n
	lo, hi := int(centre*(1-frac)), int(math.Ceil(centre*(1+frac)))
	if hi >= len(env)-1 || lo < 1 {
		return t, 0
	}
	cs := make([]float64, hi-lo+1)
	bestI := 0
	for i := range cs {
		cs[i] = corr(env, lo+i)
		if cs[i] > cs[bestI] {
			bestI = i
		}
	}
	best := cs[bestI]
	if best <= 0 {
		return t, best
	}
	var sw, swl float64
	for i := bestI; i >= 0 && cs[i] >= best*peakCut; i-- {
		sw += cs[i]
		swl += cs[i] * float64(lo+i)
	}
	for i := bestI + 1; i < len(cs) && cs[i] >= best*peakCut; i++ {
		sw += cs[i]
		swl += cs[i] * float64(lo+i)
	}
	return swl / sw / n, best
}
