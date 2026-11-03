//go:build !linux || !cgo

package audio

import (
	"fmt"
	"time"
)

// noALSA stands in for the extra input where there is no libasound to open
// it with: off Linux, or built without cgo. Open says ErrNoDevice, so the
// supervisor waits quietly instead of failing the capture.
type noALSA struct{}

func NewExtraSource(match string, channels, rate, framesPerPeriod int, latency time.Duration) ExtraSource {
	return noALSA{}
}

func (noALSA) Open(func([]int32)) (string, error) {
	return "", fmt.Errorf("%w: extra inputs need ALSA (Linux)", ErrNoDevice)
}

func (noALSA) Close()                      {}
func (noALSA) Overflows() uint64           { return 0 }
func (noALSA) InputLatency() time.Duration { return 0 }
