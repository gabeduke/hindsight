package rig

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/config"
)

// defaults is every setting at its default, saved and running alike.
func defaults() map[string]Setting {
	out := map[string]Setting{}
	for _, s := range config.Settings {
		out[s.Key] = Setting{Value: s.Default, Running: s.Default}
	}
	return out
}

// sidekickSources is TAPE_SOURCES' default, parsed as the engine does.
func sidekickSources() []SourceView {
	return []SourceView{
		{Name: "main", Pair: [2]int{1, 2}, Hears: []string{"A", "B"}},
		{Name: "ch1", Pair: [2]int{3, 4}, Hears: []string{"A"}},
		{Name: "ch2", Pair: [2]int{5, 6}, Hears: []string{"B"}},
		{Name: "aux", Pair: [2]int{7, 8}},
	}
}

func sidekick() Inputs {
	return Inputs{Interface: "EP-136 K.O. Sidekick: USB Audio (hw:2,0)", USBID: "2367:9420", Channels: 8,
		Settings: defaults(), Sources: sidekickSources()}
}

func tape4() *TapeView {
	t := &TapeView{ID: "t1", Output: "jam", Streams: true, Armed: []int{1}}
	for n := 1; n <= 4; n++ {
		t.Tracks = append(t.Tracks, TrackView{N: n, Bus: "A"})
	}
	return t
}

func cable(g Graph, id string) (Cable, bool) {
	for _, c := range g.Cables {
		if c.ID == id {
			return c, true
		}
	}
	return Cable{}, false
}

func kitSockets(g Graph, kind string) []Socket {
	var out []Socket
	for _, s := range g.Kit.Sockets {
		if s.Kind == kind {
			out = append(out, s)
		}
	}
	return out
}

func TestTheSidekicksProfileIsTodaysDefaultTapeSources(t *testing.T) {
	p, ok := ForUSB("2367:9420")
	if !ok {
		t.Fatal("the Sidekick isn't found by its USB id")
	}
	def, _ := config.Lookup("TAPE_SOURCES")
	if p.Sources() != def.Default {
		t.Fatalf("the profile's taps are %q, TAPE_SOURCES' default %q", p.Sources(), def.Default)
	}
	// What the routing notes measured: the returns land before the CH taps.
	if len(p.Returns) != 2 || p.Returns[0].Into != "in1" || p.Returns[1].Into != "in2" {
		t.Fatalf("returns %+v", p.Returns)
	}
	if mp, ok := ForMIDI("EP-136 MIDI 1"); !ok || mp.ID != "ep-136" {
		t.Fatal("the Sidekick's MIDI port isn't found by name")
	}
}

func TestTheBentosProfileGuessesNoPort(t *testing.T) {
	p, ok := ForMIDI("Bento MIDI 1")
	if !ok || !p.Placeholder {
		t.Fatalf("the Bento: %+v %v, want its placeholder", p, ok)
	}
	for _, port := range p.Ports {
		if port.Kind != "midi" {
			t.Fatalf("the Bento's placeholder draws a %s port %q: nothing but its MIDI is known", port.Kind, port.ID)
		}
	}
	if len(p.Taps) != 0 || len(p.Returns) != 0 {
		t.Fatal("the Bento has no taps or returns until its manual is read")
	}
}

func TestTheRigFromTodaysDefaultsAndTheSidekickDrawsExactlyTheTapsOfTapeSources(t *testing.T) {
	in := sidekick()
	in.Tape = tape4()
	g := Build(in)
	var got []string
	for _, s := range kitSockets(g, "tap") {
		got = append(got, fmt.Sprintf("%s=%d,%d%s", strings.TrimPrefix(s.ID, "kit.tap."), s.Pair[0], s.Pair[1], hearsSuffix(s.Hears)))
	}
	if strings.Join(got, " ") != "main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8" {
		t.Fatalf("taps %q, want TAPE_SOURCES' default", strings.Join(got, " "))
	}
	if len(g.Devices) == 0 || g.Devices[0].ID != "ep-136" || g.Devices[0].Generic {
		t.Fatalf("devices %+v, want the Sidekick first", g.Devices)
	}
	if g.Offer != nil {
		t.Fatalf("an offer %+v, when TAPE_SOURCES already is the Sidekick's", g.Offer)
	}
	// The returns: bus A into IN 1, bus B into IN 2, fixed.
	if c, ok := cable(g, "return:A"); !ok || c.To != "ep-136.in1" || !c.Fixed {
		t.Fatalf("bus A's return: %+v", c)
	}
	// KEEP writes MAIN, from SAVE_CHANNELS=1,2.
	if g.Keep.Tap != "main" || g.Keep.All {
		t.Fatalf("keep %+v, want main", g.Keep)
	}
	if c, ok := cable(g, "keep:main"); !ok || c.Pending != "" || !c.Restart {
		t.Fatalf("keep cable %+v", c)
	}
	if g.Found != "Sidekick on USB" {
		t.Fatalf("found %q", g.Found)
	}
}

