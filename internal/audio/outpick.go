package audio

import (
	"fmt"
	"strings"
)

// outDev is what choosing the tape's output needs to know of a device.
type outDev struct {
	Name   string
	MaxOut int
}

// pickOutput chooses the device the tape plays through: the capture's own
// device when it can play that many channels, else the most direct one
// matching DEVICE_MATCH. Never anything else -- the tape out of HDMI, on
// another clock, would be worse than no tape -- so no match is an error.
func pickOutput(devs []outDev, captureName, match string, channels int) (int, error) {
	best, bestScore := -1, -1
	for i, d := range devs {
		if d.MaxOut < channels {
			continue
		}
		if captureName != "" && d.Name == captureName {
			return i, nil
		}
		if match == "" || !strings.Contains(d.Name, match) {
			continue
		}
		if s := deviceScore(d.Name); s > bestScore {
			best, bestScore = i, s
		}
	}
	if best < 0 {
		return -1, fmt.Errorf("%w: no output matching %q with >=%d channels", ErrNoDevice, match, channels)
	}
	return best, nil
}

// deviceScore ranks the names ALSA gives one card: a direct hw device over
// the plug-based ones, which can silently add format conversion.
func deviceScore(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "dsnoop"), strings.Contains(n, "dmix"), strings.Contains(n, "plughw"):
		return 0
	case strings.Contains(n, "sysdefault"), strings.Contains(n, "default"):
		return 1
	case strings.Contains(n, "front"):
		return 2
	default:
		return 3 // bare "EP-136: USB Audio (hw:2,0)" style
	}
}
