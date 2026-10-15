package tape

import "math"

// The FX bus: what the room hears after the mix and before the click
// (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md).
//
//	read head ─→ mix ─→ tape character ─→ punch-in FX ─→ click ─→ ToInt32
//	                     DRIVE, AGE        FILTER, CRUSH,  dry
//	                                       ECHO
//
// One bus for the whole tape, as the K.O.'s punch-in FX work on its output:
// four channels, bus A and bus B alike, each stage keeping its state per
// channel from one span to the next, so a block split at a pending action is
// inaudible. A stage with nothing engaged and no tail ringing costs one
// branch, and leaves the samples exactly as they were.
//
// Every change is smoothed: an amount glides through a one-pole of about
// 10 ms (smooth), and an FX comes in and goes out over the renderer's 5 ms
// seam (gate), dry crossfading to wet.
//
// Only the render goroutine touches it, through perf.

const (
	// FILTER: a resonant low-pass whose cutoff falls, exponentially, from
	// open to closed as its amount rises.
	filterOpenHz   = 20000.0
	filterClosedHz = 200.0
	filterK        = 0.7 // 1/Q: resonant, not screaming

	// CRUSH: fewer bits and a lower rate as its amount rises.
	crushBitsOpen   = 12.0
	crushBitsClosed = 4.0
	crushRateClosed = 8.0 // a sample held this many frames, at full crush

	// ECHO: a throw at 3/16 of a bar (a dotted eighth), each repeat this
	// much of the last.
	echoFeedback   = 0.55
	echoMaxSeconds = 2.0
	// echoRepeats is how many repeats ring out before the tail is let go:
	// the next would be 0.55^12, 62 dB down.
	echoRepeats = 12

	// AGE: a one-pole low-pass from open down to about 4 kHz. Its first
	// tenth also fades it in from dry, so an age of 0 is the tape untouched.
	ageOpenHz   = 20000.0
	ageClosedHz = 4000.0
	ageFadeIn   = 0.1

	// DRIVE: tanh(g·x)/tanh(g), g from 1 to 10, mixed in by its amount.
	driveMaxGain = 10.0
)

// gate crossfades a stage from dry (0) to wet (1) and back, a step a frame.
type gate struct {
	e  float32
	on bool
}

func (g *gate) next(step float32) float32 {
	if g.on {
		if g.e < 1 {
			g.e = min(1, g.e+step)
		}
	} else if g.e > 0 {
		g.e = max(0, g.e-step)
	}
	return g.e
}

func (g *gate) skip(n int, step float32) {
	d := float32(n) * step
	if g.on {
		g.e = min(1, g.e+d)
	} else {
		g.e = max(0, g.e-d)
	}
}

// fxBus is the tape's character and the punch-in FX.
type fxBus struct {
	drive, age smooth
	driveV     float64 // the drive the gain below is for
	driveTanh  float64
	ageLive    bool
	ageY       [OutChannels]float32
	ageV       float64 // the age the coefficients below are for
	ageA, ageW float32

	filter fxFilter
	crush  fxCrush
	echo   fxEcho
}

// quiet says whether the bus would leave every sample as it is: nothing
// engaged, nothing ringing, nothing on its way.
func (b *fxBus) quiet() bool {
	return b.drive.idle() && b.age.idle() && !b.filter.live && !b.crush.live && !b.echo.live
}

// press engages FX pad i at amount v, on output frame o.
func (b *fxBus) press(i int, v float64, o uint64, m *Mix) {
	switch i {
	case iFilter:
		b.filter.press(v)
	case iCrush:
		b.crush.press(v)
	case iEcho:
		b.echo.press(v, m)
	}
}

// release lets FX pad i go on output frame o.
func (b *fxBus) release(i int, o uint64, m *Mix) {
	switch i {
	case iFilter:
		sixteenth := int64(unitFrames(QuantumSixteenth, m))
		if sixteenth == 0 {
			sixteenth = int64(0.125 * m.rate())
		}
		b.filter.release(o, sixteenth)
	case iCrush:
		b.crush.release()
	case iEcho:
		b.echo.release(m)
	}
}

// gateStep is how far a gate moves in a frame: across in the renderer's
// 5 ms seam.
func gateStep(m *Mix) float32 {
	xf := m.xfade
	if xf <= 0 {
		xf = int64(xfadeSeconds * m.rate())
	}
	return 1 / float32(max64(1, xf))
}

