package rig

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Setting is one setting as the rig reads it: the value saved (what the
// next start will use) and the value running now. A cable drawn from a
// setting whose two differ is waiting for a restart.
type Setting struct {
	Value   string `json:"value"`
	Running string `json:"running"`
}

// Pending says the setting was changed since Hindsight started.
func (s Setting) Pending() bool {
	return !strings.EqualFold(strings.TrimSpace(s.Value), strings.TrimSpace(s.Running))
}

// MIDIPort is a MIDI device that's plugged in.
type MIDIPort struct {
	Name string
	Open bool // Hindsight has it open now
}

// TrackView is a tape track as the rig needs it.
type TrackView struct {
	N     int
	Name  string
	Bus   string
	Clips int
	Mute  bool
	Input string // the source it records from; "" none of its own
}

// TapeView is the loaded tape as the rig needs it.
type TapeView struct {
	ID      string
	Tracks  []TrackView
	Armed   []int
	Output  string // jam, phone or both
	Streams bool   // it can play on a phone
}

// SourceView is a tap the tape catches from: a source of TAPE_SOURCES.
type SourceView struct {
	Name   string
	Pair   [2]int // 1-indexed
	Hears  []string
	PeakDB *float64
}

// Inputs is everything the graph is drawn from.
type Inputs struct {
	Interface string // the capture's device name; "" with none open
	USBID     string // its USB id, when the system says
	Channels  int    // its inputs, as the ring was sized
	Outputs   int    // its outputs, if known
	MIDI      []MIDIPort
	Settings  map[string]Setting
	// Sources are the taps catches use now: TAPE_SOURCES as running.
	Sources []SourceView
	Tape    *TapeView // nil with the tape off, or nothing loaded
	Labels  map[string]string
	Version string
	// Controller says this build has TAPE_CONTROLLER (the instrument
	// strip's), so a controller can be patched into the kit.
	Controller    bool
	RestartNeeded bool
}

// Socket is a place a cable plugs in.
type Socket struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Kind: audio, usb, midi, sync (a device's); tap, track, bus, out,
	// keep, network (the kit's and a listener's).
	Kind  string `json:"kind"`
	Dir   string `json:"dir"`
	About string `json:"about,omitempty"`
	// Name is what's drawn into it: a label from rig.json ("guitar").
	Name   string   `json:"name,omitempty"`
	PeakDB *float64 `json:"peak_db,omitempty"`
	Signal bool     `json:"signal,omitempty"`
	// A tap's channels and the buses it hears; a device's jack, the tap it
	// lands on.
	Pair  []int    `json:"pair,omitempty"`
	Hears []string `json:"hears,omitempty"`
	Tap   string   `json:"tap,omitempty"`
	// A track's.
	Track int    `json:"track,omitempty"`
	Armed bool   `json:"armed,omitempty"`
	Clips int    `json:"clips,omitempty"`
	Bus   string `json:"bus,omitempty"`
	Mute  bool   `json:"mute,omitempty"`
	Warn  bool   `json:"warn,omitempty"` // records the tape (Graph.Warnings)
}

// Device is a box on the desk.
type Device struct {
	ID string `json:"id"`
	// Role: interface (the USB audio the capture opened), midi, kit, or
	// listener (a phone on the network).
	Role        string   `json:"role"`
	Name        string   `json:"name"`
	Short       string   `json:"short"`
	Profile     string   `json:"profile"`
	Generic     bool     `json:"generic,omitempty"`
	Placeholder bool     `json:"placeholder,omitempty"`
	Note        string   `json:"note,omitempty"`
	USB         string   `json:"usb,omitempty"`  // the USB id it was found by
	MIDI        []string `json:"midi,omitempty"` // the MIDI ports it was found by
	// Match is the name its MIDI is written into settings as: the
	// profile's substring, or its port's name.
	Match   string   `json:"match,omitempty"`
	In      int      `json:"in,omitempty"`
	Out     int      `json:"out,omitempty"`
	Sockets []Socket `json:"sockets"`
}

// Cable is a connection, and the setting it is.
type Cable struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
	// Kind: usb, patch (a tape setting), return (what the tape plays into),
	// network, clock, midi, keep (what a KEEP writes), jack (drawn by you).
	Kind   string `json:"kind"`
	Writes string `json:"writes"`
	// Restart: it takes effect when Hindsight restarts. Pending: "plug",
	// saved and waiting for one; "unplug", taken out and still running.
	Restart bool   `json:"restart,omitempty"`
	Pending string `json:"pending,omitempty"`
	Fixed   bool   `json:"fixed,omitempty"` // can't be unplugged
	Label   string `json:"label,omitempty"` // a jack's label
	Waiting bool   `json:"waiting,omitempty"`
	Off     bool   `json:"off,omitempty"` // drawn, but carrying nothing now
	About   string `json:"about,omitempty"`
}

