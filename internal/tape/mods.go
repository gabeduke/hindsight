package tape

import "math"

// The render goroutine's side of the tape mods (style.go): WOW, FLUTTER and
// the bend, as an offset from where the head would read, and the one-pole
// every amount glides through.

const (
	// smoothSeconds is the one-pole every amount moves through, so a jump of
	// a knob is a glide, not a click.
	smoothSeconds = 0.010
	// snapAt is how close a smoothed amount must come to rest on its target.
	snapAt = 1e-5

	wowHz      = 0.8
	wowDepth   = 0.005 // ±0.5 % in pitch, at full wow
	flutterHz  = 8.0
	flutterDev = 0.001 // ±0.1 % in pitch, at full flutter
	// flutterJitter wanders flutter's rate by up to this fraction, so it
	// doesn't sound like a vibrato. Its depth allows for the fastest it
	// goes, so the pitch never moves more than flutterDev.
	flutterJitter = 0.2
	// bendDepth is the bend's ±8 % at full bend.
	bendDepth = 0.08
)

// smooth is an amount gliding toward where it was set.
type smooth struct{ v, to float64 }

func smoothCoef(sr float64) float64 { return 1 - math.Exp(-1/(smoothSeconds*sr)) }

// step moves it one frame on, and says where it is.
func (s *smooth) step(a float64) float64 {
	if s.v != s.to {
		s.v += (s.to - s.v) * a
		if math.Abs(s.to-s.v) < snapAt {
			s.v = s.to
		}
	}
	return s.v
}

// skip moves it n frames on.
func (s *smooth) skip(n int, a float64) {
	if s.v == s.to {
		return
	}
	s.v = s.to + (s.v-s.to)*math.Pow(1-a, float64(n))
	if math.Abs(s.to-s.v) < snapAt {
		s.v = s.to
	}
}

func (s smooth) idle() bool { return s.v == 0 && s.to == 0 }

// modulation is WOW, FLUTTER and the bend: what they add to where the head
// reads, frame by frame, carried from one span to the next.
type modulation struct {
	wow, flutter smooth
	wowPhase     float64
	flPhase      float64
	flRand       float64 // flutter's wander, -1 to 1, toward flTarget
	flTarget     float64
	flNext       int // frames until it picks a new target
	rng          uint64

	bend    smooth  // the bend, -1 to 1
	bendOn  bool    // held
	bendOff float64 // frames ahead it reads now: the bend so far
}

// wobbles says whether WOW or FLUTTER is up, or on its way.
func (md *modulation) wobbles() bool { return !md.wow.idle() || !md.flutter.idle() }

// run fills wf with WOW and FLUTTER's offset, and bend with the bend's, for
// the next n frames, and moves them on.
func (md *modulation) run(wf, bend []float64, n int, sr float64) {
	a := smoothCoef(sr)
	if md.wobbles() {
		aw := wowDepth * sr / (2 * math.Pi * wowHz)
		af := flutterDev * sr / (2 * math.Pi * flutterHz * (1 + flutterJitter))
		dw := 2 * math.Pi * wowHz / sr
		ra := smoothCoef(sr / 3) // the wander glides over 30 ms
		for k := 0; k < n; k++ {
			w := md.wow.step(a)
			f := md.flutter.step(a)
			if md.flNext <= 0 {
				md.flTarget = md.random()
				md.flNext = int(0.05 * sr)
			}
			md.flNext--
			md.flRand += (md.flTarget - md.flRand) * ra
			wf[k] = aw*w*math.Sin(md.wowPhase) + af*f*math.Sin(md.flPhase)
			// Wrapped frame by frame, not span by span: the same frames come
			// out the same however advance splits them.
			if md.wowPhase += dw; md.wowPhase >= 2*math.Pi {
				md.wowPhase -= 2 * math.Pi
			}
			if md.flPhase += 2 * math.Pi * flutterHz * (1 + flutterJitter*md.flRand) / sr; md.flPhase >= 2*math.Pi {
				md.flPhase -= 2 * math.Pi
			}
		}
	}
	if md.bendOn {
		for k := 0; k < n; k++ {
			bend[k] = md.bendOff
			md.bendOff += bendDepth * md.bend.step(a)
		}
	}
}

// skip moves them n frames on without rendering: a late render, where the
// tape counted on.
func (md *modulation) skip(n int, sr float64) {
	a := smoothCoef(sr)
	if md.wobbles() {
		md.wow.skip(n, a)
		md.flutter.skip(n, a)
		md.wowPhase = math.Mod(md.wowPhase+2*math.Pi*wowHz*float64(n)/sr, 2*math.Pi)
		md.flPhase = math.Mod(md.flPhase+2*math.Pi*flutterHz*float64(n)/sr, 2*math.Pi)
	}
	if md.bendOn {
		// The sum of a one-pole's glide over n frames.
		b := &md.bend
		sum := float64(n)*b.to + (b.v-b.to)*(1-math.Pow(1-a, float64(n)))/a
		md.bendOff += bendDepth * sum
		b.skip(n, a)
	}
}

// random is a repeatable number from -1 to 1: twin engines wander alike.
func (md *modulation) random() float64 {
	if md.rng == 0 {
		md.rng = 0x9e3779b97f4a7c15
	}
	md.rng ^= md.rng << 13
	md.rng ^= md.rng >> 7
	md.rng ^= md.rng << 17
	return float64(md.rng>>11)/float64(1<<53)*2 - 1
}