func hearsSuffix(h []string) string {
	if len(h) == 0 {
		return ""
	}
	return ":" + strings.Join(h, "")
}

func TestAnUnknownCardMakesAGenericProfile(t *testing.T) {
	in := Inputs{Interface: "Scarlett Solo USB: Audio (hw:3,0)", USBID: "1235:8211", Channels: 2, Outputs: 2,
		Settings: defaults(), Sources: sidekickSources()[:1]}
	g := Build(in)
	d := g.Devices[0]
	if !d.Generic || d.Name != "Scarlett Solo USB" || d.In != 2 {
		t.Fatalf("device %+v, want a generic Scarlett Solo USB with 2 in", d)
	}
	p := Generic("x", 6, 2)
	var ids []string
	for _, tp := range p.Taps {
		ids = append(ids, tp.ID)
		if len(tp.Hears) > 0 {
			t.Fatalf("a generic tap assumes it hears %v", tp.Hears)
		}
	}
	if strings.Join(ids, " ") != "usb1-2 usb3-4 usb5-6" {
		t.Fatalf("generic taps %v", ids)
	}
	if p := Generic("x", 3, 0); p.Taps[1].ID != "usb3" || p.Taps[1].USB != [2]int{3, 3} {
		t.Fatalf("an odd last channel: %+v", p.Taps)
	}
	// It offers its own taps, which would write TAPE_SOURCES.
	if g.Offer == nil || g.Offer.Settings["TAPE_SOURCES"] != "usb1-2=1,2" {
		t.Fatalf("offer %+v, want Use these taps → usb1-2=1,2", g.Offer)
	}
	// With no profile, nothing returns anywhere.
	for _, c := range g.Cables {
		if c.Kind == "return" {
			t.Fatalf("a generic interface drew a return: %+v", c)
		}
	}
}

func TestTheDemoAndAMacHaveNoUSBIDButASidekickCardDoes(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "card2"), 0o755)
	os.WriteFile(filepath.Join(root, "card2", "usbid"), []byte("2367:9420\n"), 0o644)
	if id := USBID("EP-136 K.O. Sidekick: USB Audio (hw:2,0)", root); id != "2367:9420" {
		t.Fatalf("usbid %q", id)
	}
	if id := USBID("MacBook Pro Microphone", root); id != "" {
		t.Fatalf("a name with no card read %q", id)
	}
	if id := USBID("bcm2835 Headphones: - (hw:0,0)", root); id != "" {
		t.Fatalf("a card with no usbid read %q", id)
	}
}

