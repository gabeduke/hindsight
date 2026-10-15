package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The control bus on the Pi (docs/superpowers/specs/2026-10-15-instrument-strip-design.md,
// "MIDI on the Pi"): a controller plugged into the Pi plays Play mode's pads
// and runs the Studio's verbs with no page open and no Wi-Fi hop.
//
// The watcher (internal/midi) opens the devices TAPE_CONTROLLER names and
// hands their messages here (ControlMIDI). Each note or CC is looked up in
// that controller's bindings -- TAPE_DIR/controls.json, keyed by controller
// name, or the defaults -- and:
//
//   - a held pad is pressed and let go as a page's is: the controller is
//     one more holder, midi:<port>, in playHolds, quantised like a page's
//     press, and its holds are let go when its port goes;
//   - the latch (CC64, a sustain pedal) keeps what's let go held until it
//     lifts; All Notes Off (CC123) lets go of everything it holds;
//   - a command runs here: CATCH, the transport, GRAB into the clipboard
//     (pages see it on their next poll, so the buffer opens), DROP on the
//     armed track at the next free span, KEEP of the feed;
//   - an amount moves (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md):
//     a punch-in FX takes its velocity at the press, and the mod wheel (CC1)
//     or aftertouch moves it while held; the pitch wheel is the bend, held
//     while it's off its centre; CC 21–24 turn the tape mods, previewed as
//     they turn and saved once still for a second (tape.ModKnobs), and a
//     program change 0–3 picks a formula.
//
// MIDI LEARN travels over the play socket (play.go): the next note or CC
// from that controller, and nothing else, is bound to the action.

// Binding is one MIDI message an action answers: a note, a CC, the pitch
// wheel, a program change, or Start/Stop. Ch narrows it to one channel
// (1–16); 0 is any. As "amount" marks a CC that moves an amount (P4) rather
// than pressing.
type Binding struct {
	Note    *int   `json:"note,omitempty"`
	CC      *int   `json:"cc,omitempty"`
	Ch      int    `json:"ch,omitempty"`
	Bend    bool   `json:"bend,omitempty"`
	Program bool   `json:"program,omitempty"`
	RT      string `json:"rt,omitempty"`
	As      string `json:"as,omitempty"`
}

// Bindings is a controller's map, action id → what plays it.
type Bindings map[string][]Binding

const (
	kindHeld     = "held"
	kindAmount   = "amount"
	kindLatched  = "latched"
	kindCommand  = "command"
	kindModifier = "modifier"
)

// controlAction is one of web/static/lib/play/controls.js's actions, as far
// as the Pi needs it: its kind and its default MIDI. TestControlsMatchThePage
// holds the two lists together.
type controlAction struct {
	ID   string
	Kind string
	MIDI []Binding
}

func bn(n int) Binding                { return Binding{Note: &n} }
func bcc(n int) Binding               { return Binding{CC: &n} }
func bamount(n int) Binding           { return Binding{CC: &n, As: "amount"} }
func brt(rt string) Binding           { return Binding{RT: rt} }
func bwith(b Binding, ch int) Binding { b.Ch = ch; return b }

// controlActions: note 36 counting up, as an unknown controller starts.
var controlActions = []controlAction{
	{"track1", kindHeld, []Binding{bn(36)}},
	{"track2", kindHeld, []Binding{bn(37)}},
	{"track3", kindHeld, []Binding{bn(38)}},
	{"track4", kindHeld, []Binding{bn(39)}},
	{"break", kindHeld, []Binding{bn(40)}},
	{"reverse", kindHeld, []Binding{bn(41)}},
	{"chop", kindHeld, []Binding{bn(42)}},
	{"stop", kindHeld, []Binding{bn(43)}},
	{"half", kindHeld, []Binding{bn(44)}},
	{"double", kindHeld, []Binding{bn(45)}},
	{"roll", kindHeld, []Binding{bn(46)}},
	{"filter", kindHeld, []Binding{bn(47), bamount(1)}},
	{"echo", kindHeld, []Binding{bn(48)}},
	{"crush", kindHeld, []Binding{bn(49)}},
	{"bend", kindAmount, []Binding{{Bend: true}}},
	{"mod.wow", kindLatched, []Binding{bamount(21)}},
	{"mod.flutter", kindLatched, []Binding{bamount(22)}},
	{"mod.drive", kindLatched, []Binding{bamount(23)}},
	{"mod.age", kindLatched, []Binding{bamount(24)}},
	{"mod.formula", kindLatched, []Binding{{Program: true}}},
	{"latch", kindModifier, []Binding{bcc(64)}},
	{"transport", kindCommand, []Binding{brt("start"), brt("stop")}},
	{"panic", kindCommand, []Binding{bcc(123)}},
	{"catch", kindCommand, []Binding{bn(50)}},
	{"grab", kindCommand, []Binding{bn(51)}},
	{"drop", kindCommand, []Binding{bn(52)}},
	{"keep", kindCommand, []Binding{bn(53)}},
	{"click", kindCommand, nil},
	{"buffer.in-back", kindCommand, nil},
	{"buffer.in-on", kindCommand, nil},
	{"buffer.out-back", kindCommand, nil},
	{"buffer.out-on", kindCommand, nil},
	{"buffer.toss", kindCommand, nil},
	{"crate.1", kindHeld, []Binding{bn(60)}},
	{"crate.2", kindHeld, []Binding{bn(61)}},
	{"crate.3", kindHeld, []Binding{bn(62)}},
	{"crate.4", kindHeld, []Binding{bn(63)}},
	{"crate.5", kindHeld, []Binding{bn(64)}},
	{"crate.6", kindHeld, []Binding{bn(65)}},
}

func actionByID(id string) (controlAction, bool) {
	for _, c := range controlActions {
		if c.ID == id {
			return c, true
		}
	}
	return controlAction{}, false
}

// defaultBindings is note 36 counting up, and the CCs, the wheel and
// Start/Stop: controls.js's defaults.
func defaultBindings() Bindings {
	out := Bindings{}
	for _, c := range controlActions {
		if len(c.MIDI) > 0 {
			out[c.ID] = slices.Clone(c.MIDI)
		}
	}
	return out
}

// profile is a known controller's own starting map.
type profile struct {
	Name     string // matched in the device's name, as TAPE_CONTROLLER is
	Bindings func() Bindings
}

// profiles: known controllers.
//
// The SMK-37 (M-VAVE): its manual wasn't to be found when this was written,
// so the profile is the defaults with every note on channel 10, where a
// controller's drum pads usually send (36 up, as here). That keeps its
// keys, on channel 1 and starting at C3 (48), from running CATCH or DROP
// while they're played. If its pads send elsewhere, MIDI LEARN rebinds them.
var profiles = []profile{
	{Name: "SMK-37", Bindings: func() Bindings {
		out := defaultBindings()
		for id, list := range out {
			for i, b := range list {
				if b.Note != nil {
					list[i] = bwith(b, 10)
				}
			}
			out[id] = list
		}
		return out
	}},
}

func profileFor(name string) (string, Bindings) {
	low := strings.ToLower(name)
	for _, p := range profiles {
		if strings.Contains(low, strings.ToLower(p.Name)) {
			return p.Name, p.Bindings()
		}
	}
	return "", defaultBindings()
}

// controlsFile is TAPE_DIR/controls.json: the Pi's bindings, shared by
// everyone, like its settings.
type controlsFile struct {
	Version int `json:"version"`
	// Quantum is when a controller's press lands, as a page's quantise
	// switch says for its own: 16th unless set.
	Quantum string `json:"quantum,omitempty"`
	// Catch is how a controller's CATCH lands on audio already there:
	// "layer" (the default) or "replace". The page's Layer / Replace switch
	// is each device's own, so the Pi keeps one of its own.
	Catch       string              `json:"catch,omitempty"`
	Controllers map[string]Bindings `json:"controllers"`
}

// midiMsg is one message, decoded as controls.js's midi.js decodes it.
type midiMsg struct {
	typ   string // on, off, cc, bend, program, rt
	ch    int
	note  int
	cc    int
	value int
	rt    string
}

func decodeMIDI(status, d1, d2 byte) (midiMsg, bool) {
	switch status {
	case 0xFA, 0xFB:
		return midiMsg{typ: "rt", rt: "start"}, true
	case 0xFC:
		return midiMsg{typ: "rt", rt: "stop"}, true
	}
	ch := int(status&0x0F) + 1
	switch status & 0xF0 {
	case 0x90:
		if d2 > 0 {
			return midiMsg{typ: "on", ch: ch, note: int(d1), value: int(d2)}, true
		}
		return midiMsg{typ: "off", ch: ch, note: int(d1)}, true
	case 0x80:
		return midiMsg{typ: "off", ch: ch, note: int(d1)}, true
	case 0xB0:
		return midiMsg{typ: "cc", ch: ch, cc: int(d1), value: int(d2)}, true
	case 0xC0:
		return midiMsg{typ: "program", ch: ch, value: int(d1)}, true
	case 0xD0:
		return midiMsg{typ: "pressure", ch: ch, value: int(d1)}, true
	case 0xA0:
		return midiMsg{typ: "polypressure", ch: ch, note: int(d1), value: int(d2)}, true
	case 0xE0:
		return midiMsg{typ: "bend", ch: ch, value: int(d2)<<7 | int(d1)}, true
	}
	return midiMsg{}, false
}

func (b Binding) matches(m midiMsg) bool {
	if b.Ch != 0 && m.ch != 0 && b.Ch != m.ch {
		return false
	}
	switch m.typ {
	case "on", "off":
		return b.Note != nil && *b.Note == m.note
	case "cc":
		return b.CC != nil && *b.CC == m.cc
	case "bend":
		return b.Bend
	case "program":
		return b.Program
	case "rt":
		return b.RT != "" && b.RT == m.rt
	}
	return false
}

// actionFor is the action a message plays, skipping amounts (P4's).
func (bs Bindings) actionFor(m midiMsg) (string, bool) {
	ids := make([]string, 0, len(bs))
	for id := range bs {
		ids = append(ids, id)
	}
	sort.Strings(ids) // one answer, whatever the map's order
	for _, id := range ids {
		for _, b := range bs[id] {
			if b.As == "amount" {
				continue
			}
			if b.matches(m) {
				return id, true
			}
		}
	}
	return "", false
}

// bind writes one learned binding for id: it replaces id's bindings but its
// amounts, and comes off every other action, so one key plays one pad.
func (bs Bindings) bind(id string, nb Binding) Bindings {
	same := func(x Binding) bool {
		if x.Ch != 0 && nb.Ch != 0 && x.Ch != nb.Ch {
			return false
		}
		return (nb.Note != nil && x.Note != nil && *x.Note == *nb.Note) || (nb.CC != nil && x.CC != nil && *x.CC == *nb.CC)
	}
	out := Bindings{}
	for k, list := range bs {
		var keep []Binding
		for _, x := range list {
			if !same(x) {
				keep = append(keep, x)
			}
		}
		out[k] = keep
	}
	next := []Binding{nb}
	for _, x := range out[id] {
		if x.As == "amount" {
			next = append(next, x)
		}
	}
	out[id] = next
	return out
}

func (bs Bindings) check() error {
	for id, list := range bs {
		if _, ok := actionByID(id); !ok {
			return fmt.Errorf("%q is not an action", id)
		}
		for _, b := range list {
			n := 0
			if b.Note != nil {
				n++
				if *b.Note < 0 || *b.Note > 127 {
					return fmt.Errorf("%s: note %d is not 0–127", id, *b.Note)
				}
			}
			if b.CC != nil {
				n++
				if *b.CC < 0 || *b.CC > 127 {
					return fmt.Errorf("%s: CC %d is not 0–127", id, *b.CC)
				}
			}
			if b.Bend {
				n++
			}
			if b.Program {
				n++
			}
			if b.RT != "" {
				n++
				if b.RT != "start" && b.RT != "stop" {
					return fmt.Errorf("%s: rt is start or stop", id)
				}
			}
			if n != 1 {
				return fmt.Errorf("%s: a binding is one of note, cc, bend, program or rt", id)
			}
			if b.Ch < 0 || b.Ch > 16 {
				return fmt.Errorf("%s: channel %d is not 1–16", id, b.Ch)
			}
			if b.As != "" && b.As != "amount" {
				return fmt.Errorf("%s: as is amount or nothing", id)
			}
		}
	}
	return nil
}

// verbs are the commands a controller runs on the Pi; tests stand in.
type verbs interface {
	Verb(id, rt string) (string, error)
}

// learnReq is MIDI LEARN waiting for a controller.
type learnReq struct {
	action, port string
	done         func(port string, b Binding)
	refused      func(why string)
	timer        *time.Timer
}

// controlBus is the Pi's side of the bus.
type controlBus struct {
	mu     sync.Mutex
	loaded bool
	file   controlsFile
	held   map[string]map[string]bool // port → the pads it holds
	// pressed is what each key or pedal pressed, by port and message (a
	// note or a CC on a channel): its release lets go of that pad, whatever
	// the bindings say by then, as the keyboard keeps the code it pressed.
	pressed map[string]map[string]string
	latch   map[string]bool            // port → its latch is down
	wait    map[string]map[string]bool // port → pads let go under the latch
	learn   *learnReq
	verbs   verbs // nil: the Pi's own (piVerbs)
	// learnWait is how long learn waits; 0 is ten seconds. Tests shorten it.
	learnWait time.Duration
	// The verbs run off the reader's goroutine, on two queues. GRAB and
	// DROP take turns on the slow one: DROP must find what GRAB put there,
	// and a GRAB waits about a bar for the bar after it. CATCH, KEEP and the
	// transport go on the quick one, so none of them waits behind that bar:
	// KEEP would keep a later 30 s, Stop would stop late, CATCH would take a
	// later pass.
	verbOnce sync.Once
	slowQ    chan verbJob
	quickQ   chan verbJob
	// knobs are each controller's mod knobs, previewing as their own owner;
	// knobQuiet, when set, is how long one is still before it saves (tests).
	knobs     map[string]*tape.ModKnobs
	knobQuiet time.Duration
}

type verbJob struct{ port, id, rt string }

// controlsPath is where the bindings live: beside the tapes.
func (a *API) controlsPath() string { return filepath.Join(a.cfg.TapeDir, "controls.json") }

// controlsLocked reads controls.json once. Called with mu held.
func (a *API) controlsLocked() *controlsFile {
	b := &a.controls
	if b.loaded {
		return &b.file
	}
	b.loaded = true
	b.file = controlsFile{Version: 1, Controllers: map[string]Bindings{}}
	if a.cfg.TapeDir == "" {
		return &b.file // nowhere to keep them: this run only
	}
	raw, err := os.ReadFile(a.controlsPath())
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("[!] controls: %v", err)
		}
		return &b.file
	}
	var f controlsFile
	if err := json.Unmarshal(raw, &f); err != nil {
		log.Printf("[!] controls.json unreadable, starting from the defaults: %v", err)
		return &b.file
	}
	if f.Controllers == nil {
		f.Controllers = map[string]Bindings{}
	}
	if f.Version == 0 {
		f.Version = 1
	}
	b.file = f
	return &b.file
}

