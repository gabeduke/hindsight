package audio

// Sink is a live audio output: the tape player's twin of Source. The device
// calls pull for every block it plays, from one goroutine, and pull fills
// out (interleaved, channels wide) without blocking.
type Sink interface {
	Open(channels int, pull func(out []int32)) (name string, err error)
	Close()
}

// KnownDelta is the optional capability of a Sink that knows exactly where
// its output lands in the capture ring: output frame o (counted from the
// first frame it pulled since Open) is captured at ring frame o + delta. Only
// the demo knows this; on hardware the tape's aligner measures it.
type KnownDelta interface {
	Delta() (delta int64, ok bool)
}
