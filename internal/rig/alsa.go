package rig

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// ProcAsound is where ALSA describes its cards.
const ProcAsound = "/proc/asound"

// hwCard finds the card number in a PortAudio device name: "EP-136 K.O.
// Sidekick: USB Audio (hw:2,0)" is card 2.
var hwCard = regexp.MustCompile(`\(hw:(?:CARD=)?([A-Za-z0-9_-]+),\d+\)`)

// USBID is the USB id ("2367:9420") of the ALSA card a PortAudio device
// name names, read from the card's usbid file under procRoot. "" when the
// name names no card (a Mac, the demo) or the card isn't USB.
func USBID(device, procRoot string) string {
	m := hwCard.FindStringSubmatch(device)
	if m == nil {
		return ""
	}
	card := m[1] // a number, or an extra input's id ("hw:CARD=AMS24,0"), which ALSA links
	if _, err := strconv.Atoi(card); err == nil {
		card = "card" + card
	}
	b, err := os.ReadFile(filepath.Join(procRoot, card, "usbid"))
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(b)))
}