// saveControlsLocked writes controls.json whole, by rename.
func (a *API) saveControlsLocked() error {
	if a.cfg.TapeDir == "" {
		return nil
	}
	raw, err := json.MarshalIndent(a.controls.file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(a.controlsPath()), 0o755); err != nil {
		return err
	}
	tmp := a.controlsPath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, a.controlsPath())
}

// bindingsLocked is a controller's map: its own, or its profile's.
func (a *API) bindingsLocked(port string) (Bindings, string, bool) {
	f := a.controlsLocked()
	prof, def := profileFor(port)
	if bs, ok := f.Controllers[port]; ok {
		return bs, prof, true
	}
	return def, prof, false
}

func (a *API) quantumLocked() string {
	if q := a.controlsLocked().Quantum; q != "" {
		return q
	}
	return "16th"
}

// msgKey names a note or a CC on its channel, for what it pressed.
func msgKey(m midiMsg) string {
	switch m.typ {
	case "on", "off":
		return fmt.Sprintf("n%d:%d", m.ch, m.note)
	case "cc":
		return fmt.Sprintf("c%d:%d", m.ch, m.cc)
	}
	return ""
}

// holder is a controller's name in playHolds' terms.
func holder(port string) string { return "midi:" + port }

// ControlMIDI is the watcher's ControlSink: one message from a controller.
func (a *API) ControlMIDI(port string, status, d1, d2 byte) {
	m, ok := decodeMIDI(status, d1, d2)
	if !ok {
		return
	}
	b := &a.controls
	down := m.typ == "on" || m.typ == "rt" || (m.typ == "cc" && (m.value >= 64 || m.cc >= 120))
	key := msgKey(m)
	b.mu.Lock()
	if !down && key != "" {
		if pad, ok := b.pressed[port][key]; ok {
			delete(b.pressed[port], key)
			b.mu.Unlock()
			a.controllerRelease(port, pad)
			return
		}
		if m.typ == "off" {
			b.mu.Unlock()
			return // a note that pressed nothing: the one that taught MIDI LEARN
		}
	}
	if l := b.learn; l != nil && (l.port == "" || l.port == port) && (m.typ == "on" || m.typ == "cc") {
		nb := Binding{Ch: m.ch}
		if m.typ == "on" {
			n := m.note
			nb.Note = &n
		} else {
			c := m.cc
			nb.CC = &c
		}
		bs, _, _ := a.bindingsLocked(port)
		a.controlsLocked().Controllers[port] = bs.bind(l.action, nb)
		if err := a.saveControlsLocked(); err != nil {
			log.Printf("[!] controls: %v", err)
		}
		b.learn = nil
		l.timer.Stop()
		b.mu.Unlock()
		l.done(port, nb)
		return
	}
	bs, _, _ := a.bindingsLocked(port)
	id, found := bs.actionFor(m)
	amountID, isAmount := bs.amountFor(m)
	if m.typ == "polypressure" {
		// Aftertouch on one key: the pad that key pressed, whatever the
		// bindings say by now.
		id, found = b.pressed[port][msgKey(midiMsg{typ: "on", ch: m.ch, note: m.note})]
	}
	q := a.quantumLocked()
	b.mu.Unlock()
	switch {
	case m.typ == "pressure":
		a.controllerPressure(port, "", m.value)
		return
	case m.typ == "polypressure":
		if found {
			a.controllerPressure(port, id, m.value)
		}
		return
	case !found && isAmount:
		a.controllerAmount(port, amountID, m.value)
		return
	case !found:
		return
	}
	act, _ := actionByID(id)
	switch act.Kind {
	case kindModifier:
		a.controllerLatch(port, down)
	case kindHeld:
		if down && key != "" {
			b.mu.Lock()
			if b.pressed == nil {
				b.pressed = map[string]map[string]string{}
			}
			if b.pressed[port] == nil {
				b.pressed[port] = map[string]string{}
			}
			_, again := b.pressed[port][key]
			if !again {
				b.pressed[port][key] = id
			}
			b.mu.Unlock()
			if !again {
				v := math.NaN()
				if m.typ == "on" && fxPads[id] {
					v = float64(m.value) / 127 // its velocity is its amount
				}
				a.controllerPress(port, id, q, v)
			}
		}
	case kindAmount:
		if id == "bend" && m.typ == "bend" {
			a.controllerBend(port, m.value)
		}
	case kindLatched:
		if id == "mod.formula" && m.typ == "program" {
			a.controllerFormula(m.value)
		}
	case kindCommand:
		if !down {
			return
		}
		if id == "panic" {
			a.ControllerGone(port) // let go of all it holds, the latch too
			return
		}
		a.queueVerb(port, id, m.rt)
	}
}