// Move puts a track on a bus.
type Move struct {
	N   int    `json:"n"`
	Bus string `json:"bus"`
}

// Fix is a warning's way out: one undoable edit.
type Fix struct {
	Label string `json:"label"`
	Buses []Move `json:"buses"`
}

// Warning is worked out, never written: a tap that hears a bus, patched to
// an armed track, while a track with clips plays on that bus.
type Warning struct {
	ID     string   `json:"id"`
	Tap    string   `json:"tap"`
	Socket string   `json:"socket"`
	Buses  []string `json:"buses"`
	Armed  []int    `json:"armed"`
	Tracks []int    `json:"tracks"`
	Text   string   `json:"text"`
	Fix    *Fix     `json:"fix,omitempty"`
}

// Keep is what a KEEP writes: one tap's pair, or every channel.
type Keep struct {
	Tap     string   `json:"tap,omitempty"`
	Pair    []int    `json:"pair,omitempty"`
	All     bool     `json:"all"`
	Pending bool     `json:"pending,omitempty"`
	Choices []string `json:"choices"`
}

// Offer is a write the rig suggests: the interface's own taps.
type Offer struct {
	Label    string            `json:"label"`
	About    string            `json:"about"`
	Settings map[string]string `json:"settings"`
	Pending  bool              `json:"pending,omitempty"`
}

// Line is one setting the picture is drawn from.
type Line struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Running string `json:"running,omitempty"`
	Pending bool   `json:"pending,omitempty"`
}

// TapeInfo is the tape the patch bay's lower half is.
type TapeInfo struct {
	ID     string `json:"id"`
	Armed  []int  `json:"rec_tracks"`
	Output string `json:"output"`
}

// Graph is the rig: what /api/rig answers.
type Graph struct {
	Found         string            `json:"found"`
	Devices       []Device          `json:"devices"`
	Kit           Device            `json:"kit"`
	Cables        []Cable           `json:"cables"`
	Warnings      []Warning         `json:"warnings"`
	Labels        map[string]string `json:"labels"`
	Keep          Keep              `json:"keep"`
	Offer         *Offer            `json:"offer,omitempty"`
	RestartNeeded bool              `json:"restart_needed"`
	Settings      []Line            `json:"settings"`
	Tape          *TapeInfo         `json:"tape,omitempty"`
}

// The settings the rig draws from.
const (
	keySources    = "TAPE_SOURCES"
	keySave       = "SAVE_CHANNELS"
	keySaveAll    = "SAVE_ALL_CHANNELS"
	keyClock      = "TAPE_CLOCK"
	keyClockOut   = "TAPE_CLOCK_OUT"
	keyClockIn    = "MIDI_CLOCK_DEVICE"
	keyIgnore     = "MIDI_IGNORE"
	keyDevices    = "MIDI_DEVICES"
	keyCapture    = "MIDI_CAPTURE"
	keyControl    = "TAPE_CONTROLLER"
	signalFloorDB = -50.0
)

// Build draws the rig.
func Build(in Inputs) Graph {
	b := builder{in: in, labels: in.Labels, ifaceN: -1}
	if b.labels == nil {
		b.labels = map[string]string{}
	}
	return b.build()
}

type builder struct {
	in     Inputs
	labels map[string]string
	g      Graph
	ifaceN int // the interface's index in g.Devices, or -1
	prof   Profile
}

// iface is the interface's device, or nil. By index: g.Devices grows.
func (b *builder) iface() *Device {
	if b.ifaceN < 0 {
		return nil
	}
	return &b.g.Devices[b.ifaceN]
}

