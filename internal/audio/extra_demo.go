package audio

import (
	"math"
	"sync"
	"time"
)

// demoExtraPPM is how far the demo's extra input's clock runs from the main
// one's, on purpose, so the demo and CI steer a drift as the AMS-24 does.
const demoExtraPPM = 80

// demoExtra is the demo's extra input: a guitar picking a note on every beat
// at 96 BPM, on two channels, its frames paced 80 ppm fast.
type demoExtra struct {
	rate int

	mu         sync.Mutex
	stop, done chan struct{}
}

// NewDemoExtraSource is an extra input for --demo.
func NewDemoExtraSource(rate int) ExtraSource { return &demoExtra{rate: rate} }

func (d *demoExtra) Open(sink func([]int32)) (string, error) {
	d.Close()
	d.mu.Lock()
	d.stop, d.done = make(chan struct{}), make(chan struct{})
	stop, done := d.stop, d.done
	d.mu.Unlock()
	const period = 1024
	go func() {
		defer close(done)
		rate := float64(d.rate) * (1 + demoExtraPPM*1e-6)
		block := make([]int32, period*2)
		start := time.Now()
		t := time.NewTicker(time.Duration(float64(period) / rate * float64(time.Second)))
		defer t.Stop()
		var n int64
		for {
			select {
			case <-stop:
				return
			case <-t.C:
			}
			// As many whole periods as its clock has run: a ticker alone
			// would keep the main one's time.
			for float64(n+period) <= time.Since(start).Seconds()*rate {
				for f := 0; f < period; f++ {
					v := demoPluck(float64(n+int64(f)) / rate)
					block[2*f], block[2*f+1] = v, v/2
				}
				n += period
				sink(block)
			}
		}
	}()
	return "Demo extra input (synthetic guitar, +80 ppm)", nil
}

// demoPluck is a plucked A on every beat at 96 BPM: a decaying fundamental
// and two harmonics.
func demoPluck(t float64) int32 {
	const beat = 60.0 / 96
	since := math.Mod(t, beat)
	f := 220.0
	v := math.Sin(2*math.Pi*f*t) + 0.4*math.Sin(4*math.Pi*f*t) + 0.2*math.Sin(6*math.Pi*f*t)
	return int32(0.25 * v * math.Exp(-since*5) * 2147483647)
}

func (d *demoExtra) Close() {
	d.mu.Lock()
	stop, done := d.stop, d.done
	d.stop = nil
	d.mu.Unlock()
	if stop != nil {
		close(stop)
		<-done
	}
}

func (d *demoExtra) Overflows() uint64           { return 0 }
func (d *demoExtra) InputLatency() time.Duration { return 0 }
