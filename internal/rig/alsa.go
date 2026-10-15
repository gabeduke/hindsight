package rig

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ProcAsound is where ALSA describes its cards.
const ProcAsound = "/proc/asound"

// hwCard finds the card number in a PortAudio device name: "EP-136 K.O.
// Sidekick: USB Audio (hw:2,0)" is card 2.
var hwCard = regexp.MustCompile(`\(hw:(\d+),\d+\)`)

// USBID is the USB id ("2367:9420") of the ALSA card a PortAudio device
// name names, read from the card's usbid file under procRoot. "" when the
// name names no card (a Mac, the demo) or the card isn't USB.
func USBID(device, procRoot string) string {
	m := hwCard.FindStringSubmatch(device)
	if m == nil {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(procRoot, "card"+m[1], "usbid"))
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(b)))
}
