package audio

import "strings"

// Input is an audio input PortAudio lists: what the settings sheet offers.
type Input struct {
	Name     string `json:"name"`
	Channels int    `json:"channels"`
}

// CardName is a PortAudio device name without ALSA's suffix:
// "EP-136 K.O. Sidekick: USB Audio (hw:2,0)" is "EP-136 K.O. Sidekick". It
// is what the same card's MIDI port is called, so it is MIDI_CLOCK_DEVICE's
// default under DEVICE_MATCH=auto.
func CardName(name string) string {
	if i := strings.Index(name, ":"); i > 0 {
		return strings.TrimSpace(name[:i])
	}
	return strings.TrimSpace(name)
}