// fxPads are the punch-in FX: held, each with an amount that velocity sets
// and aftertouch moves.
var fxPads = map[string]bool{"roll": true, "filter": true, "echo": true, "crush": true}

// bendDead is how near its centre the pitch wheel counts as let go.
const bendDead = 0.02

// amountFor is the action whose amount a message moves: a CC bound as an
// amount (the mod wheel on FILTER, CC 21–24 on the mods).
func (bs Bindings) amountFor(m midiMsg) (string, bool) {
	if m.typ != "cc" {
		return "", false
	}
	ids := make([]string, 0, len(bs))
	for id := range bs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		for _, b := range bs[id] {
			if b.As == "amount" && b.matches(m) {
				return id, true
			}
		}
	}
	return "", false
}

// controllerAmount moves an amount from a knob or the mod wheel: a punch-in
// FX's, from the next block; a tape mod's, previewed, and saved once the
// knob has been still for a second.
func (a *API) controllerAmount(port, id string, value int) {
	v := float64(value) / 127
	if strings.HasPrefix(id, "mod.") {
		if k := a.knobsFor(port); k != nil {
			if err := k.Turn(a.tape.LoadedID(), id, v); err != nil {
				log.Printf("[!] %s: %s: %v", holder(port), id, err)
			}
		}
		return
	}
	if eng := a.playerOrNil(); eng != nil {
		_ = eng.Set(id, v)
	}
}