func TestARestartCableIsPendingUntilTheRestart(t *testing.T) {
	in := sidekick()
	in.MIDI = []MIDIPort{{Name: "Bento", Open: true}}
	// The page plugged the kit's clock into the Bento: saved, not running.
	in.Settings["TAPE_CLOCK"] = Setting{Value: "lead", Running: "free"}
	in.Settings["TAPE_CLOCK_OUT"] = Setting{Value: "bento", Running: ""}
	g := Build(in)
	c, ok := cable(g, "clock-out:bento")
	if !ok || c.Pending != "plug" || !c.Restart || c.From != "kit.clock-out" || c.To != "bento.midi-in" {
		t.Fatalf("clock out %+v %v, want plugged and waiting for a restart", c, ok)
	}
	// After the restart it's simply there.
	in.Settings["TAPE_CLOCK"] = Setting{Value: "lead", Running: "lead"}
	in.Settings["TAPE_CLOCK_OUT"] = Setting{Value: "bento:-4", Running: "bento:-4"}
	if c, ok := cable(Build(in), "clock-out:bento"); !ok || c.Pending != "" {
		t.Fatalf("after the restart: %+v %v", c, ok)
	}
	// Unplugged: still running until the next restart.
	in.Settings["TAPE_CLOCK"] = Setting{Value: "free", Running: "lead"}
	if c, ok := cable(Build(in), "clock-out:bento"); !ok || c.Pending != "unplug" {
		t.Fatalf("unplugged: %+v %v, want still drawn, pending its unplug", c, ok)
	}
	// Its clock into the kit, and ignoring it.
	in.Settings["MIDI_CLOCK_DEVICE"] = Setting{Value: "Bento", Running: ""}
	in.Settings["MIDI_IGNORE"] = Setting{Value: "", Running: ""}
	g = Build(in)
	if c, ok := cable(g, "clock-in:bento"); !ok || c.Pending != "plug" {
		t.Fatalf("clock in %+v %v", c, ok)
	}
	if c, ok := cable(g, "midi:bento"); !ok || c.Pending != "" || c.To != "kit.midi" {
		t.Fatalf("the Bento's MIDI, recorded: %+v %v", c, ok)
	}
	in.Settings["MIDI_IGNORE"] = Setting{Value: "bento", Running: ""}
	if c, ok := cable(Build(in), "midi:bento"); !ok || c.Pending != "unplug" {
		t.Fatalf("ignored: %+v %v, want pending its unplug", c, ok)
	}
	// KEEP moved to CH2.
	in.Settings["SAVE_CHANNELS"] = Setting{Value: "5,6", Running: "1,2"}
	g = Build(in)
	if c, _ := cable(g, "keep:ch2"); c.Pending != "plug" {
		t.Fatalf("keep → ch2: %+v", c)
	}
	if c, _ := cable(g, "keep:main"); c.Pending != "unplug" {
		t.Fatalf("keep main: %+v", c)
	}
	if g.Keep.Tap != "ch2" || !g.Keep.Pending {
		t.Fatalf("keep %+v", g.Keep)
	}
}

func TestTheInterfacesOwnClockIsTheDefaultClockIn(t *testing.T) {
	in := sidekick()
	in.MIDI = []MIDIPort{{Name: "EP-136", Open: true}}
	g := Build(in)
	if !slices.Equal(g.Devices[0].MIDI, []string{"EP-136"}) {
		t.Fatalf("the Sidekick's MIDI port should join it: %+v", g.Devices)
	}
	if c, ok := cable(g, "clock-in:ep-136"); !ok || c.Pending != "" {
		t.Fatalf("an empty MIDI_CLOCK_DEVICE follows the interface: %+v %v", c, ok)
	}
}

func TestTheBusWarningAppearsAndClearsAsTracksChangeBusOrEmpty(t *testing.T) {
	in := sidekick()
	in.Tape = tape4()
	in.Tape.Armed = []int{2}
	in.Tape.Tracks[1].Input = "ch1" // track 2 records CH1, which hears bus A
	in.Tape.Tracks[2].Input = "ch2"
	g := Build(in)
	if len(g.Warnings) != 0 {
		t.Fatalf("nothing plays, yet %+v", g.Warnings)
	}
	in.Tape.Tracks[0].Clips = 2 // tracks 1 and 4 play on bus A
	in.Tape.Tracks[3].Clips = 1
	g = Build(in)
	if len(g.Warnings) != 1 {
		t.Fatalf("warnings %+v, want the tape in CH1", g.Warnings)
	}
	w := g.Warnings[0]
	if w.Tap != "ch1" || !slices.Equal(w.Tracks, []int{1, 4}) || !slices.Equal(w.Armed, []int{2}) || w.Fix == nil {
		t.Fatalf("warning %+v", w)
	}
	if w.Fix.Label != "Move tracks 1, 4 to bus B" || len(w.Fix.Buses) != 2 || w.Fix.Buses[0] != (Move{N: 1, Bus: "B"}) {
		t.Fatalf("fix %+v", w.Fix)
	}
	if !strings.Contains(w.Text, "Tracks 1 and 4 play on bus A, which CH1 hears") {
		t.Fatalf("text %q", w.Text)
	}
	for _, s := range kitSockets(g, "track") {
		if s.Warn != (s.Track == 2) {
			t.Fatalf("track %d warn %v: only the armed track records the tape", s.Track, s.Warn)
		}
	}
	// The fix done: they play on bus B, which CH1 doesn't hear.
	in.Tape.Tracks[0].Bus, in.Tape.Tracks[3].Bus = "B", "B"
	if g := Build(in); len(g.Warnings) != 0 {
		t.Fatalf("on bus B: %+v", g.Warnings)
	}
	// Muted, or emptied, it clears too.
	in.Tape.Tracks[0].Bus, in.Tape.Tracks[3].Bus = "A", "A"
	in.Tape.Tracks[0].Mute, in.Tape.Tracks[3].Clips = true, 0
	if g := Build(in); len(g.Warnings) != 0 {
		t.Fatalf("muted and emptied: %+v", g.Warnings)
	}
	// With CH2 armed too, both buses are heard: no bus to move to.
	in.Tape.Tracks[0].Mute = false
	in.Tape.Armed = []int{2, 3}
	g = Build(in)
	if len(g.Warnings) != 1 || g.Warnings[0].Fix != nil || !strings.Contains(g.Warnings[0].Text, "Mute it") {
		t.Fatalf("both buses heard: %+v", g.Warnings)
	}
	// Disarmed, no warning.
	in.Tape.Armed = nil
	if g := Build(in); len(g.Warnings) != 0 {
		t.Fatalf("nothing armed: %+v", g.Warnings)
	}
}

