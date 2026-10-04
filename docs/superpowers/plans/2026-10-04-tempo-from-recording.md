# Tempo from the recording — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A take's tempo is measured from its audio after every save, and a take sent to an empty tape gives the tape that tempo, so a loop's seam lands on the beat.

**Architecture:** A new pure-Go package, `internal/tempo`, measures a pulse from mono samples (onset envelope → autocorrelation comb → long-lag refinement). `internal/audio` runs it in the background after ring, ribbon and phone saves and keeps the result in the take's sidecar, beside a new `tempo_from`. The tape's clipboard carries the take's BPM so a drop onto an empty tape counts whole bars from it; the tape state suggests a tempo for the empty-tape form; the take page shows where its tempo came from, snaps to bars by default and puts Send to tape in its toolbar.

**Tech Stack:** Go 1.23 (no new dependencies), vanilla ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-04-tempo-from-recording-design.md`

## Global Constraints

- Go `CGO_ENABLED=0 go test ./...` and `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'` pass after every task.
- `internal/tempo` imports only the standard library.
- A save never fails or slows because of the measurement: background only, panics recovered and logged.
- The measurement never overwrites a BPM that changed after the save stamped it.
- BPM is kept to two decimals (`math.Round(v*100)/100`), as `stampTempo` does.
- New sidecar and JSON fields are optional and additive (`omitempty`); no `MetaVersion` bump.
- `tempo_from` values are exactly `clock`, `audio`, `you`.
- Copy and comments follow the repo's voice: plain words, no "user", sentences not fragments.
- The take page's toolbar gains one button only (a restyle is in progress on these files).
- The help test requires `docs/guide.md`'s tips table and `web/static/lib/help/tips.js` to match row for row.

## Review Focus

1. **A take with no steady pulse** (a pad, free time, silence, a 1 s take) keeps the clock's BPM and `tempo_from: clock`; it never gets a confident wrong tempo. → Task 2's beatless test.
2. **The owner edits the BPM while the measurement runs** → the edit stays and `tempo_from` reads `you`. → Task 2's compare-and-set test.
3. **A clipboard from the ring or the tape** (no BPM) dropped on an empty tape behaves exactly as before. → Task 3's no-BPM drop test.
4. **A selection that isn't whole bars** at the take's BPM (snap off, dragged by hand) falls back to the guess, hinted by the take's BPM, not the last tape's. → Task 3's `barsFor` table.
5. **The empty-tape form after the owner has typed a tempo** keeps what they typed when the next poll arrives. → Task 5's guard on `dataset.touched`, checked in the demo step.

---

### Task 1: `internal/tempo`, measuring a pulse

**Files:**
- Create: `internal/tempo/tempo.go`
- Test: `internal/tempo/tempo_test.go`

**Interfaces:**
- Produces: `tempo.Measure(samples []float32, sampleRate int, hint float64) (tempo.Result, bool)`; `tempo.Result{BPM, Confidence float64}`.

This algorithm was prototyped against the real stylophone take from 2026-10-04 (125.172 BPM measured, against a clock reading of 125.32 and a hand measurement of 125.17–125.23 drifting over the take) and the tests below, which all pass with it. Write it as given.

- [ ] **Step 1: Write the failing tests**

```go
package tempo

import (
	"math"
	"math/rand"
	"testing"
)

const sr = 48000

// beats is seconds of audio at bpm: a decaying noise burst on every beat,
// louder on the first of four, each hit moved by up to jitterMS at random,
// over a noise floor at floorDB.
func beats(bpm, seconds, jitterMS, floorDB float64, seed int64) []float32 {
	r := rand.New(rand.NewSource(seed))
	n := int(seconds * sr)
	x := make([]float32, n)
	floor := math.Pow(10, floorDB/20)
	for i := range x {
		x[i] = float32(floor * (r.Float64()*2 - 1))
	}
	beat := 60 / bpm * sr
	for k := 0; ; k++ {
		at := int(float64(k)*beat + (r.Float64()*2-1)*jitterMS/1000*sr)
		if at >= n {
			break
		}
		amp := 0.5
		if k%4 == 0 {
			amp = 0.9
		}
		for i := 0; i < sr/10 && at+i < n; i++ {
			if at+i < 0 {
				continue
			}
			x[at+i] += float32(amp * math.Exp(-float64(i)/(sr*0.02)) * (r.Float64()*2 - 1))
		}
	}
	return x
}

func TestMeasure(t *testing.T) {
	cases := []struct {
		name      string
		bpm, hint float64
		want, tol float64
	}{
		{"off-grid, right hint", 125.25, 125.32, 125.25, 0.02},
		{"off-grid, no hint", 125.25, 0, 125.25, 0.02},
		{"a hint that's wrong is ignored", 125.25, 92, 125.25, 0.02},
		{"a half-time hint picks half time", 125.25, 62.6, 62.625, 0.02},
		{"slow", 83.47, 0, 83.47, 0.02},
		{"fast, double-time hint", 172.4, 172.4, 172.4, 0.03},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, ok := Measure(beats(c.bpm, 60, 3, -50, 1), sr, c.hint)
			if !ok {
				t.Fatalf("no tempo")
			}
			if math.Abs(r.BPM-c.want) > c.tol {
				t.Errorf("BPM = %.3f, want %.3f ± %.2f (confidence %.2f)", r.BPM, c.want, c.tol, r.Confidence)
			}
		})
	}
}

// Across seeds and tempos in 80–160 (where no hint is needed to choose the
// octave), with and without a hint just off the true tempo.
func TestMeasureHoldsAcrossSeedsAndTempos(t *testing.T) {
	for seed := int64(1); seed <= 5; seed++ {
		for _, bpm := range []float64{82.3, 96, 125.25, 143.7, 158.4} {
			for _, hint := range []float64{0, bpm * 1.004} {
				r, ok := Measure(beats(bpm, 40, 5, -45, seed), sr, hint)
				if !ok || math.Abs(r.BPM-bpm) > 0.03 {
					t.Errorf("seed %d, %.2f BPM, hint %.2f: got %.3f (ok %v, confidence %.2f)", seed, bpm, hint, r.BPM, ok, r.Confidence)
				}
			}
		}
	}
}

func TestMeasureFindsNoTempoWithoutAPulse(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	noise := make([]float32, 30*sr)
	for i := range noise {
		noise[i] = float32(0.3 * (r.Float64()*2 - 1))
	}
	sine := make([]float32, 30*sr)
	for i := range sine {
		sine[i] = float32(0.5 * math.Sin(2*math.Pi*220*float64(i)/sr))
	}
	for name, x := range map[string][]float32{"noise": noise, "a sine": sine, "silence": make([]float32, 30*sr), "too short": beats(120, 1, 0, -60, 3)} {
		if got, ok := Measure(x, sr, 120); ok {
			t.Errorf("%s: BPM %.2f (confidence %.2f), want no tempo", name, got.BPM, got.Confidence)
		}
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `CGO_ENABLED=0 go test ./internal/tempo/`
Expected: FAIL to build: `undefined: Measure`.

- [ ] **Step 3: Write the package**

```go
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
	windowMS       = 40   // the coarse energy window, longer than a low note's period
	fineWindowMS   = 10   // the fine energy window
	riseMin        = 0.1  // a rise in log energy smaller than this (0.4 dB) is no attack
)