// controllerPressure is aftertouch: it moves the amount of the punch-in FX
// the controller holds -- pad's alone for a key's own (poly) aftertouch.
func (a *API) controllerPressure(port, pad string, value int) {
	b := &a.controls
	b.mu.Lock()
	var moved []string
	for p := range b.held[port] {
		if fxPads[p] && (pad == "" || p == pad) {
			moved = append(moved, p)
		}
	}
	b.mu.Unlock()
	sort.Strings(moved)
	eng := a.playerOrNil()
	if eng == nil {
		return
	}
	for _, p := range moved {
		_ = eng.Set(p, float64(value)/127)
	}
}

// controllerBend is the pitch wheel: the bend is pressed as it leaves its
// centre, moved while it's off, and let go as it springs back -- whatever
// the latch says, as a wheel is never held by a pedal.
func (a *API) controllerBend(port string, raw int) {
	v := float64(raw-8192) / 8192
	if raw > 8192 {
		v = float64(raw-8192) / 8191
	}
	b := &a.controls
	b.mu.Lock()
	bending := b.held[port]["bend"]
	b.mu.Unlock()
	eng := a.playerOrNil()
	switch {
	case eng == nil:
	case math.Abs(v) <= bendDead && bending:
		b.mu.Lock()
		delete(b.held[port], "bend")
		delete(b.wait[port], "bend")
		b.mu.Unlock()
		a.playHolds.release("bend", func() { _ = eng.Release("bend") })
	case math.Abs(v) > bendDead && !bending:
		a.controllerPress(port, "bend", tape.QuantumNow, v)
	case bending:
		_ = eng.Set("bend", v)
	}
}

