package midi

import (
	"path/filepath"
	"testing"
)

// A plausible /proc/asound/cards with the whole rig plugged in. The EP entry
// is the real one; the rest follow ALSA's format for a USB MIDI-only device
// (driver "USB-Audio" still, since snd-usb-audio owns them).
const rigCards = ` 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0
                      vc4-hdmi-0
 2 [EP136          ]: USB-Audio - EP-136
                      teenage engineering EP-136 at usb-xhci-hcd.0-1, high speed
 3 [Orchid         ]: USB-Audio - Orchid
                      Telepathic Instruments Orchid at usb-xhci-hcd.1-1.2, full speed
 4 [KeyStep37      ]: USB-Audio - Arturia KeyStep 37
                      Arturia Arturia KeyStep 37 at usb-xhci-hcd.1-1.3, full speed
`

func TestEnumerateNamesPortsFromTheCardTable(t *testing.T) {
	cards, snd := fixture(t, rigCards, "midiC2D0", "midiC3D0", "midiC4D0", "controlC2", "pcmC2D0c")

	got := Enumerate(cards, snd)
	if len(got) != 3 {
		t.Fatalf("got %d ports: %+v", len(got), got)
	}
	want := map[string]string{
		"midiC2D0": "EP-136",
		"midiC3D0": "Orchid",
		"midiC4D0": "Arturia KeyStep 37",
	}
	for _, p := range got {
		base := filepath.Base(p.Node)
		if p.Name != want[base] {
			t.Errorf("%s named %q, want %q", base, p.Name, want[base])
		}
	}
	if got[0].Card != 2 || got[0].Dev != 0 {
		t.Errorf("card/dev parsed wrong: %+v", got[0])
	}
}

// A card the table does not know is named from its node, so it still gets a
// track rather than being skipped.
func TestEnumerateFallsBackToTheNodeName(t *testing.T) {
	cards, snd := fixture(t, realCards, "midiC7D0")
	got := Enumerate(cards, snd)
	if len(got) != 1 || got[0].Name != "midiC7D0" {
		t.Fatalf("got %+v", got)
	}
}

// A card with two rawmidi devices suffixes both, so a DAW shows two tracks
// that can be told apart.
func TestEnumerateSuffixesSiblingDevices(t *testing.T) {
	cards, snd := fixture(t, realCards, "midiC2D0", "midiC2D1")
	got := Enumerate(cards, snd)
	if len(got) != 2 || got[0].Name != "EP-136 #1" || got[1].Name != "EP-136 #2" {
		t.Fatalf("got %+v", got)
	}
}

func TestEnumerateWithNoALSAIsEmpty(t *testing.T) {
	if got := Enumerate("/nonexistent/cards", "/nonexistent/snd"); got != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestPortMatches(t *testing.T) {
	p := Port{Node: "/dev/snd/midiC2D0", Name: "EP-136"}
	if !p.Matches("ep-136") || !p.Matches("midiC2") || p.Matches("Orchid") || p.Matches("") {
		t.Fatal("Matches is wrong")
	}
}

func TestCardProduct(t *testing.T) {
	cases := map[string]card{
		"EP-136":     {ID: "EP136", Short: "USB-Audio - EP-136"},
		"K.O. II":    {ID: "KO2", Short: "USB-Audio - K.O. II"},
		"NoDash":     {ID: "x", Short: "NoDash"},
		"vc4hdmi0":   {ID: "vc4hdmi0", Short: ""},
		"With - Two": {ID: "y", Short: "USB-Audio - With - Two"},
	}
	for want, c := range cases {
		if got := c.Product(); got != want {
			t.Errorf("%+v Product() = %q, want %q", c, got, want)
		}
	}
}