func (b *builder) set(key string) Setting { return b.in.Settings[key] }

// under answers a key's value under the saved settings (saved true) or the
// running ones.
func (b *builder) under(saved bool) func(string) string {
	return func(k string) string {
		s := b.in.Settings[k]
		if saved {
			return s.Value
		}
		return s.Running
	}
}

func (b *builder) build() Graph {
	b.g = Graph{Labels: b.labels, RestartNeeded: b.in.RestartNeeded, Cables: []Cable{}, Warnings: []Warning{}, Devices: []Device{}}
	b.interfaceDevice()
	b.kit()
	b.midiDevices()
	b.tapeCables()
	b.keep()
	b.jacks()
	b.warnings()
	b.offer()
	b.lines()
	b.found()
	return b.g
}

// interfaceDevice is the USB audio the capture opened, by its profile, or
// generic.
func (b *builder) interfaceDevice() {
	if b.in.Interface == "" {
		return
	}
	p, ok := ForUSB(b.in.USBID)
	if !ok {
		out := b.in.Outputs
		p = Generic(cardName(b.in.Interface), b.in.Channels, out)
	}
	b.prof = p
	d := Device{ID: p.ID, Role: "interface", Name: p.Name, Short: p.Short, Profile: p.ID, Generic: p.Generic,
		Placeholder: p.Placeholder, Note: p.Note, USB: b.in.USBID, Match: p.Match.MIDI}
	if u, ok := p.Port("usb"); ok {
		d.In, d.Out = u.In, u.Out
	}
	for _, port := range p.Ports {
		s := Socket{ID: d.ID + "." + port.ID, Label: port.Label, Kind: port.Kind, Dir: port.Dir, About: port.About}
		for _, t := range p.Taps {
			if t.From == port.ID {
				s.Tap = t.ID
			}
		}
		d.Sockets = append(d.Sockets, s)
	}
	b.g.Devices = append(b.g.Devices, d)
	b.ifaceN = len(b.g.Devices) - 1
	b.g.Cables = append(b.g.Cables, Cable{ID: "usb:" + d.ID, From: d.ID + ".usb", To: "kit.usb", Kind: "usb", Fixed: true,
		Writes: "the interface the capture opened (DEVICE_MATCH)",
		About:  fmt.Sprintf("USB audio: %d in, %d out. The capture records every input.", d.In, d.Out)})
}

// cardName is a PortAudio name without ALSA's suffix (audio.CardName).
func cardName(name string) string {
	if i := strings.Index(name, ":"); i > 0 {
		return strings.TrimSpace(name[:i])
	}
	return strings.TrimSpace(name)
}

