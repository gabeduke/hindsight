package audio

import (
	"fmt"
	"strings"
)

// inDev is what choosing the capture's input needs to know of a device: the
// PortAudio name and how many inputs it has. Kept apart from PortAudio's own
// type so the choice is testable without the C library.
type inDev struct {
	Name  string
	MaxIn int
}

// virtualInputs are the PCMs ALSA lists beside the cards themselves: plugs,
// mixers and sound servers that route to some card (or to none), never a
// card of their own. A few macOS loopback drivers sit here too, so auto on a
// laptop doesn't pick a 64-channel BlackHole over the microphone.
var virtualInputs = []string{
	"default", "sysdefault", "pulse", "pipewire", "jack", "dmix", "dsnoop",
	"plughw", "front", "surround", "iec958", "spdif", "samplerate", "speex",
	"upmix", "vdownmix", "lavrate", "hdmi",
	"blackhole", "soundflower", "loopback", "zoomaudiodevice", "microsoft teams audio",
}

// isVirtualInput reports a name that is a plug, a mixer or a loopback driver
// rather than an interface: "sysdefault", "surround51", "dmix",
// "pulse", "BlackHole 2ch".
func isVirtualInput(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	for _, v := range virtualInputs {
		if strings.HasPrefix(n, v) {
			return true
		}
	}
	return false
}

// hardwareInputs answers the indices of the devices that are real inputs. On
// Linux that is ALSA's direct devices, "EP-136 K.O. Sidekick: USB Audio
// (hw:2,0)": each card appears once that way and again under every plug.
// Where nothing is named like that (CoreAudio on a Mac), every device with
// inputs that isn't obviously virtual.
func hardwareInputs(devs []inDev) []int {
	hw := false
	for _, d := range devs {
		if strings.Contains(d.Name, "(hw:") {
			hw = true
			break
		}
	}
	var out []int
	for i, d := range devs {
		if d.MaxIn < 1 {
			continue
		}
		if hw && !strings.Contains(d.Name, "(hw:") {
			continue
		}
		if !hw && isVirtualInput(d.Name) {
			continue
		}
		out = append(out, i)
	}
	return out
}

// pickInput chooses the capture's input among devs, answering its index.
//
// With match "" (DEVICE_MATCH=auto) it is the hardware input with the most
// inputs, the first listed on a tie: the EP-136's eight over a Solo's two.
// With a match it is, as it always was, the most direct of the names
// containing it (deviceScore), else the first device with enough inputs at
// all, reported by fellBack so the caller can say so.
//
// Only devices with at least channels inputs are considered; channels 0
// (CHANNELS=auto, not yet resolved) means any device with an input.
func pickInput(devs []inDev, match string, channels int) (idx int, fellBack bool, err error) {
	need := max(channels, 1)
	if match == "" {
		best := -1
		for _, i := range hardwareInputs(devs) {
			if devs[i].MaxIn < need {
				continue
			}
			if best < 0 || devs[i].MaxIn > devs[best].MaxIn {
				best = i
			}
		}
		if best < 0 {
			return -1, false, fmt.Errorf("%w: no interface with >=%d inputs (is it off, unplugged, or in use by another process?)", ErrNoDevice, need)
		}
		return best, false, nil
	}

	match1, fallback, bestScore := -1, -1, -1
	for i, d := range devs {
		if d.MaxIn < need {
			continue
		}
		if fallback < 0 {
			fallback = i
		}
		if !strings.Contains(d.Name, match) {
			continue
		}
		if s := deviceScore(d.Name); s > bestScore {
			bestScore, match1 = s, i
		}
	}
	switch {
	case match1 >= 0:
		return match1, false, nil
	case fallback >= 0:
		return fallback, true, nil
	}
	return -1, false, fmt.Errorf("%w: none with >=%d channels (is it off, unplugged, or in use by another process?)", ErrNoDevice, need)
}

// listHardware is ListInputs over devs: every hardware input, in order.
func listHardware(devs []inDev) []Input {
	var out []Input
	for _, i := range hardwareInputs(devs) {
		out = append(out, Input{Name: devs[i].Name, Channels: devs[i].MaxIn})
	}
	return out
}

// Fitted is an optional Source capability: the device the last Open chose
// and how many inputs it has, set even when the open then failed because it
// has fewer than the ring. Under CHANNELS=auto the capture compares that with
// the ring's channels; a difference means another interface turned up than
// the one Hindsight was sized for at startup.
type Fitted interface {
	Picked() (name string, inputs int)
}
