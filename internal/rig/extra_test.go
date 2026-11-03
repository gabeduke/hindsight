package rig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withAMS is the Sidekick with the AMS-24 as an extra input, live and
// locked, its sources ams1 and ams2 on channels 9 and 10.
func withAMS(live, locked bool) Inputs {
	in := sidekick()
	in.Settings[keyExtra] = Setting{Value: "AMS-24", Running: "AMS-24"}
	in.Sources = append(in.Sources, SourceView{Name: "ams1", Pair: [2]int{9, 9}}, SourceView{Name: "ams2", Pair: [2]int{10, 10}})
	in.Extras = []ExtraView{{Match: "AMS-24", Device: "AMS-24 (hw:CARD=AMS24,0)", USBID: "1686:067f", Channels: [2]int{9, 10}, Live: live, Locked: locked}}
	in.MIDI = []MIDIPort{{Name: "AMS-24 ZOOM AMS-24 Reserved Por"}, {Name: "EP-136 MIDI 1", Open: true}}
	return in
}

func device(g Graph, role string) (Device, bool) {
	for _, d := range g.Devices {
		if d.Role == role {
			return d, true
		}
	}
	return Device{}, false
}

// The AMS-24 as an extra input is a box of its own, role input, its USB into
// a kit socket of its own; its IN 1 and IN 2 land on ams1 and ams2, its
// outputs are never played, and its MIDI port folds into it.
func TestAnExtraInputIsABoxOfItsOwnJoinedToTheKit(t *testing.T) {
	g := Build(withAMS(true, true))
	d, ok := device(g, "input")
	if !ok || d.Profile != "zoom-ams-24" || d.ID != "input-ams-24" {
		t.Fatalf("input device %+v %v", d, ok)
	}
	taps := map[string]string{}
	for _, s := range d.Sockets {
		taps[s.ID] = s.Tap
		if s.Kind == "audio" && s.Dir == "out" && !strings.Contains(s.About, "never plays") {
			t.Errorf("%s doesn't say Hindsight never plays there", s.ID)
		}
	}
	if taps["input-ams-24.in1"] != "ams1" || taps["input-ams-24.in2"] != "ams2" {
		t.Fatalf("its jacks land on %v", taps)
	}
	if len(d.MIDI) != 1 || !strings.Contains(d.MIDI[0], "AMS-24") {
		t.Fatalf("its MIDI port %v", d.MIDI)
	}
	for _, x := range g.Devices {
		if x.Role == "midi" && strings.Contains(x.Name, "AMS-24") {
			t.Fatal("its MIDI port is drawn as a box of its own too")
		}
	}
	c, ok := cable(g, "usb:input-ams-24")
	if !ok || c.To != "kit.usb.input-ams-24" || c.Pending != "" || c.Off || !strings.Contains(c.About, "channels 9-10") {
		t.Fatalf("its USB cable %+v %v", c, ok)
	}
	found := false
	for _, s := range g.Kit.Sockets {
		if s.ID == "kit.usb.input-ams-24" && s.Label == "USB IN" {
			found = true
		}
		if s.ID == "kit.tap.ams1" && !strings.Contains(s.About, "IN 1") {
			t.Errorf("ams1 says %q", s.About)
		}
	}
	if !found {
		t.Fatal("no kit socket for its USB")
	}
	// The main interface is still the interface.
	if i, _ := device(g, "interface"); i.ID != "ep-136" {
		t.Fatalf("the interface is %q", i.ID)
	}
}

// Unplugged, its cable carries nothing; not locked yet, it says so; saved
// and not running, it waits for the restart.
func TestAnExtraInputsCableSaysWhereItStands(t *testing.T) {
	if c, _ := cable(Build(withAMS(false, false)), "usb:input-ams-24"); !c.Off || !strings.Contains(c.About, "Not plugged in") {
		t.Fatalf("unplugged: %+v", c)
	}
	if c, _ := cable(Build(withAMS(true, false)), "usb:input-ams-24"); c.Off || !strings.Contains(c.About, "Not locked") {
		t.Fatalf("not locked: %+v", c)
	}
	in := sidekick()
	in.Settings[keyExtra] = Setting{Value: "AMS-24", Running: "none"}
	g := Build(in)
	if c, ok := cable(g, "usb:input-ams-24"); !ok || c.Pending != "plug" {
		t.Fatalf("saved, not running: %+v %v", c, ok)
	}
	if _, ok := device(g, "input"); !ok {
		t.Fatal("a saved extra input isn't drawn")
	}
	if _, ok := device(Build(sidekick()), "input"); ok {
		t.Fatal("an extra input drawn with none set")
	}
}

// An extra input's device name ("hw:CARD=AMS24,0") finds its USB id through
// the card's id, which ALSA links to its number.
func TestAnExtraInputsUSBIDIsReadByItsCardID(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "card3"), 0o755)
	os.WriteFile(filepath.Join(root, "card3", "usbid"), []byte("1686:067f\n"), 0o644)
	os.Symlink("card3", filepath.Join(root, "AMS24"))
	if id := USBID("AMS-24 (hw:CARD=AMS24,0)", root); id != "1686:067f" {
		t.Fatalf("usbid %q", id)
	}
	if p, ok := ForName("AMS-24"); !ok || p.ID != "zoom-ams-24" {
		t.Fatalf("ForName(AMS-24) = %q %v", p.ID, ok)
	}
	if p, ok := ForName("1686:067f"); !ok || p.ID != "zoom-ams-24" {
		t.Fatalf("ForName(usb id) = %q %v", p.ID, ok)
	}
}