// process runs n frames of d, in place, from output frame o: the mods, then
// the FX, each at its amount. A mixdown's pass (once) prints the mods; the
// FX aren't in it, as no trick is, and anything they had ringing is dropped.
func (b *fxBus) process(d []float32, n int, o uint64, m *Mix, amount *[numPads]float64, once bool) {
	sr := m.rate()
	a := smoothCoef(sr)
	if !b.drive.idle() {
		b.runDrive(d, n, a)
	}
	if !b.age.idle() {
		b.runAge(d, n, a, sr)
	} else {
		b.ageLive = false
	}
	if once {
		b.skipFX(n, o, m)
		return
	}
	step := gateStep(m)
	if b.filter.live {
		b.filter.run(d, n, o, amount[iFilter], a, sr, step)
	}
	if b.crush.live {
		b.crush.run(d, n, amount[iCrush], a, step)
	}
	if b.echo.live {
		b.echo.run(d, n, amount[iEcho], a, step)
	}
}

// skip moves the bus n frames on without rendering: a late render, where the
// device played silence. Every clock steps; what was ringing is dropped,
// not delayed.
func (b *fxBus) skip(n int, o uint64, m *Mix) {
	a := smoothCoef(m.rate())
	b.drive.skip(n, a)
	b.age.skip(n, a)
	b.ageLive = false
	b.skipFX(n, o, m)
}

func (b *fxBus) skipFX(n int, o uint64, m *Mix) {
	a := smoothCoef(m.rate())
	step := gateStep(m)
	if b.filter.live {
		b.filter.skip(n, o, a, step)
	}
	if b.crush.live {
		b.crush.skip(n, a, step)
	}
	if b.echo.live {
		b.echo.skip(n, a, step)
	}
}

// runDrive is DRIVE: soft saturation, level-matched so full scale stays
// full scale, mixed in by its amount so that 0 is the tape untouched and a
// knob moving off 0 doesn't jump. Never outside ±1.
func (b *fxBus) runDrive(d []float32, n int, a float64) {
	for k := 0; k < n; k++ {
		v := b.drive.step(a)
		if v == 0 {
			continue
		}
		g := 1 + (driveMaxGain-1)*v
		if v != b.driveV {
			b.driveV, b.driveTanh = v, math.Tanh(g)
		}
		i := k * OutChannels
		for c := 0; c < OutChannels; c++ {
			if d[i+c] == 0 {
				continue // a bus with nothing on it stays silent, and costs no tanh
			}
			x := math.Max(-1, math.Min(1, float64(d[i+c])))
			d[i+c] = float32((1-v)*x + v*math.Tanh(g*x)/b.driveTanh)
		}
	}
}

// runAge is AGE: the top end falls, a one-pole low-pass from open down to
// about 4 kHz.
func (b *fxBus) runAge(d []float32, n int, a, sr float64) {
	if !b.ageLive {
		// From where the signal is, so it starts without a step.
		b.ageLive, b.ageV = true, -1
		copy(b.ageY[:], d[:OutChannels])
	}
	for k := 0; k < n; k++ {
		v := b.age.step(a)
		if v != b.ageV {
			fc := ageOpenHz * math.Pow(ageClosedHz/ageOpenHz, v)
			b.ageA = float32(1 - math.Exp(-2*math.Pi*fc/sr))
			b.ageW = float32(math.Min(1, v/ageFadeIn))
			b.ageV = v
		}
		i := k * OutChannels
		for c := 0; c < OutChannels; c++ {
			x := d[i+c]
			y := b.ageA*x + (1-b.ageA)*b.ageY[c]
			b.ageY[c] = y
			d[i+c] = x*(1-b.ageW) + y*b.ageW
		}
	}
}

// fxFilter is FILTER: a state-variable low-pass per channel (the
// trapezoidal form, stable all the way up). Let go, it sweeps back open over
// a sixteenth, then crossfades to dry and bypasses.
type fxFilter struct {
	live, held bool
	amt        smooth
	gate       gate
	sweep      bool    // let go: reopening
	from       float64 // the amount it reopens from
	at         uint64  // the output frame it began to
	length     int64   // over this many frames
	warm       bool    // its state takes the next frame as where it is
	ic1, ic2   [OutChannels]float64
	cv         float64 // the amount the coefficients are for
	a1, a2, a3 float64
}