// controllerFormula is a program change: 0–3 pick CLEAN, CHROME, FERRIC or
// WORN for the loaded tape, one step of undo.
func (a *API) controllerFormula(n int) {
	names := tape.Formulas()
	if a.tape == nil || n < 0 || n >= len(names) {
		return
	}
	id := a.tape.LoadedID()
	if id == "" {
		return
	}
	if err := a.tape.SetStyle(id, tape.StyleChange{Formula: &names[n]}); err != nil {
		log.Printf("[!] controls: formula %s: %v", names[n], err)
	}
}

// knobsFor is a controller's mod knobs: they preview as midi:<port>, so a
// page that previewed a mod before them can't clear theirs.
func (a *API) knobsFor(port string) *tape.ModKnobs {
	if a.tape == nil {
		return nil
	}
	b := &a.controls
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.knobs == nil {
		b.knobs = map[string]*tape.ModKnobs{}
	}
	k := b.knobs[port]
	if k == nil {
		k = tape.NewModKnobs(a.tape)
		k.Owner = holder(port)
		if b.knobQuiet > 0 {
			k.Quiet = b.knobQuiet
		}
		b.knobs[port] = k
	}
	return k
}

// controllerPress presses pad for a controller, quantised to q; v is a
// punch-in FX's amount (NaN for none).
func (a *API) controllerPress(port, pad, q string, v float64) {
	if !slices.Contains(tape.Pads(), pad) {
		return // a pad this Pi doesn't play yet (P4's, the crate's)
	}
	eng := a.playerOrNil()
	if eng == nil {
		return
	}
	b := &a.controls
	b.mu.Lock()
	if b.held == nil {
		b.held, b.wait = map[string]map[string]bool{}, map[string]map[string]bool{}
	}
	delete(b.wait[port], pad) // pressed again: the hand holds it, not the latch
	if b.held[port][pad] {
		b.mu.Unlock()
		return
	}
	b.mu.Unlock()
	press := func() error { return eng.Press(pad, q) }
	if !math.IsNaN(v) {
		press = func() error { return eng.PressAmount(pad, q, v) }
	}
	if err := a.playHolds.press(pad, press); err != nil {
		log.Printf("[!] %s: %s refused: %v", holder(port), pad, err)
		return
	}
	b.mu.Lock()
	if b.held[port] == nil {
		b.held[port] = map[string]bool{}
	}
	b.held[port][pad] = true
	b.mu.Unlock()
}