// kit is Hindsight's own patch bay.
func (b *builder) kit() {
	k := Device{ID: "kit", Role: "kit", Name: "Hindsight kit", Short: "Kit", Profile: "kit"}
	if b.in.Version != "" {
		k.Note = b.in.Version
	}
	k.Sockets = append(k.Sockets, Socket{ID: "kit.usb", Label: "USB", Kind: "usb", Dir: "in", About: "The interface's USB: every input it has, into the ring."})
	for _, s := range b.in.Sources {
		sock := Socket{ID: "kit.tap." + s.Name, Label: strings.ToUpper(s.Name), Kind: "tap", Dir: "out",
			Pair: []int{s.Pair[0], s.Pair[1]}, Hears: nonNil(s.Hears), PeakDB: s.PeakDB, Signal: s.PeakDB != nil && *s.PeakDB > signalFloorDB}
		sock.About = fmt.Sprintf("USB %d/%d.", s.Pair[0], s.Pair[1])
		if t, ok := b.prof.TapAt(s.Pair); ok {
			sock.About = t.About
			if t.From != "" && t.From != "mix" {
				sock.Name = b.labels[b.prof.ID+"."+t.From]
			}
		}
		if n := b.labels[sock.ID]; n != "" {
			sock.Name = n
		}
		k.Sockets = append(k.Sockets, sock)
	}
	if t := b.in.Tape; t != nil {
		armed := map[int]bool{}
		for _, n := range t.Armed {
			armed[n] = true
		}
		for _, tr := range t.Tracks {
			k.Sockets = append(k.Sockets, Socket{ID: fmt.Sprintf("kit.track.%d", tr.N), Label: strconv.Itoa(tr.N), Name: tr.Name,
				Kind: "track", Dir: "both", Track: tr.N, Armed: armed[tr.N], Clips: tr.Clips, Bus: tr.Bus, Mute: tr.Mute,
				About: fmt.Sprintf("Track %d's input: what a catch or ● Rec puts on it.", tr.N)})
		}
		for _, bus := range []string{"A", "B"} {
			about := fmt.Sprintf("Bus %s: the tracks on it play out of USB playback %s.", bus, map[string]string{"A": "1/2", "B": "3/4"}[bus])
			for _, r := range b.prof.Returns {
				if r.Bus == bus {
					about = r.About
				}
			}
			k.Sockets = append(k.Sockets, Socket{ID: "kit.bus." + bus, Label: "BUS " + bus, Kind: "bus", Dir: "both", Bus: bus, About: about})
		}
		if t.Streams {
			k.Sockets = append(k.Sockets, Socket{ID: "kit.out", Label: "OUT", Kind: "out", Dir: "out", About: "The tape, streamed to a phone on the Wi-Fi."})
		}
	}
	k.Sockets = append(k.Sockets,
		Socket{ID: "kit.keep", Label: "KEEP", Kind: "keep", Dir: "in", About: "What a KEEP writes to a take: one tap, or every input."},
		Socket{ID: "kit.clock-out", Label: "CLOCK OUT", Kind: "midi", Dir: "out", About: "The tape's MIDI clock, Start and Stop, when it leads."},
		Socket{ID: "kit.clock-in", Label: "CLOCK IN", Kind: "midi", Dir: "in", About: "The MIDI clock a take's tempo is read from."},
		Socket{ID: "kit.midi", Label: "MIDI IN", Kind: "midi", Dir: "in", About: "MIDI recorded beside each take, as a .mid."},
	)
	if b.in.Controller {
		k.Sockets = append(k.Sockets, Socket{ID: "kit.controls", Label: "CONTROLS", Kind: "midi", Dir: "in", About: "A controller's notes and knobs, played into the instrument strip."})
	}
	b.g.Kit = k
	if t := b.in.Tape; t != nil {
		b.g.Tape = &TapeInfo{ID: t.ID, Armed: nonNilInts(t.Armed), Output: t.Output}
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilInts(s []int) []int {
	if s == nil {
		return []int{}
	}
	return s
}

// list reads a comma-separated setting: the names in it, a nudge after a
// colon ("bento:-4") left off.
func list(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		p = strings.TrimSpace(p)
		if i := strings.LastIndex(p, ":"); i > 0 {
			if _, err := strconv.ParseFloat(strings.TrimSpace(p[i+1:]), 64); err == nil {
				p = strings.TrimSpace(p[:i])
			}
		}
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// names says whether a device name is matched by any substring in a list,
// as MIDI_DEVICES matches.
func names(subs []string, name string) bool {
	n := strings.ToLower(name)
	for _, s := range subs {
		if strings.Contains(n, strings.ToLower(s)) {
			return true
		}
	}
	return false
}

// midiDevices are the MIDI ports, by profile: a port that is the
// interface's own joins it.
func (b *builder) midiDevices() {
	ports := append([]MIDIPort(nil), b.in.MIDI...)
	sort.SliceStable(ports, func(i, j int) bool { return ports[i].Name < ports[j].Name })
	used := map[string]bool{"kit": true, "phones": true}
	if d := b.iface(); d != nil {
		used[d.ID] = true
	}
	for _, port := range ports {
		if d := b.iface(); d != nil && !b.prof.Generic && b.prof.Match.MIDI != "" && names([]string{b.prof.Match.MIDI}, port.Name) {
			d.MIDI = append(d.MIDI, port.Name)
			b.midiCables(d, port)
			continue
		}
		p, ok := ForMIDI(port.Name)
		if !ok {
			p = GenericMIDI(port.Name)
		}
		id := p.ID
		if p.Generic {
			id = "midi-" + slug(port.Name)
		}
		for n := 2; used[id]; n++ {
			id = fmt.Sprintf("%s-%d", strings.TrimSuffix(id, fmt.Sprintf("-%d", n-1)), n)
		}
		used[id] = true
		d := Device{ID: id, Role: "midi", Name: p.Name, Short: p.Short, Profile: p.ID, Generic: p.Generic,
			Placeholder: p.Placeholder, Note: p.Note, MIDI: []string{port.Name}, Match: p.Match.MIDI}
		if p.Generic {
			d.Name, d.Short, d.Match = port.Name, port.Name, port.Name
		}
		for _, x := range p.Ports {
			d.Sockets = append(d.Sockets, Socket{ID: id + "." + x.ID, Label: x.Label, Kind: x.Kind, Dir: x.Dir, About: x.About})
		}
		b.g.Devices = append(b.g.Devices, d)
		b.midiCables(&b.g.Devices[len(b.g.Devices)-1], port)
	}
	// The listener: a phone on the network, when the tape can stream.
	if t := b.in.Tape; t != nil && t.Streams {
		b.g.Devices = append(b.g.Devices, Device{ID: "phones", Role: "listener", Name: "A phone", Short: "Phone", Profile: "listener",
			Sockets: []Socket{{ID: "phones.in", Label: "Wi-Fi", Kind: "network", Dir: "in", About: "A phone that plays the tape: the tape page's OUT."}}})
	}
}

var nonWord = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	s = strings.Trim(nonWord.ReplaceAllString(strings.ToLower(s), "-"), "-")
	if s == "" {
		return "device"
	}
	return s
}

// both draws a cable that a pair of settings decides: present under the
// saved values, the running ones, or both. Present in only one, it's
// pending: plugged and waiting for a restart, or unplugged and still on.
func (b *builder) both(c Cable, present func(get func(string) string) bool) {
	saved, running := present(b.under(true)), present(b.under(false))
	switch {
	case saved && running:
	case saved:
		c.Pending = "plug"
	case running:
		c.Pending = "unplug"
	default:
		return
	}
	c.Restart = true
	b.g.Cables = append(b.g.Cables, c)
}

// midiCables are a MIDI device's: recorded, its clock in, the tape's clock
// out to it, and as a controller.
func (b *builder) midiCables(d *Device, port MIDIPort) {
	out, in := d.ID+".midi-out", d.ID+".midi-in"
	hasOut, hasIn := false, false
	for _, s := range d.Sockets {
		hasOut = hasOut || s.ID == out
		hasIn = hasIn || s.ID == in
	}
	name := port.Name
	if hasOut {
		b.both(Cable{ID: "midi:" + d.ID, From: out, To: "kit.midi", Kind: "midi", Writes: keyIgnore,
			About: name + "'s MIDI, recorded beside each take. Unplugged, it's ignored (MIDI_IGNORE)."},
			func(get func(string) string) bool {
				if strings.EqualFold(strings.TrimSpace(get(keyCapture)), "false") {
					return false
				}
				if names(list(get(keyIgnore)), name) {
					return false
				}
				allow := list(get(keyDevices))
				return len(allow) == 0 || names(allow, name)
			})
		isIface := b.iface() != nil && d.ID == b.iface().ID
		b.both(Cable{ID: "clock-in:" + d.ID, From: out, To: "kit.clock-in", Kind: "clock", Writes: keyClockIn,
			About: "The tempo is read from " + name + "'s clock (MIDI_CLOCK_DEVICE)."},
			func(get func(string) string) bool {
				if names(list(get(keyIgnore)), name) {
					return false
				}
				v := strings.TrimSpace(get(keyClockIn))
				if v == "" {
					return isIface // empty follows the interface
				}
				return names([]string{v}, name)
			})
		if b.in.Controller {
			b.both(Cable{ID: "controls:" + d.ID, From: out, To: "kit.controls", Kind: "midi", Writes: keyControl,
				About: name + " plays the instrument strip (TAPE_CONTROLLER)."},
				func(get func(string) string) bool { return names(list(get(keyControl)), name) })
		}
	}
	if hasIn {
		b.both(Cable{ID: "clock-out:" + d.ID, From: "kit.clock-out", To: in, Kind: "clock", Writes: keyClock + ", " + keyClockOut,
			About: "The tape leads " + name + ": clock, Start, Stop and where it is (TAPE_CLOCK=lead)."},
			func(get func(string) string) bool {
				return strings.EqualFold(strings.TrimSpace(get(keyClock)), "lead") && names(list(get(keyClockOut)), name)
			})
	}
}

// tapeCables are the tape's: each track's input, its bus, the buses into
// the interface, and OUT.
func (b *builder) tapeCables() {
	t := b.in.Tape
	if t == nil {
		return
	}
	known := map[string]bool{}
	for _, s := range b.in.Sources {
		known[s.Name] = true
	}
	for _, tr := range t.Tracks {
		if tr.Input != "" && known[tr.Input] {
			b.g.Cables = append(b.g.Cables, Cable{ID: fmt.Sprintf("input:%d", tr.N), From: "kit.tap." + tr.Input, To: fmt.Sprintf("kit.track.%d", tr.N),
				Kind: "patch", Writes: "tape input", About: fmt.Sprintf("Track %d records from %s.", tr.N, strings.ToUpper(tr.Input))})
		}
		bus := tr.Bus
		if bus != "B" {
			bus = "A"
		}
		b.g.Cables = append(b.g.Cables, Cable{ID: fmt.Sprintf("bus:%d", tr.N), From: fmt.Sprintf("kit.track.%d", tr.N), To: "kit.bus." + bus,
			Kind: "patch", Writes: "track bus", Off: tr.Clips == 0 || tr.Mute,
			About: fmt.Sprintf("Track %d plays on bus %s.", tr.N, bus)})
	}
	room := t.Output != "phone"
	for _, r := range b.prof.Returns {
		b.g.Cables = append(b.g.Cables, Cable{ID: "return:" + r.Bus, From: "kit.bus." + r.Bus, To: b.prof.ID + "." + r.Into, Kind: "return", Fixed: true,
			Off: !room, Writes: "the interface's routing", About: r.About})
	}
	if t.Streams && (t.Output == "phone" || t.Output == "both") {
		b.g.Cables = append(b.g.Cables, Cable{ID: "out:phones", From: "kit.out", To: "phones.in", Kind: "network", Writes: "tape output",
			About: map[string]string{"phone": "The tape plays on a phone, and not in the room.", "both": "The tape plays in the room and on a phone."}[t.Output]})
	}
}

// pairOf reads SAVE_CHANNELS: "1,2".
func pairOf(v string) ([2]int, bool) {
	l, r, ok := strings.Cut(strings.TrimSpace(v), ",")
	if !ok {
		return [2]int{}, false
	}
	a, err1 := strconv.Atoi(strings.TrimSpace(l))
	c, err2 := strconv.Atoi(strings.TrimSpace(r))
	if err1 != nil || err2 != nil {
		return [2]int{}, false
	}
	return [2]int{a, c}, true
}

// keep is what a KEEP writes, and its cable: from the tap whose pair it is,
// or from the interface's USB for every channel.
func (b *builder) keep() {
	k := Keep{Choices: []string{}}
	for _, s := range b.in.Sources {
		k.Choices = append(k.Choices, s.Name)
	}
	k.Choices = append(k.Choices, "all")
	all := func(get func(string) string) bool {
		return strings.EqualFold(strings.TrimSpace(get(keySaveAll)), "true")
	}
	tapOf := func(get func(string) string) string {
		if all(get) {
			return ""
		}
		p, ok := pairOf(get(keySave))
		if !ok {
			return ""
		}
		for _, s := range b.in.Sources {
			if s.Pair == p {
				return s.Name
			}
		}
		return ""
	}
	saved := b.under(true)
	k.All = all(saved)
	k.Tap = tapOf(saved)
	if p, ok := pairOf(saved(keySave)); ok && !k.All {
		k.Pair = []int{p[0], p[1]}
	}
	k.Pending = b.set(keySave).Pending() || b.set(keySaveAll).Pending()
	b.g.Keep = k
	for _, s := range b.in.Sources {
		name := s.Name
		b.both(Cable{ID: "keep:" + name, From: "kit.tap." + name, To: "kit.keep", Kind: "keep", Writes: keySave,
			About: fmt.Sprintf("A KEEP writes %s (USB %d/%d) to the take.", strings.ToUpper(name), s.Pair[0], s.Pair[1])},
			func(get func(string) string) bool { return tapOf(get) == name })
	}
	if d := b.iface(); d != nil {
		b.both(Cable{ID: "keep:all", From: d.ID + ".usb", To: "kit.keep", Kind: "keep", Writes: keySaveAll,
			About: "A KEEP writes every input to the take, for stems: about 23 MB a minute per pair."}, all)
	}
}

// jacks are the cables you draw: labels, which name what's plugged into a
// jack and route nothing. One waits, dashed, until its tap has signal.
func (b *builder) jacks() {
	sockets := map[string]Socket{}
	for _, d := range b.g.Devices {
		for _, s := range d.Sockets {
			sockets[s.ID] = s
		}
	}
	signal := map[string]bool{}
	for _, s := range b.g.Kit.Sockets {
		if s.Kind == "tap" {
			signal[strings.TrimPrefix(s.ID, "kit.tap.")] = s.Signal
		}
	}
	keys := make([]string, 0, len(b.labels))
	for k := range b.labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		s, ok := sockets[k]
		if !ok || b.labels[k] == "" {
			continue
		}
		for di := range b.g.Devices {
			for si := range b.g.Devices[di].Sockets {
				if b.g.Devices[di].Sockets[si].ID == k {
					b.g.Devices[di].Sockets[si].Name = b.labels[k]
				}
			}
		}
		c := Cable{ID: "jack:" + k, From: "label:" + k, To: k, Kind: "jack", Label: b.labels[k], Writes: "a label (rig.json)",
			About: fmt.Sprintf("%q, drawn into %s. A label: it names what's there and routes nothing.", b.labels[k], s.Label)}
		c.Waiting = s.Tap == "" || !signal[s.Tap]
		b.g.Cables = append(b.g.Cables, c)
	}
}

// warnings works out where the tape records itself: a tap that hears a
// bus, patched to an armed track, while an unmuted track with clips plays
// on that bus. Its fix moves those tracks to a bus no armed track's tap
// hears, when there is one.
func (b *builder) warnings() {
	t := b.in.Tape
	if t == nil {
		return
	}
	hears := map[string][]string{}
	for _, s := range b.in.Sources {
		hears[s.Name] = s.Hears
	}
	input := map[int]string{}
	for _, tr := range t.Tracks {
		input[tr.N] = tr.Input
	}
	armedBy := map[string][]int{}
	var taps []string
	heard := map[string]bool{} // buses some armed track's tap hears
	for _, n := range t.Armed {
		src := input[n]
		if _, ok := hears[src]; !ok {
			continue // none of its own: this device's choice, unknown here
		}
		if armedBy[src] == nil {
			taps = append(taps, src)
		}
		armedBy[src] = append(armedBy[src], n)
		for _, h := range hears[src] {
			heard[h] = true
		}
	}
	free := ""
	for _, bus := range []string{"A", "B"} {
		if !heard[bus] {
			free = bus
			break
		}
	}
	for _, src := range taps {
		var tracks []int
		buses := map[string]bool{}
		for _, tr := range t.Tracks {
			if tr.Clips == 0 || tr.Mute {
				continue
			}
			for _, h := range hears[src] {
				if tr.Bus == h {
					tracks = append(tracks, tr.N)
					buses[h] = true
				}
			}
		}
		if len(tracks) == 0 {
			continue
		}
		var bl []string
		for _, bus := range []string{"A", "B"} {
			if buses[bus] {
				bl = append(bl, bus)
			}
		}
		tap := strings.ToUpper(src)
		w := Warning{ID: "tape-in-tap:" + src, Tap: src, Socket: "kit.tap." + src, Buses: bl, Armed: armedBy[src], Tracks: tracks}
		w.Text = fmt.Sprintf("%s on bus %s, which %s hears. Recording %s from %s records %s too.",
			playWords(tracks), strings.Join(bl, " and "), tap, trackWords(armedBy[src]), tap, them(tracks))
		if free != "" {
			f := &Fix{Label: fmt.Sprintf("Move %s to bus %s", trackWords(tracks), free)}
			for _, n := range tracks {
				f.Buses = append(f.Buses, Move{N: n, Bus: free})
			}
			w.Fix = f
		} else {
			w.Text += fmt.Sprintf(" Mute %s, or record from a tap that doesn't hear the tape.", them(tracks))
		}
		b.g.Warnings = append(b.g.Warnings, w)
		for i := range b.g.Kit.Sockets {
			s := &b.g.Kit.Sockets[i]
			if s.Kind == "track" && contains(armedBy[src], s.Track) {
				s.Warn = true
			}
		}
	}
}

func contains(ns []int, n int) bool {
	for _, x := range ns {
		if x == n {
			return true
		}
	}
	return false
}

// trackWords is "track 2", or "tracks 1, 4".
func trackWords(ns []int) string {
	var s []string
	for _, n := range ns {
		s = append(s, strconv.Itoa(n))
	}
	if len(ns) == 1 {
		return "track " + s[0]
	}
	return "tracks " + strings.Join(s, ", ")
}

// playWords is "Track 1 plays", or "Tracks 1 and 4 play".
func playWords(ns []int) string {
	var s []string
	for _, n := range ns {
		s = append(s, strconv.Itoa(n))
	}
	if len(ns) == 1 {
		return "Track " + s[0] + " plays"
	}
	return "Tracks " + strings.Join(s[:len(s)-1], ", ") + " and " + s[len(s)-1] + " play"
}

func them(ns []int) string {
	if len(ns) == 1 {
		return "it"
	}
	return "them"
}

// sameSources says two TAPE_SOURCES are the same taps, in any order.
func sameSources(a, b string) bool {
	fa, fb := strings.Fields(strings.ToLower(a)), strings.Fields(strings.ToLower(b))
	sort.Strings(fa)
	sort.Strings(fb)
	return strings.Join(fa, " ") == strings.Join(fb, " ")
}

// offer suggests the interface's own taps when TAPE_SOURCES isn't them.
func (b *builder) offer() {
	if b.iface() == nil || len(b.prof.Taps) == 0 {
		return
	}
	want := b.prof.Sources()
	s := b.set(keySources)
	if sameSources(s.Running, want) {
		return
	}
	about := "TAPE_SOURCES isn't this interface's taps. Use its own: " + want + "."
	if b.prof.Generic {
		about = "An interface Hindsight has no profile for: its inputs in pairs, hearing nothing of the tape, as far as anyone knows. " + want + "."
	}
	b.g.Offer = &Offer{Label: "Use these taps", About: about, Settings: map[string]string{keySources: want}, Pending: sameSources(s.Value, want)}
}

// lines are the settings the picture is.
func (b *builder) lines() {
	keys := []string{keySources, keySave, keySaveAll, keyClock, keyClockOut, keyClockIn, keyIgnore}
	if b.in.Controller {
		keys = append(keys, keyControl)
	}
	for _, k := range keys {
		s := b.set(k)
		l := Line{Key: k, Value: s.Value, Pending: s.Pending()}
		if l.Pending {
			l.Running = s.Running
		}
		b.g.Settings = append(b.g.Settings, l)
	}
	if t := b.in.Tape; t != nil {
		var ins []string
		for _, tr := range t.Tracks {
			ins = append(ins, strconv.Quote(tr.Input))
		}
		var armed []string
		for _, n := range t.Armed {
			armed = append(armed, strconv.Itoa(n))
		}
		b.g.Settings = append(b.g.Settings,
			Line{Key: "tape inputs", Value: "[" + strings.Join(ins, ",") + "]"},
			Line{Key: "rec tracks", Value: "[" + strings.Join(armed, ",") + "]"},
			Line{Key: "tape output", Value: t.Output})
	}
}

// found is the header's line: what's plugged in, and how it's reached.
func (b *builder) found() {
	var parts []string
	if d := b.iface(); d != nil {
		parts = append(parts, d.Short+" on USB")
	} else {
		parts = append(parts, "no audio interface")
	}
	var midi []string
	for _, d := range b.g.Devices {
		if d.Role == "midi" {
			midi = append(midi, d.Short)
		}
	}
	switch len(midi) {
	case 0:
	case 1:
		parts = append(parts, midi[0]+" on MIDI")
	default:
		parts = append(parts, strings.Join(midi[:len(midi)-1], ", ")+" and "+midi[len(midi)-1]+" on MIDI")
	}
	b.g.Found = strings.Join(parts, " · ")
}