func (f *fxFilter) press(v float64) {
	f.held, f.sweep = true, false
	if !f.live {
		*f = fxFilter{live: true, held: true, warm: true, amt: smooth{v: v, to: v}, cv: -1}
	}
	f.amt.to = v
	f.gate.on = true
}

func (f *fxFilter) release(o uint64, sixteenth int64) {
	f.held = false
	f.sweep, f.from, f.at, f.length = true, f.amt.v, o, max64(1, sixteenth)
}

// cutoff is the filter's cutoff at amount v.
func filterCutoff(v, sr float64) float64 {
	return math.Min(filterOpenHz*math.Pow(filterClosedHz/filterOpenHz, v), 0.45*sr)
}

func (f *fxFilter) coef(v, sr float64) {
	g := math.Tan(math.Pi * filterCutoff(v, sr) / sr)
	f.a1 = 1 / (1 + g*(g+filterK))
	f.a2 = g * f.a1
	f.a3 = g * f.a2
	f.cv = v
}

func (f *fxFilter) run(d []float32, n int, o uint64, target, a, sr float64, step float32) {
	if f.held {
		f.amt.to = target
	}
	for k := 0; k < n; k++ {
		var v float64
		if f.sweep {
			x := float64(int64(o)+int64(k)-int64(f.at)) / float64(f.length)
			if x >= 1 {
				x = 1
				f.gate.on = false
			}
			v = f.from * (1 - x)
			f.amt = smooth{v: v, to: v}
		} else {
			v = f.amt.step(a)
		}
		if v != f.cv {
			f.coef(v, sr)
		}
		e := float64(f.gate.next(step))
		i := k * OutChannels
		for c := 0; c < OutChannels; c++ {
			x := float64(d[i+c])
			if f.warm {
				f.ic1[c], f.ic2[c] = 0, x
			}
			v3 := x - f.ic2[c]
			v1 := f.a1*f.ic1[c] + f.a2*v3
			v2 := f.ic2[c] + f.a2*f.ic1[c] + f.a3*v3
			f.ic1[c] = 2*v1 - f.ic1[c]
			f.ic2[c] = 2*v2 - f.ic2[c]
			d[i+c] = float32(x*(1-e) + v2*e)
		}
		f.warm = false
		if !f.gate.on && e == 0 {
			f.live = false // open, and dry again: bypassed from the next frame
			return
		}
	}
}

func (f *fxFilter) skip(n int, o uint64, a float64, step float32) {
	if f.sweep && int64(o)+int64(n) >= int64(f.at)+f.length {
		f.gate.on = false
		f.amt = smooth{}
	}
	f.amt.skip(n, a)
	f.gate.skip(n, step)
	f.warm = true // the device played silence: the state starts again
	if !f.gate.on && f.gate.e == 0 {
		f.live = false
	}
}

// fxCrush is CRUSH: the signal held for a few frames at a time (the rate
// down to an eighth) and rounded to fewer bits (12 down to 4).
type fxCrush struct {
	live, held bool
	amt        smooth
	gate       gate
	ph         float64 // frames since the last sample was taken
	fresh      bool    // take the next frame
	hold       [OutChannels]float32
	// What amount cv means: hold a sample rate frames, round it to q.
	cv, rate, q, lim float64
}

func (f *fxCrush) press(v float64) {
	f.held = true
	if !f.live {
		*f = fxCrush{live: true, held: true, fresh: true, amt: smooth{v: v, to: v}, cv: -1}
	}
	f.amt.to = v
	f.gate.on = true
}

func (f *fxCrush) release() {
	f.held = false
	f.gate.on = false
}

// crushBits is how many bits CRUSH keeps at amount v.
func crushBits(v float64) float64 { return crushBitsOpen - (crushBitsOpen-crushBitsClosed)*v }

// crushStep is CRUSH's rounding at bits bits: a step of q, from -lim to
// lim-1 steps -- 2^bits levels across ±1.
func crushStep(bits float64) (q, lim float64) {
	return math.Exp2(1 - bits), math.Floor(math.Exp2(bits - 1))
}

