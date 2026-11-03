package audio

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// asoundFixture is /proc/asound as the Pi had it on 2026-11-02, cut to its
// two USB cards: the EP-136 as card 2 and the AMS-24 as card 3, with the
// links by id the real directory has beside the cardN ones.
func asoundFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	write := func(rel, body string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("card2/id", "EP136\n")
	write("card2/usbid", "2367:9420\n")
	write("card3/id", "AMS24\n")
	write("card3/usbid", "1686:067f\n")
	write("cards", ""+
		" 2 [EP136          ]: USB-Audio - EP-136\n"+
		"                      teenage engineering EP-136 at usb-xhci-hcd.0-1, high speed\n"+
		" 3 [AMS24          ]: USB-Audio - AMS-24\n"+
		"                      ZOOM Corporation AMS-24 at usb-xhci-hcd.1-1, high speed\n")
	for _, l := range [][2]string{{"card2", "EP136"}, {"card3", "AMS24"}} {
		if err := os.Symlink(l[0], filepath.Join(root, l[1])); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestFindALSACard(t *testing.T) {
	root := asoundFixture(t)
	for _, tc := range []struct{ match, want string }{
		{"AMS-24", "AMS24"},    // the name on the box finds the ALSA id
		{"ams24", "AMS24"},     // whatever the case
		{"1686:067f", "AMS24"}, // the USB id
		{"Zoom", "AMS24"},      // the long name's second line
		{"EP-136", "EP136"},    // the other card, not just the first USB one
		{"2367:9420", "EP136"},
	} {
		got, err := findALSACard(root, tc.match)
		if err != nil || got != tc.want {
			t.Errorf("findALSACard(%q) = %q, %v; want %q", tc.match, got, err, tc.want)
		}
	}
	for _, match := range []string{"Scarlett", "", "  "} {
		if _, err := findALSACard(root, match); !errors.Is(err, ErrNoDevice) {
			t.Errorf("findALSACard(%q) err = %v, want ErrNoDevice", match, err)
		}
	}
}

// An unplugged card leaves no directory, and the lookup says ErrNoDevice so
// the supervisor waits for it; so does a machine with no /proc/asound.
func TestFindALSACardGone(t *testing.T) {
	root := asoundFixture(t)
	if err := os.RemoveAll(filepath.Join(root, "card3")); err != nil {
		t.Fatal(err)
	}
	if _, err := findALSACard(root, "1686:067f"); !errors.Is(err, ErrNoDevice) {
		t.Errorf("unplugged: err = %v, want ErrNoDevice", err)
	}
	if _, err := findALSACard(filepath.Join(root, "nope"), "AMS24"); !errors.Is(err, ErrNoDevice) {
		t.Errorf("no /proc/asound: err = %v, want ErrNoDevice", err)
	}
}

// The name shown is the card's own, from the cards file.
func TestFindALSACardShortName(t *testing.T) {
	c, err := findCard(asoundFixture(t), "1686:067f")
	if err != nil {
		t.Fatal(err)
	}
	if c.short != "AMS-24" {
		t.Errorf("short = %q, want AMS-24", c.short)
	}
}