func (a *API) controllerRelease(port, pad string) {
	b := &a.controls
	b.mu.Lock()
	if !b.held[port][pad] {
		b.mu.Unlock()
		return
	}
	if b.latch[port] {
		if b.wait[port] == nil {
			b.wait[port] = map[string]bool{}
		}
		b.wait[port][pad] = true
		b.mu.Unlock()
		return
	}
	delete(b.held[port], pad)
	b.mu.Unlock()
	if eng := a.playerOrNil(); eng != nil {
		a.playHolds.release(pad, func() { _ = eng.Release(pad) })
	}
}

func (a *API) controllerLatch(port string, down bool) {
	b := &a.controls
	b.mu.Lock()
	if b.latch == nil {
		b.latch = map[string]bool{}
	}
	b.latch[port] = down
	var waiting []string
	if !down {
		for p := range b.wait[port] {
			waiting = append(waiting, p)
		}
		delete(b.wait, port)
	}
	b.mu.Unlock()
	for _, p := range waiting {
		a.controllerRelease(port, p)
	}
}

// ControllerGone is the watcher's word that a controller's port went: what
// it held is let go, as a dropped socket's is. Also its All Notes Off.
func (a *API) ControllerGone(port string) {
	b := &a.controls
	b.mu.Lock()
	var held []string
	for p := range b.held[port] {
		held = append(held, p)
	}
	delete(b.held, port)
	delete(b.wait, port)
	delete(b.latch, port)
	delete(b.pressed, port)
	b.mu.Unlock()
	eng := a.playerOrNil()
	if eng == nil {
		return
	}
	for _, p := range held {
		a.playHolds.release(p, func() { _ = eng.Release(p) })
	}
}

