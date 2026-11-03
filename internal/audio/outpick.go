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
// the card the capture is recording from -- the capture's own device if it
// can play, otherwise the most direct device on its card. DEVICE_MATCH names
// the card only while the capture has none of its own (nothing open yet, or
// a plug like "default"): a capture that fell back to another card takes the
// output with it, since that card is the ring's clock and the one that
// answers (2026-11-02: AMS-24 chosen, the capture on the EP-136, the output
// stalled on the AMS-24 and ▶ did nothing). Never a plug, a mixer or a sound
// server ("default", "pulse"), and never another card: the tape out of HDMI,
// on another clock, would be worse than no tape. So no match is an error.
//
// With no capture open yet and DEVICE_MATCH=auto (match "") there is no card
// at all, and that is an error too, which the tape retries.
func pickOutput(devs []outDev, captureName, match string, channels int) (int, error) {
	if card := captureCard(captureName); card != "" {
		match = card
	}
	best, bestScore := -1, -1
	for i, d := range devs {
		if d.MaxOut < channels || !onCard(d.Name, match) {
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

// outputOffTheCapturesCard reports an output open on one card while the
// capture records on another direct device: the output is reopened, so it
// follows the card that's recording.
func outputOffTheCapturesCard(outputName, captureName string) bool {
	card := captureCard(captureName)
	return outputName != "" && card != "" && !onCard(outputName, card)
}

// onCard is how a device is matched to a card, here and in pickOutput alike,
// so an output pickOutput chose is never then reported off its card.
func onCard(name, card string) bool {
	return card != "" && strings.Contains(name, card)
}

// captureCard is the card a capture device is on: an ALSA direct device's
// name up to the colon, "EP-136" of "EP-136: USB Audio (hw:2,0)". Anything
// else is "" ("default", a plug, nothing open, or a CoreAudio name on a Mac,
// whose input and output are different devices with different names), and
// DEVICE_MATCH names the card instead.
func captureCard(captureName string) string {
	if !strings.Contains(captureName, "(hw:") {
		return ""
	}
	return CardName(captureName)
}