// crush rounds x to one of crushStep's levels.
func crush(x float32, q, lim float64) float32 {
	k := math.Round(float64(x) / q)
	k = math.Max(-lim, math.Min(lim-1, k))
	return float32(k * q)
}

func (f *fxCrush) run(d []float32, n int, target, a float64, step float32) {
	if f.held {
		f.amt.to = target
	}
	for k := 0; k < n; k++ {
		v := f.amt.step(a)
		if v != f.cv {
			f.cv, f.rate = v, math.Pow(crushRateClosed, v)
			f.q, f.lim = crushStep(crushBits(v))
		}
		e := f.gate.next(step)
		i := k * OutChannels
		f.ph++
		if f.fresh || f.ph >= f.rate {
			if f.fresh {
				f.ph, f.fresh = 0, false
			} else {
				f.ph -= f.rate
			}
			for c := 0; c < OutChannels; c++ {
				f.hold[c] = crush(d[i+c], f.q, f.lim)
			}
		}
		for c := 0; c < OutChannels; c++ {
			d[i+c] = d[i+c]*(1-e) + f.hold[c]*e
		}
		if !f.gate.on && e == 0 {
			f.live = false
			return
		}
	}
}

func (f *fxCrush) skip(n int, a float64, step float32) {
	f.amt.skip(n, a)
	f.gate.skip(n, step)
	f.fresh = true
	if !f.gate.on && f.gate.e == 0 {
		f.live = false
	}
}

// fxEcho is ECHO: a delay throw. Only what plays while it's held goes in;
// let go, the repeats ring out until they're 60 dB down, then fade and the
// stage bypasses.
type fxEcho struct {
	live, held bool
	amt        smooth // the send level
	send       gate   // what plays goes in
	wet        gate   // the repeats come out; it closes once they've died
	line       []float32
	dl         int   // the delay, in frames: the line's length
	w          int   // where the line is read and written
	tail       int64 // frames of ringing left once let go; -1 while held
}

// echoFrames is ECHO's delay: 3/16 of a bar, or of a 120 BPM bar on a tape
// with no tempo, and never more than 2 s.
func echoFrames(m *Mix) int {
	sr := m.rate()
	bar := 2 * sr
	if m.grid != nil {
		bar = m.grid.BarFrames()
	}
	return int(max64(1, int64(math.Round(math.Min(3*bar/16, echoMaxSeconds*sr)))))
}

func (f *fxEcho) press(v float64, m *Mix) {
	f.held, f.tail = true, -1
	if !f.live {
		f.live, f.dl, f.w = true, echoFrames(m), 0
		if need := f.dl * OutChannels; cap(f.line) < need {
			f.line = make([]float32, need)
		}
		f.line = f.line[:f.dl*OutChannels]
		clear(f.line)
		f.amt = smooth{v: v, to: v}
		f.send = gate{}
		f.wet = gate{e: 1, on: true} // nothing in the line yet to fade in
	}
	f.amt.to = v
	f.send.on, f.wet.on = true, true
}

func (f *fxEcho) release(m *Mix) {
	f.held = false
	f.send.on = false
	// Until everything still sounding is a 13th repeat or later; the send
	// takes a seam to close.
	f.tail = int64(echoRepeats*f.dl) + max64(1, m.xfade)
}

func (f *fxEcho) run(d []float32, n int, target, a float64, step float32) {
	if f.held {
		f.amt.to = target
	}
	for k := 0; k < n; k++ {
		g := float32(f.amt.step(a)) * f.send.next(step)
		if f.tail == 0 {
			f.wet.on = false
		} else if f.tail > 0 {
			f.tail--
		}
		we := f.wet.next(step)
		i, j := k*OutChannels, f.w*OutChannels
		for c := 0; c < OutChannels; c++ {
			x, tap := d[i+c], f.line[j+c]
			f.line[j+c] = x*g + echoFeedback*tap
			d[i+c] = x + tap*we
		}
		if f.w++; f.w == f.dl {
			f.w = 0
		}
		if !f.wet.on && we == 0 {
			f.live = false
			return
		}
	}
}

// skip drops what was ringing: a late render's repeats aren't played late.
func (f *fxEcho) skip(n int, a float64, step float32) {
	clear(f.line)
	f.amt.skip(n, a)
	f.send.skip(n, step)
	if !f.held {
		f.live = false
	}
}