// heldBy lists the pads a controller holds, for tests and the log.
func (a *API) heldBy(port string) []string {
	a.controls.mu.Lock()
	defer a.controls.mu.Unlock()
	var out []string
	for p := range a.controls.held[port] {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// startLearn waits for the next note or CC from port ("" any controller)
// and binds it to action; done hears it, refused hears why not (another
// learn took its place, or ten seconds passed). The cancel it returns
// forgets it, if it's still waiting.
func (a *API) startLearn(action, port string, done func(port string, b Binding), refused func(why string)) (cancel func(), err error) {
	if _, ok := actionByID(action); !ok {
		return nil, fmt.Errorf("%q is not an action", action)
	}
	b := &a.controls
	wait := b.learnWait
	if wait == 0 {
		wait = 10 * time.Second
	}
	l := &learnReq{action: action, port: port, done: done, refused: refused}
	b.mu.Lock()
	prev := b.learn
	b.learn = l
	l.timer = time.AfterFunc(wait, func() {
		b.mu.Lock()
		mine := b.learn == l
		if mine {
			b.learn = nil
		}
		b.mu.Unlock()
		if mine {
			refused(fmt.Sprintf("no controller moved in %d s", int(wait.Round(time.Second)/time.Second)))
		}
	})
	b.mu.Unlock()
	if prev != nil {
		prev.timer.Stop()
		prev.refused("another pad is learning")
	}
	return func() {
		b.mu.Lock()
		mine := b.learn == l
		if mine {
			b.learn = nil
		}
		b.mu.Unlock()
		if mine {
			l.timer.Stop()
		}
	}, nil
}

// queueVerb hands a command to its queue's goroutine. A full queue drops it:
// sixteen commands waiting is a stuck verb, not a player.
func (a *API) queueVerb(port, id, rt string) {
	b := &a.controls
	b.verbOnce.Do(func() {
		b.slowQ, b.quickQ = make(chan verbJob, 16), make(chan verbJob, 16)
		for _, q := range []chan verbJob{b.slowQ, b.quickQ} {
			go func(q chan verbJob) {
				for j := range q {
					a.runVerb(j.port, j.id, j.rt)
				}
			}(q)
		}
	})
	q := b.quickQ
	if id == "grab" || id == "drop" {
		q = b.slowQ
	}
	select {
	case q <- verbJob{port, id, rt}:
	default:
		log.Printf("[!] %s: %s dropped: the verbs before it haven't finished", holder(port), id)
	}
}

// runVerb runs a command from a controller, here on the Pi.
func (a *API) runVerb(port, id, rt string) {
	v := a.controls.verbs
	if v == nil {
		v = piVerbs{a}
	}
	what, err := v.Verb(id, rt)
	if err != nil {
		log.Printf("[!] %s: %s: %v", holder(port), id, err)
		return
	}
	log.Printf("[*] %s: %s", holder(port), what)
}

// piVerbs are the verbs on this Pi's tape, capture and clipboard.
type piVerbs struct{ a *API }

// keepSeconds is what KEEP from a controller keeps: the Studio's default.
const keepSeconds = 30

// grabBars is what GRAB from a controller grabs: the buffer's default, or
// twice as many seconds with no tempo.
const grabBars = 4

func (v piVerbs) Verb(id, rt string) (string, error) {
	a := v.a
	if id == "keep" {
		if a.saver == nil {
			return "", errors.New("nothing to keep from")
		}
		name, err := a.saver.Save(keepSeconds)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("kept the last %d s as %s", keepSeconds, name), nil
	}
	if a.tape == nil {
		return "", errors.New("the tape is off")
	}
	t := a.tape.Loaded()
	if t == nil {
		return "", tape.ErrNoTape
	}
	track, src, armed := a.armedOf(t)
	switch id {
	case "transport":
		kind := "play"
		if rt == "stop" || (rt == "" && a.tape.Live().Playing) {
			kind = "stop"
		}
		if kind == "play" && !a.tape.HasOutput() {
			return "", errors.New("nothing plays the tape: this build has no audio output")
		}
		if _, err := a.tape.Transport(t.ID, tape.Action{Kind: kind}); err != nil {
			return "", err
		}
		return kind, nil
	case "catch":
		req, err := a.catchRequest(t)
		if err != nil {
			return "", err
		}
		// Engine.Catch is the page's path: it refuses while the tape plays
		// on a phone (jamOnly), as the page's Catch does.
		c, err := a.tape.Catch(t.ID, req)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("caught %.1f s from %s onto track %d", float64(c.Frames)/float64(t.SampleRate), req.Source, req.Track), nil
	case "grab":
		req := tape.GrabRequest{Sources: []string{src}}
		if t.Grid != nil && t.Grid.Bars > 0 {
			req.Bars = grabBars
		} else {
			req.Seconds = 2 * grabBars
		}
		if _, err := a.tape.Grab(req); err != nil {
			return "", err
		}
		return fmt.Sprintf("grabbed the last %d bars of %s into the buffer", grabBars, src), nil
	case "drop":
		if !armed {
			return "", errors.New("arm a track first")
		}
		c, err := a.tape.Clipboard()
		if err != nil {
			return "", err
		}
		if c.Empty() {
			return "", tape.ErrEmptyClipboard
		}
		// A buffer lays down its window, as the page's DROP measures it
		// (lib/buffer/state.js, windowFrames).
		frames := c.Frames
		if g := c.Grab; g != nil && g.Out > g.In {
			frames = g.Out - g.In
		}
		at, ok := tape.NextFreeSpan(t.State, t.Length, track, len(c.Tracks), frames, a.tape.Live().Heard)
		if !ok {
			return "", fmt.Errorf("no room on track %d", track)
		}
		if _, err := a.tape.DropClipboardAt(t.ID, track, false, &at); err != nil {
			return "", err
		}
		return fmt.Sprintf("dropped the buffer on track %d", track), nil
	}
	return "", fmt.Errorf("%s isn't a verb the Pi runs", id)
}

// catchRequest is the controller's CATCH, as the page's Catch asks it: the
// last pass, onto the armed track, from its input, layered or replacing as
// controls.json says.
func (a *API) catchRequest(t *tape.Tape) (tape.CatchRequest, error) {
	track, src, armed := a.armedOf(t)
	if !armed {
		return tape.CatchRequest{}, errors.New("arm a track first")
	}
	a.controls.mu.Lock()
	replace := a.controlsLocked().Catch == "replace"
	a.controls.mu.Unlock()
	return tape.CatchRequest{Track: track, Source: src, Pass: 1, Replace: replace}, nil
}

// armedOf is the record track (0 in tape.json is track 1) and its input,
// or the first source when it has none of its own.
func (a *API) armedOf(t *tape.Tape) (track int, src string, armed bool) {
	track = t.RecTrack
	if track == tape.NoRecTrack {
		return 0, a.firstSource(), false
	}
	if track == 0 {
		track = 1
	}
	if track-1 < len(t.Inputs) && t.Inputs[track-1] != "" {
		return track, t.Inputs[track-1], true
	}
	return track, a.firstSource(), true
}

func (a *API) firstSource() string {
	names := []string{}
	for _, s := range a.tape.Sources() {
		names = append(names, s.Name)
	}
	if slices.Contains(names, "main") || len(names) == 0 {
		return "main"
	}
	return names[0]
}

// --- GET and PUT /api/tapes/controls -------------------------------------------

type controllerView struct {
	Name      string   `json:"name"`
	Connected bool     `json:"connected"`
	Profile   string   `json:"profile,omitempty"`
	Learned   bool     `json:"learned"` // its own map, not the profile's
	Bindings  Bindings `json:"bindings"`
}

func (a *API) controlsView() map[string]any {
	connected := map[string]bool{}
	for _, d := range a.controllerDevices() {
		if d.Controller && d.Connected {
			connected[d.Name] = true
		}
	}
	a.controls.mu.Lock()
	defer a.controls.mu.Unlock()
	f := a.controlsLocked()
	names := map[string]bool{}
	for n := range connected {
		names[n] = true
	}
	for n := range f.Controllers {
		names[n] = true
	}
	list := make([]controllerView, 0, len(names))
	for n := range names {
		bs, prof, own := a.bindingsLocked(n)
		list = append(list, controllerView{Name: n, Connected: connected[n], Profile: prof, Learned: own, Bindings: bs})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Connected != list[j].Connected {
			return list[i].Connected
		}
		return list[i].Name < list[j].Name
	})
	setting := a.cfg.TapeController
	if setting == nil {
		setting = []string{}
	}
	catch := f.Catch
	if catch == "" {
		catch = "layer"
	}
	return map[string]any{"quantum": a.quantumLocked(), "catch": catch, "controllers": list, "setting": setting, "defaults": defaultBindings()}
}

func (a *API) handleControlsGet(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	writeJSON(w, http.StatusOK, a.controlsView())
}

// handleControlsPut replaces the named controllers' bindings (null puts one
// back to its profile) and the quantum, and writes controls.json.
func (a *API) handleControlsPut(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var body struct {
		Quantum     *string              `json:"quantum"`
		Catch       *string              `json:"catch"`
		Controllers map[string]*Bindings `json:"controllers"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "body must be {quantum, controllers: {name: {action: [binding]} | null}}")
		return
	}
	if body.Quantum != nil {
		switch *body.Quantum {
		case "", "now", "off", "16th", "8th", "beat", "bar":
		default:
			writeErr(w, http.StatusBadRequest, "quantum is now, 16th, 8th, beat or bar")
			return
		}
	}
	if body.Catch != nil && *body.Catch != "layer" && *body.Catch != "replace" {
		writeErr(w, http.StatusBadRequest, "catch is layer or replace")
		return
	}
	for name, bs := range body.Controllers {
		if strings.TrimSpace(name) == "" {
			writeErr(w, http.StatusBadRequest, "a controller needs a name")
			return
		}
		if bs != nil {
			if err := bs.check(); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
		}
	}
	a.controls.mu.Lock()
	f := a.controlsLocked()
	if body.Quantum != nil {
		f.Quantum = *body.Quantum
	}
	if body.Catch != nil {
		f.Catch = *body.Catch
	}
	for name, bs := range body.Controllers {
		if bs == nil {
			delete(f.Controllers, name)
		} else {
			f.Controllers[name] = *bs
		}
	}
	err := a.saveControlsLocked()
	a.controls.mu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "couldn't save the controls: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.controlsView())
}

// SetControllers says who lists the controllers (the MIDI watcher); without
// it, the MIDI source is asked, if it can say.
func (a *API) SetControllers(l DeviceLister) { a.controllers = l }

func (a *API) controllerDevices() []midi.DeviceInfo {
	if a.controllers != nil {
		return a.controllers.Devices()
	}
	return a.midiDevices()
}

// playerOrNil is player(), or nil with the tape off: a nil engine in an
// interface isn't nil.
func (a *API) playerOrNil() tricks {
	if a.playFake == nil && a.tape == nil {
		return nil
	}
	return a.player()
}
