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

// pickOutput chooses the device the tape plays through: a direct device on
// the card DEVICE_MATCH names -- the capture's own device if it's one,
// otherwise the most direct match. Never a plug, a mixer or a sound server
// ("default", "pulse"), and never another card: the tape out of HDMI, on
// another clock, would be worse than no tape. So no match is an error.
//
// Under DEVICE_MATCH=auto (match "") the card is the capture's own: its name
// up to the colon. With no capture open yet there is none, and that is an
// error too, which the tape retries.
func pickOutput(devs []outDev, captureName, match string, channels int) (int, error) {
	if match == "" {
		match = CardName(captureName)
	}
	best, bestScore := -1, -1
	for i, d := range devs {
		if d.MaxOut < channels || match == "" || !strings.Contains(d.Name, match) {
			continue
		}
		s := deviceScore(d.Name)
		if s < 2 {
			continue // plug, dmix, default: conversion or another clock
		}
		if d.Name == captureName {
			return i, nil
		}
		if s > bestScore {
			best, bestScore = i, s
		}
	}
	if best < 0 {
		return -1, fmt.Errorf("%w: no direct output matching %q with >=%d channels", ErrNoDevice, match, channels)
	}
	return best, nil
}

// deviceScore ranks the names ALSA gives one card: a direct hw device over
// the plug-based ones, which can silently add format conversion.
func deviceScore(name string) int {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "dsnoop"), strings.Contains(n, "dmix"), strings.Contains(n, "plughw"),
		strings.Contains(n, "pulse"), strings.Contains(n, "pipewire"), strings.Contains(n, "jack"):
		return 0
	case strings.Contains(n, "sysdefault"), strings.Contains(n, "default"):
		return 1
	case strings.Contains(n, "front"):
		return 2
	default:
		return 3 // bare "EP-136: USB Audio (hw:2,0)" style
	}
}