func TestEachTapeCableIsDrawnFromTheTape(t *testing.T) {
	in := sidekick()
	in.Tape = tape4()
	in.Tape.Armed = []int{2, 3}
	in.Tape.Tracks[1].Input = "ch1"
	in.Tape.Tracks[2].Input = "ch2"
	in.Tape.Tracks[3].Bus = "B"
	in.Tape.Output = "both"
	g := Build(in)
	if c, ok := cable(g, "input:2"); !ok || c.From != "kit.tap.ch1" || c.To != "kit.track.2" || c.Restart {
		t.Fatalf("track 2's input: %+v %v, want ch1, at once", c, ok)
	}
	if _, ok := cable(g, "input:1"); ok {
		t.Fatal("track 1 has no input of its own, so no cable")
	}
	if c, _ := cable(g, "bus:4"); c.To != "kit.bus.B" {
		t.Fatalf("track 4's bus: %+v", c)
	}
	if _, ok := cable(g, "out:phones"); !ok {
		t.Fatal("output both: OUT should reach a phone")
	}
	armed := 0
	for _, s := range kitSockets(g, "track") {
		if s.Armed {
			armed++
		}
	}
	if armed != 2 || !slices.Equal(g.Tape.Armed, []int{2, 3}) {
		t.Fatalf("%d lamps, armed %v: two cables, two red lamps", armed, g.Tape.Armed)
	}
}

func TestLabelsNameAJackAndWaitForSignal(t *testing.T) {
	in := sidekick()
	in.Labels = map[string]string{"ep-136.in1": "guitar", "ep-136.aux": "Bento out", "nowhere.x": "lost"}
	quiet, loud := -70.0, -20.0
	in.Sources[1].PeakDB = &loud // CH1
	in.Sources[3].PeakDB = &quiet
	g := Build(in)
	gtr, ok := cable(g, "jack:ep-136.in1")
	if !ok || gtr.Label != "guitar" || gtr.Waiting || gtr.Kind != "jack" {
		t.Fatalf("guitar: %+v %v, want drawn, with signal", gtr, ok)
	}
	if c, _ := cable(g, "jack:ep-136.aux"); !c.Waiting {
		t.Fatal("the aux label should wait, dashed, for signal")
	}
	if _, ok := cable(g, "jack:nowhere.x"); ok {
		t.Fatal("a label on a socket that isn't there draws nothing")
	}
	// The tap carries the name of what's in its jack.
	for _, s := range kitSockets(g, "tap") {
		if s.ID == "kit.tap.ch1" && s.Name != "guitar" {
			t.Fatalf("the CH1 tap reads %q", s.Name)
		}
	}
	// And routes nothing: no cable but the jack's touches it.
	for _, c := range g.Cables {
		if strings.HasPrefix(c.From, "label:") && c.Kind != "jack" {
			t.Fatalf("a label routed %+v", c)
		}
	}
}

func TestLabelsRoundTripInRigJSON(t *testing.T) {
	p := LabelsPath(filepath.Join(t.TempDir(), "settings.json"))
	if l, err := ReadLabels(p); err != nil || len(l) != 0 {
		t.Fatalf("missing file: %v %v", l, err)
	}
	if err := WriteLabels(p, map[string]string{"ep-136.in1": "guitar"}); err != nil {
		t.Fatal(err)
	}
	l, err := ReadLabels(p)
	if err != nil || l["ep-136.in1"] != "guitar" {
		t.Fatalf("%v %v", l, err)
	}
	if _, err := CleanLabel("../etc", "x"); err == nil {
		t.Fatal("a path is not a socket")
	}
	if v, _ := CleanLabel("ep-136.in1", "  a\nvery   long  "+strings.Repeat("x", 60)); len([]rune(v)) != MaxLabel || strings.Contains(v, "\n") {
		t.Fatalf("cleaned %q", v)
	}
}