// Measure finds the pulse in mono samples at sampleRate. hint is a tempo to
// prefer between readings of the same pulse (half or double time), or 0 for
// none. It answers false for audio with no steady pulse.
func Measure(samples []float32, sampleRate int, hint float64) (Result, bool) {
	// The coarse envelope's long window keeps a held tone's ripple out; the
	// fine one's short window keeps attacks sharp for the refinement.
	fine := envelope(samples, sampleRate*fineMS/1000, sampleRate*fineWindowMS/1000)
	coarse := envelope(samples, sampleRate*coarseMS/1000, sampleRate*windowMS/1000)
	if len(coarse) < int(4*60/minBPM*1000/coarseMS) { // four slow beats at least
		return Result{}, false
	}
	beat := coarseBeat(coarse, hint) // in coarse hops
	if beat <= 0 {
		return Result{}, false
	}
	// Refine at the fine hop: eight beats out first, then at 16, 32, ...
	// beats up to half the audio, each search centred on the beat so far,
	// and the beat fitted to all of them by least squares (lag = n × beat).
	per := float64(coarseMS / fineMS)
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
	bpm := 60 * 1000 / (t * fineMS)
	return Result{BPM: bpm, Confidence: conf}, true
}

// envelope is the onset strength every hop samples: the rise in log energy
// over the last win samples from the hop before, ignoring rises under riseMin
// (a tone's ripple, not an attack), less its mean. All zeros means nothing
// in the audio rose.
func envelope(x []float32, hop, win int) []float64 {
	if hop < 1 {
		hop = 1
	}
	n := len(x) / hop
	out := make([]float64, n)
	sum, prev := 0.0, 0.0
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
		l := math.Log(sum/float64(win) + 1e-10)
		if i > 0 && l-prev > riseMin {
			out[i] = l - prev
		}
		prev = l
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
func coarseBeat(env []float64, hint float64) float64 {
	hopsPerMin := 60.0 * 1000 / coarseMS
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
// position is the centre of mass of the correlation above half its height
// round the best lag: with real timing spread the peak is broad, and its
// centre is steadier than a parabola through three points.
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
	for i := bestI; i >= 0 && cs[i] >= best/2; i-- {
		sw += cs[i]
		swl += cs[i] * float64(lo+i)
	}
	for i := bestI + 1; i < len(cs) && cs[i] >= best/2; i++ {
		sw += cs[i]
		swl += cs[i] * float64(lo+i)
	}
	return swl / sw / n, best
}
```

- [ ] **Step 4: Run the tests**

Run: `CGO_ENABLED=0 go test ./internal/tempo/ && gofmt -l internal/tempo`
Expected: `ok`, about 3 s; gofmt lists nothing.

- [ ] **Step 5: Bring the spec in line with the octave rule as built**

In `docs/superpowers/specs/2026-10-04-tempo-from-recording-design.md`, §1, replace the **Coarse period** and **Octave choice** bullets with:

```markdown
- **Coarse period.** Autocorrelate the envelope over beat periods for
  40–240 BPM, in tenths of a 10 ms hop (a beat is rarely a whole number of
  hops). Score each by its autocorrelation at 1, 2, 3 and 4 beats, weighted
  towards 120 BPM so a period three beats long doesn't outscore the beat.
- **Octave choice.** A hint within 8% of the best reading, or of its half
  or double time, picks that; else a strong peak within 8% of the hint
  (at least 0.8 of the best) wins; else the best's octave in 80–160 BPM.
  A hint far from every reading is ignored: the clock is a hint, never a
  fact.
```

and in **Refine**, replace "with parabolic interpolation" with "at 8, 16, 32… beats, each peak's centre of mass above half its height, fitted by least squares".

- [ ] **Step 6: Commit**

```bash
git add internal/tempo docs/superpowers/specs/2026-10-04-tempo-from-recording-design.md
git commit -m "Measure a recording's tempo from its audio

internal/tempo finds the pulse: an onset envelope, an autocorrelation comb
over 40–240 BPM, and a least-squares fit over long lags. The MIDI clock is a
hint for the octave, never a fact. Tested on synthetic beats; it reads the
2026-10-04 stylophone take at 125.17 against the clock's 125.32."
```

---

### Task 2: Measure every take after it's saved

**Files:**
- Modify: `internal/audio/meta.go` (the `Meta` struct, after `BPM`)
- Modify: `internal/audio/save.go` (`stampTempo`, `afterSave`, the `Take` struct and its copy from the sidecar near line 762)
- Create: `internal/audio/measure.go`
- Test: `internal/audio/measure_test.go`
- Modify: `internal/api/api.go` (the take PATCH handler near line 1045 and its response near line 1190)
- Modify: `internal/api/phone.go` (the background steps after a phone take is finished, near line 332)

**Interfaces:**
- Consumes: `tempo.Measure` (Task 1).
- Produces: `audio.TempoFromClock`, `audio.TempoFromAudio`, `audio.TempoFromYou` (strings `clock`, `audio`, `you`); `Meta.TempoFrom string` and `Take.TempoFrom string`, JSON `tempo_from`; `audio.MeasureTempo(wavPath string)`; the take PATCH response gains `tempo_from`.

- [ ] **Step 1: Write the failing tests**

`internal/audio/measure_test.go`:

```go
package audio

import (
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

// beatTake writes a stereo 32-bit take of seconds at bpm: a decaying noise
// burst on every beat over a quiet floor. bpm 0 writes the floor alone.
func beatTake(t *testing.T, dir, name string, bpm, seconds float64) string {
	t.Helper()
	r := rand.New(rand.NewSource(1))
	n := int(seconds * 48000)
	data := make([]int32, 2*n)
	beat := 0.0
	if bpm > 0 {
		beat = 60 / bpm * 48000
	}
	for i := 0; i < n; i++ {
		v := 0.003 * (r.Float64()*2 - 1)
		if beat > 0 {
			k := math.Floor(float64(i) / beat)
			since := float64(i) - k*beat
			v += 0.5 * math.Exp(-since/960) * (r.Float64()*2 - 1)
		}
		x := int32(v * 2147483647)
		data[2*i], data[2*i+1] = x, x
	}
	p := filepath.Join(dir, name)
	if _, err := WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMeasureTempoKeepsTheMeasuredTempo(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_a.wav", 125.25, 30)
	clock := 125.32
	if err := WriteMeta(wav, Meta{BPM: &clock, TempoFrom: TempoFromClock, Label: "keep"}); err != nil {
		t.Fatal(err)
	}
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || math.Abs(*m.BPM-125.25) > 0.02 || m.TempoFrom != TempoFromAudio {
		t.Fatalf("BPM %v from %q, want 125.25 from audio", m.BPM, m.TempoFrom)
	}
	if *m.BPM != math.Round(*m.BPM*100)/100 {
		t.Errorf("BPM %v isn't two decimals", *m.BPM)
	}
	if m.Label != "keep" {
		t.Errorf("the label went: %+v", m)
	}
}

func TestMeasureTempoMeasuresATakeWithNoClock(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_phone.wav", 96, 20)
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || math.Abs(*m.BPM-96) > 0.02 || m.TempoFrom != TempoFromAudio {
		t.Fatalf("BPM %v from %q, want 96 from audio", m.BPM, m.TempoFrom)
	}
}

func TestMeasureTempoLeavesABeatlessTakeAlone(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_pad.wav", 0, 20)
	clock := 120.0
	if err := WriteMeta(wav, Meta{BPM: &clock, TempoFrom: TempoFromClock}); err != nil {
		t.Fatal(err)
	}
	MeasureTempo(wav)
	m := ReadMeta(wav)
	if m.BPM == nil || *m.BPM != 120 || m.TempoFrom != TempoFromClock {
		t.Fatalf("BPM %v from %q, want the clock's 120 kept", m.BPM, m.TempoFrom)
	}
}

// An edit between the save's stamp and the measurement wins.
func TestKeepMeasuredLosesToAnEdit(t *testing.T) {
	wav := beatTake(t, t.TempDir(), "jam_a.wav", 125.25, 10)
	stamped, edited := 125.32, 124.0
	if err := WriteMeta(wav, Meta{BPM: &edited, TempoFrom: TempoFromYou}); err != nil {
		t.Fatal(err)
	}
	keepMeasured(wav, &stamped, 125.25)
	m := ReadMeta(wav)
	if *m.BPM != 124 || m.TempoFrom != TempoFromYou {
		t.Fatalf("BPM %v from %q, want the edit kept", *m.BPM, m.TempoFrom)
	}
}

func TestMeasureTempoSurvivesAMissingFile(t *testing.T) {
	MeasureTempo(filepath.Join(t.TempDir(), "jam_gone.wav")) // no panic, no sidecar
}

func TestStampTempoSaysItCameFromTheClock(t *testing.T) {
	wav := writeFakeTake(t, t.TempDir(), "jam_a.wav", 0)
	stampTempo(wav, &fakeTempo{bpm: 100, ok: true}, nowForTest(), 30e9)
	if m := ReadMeta(wav); m.TempoFrom != TempoFromClock {
		t.Errorf("tempo_from = %q, want clock", m.TempoFrom)
	}
}

func TestASaveMeasuresItsTakeInTheBackground(t *testing.T) {
	var got []string
	measureTempo = func(wav string) { got = append(got, filepath.Base(wav)) }
	t.Cleanup(func() { measureTempo = MeasureTempo })
	dir := t.TempDir()
	cap := NewCapture(testSaveConfig(dir), nil)
	cap.Ring().WriteFrames(make([]int32, 1000*2))
	saver := NewSaver(cap)
	t.Cleanup(saver.WaitBackground)
	name, err := saver.Save(0)
	if err != nil {
		t.Fatal(err)
	}
	saver.WaitBackground()
	if len(got) != 1 || got[0] != name {
		t.Fatalf("measured %v, want [%s]", got, name)
	}
}

// The 2026-10-04 stylophone take, by hand: too big for the repo.
//
//	HINDSIGHT_TEMPO_WAV=/path/copy_2026-10-04_095937.wav go test ./internal/audio -run RealTake -v
func TestMeasureARealTake(t *testing.T) {
	path := os.Getenv("HINDSIGHT_TEMPO_WAV")
	if path == "" {
		t.Skip("set HINDSIGHT_TEMPO_WAV to a take")
	}
	x, sr, err := readMiddle(path, measureWindowSeconds)
	if err != nil {
		t.Fatal(err)
	}
	bpm, ok := measure(x, sr, 125.32)
	t.Logf("%s: %.3f BPM (ok %v)", filepath.Base(path), bpm, ok)
	if !ok || bpm < 125.1 || bpm > 125.4 {
		t.Errorf("want 125.1–125.4")
	}
}
```

`nowForTest` and `testSaveConfig` don't exist yet; add them at the bottom of the same file:

```go
func nowForTest() time.Time { return time.Now() }

// testSaveConfig is the smallest config a save works with, into dir.
func testSaveConfig(dir string) *config.Config {
	return &config.Config{Channels: 2, SampleRate: 48000, RingSeconds: 10, SaveChannels: []int{0, 1}, OutputDir: dir}
}
```

and add `"time"` and `"github.com/gabeduke/hindsight/internal/config"` to its imports.

- [ ] **Step 2: Run them to see them fail**

Run: `CGO_ENABLED=0 go test ./internal/audio/ -run 'MeasureTempo|KeepMeasured|StampTempoSays|ASaveMeasures|RealTake'`
Expected: FAIL to build: `undefined: TempoFromClock`, `MeasureTempo`, `keepMeasured`, `measureTempo`, `readMiddle`, `measure`, `measureWindowSeconds`.

- [ ] **Step 3: The sidecar field**

In `internal/audio/meta.go`, after the `BPM` field of `Meta`:

```go
	// TempoFrom says where BPM came from: TempoFromClock (the MIDI clock, at
	// save), TempoFromAudio (measured from the take), or TempoFromYou
	// (edited). Empty for a take saved before it was kept. Optional and
	// additive, like BPM.
	TempoFrom string `json:"tempo_from,omitempty"`
```

and after the `Meta` struct:

```go
// Where a take's tempo came from: Meta.TempoFrom.
const (
	TempoFromClock = "clock"
	TempoFromAudio = "audio"
	TempoFromYou   = "you"
)
```

In `internal/audio/save.go`: in the `Take` struct, after `BPM`, add
`TempoFrom     string            `json:"tempo_from,omitempty"``; where a `Take` is filled from its sidecar (`t.BPM = m.BPM`), add `t.TempoFrom = m.TempoFrom`; in `stampTempo`, change the update to
`func(m *Meta) error { m.BPM = &bpm; m.TempoFrom = TempoFromClock; return nil }`.

- [ ] **Step 4: `internal/audio/measure.go`**

```go
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
```

- [ ] **Step 5: Run it after every ring and ribbon save**

In `internal/audio/save.go`, `afterSave`:

```go
// afterSave starts what a save leaves to the background: the preview encode,
// measuring the take's tempo, and MAX_SAVES pruning.
func (s *Saver) afterSave(wavPath string, outCh int, keep ...string) {
	s.bg.Add(3)
	go func() { defer s.bg.Done(); s.makePreview(wavPath, outCh) }()
	go func() { defer s.bg.Done(); measureTempo(wavPath) }()
	go func() { defer s.bg.Done(); s.prune(keep...) }()
}
```

- [ ] **Step 6: …and after a phone take**

In `internal/api/phone.go`, after the line that backgrounds `audio.MakePreview` for a finished phone take:

```go
		a.background(func() { audio.MeasureTempo(filepath.Join(a.cfg.OutputDir, name)) })
```

- [ ] **Step 7: An edit says it's yours**

In `internal/api/api.go`'s take PATCH handler, where a BPM value is set (`m.BPM = &v`), also set `m.TempoFrom = audio.TempoFromYou`; where it's cleared (`m.BPM = nil`), also set `m.TempoFrom = ""`. In the handler's response struct, after `BPM`, add `TempoFrom string `json:"tempo_from"`` and fill it with `TempoFrom: m.TempoFrom`.

Add to `internal/api/api_test.go`, after `TestPatchTakeResponseCarriesTheBPM` (it uses that file's `newTestAPI`, `writeTake` and `patch`):

```go
// A tempo typed on the take page is yours: the measurement leaves it alone,
// and the page stops calling it measured.
func TestEditingTheTempoMakesItYours(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeTake(t, dir, "jam_a.wav")
	measured := 125.17
	if err := audio.WriteMeta(wav, audio.Meta{BPM: &measured, TempoFrom: audio.TempoFromAudio}); err != nil {
		t.Fatal(err)
	}

	w := patch(t, r, "jam_a.wav", `{"bpm":125.2}`)
	var got struct {
		TempoFrom string `json:"tempo_from"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.TempoFrom != audio.TempoFromYou {
		t.Errorf("response tempo_from = %q, want you", got.TempoFrom)
	}
	if m := audio.ReadMeta(wav); m.TempoFrom != audio.TempoFromYou {
		t.Errorf("sidecar tempo_from = %q, want you", m.TempoFrom)
	}

	patch(t, r, "jam_a.wav", `{"bpm":null}`)
	if m := audio.ReadMeta(wav); m.BPM != nil || m.TempoFrom != "" {
		t.Errorf("cleared: BPM %v, tempo_from %q; want neither", m.BPM, m.TempoFrom)
	}
}
```

- [ ] **Step 8: Run the tests**

Run: `CGO_ENABLED=0 go test ./internal/audio/ ./internal/api/ ./internal/tempo/`
Expected: `ok` for all three. `TestMeasureARealTake` skips.

- [ ] **Step 9: Measure the real take by hand**

Run (the file is in the session scratchpad; or fetch it from the Pi's `~/hindsight-tapes/audio/`):
`HINDSIGHT_TEMPO_WAV=<path>/take.wav CGO_ENABLED=0 go test ./internal/audio -run RealTake -v`
Expected: PASS, logging about 125.17 BPM.

- [ ] **Step 10: Commit**

```bash
git add internal/audio internal/api
git commit -m "Measure every take's tempo after it's saved

A ring, ribbon or phone save measures the take's tempo in the background,
with the MIDI clock's reading as the hint, and keeps it when the take has
a steady pulse and nobody has edited the tempo meanwhile. tempo_from says
where a take's tempo came from: clock, audio, or you."
```

---

### Task 3: A take's tempo onto the tape

**Files:**
- Modify: `internal/tape/clipboard.go` (`Clipboard`, `CopyTake`, `DropClipboard`)
- Modify: `internal/tape/tap.go` (add `barsFor` beside `guessBarsNear`)
- Modify: `internal/tape/engine.go` (`DropTake`; remove `guessBars` if nothing else calls it)
- Test: `internal/tape/clipboard_test.go`, `internal/tape/engine_test.go`

**Interfaces:**
- Consumes: `audio.ReadMeta(path).BPM` (existing), Task 2's measured BPMs.
- Produces: `Clipboard.BPM float64` (JSON `bpm`, omitempty); `barsFor(frames int64, sampleRate int, bpm, near float64) int`.

- [ ] **Step 1: Write the failing tests**

In `internal/tape/engine_test.go`:

```go
func TestBarsForCountsWholeBarsAtATakesTempo(t *testing.T) {
	bar := func(bpm float64) float64 { return 4 * 60 * 48000 / bpm }
	cases := []struct {
		name        string
		frames      int64
		bpm, near   float64
		want        int
	}{
		{"six bars at 125.25", int64(math.Round(6 * bar(125.25))), 125.25, 90, 6},
		{"three bars", int64(math.Round(3 * bar(96))), 96, 90, 3},
		{"half a percent of a bar long", int64(math.Round(8*bar(120) + 0.005*bar(120))), 120, 90, 8},
		{"not whole bars: the guess, hinted by the take", int64(math.Round(5.5 * bar(125.25))), 125.25, 90, 4},
		{"no tempo: the guess near the last tape's", 96000, 0, 120, 1},
	}
	for _, c := range cases {
		if got := barsFor(c.frames, 48000, c.bpm, c.near); got != c.want {
			t.Errorf("%s: %d bars, want %d", c.name, got, c.want)
		}
	}
}

func TestATakesTempoMakesTheFirstLoopExactly(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 600000, func(i int) float64 { return 0.25 })
	bpm := 125.25
	if err := audio.WriteMeta(take, audio.Meta{BPM: &bpm}); err != nil {
		t.Fatal(err)
	}
	frames := int64(math.Round(6 * 4 * 60 * 48000 / bpm)) // six bars
	c, err := e.CopyTake(take, "jam_take.wav", 0, frames, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if c.BPM != 125.25 {
		t.Fatalf("clipboard BPM %v, want the take's 125.25", c.BPM)
	}
	if _, err := e.DropClipboard(tp.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	g := e.Loaded().Grid
	if g == nil || g.Frames != frames || g.Bars != 6 {
		t.Fatalf("grid %+v, want %d frames as 6 bars", g, frames)
	}
}

func TestAClipboardWithNoTempoDropsAsBefore(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 }) // no sidecar
	c, err := e.CopyTake(take, "jam_take.wav", 0, 96000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if c.BPM != 0 {
		t.Fatalf("clipboard BPM %v, want none", c.BPM)
	}
	if _, err := e.DropClipboard(tp.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	// 2 s: one bar at 120, the guess nearest 90 with no other tapes.
	if g := e.Loaded().Grid; g == nil || g.Frames != 96000 || g.Bars != 1 {
		t.Fatalf("grid %+v, want 96000 frames as 1 bar", g)
	}
}

func TestDropTakeCountsBarsFromTheTakesTempo(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 600000, func(i int) float64 { return 0.25 })
	bpm := 96.0
	if err := audio.WriteMeta(take, audio.Meta{BPM: &bpm}); err != nil {
		t.Fatal(err)
	}
	frames := int64(3 * 4 * 60 * 48000 / 96) // three bars, 360000
	if _, err := e.DropTake(tp.ID, take, 0, frames, 1, 0, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	if g := e.Loaded().Grid; g == nil || g.Bars != 3 || g.Frames != frames {
		t.Fatalf("grid %+v, want %d frames as 3 bars", g, frames)
	}
}
```

(Add `"math"` and the `audio` import to `engine_test.go` if missing. For "not whole bars", 5.5 bars at 125.25 is 503,868 frames; the power-of-two bar counts give 4 → 91.45 BPM and 8 → 182.9: log distance to 125.25 is 0.315 for 4 and 0.379 for 8, so 4.)

- [ ] **Step 2: Run them to see them fail**

Run: `CGO_ENABLED=0 go test ./internal/tape/ -run 'BarsFor|TakesTempo|NoTempoDrops|DropTakeCounts'`
Expected: FAIL to build: `undefined: barsFor`, `c.BPM undefined`.

- [ ] **Step 3: The clipboard carries a tempo**

In `internal/tape/clipboard.go`, `Clipboard` gains, after `Frames`:

```go
	// BPM is the tempo of the take it was copied from, if that take has
	// one: a drop onto an empty tape counts bars by it. 0 for a copy from
	// the ring or a tape.
	BPM float64 `json:"bpm,omitempty"`
```

In `CopyTake`, after building `c` and before saving it:

```go
	if m := audio.ReadMeta(take); m.BPM != nil {
		c.BPM = *m.BPM
	}
```

- [ ] **Step 4: `barsFor`**

In `internal/tape/tap.go`, above `guessBarsNear`:

```go
// barsFor is how many bars a first loop of frames is. With the tempo of the
// take it came from, it's that many whole bars when the frames are within
// 1% of a bar of a whole number of them (1–64); else, or with no tempo,
// it's guessBarsNear, hinted by that tempo or, with none, by near.
func barsFor(frames int64, sampleRate int, bpm, near float64) int {
	if bpm > 0 {
		bar := 4 * 60 * float64(sampleRate) / bpm
		n := math.Round(float64(frames) / bar)
		if n >= 1 && n <= 64 && math.Abs(float64(frames)-n*bar) <= 0.01*bar {
			return int(n)
		}
		near = bpm
	}
	return guessBarsNear(frames, sampleRate, near)
}
```

- [ ] **Step 5: Drops use it**

In `DropClipboard`, replace `bars := guessBarsNear(c.Frames, sr, near)` with `bars := barsFor(c.Frames, sr, c.BPM, near)`.

In `DropTake`, replace

```go
			if bars <= 0 {
				bars = guessBars(frames, e.store.SampleRate())
			}
```

with

```go
			if bars <= 0 {
				bpm := 0.0
				if m := audio.ReadMeta(take); m.BPM != nil {
					bpm = *m.BPM
				}
				bars = barsFor(frames, e.store.SampleRate(), bpm, 90)
			}
```

Then `grep -n 'guessBars(' internal/tape/*.go`; if only its definition is left, delete `guessBars`.

- [ ] **Step 6: Run the tape tests**

Run: `CGO_ENABLED=0 go test ./internal/tape/`
Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
git add internal/tape
git commit -m "A take's tempo sets the first loop's bars

The clipboard carries the tempo of the take it was copied from, and a drop
onto an empty tape counts whole bars by it -- any number, 1 to 64 -- so a
loop selected on the take's bars is exactly that many bars on the tape."
```

---

### Task 4: The empty-tape form's tempo

**Files:**
- Modify: `internal/tape/tap.go` (`lastBPM` → built on a new `LastTapeBPM`)
- Modify: `internal/api/tape.go` (`tapeStateResponse`, `writeTapeStateWith`, a new `suggestBPM`)
- Test: `internal/api/tape_test.go`

**Interfaces:**
- Consumes: `Clipboard.BPM` (Task 3); `a.takes.List() ([]audio.Take, string, error)`; `Take.BPM`, `Take.Created`.
- Produces: `(*tape.Engine).LastTapeBPM(except string) (float64, bool)`; tape state JSON `suggest_bpm` (omitempty), set only for an empty tape with no grid.

- [ ] **Step 1: Write the failing test**

In `internal/api/tape_test.go`:

```go
func TestAnEmptyTapeSuggestsTheTempoYouWerePlaying(t *testing.T) {
	r, dir := newTapeAPI(t)
	write := func(name string, bpm float64) {
		p := filepath.Join(dir, name)
		if _, err := audio.WriteWAV(p, make([]int32, 2*96000), 2, []int{0, 1}, 48000); err != nil {
			t.Fatal(err)
		}
		if err := audio.WriteMeta(p, audio.Meta{BPM: &bpm}); err != nil {
			t.Fatal(err)
		}
	}
	write("jam_2026-10-04_10-00-00.wav", 100)
	write("jam_2026-10-04_11-00-00.wav", 125.25) // the newest
	var made struct{ ID string `json:"id"` }
	w := send(t, r, http.MethodPost, "/api/tapes", `{"name":"s"}`)
	want(t, w, http.StatusOK, "create")
	json.Unmarshal(w.Body.Bytes(), &made)
	suggest := func() float64 {
		var b struct{ Suggest float64 `json:"suggest_bpm"` }
		w := send(t, r, http.MethodGet, "/api/tapes/state?id="+made.ID, "")
		want(t, w, http.StatusOK, "state")
		json.Unmarshal(w.Body.Bytes(), &b)
		return b.Suggest
	}
	if got := suggest(); got != 125.25 {
		t.Fatalf("suggest_bpm %v, want the newest take's 125.25", got)
	}
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_10-00-00.wav","from":0,"to":48000}`)
	want(t, w, http.StatusOK, "copy")
	if got := suggest(); got != 100 {
		t.Fatalf("suggest_bpm %v, want the clipboard's 100", got)
	}
}
```

(Check `POST /api/tapes`'s status code and body in the existing tests and match them; add imports as needed.)

- [ ] **Step 2: Run it to see it fail**

Run: `CGO_ENABLED=0 go test ./internal/api/ -run SuggestsTheTempo`
Expected: FAIL: `suggest_bpm 0, want the newest take's 125.25`.

- [ ] **Step 3: `LastTapeBPM`**

In `internal/tape/tap.go`, replace `lastBPM` with:

```go
// LastTapeBPM is the tempo of the newest other tape that has one.
func (e *Engine) LastTapeBPM(except string) (float64, bool) {
	if list, err := e.store.List(); err == nil {
		for _, s := range list {
			if s.ID != except && s.BPM > 0 {
				return s.BPM, true
			}
		}
	}
	return 0, false
}

// lastBPM is LastTapeBPM, or 90 with no other tape to go by.
func (e *Engine) lastBPM(except string) float64 {
	if bpm, ok := e.LastTapeBPM(except); ok {
		return bpm
	}
	return 90
}
```

- [ ] **Step 4: `suggest_bpm`**

In `internal/api/tape.go`, `tapeStateResponse` gains
`SuggestBPM float64 `json:"suggest_bpm,omitempty"` // where an empty tape's tempo form starts`. In `writeTapeStateWith`, after the `resp.BPM` lines:

```go
	if resp.Tape.Grid == nil && resp.Tape.Empty() {
		resp.SuggestBPM = a.suggestBPM(resp.Tape.ID)
	}
```

and below it:

```go
// suggestBPM is where an empty tape's tempo form starts: the clipboard's
// tempo, else the newest take's that has one, else the last tape's, else 90.
func (a *API) suggestBPM(id string) float64 {
	if c, err := a.tape.Clipboard(); err == nil && c != nil && c.BPM > 0 {
		return c.BPM
	}
	if takes, _, err := a.takes.List(); err == nil {
		var newest *audio.Take
		for i := range takes {
			if takes[i].BPM != nil && (newest == nil || takes[i].Created.After(newest.Created)) {
				newest = &takes[i]
			}
		}
		if newest != nil {
			return *newest.BPM
		}
	}
	if bpm, ok := a.tape.LastTapeBPM(id); ok {
		return bpm
	}
	return 90
}
```

- [ ] **Step 5: Run the tests**

Run: `CGO_ENABLED=0 go test ./internal/api/ ./internal/tape/`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add internal/api internal/tape
git commit -m "An empty tape suggests the tempo you were playing

The tape state offers suggest_bpm for an empty tape: the clipboard's
tempo, the newest take's, the last tape's, and only then 90."
```

---

### Task 5: The pages

**Files:**
- Modify: `web/static/lib/wave/geometry.js` (add `initialSnap`, `tempoLabel`)
- Test: `web/static/lib/wave/geometry.test.js`
- Modify: `web/static/lib/wave/page.js` (snap's first value; the tempo's label; `tempo_from` from a PATCH and a refresh)
- Modify: `web/static/wave.html` (Send to tape into the toolbar)
- Modify: `web/static/tape.html` (the empty-tape text)
- Modify: `web/static/lib/tape/page.js` (the form's BPM from `suggest_bpm`)
- Modify: `docs/guide.md` (§4 take page, §8 "From a take", its check)

**Interfaces:**
- Consumes: take JSON `tempo_from` (Task 2), tape state `suggest_bpm` (Task 4).
- Produces: `initialSnap(stored, hasBpm) → 'off'|'bar'|'beat'|'eighth'`; `tempoLabel(bpm, from) → string`.

- [ ] **Step 1: Write the failing tests**

Append to `web/static/lib/wave/geometry.test.js`, and add `initialSnap, tempoLabel` to its import from `./geometry.js`:

```js
test('snap starts on bars for a take with a tempo, unless one was chosen before', () => {
  assert.equal(initialSnap(null, true), 'bar');
  assert.equal(initialSnap(null, false), 'off');
  assert.equal(initialSnap('off', true), 'off', 'a choice is kept');
  assert.equal(initialSnap('beat', false), 'beat');
  assert.equal(initialSnap('nonsense', true), 'bar');
});

test('the tempo says where it came from', () => {
  assert.equal(tempoLabel(125.17, 'audio'), '125.17 bpm · measured');
  assert.equal(tempoLabel(125.32, 'clock'), '125.32 bpm · clock');
  assert.equal(tempoLabel(120, 'you'), '120 bpm');
  assert.equal(tempoLabel(96, undefined), '96 bpm');
  assert.equal(tempoLabel(null, 'audio'), '+ bpm');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test web/static/lib/wave/geometry.test.js`
Expected: FAIL: `initialSnap` is not exported.

- [ ] **Step 3: The two functions**

Append to `web/static/lib/wave/geometry.js`:

```js
/**
 * initialSnap is the snap a take page opens with: the one chosen before, if
 * any; else bars for a take with a tempo -- so In and Out land on bar lines
 * and a loop sent to tape is whole bars -- and off for one without.
 */
export function initialSnap(stored, hasBpm) {
  if (SNAPS.includes(stored)) return stored;
  return hasBpm ? 'bar' : 'off';
}

/** tempoLabel is the take's tempo as its header reads it, and where it came from. */
export function tempoLabel(bpm, from) {
  if (!bpm) return '+ bpm';
  const note = { audio: ' · measured', clock: ' · clock' }[from] || '';
  return `${bpm} bpm${note}`;
}
```

- [ ] **Step 4: Use them on the take page**

In `web/static/lib/wave/page.js`:
- import `initialSnap, tempoLabel` from `./geometry.js` with the others;
- the state's `snap:` line becomes `snap: initialSnap(readPref('wave.snap', null), !!take.bpm),`;
- the header's `$('take-bpm').textContent = take.bpm ? `${take.bpm} bpm` : '+ bpm';` becomes `$('take-bpm').textContent = tempoLabel(take.bpm, take.tempo_from);`;
- in the BPM edit, after `take.bpm = res.bpm ?? null;` add `take.tempo_from = res.tempo_from || '';`, and before the PATCH (where `take.bpm = bpm;` is set optimistically) add `take.tempo_from = 'you';`;
- in the refresh, after `take.bpm = fresh.bpm;` add `take.tempo_from = fresh.tempo_from;`.

- [ ] **Step 5: Send to tape in the toolbar**

In `web/static/wave.html`, delete the `send-to-tape` button from `#more-menu`, and add it between `#save-take` and `#share`:

```html
        <button id="send-to-tape" class="icon-btn" type="button" hidden data-tip="send-to-tape">Send to tape</button>
```

(`page.js` already unhides it when the Pi runs the tape, and already wires its click.) If the four buttons don't fit at 390 px wide in the demo, give that toolbar row `flex-wrap: wrap` in `styles.css` rather than shrinking the text.

- [ ] **Step 6: The empty-tape form**

In `web/static/tape.html`, the empty tape's text `choose <b>More → Send to tape</b>` becomes `choose <b>Send to tape</b>`.

In `web/static/lib/tape/page.js`, in `apply(s)` after `state.tape = s.tape;`:

```js
  // The empty-tape form starts at the tempo you were playing, until you type.
  if (s.suggest_bpm && !$('new-bpm').dataset.touched) $('new-bpm').value = String(s.suggest_bpm);
```

and in `wire()`, beside the `set-tempo` listener:

```js
  $('new-bpm').addEventListener('input', () => { $('new-bpm').dataset.touched = '1'; });
```

- [ ] **Step 7: The guide**

In `docs/guide.md`:
- §4, near the take page's BPM: add a bullet: "**The tempo** is measured from the audio after every save, with the MIDI clock as a hint: it reads *125.17 bpm · measured*. A take with no steady pulse keeps the clock's (*· clock*). Tap it to type your own."
- §4, Snap: say it starts on **bar** for a take with a tempo, until you choose another.
- §8 "From a take": `**More → Send to tape**` becomes `**Send to tape**`, and replace the first bullet's tempo sentence with: "Its length sets the tempo: with the take's tempo, it's that many whole bars (any number); without one, Hindsight picks the number of bars that puts it nearest your last tape's tempo (or 90 BPM)."
- §8 "From a tempo": add "The BPM starts at the tempo you were last playing: the clipboard's, else your newest take's."
- The step-6 check that says `**More → Send to tape**` says `**Send to tape**`.

- [ ] **Step 8: Run the JS tests**

Run: `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add web docs/guide.md
git commit -m "Take page: the tempo says where it came from, snap starts on bars

Send to tape moves out of More into the toolbar, a take with a tempo opens
with Snap on bars, and the empty tape's form starts at the tempo you were
playing."
```

---

### Task 6: Check it end to end

**Files:** none changed, unless a check fails.

- [ ] **Step 1: The whole suite**

Run: `CGO_ENABLED=0 go test ./... && node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'`
Expected: all `ok`.

- [ ] **Step 2: The demo**

Run the demo (`RING_SECONDS=120 OUTPUT_DIR=<scratch> TAPE=true TAPE_DIR=<scratch> PORT=15173 CGO_ENABLED=0 go run ./cmd/hindsight --demo`), then at 390 × 844 in a browser:
1. Wait 35 s, Capture 30 s, open the take → the header reads *96 bpm · measured* (96.00 ± 0.02; the demo loop is 96 BPM) within a few seconds, and Snap reads *bar*.
2. Hold and drag eight bars; tap **Send to tape** (in the toolbar) → the toast says it was sent; the tape page reads *96.0 BPM · 8 bars*, loop on.
3. ▶ → the seam is clean (no gap in the lanes' clip at the loop's end).
4. Make a new empty tape → the form's BPM reads 96 (the clipboard's). Type 100 and wait two seconds → it still reads 100.
5. Delete the demo's scratch folders and stop the server.

- [ ] **Step 3: Note it in STATE.md**

Add a line to the newest handoff in `STATE.md` (gitignored): what shipped, and that the [rig] check (a stylophone take's measured tempo, and an 8-bar loop with no stutter) is the owner's to do.
