package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/rig"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
)

// newRigAPI is a tape API on a kit with a Sidekick and a Bento plugged in,
// running on the default settings, with its settings.json in a temp dir.
func newRigAPI(t *testing.T) (*mux.Router, *API) {
	t.Helper()
	dir := t.TempDir()
	running, _ := config.Effective(nil)
	cfg := &config.Config{OutputDir: dir, SampleRate: 48000, SaveChannels: []int{0, 1}, Channels: 8,
		SettingsFile: filepath.Join(dir, "settings.json"), Running: running, Version: "v-test"}
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	eng := tape.NewEngine(tape.Options{Store: store})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	a := New(cfg, nil, nil, nil, nil)
	a.SetTape(eng)
	a.rig.hooks = rigHooks{
		device: func() string { return "EP-136 K.O. Sidekick: USB Audio (hw:2,0)" },
		usb:    func(string) string { return "2367:9420" },
		midi:   func() []rig.MIDIPort { return []rig.MIDIPort{{Name: "Bento", Open: true}} },
	}
	t.Cleanup(a.WaitBackground)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	return r, a
}

func readRig(t *testing.T, r *mux.Router) rig.Graph {
	t.Helper()
	w := send(t, r, http.MethodGet, "/api/rig", "")
	want(t, w, http.StatusOK, "rig")
	var g rig.Graph
	if err := json.Unmarshal(w.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func rigCable(g rig.Graph, id string) (rig.Cable, bool) {
	for _, c := range g.Cables {
		if c.ID == id {
			return c, true
		}
	}
	return rig.Cable{}, false
}

func TestTheRigIsReadFromTheSettingsTheTapeAndWhatsPluggedIn(t *testing.T) {
	r, _ := newRigAPI(t)
	id := makeLoadedTape(t, r)
	g := readRig(t, r)
	var taps []string
	for _, s := range g.Kit.Sockets {
		if s.Kind == "tap" {
			taps = append(taps, s.ID)
		}
	}
	if !slices.Equal(taps, []string{"kit.tap.main", "kit.tap.ch1", "kit.tap.ch2", "kit.tap.aux"}) {
		t.Fatalf("taps %v, want TAPE_SOURCES' four", taps)
	}
	if g.Devices[0].ID != "ep-136" || g.Devices[1].ID != "bento" || g.Found != "Sidekick on USB · Bento on MIDI" {
		t.Fatalf("devices %s, found %q", g.Found, g.Found)
	}
	if g.Tape == nil || g.Tape.ID != id || !slices.Equal(g.Tape.Armed, []int{1}) || g.RestartNeeded {
		t.Fatalf("tape %+v restart %v", g.Tape, g.RestartNeeded)
	}
}

// Each cable is a setting: plugging it writes through the route that owns
// it, and the next read draws it -- a restart cable as pending.
func TestEachCableWritesItsSettingAndTheNextReadDrawsIt(t *testing.T) {
	r, _ := newRigAPI(t)
	id := makeLoadedTape(t, r)

	// Two taps into two tracks: their inputs, and both armed.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id,
		`{"inputs":[{"n":2,"source":"ch1"},{"n":3,"source":"ch2"}],"rec_tracks":[2,3]}`), http.StatusOK, "patch two")
	g := readRig(t, r)
	for _, want := range [][2]string{{"input:2", "kit.tap.ch1"}, {"input:3", "kit.tap.ch2"}} {
		if c, ok := rigCable(g, want[0]); !ok || c.From != want[1] || c.Restart {
			t.Fatalf("%s: %+v %v", want[0], c, ok)
		}
	}
	if !slices.Equal(g.Tape.Armed, []int{2, 3}) {
		t.Fatalf("armed %v, want two red lamps", g.Tape.Armed)
	}
	// A track onto bus B.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":4,"bus":"B"}}`), http.StatusOK, "bus")
	if c, _ := rigCable(readRig(t, r), "bus:4"); c.To != "kit.bus.B" {
		t.Fatalf("bus:4 %+v", c)
	}

	// The kit's clock into the Bento: on restart.
	want(t, send(t, r, http.MethodPut, "/api/settings", `{"TAPE_CLOCK":"lead","TAPE_CLOCK_OUT":"bento"}`), http.StatusOK, "clock out")
	g = readRig(t, r)
	if c, ok := rigCable(g, "clock-out:bento"); !ok || c.Pending != "plug" || !c.Restart {
		t.Fatalf("clock out %+v %v, want pending", c, ok)
	}
	if !g.RestartNeeded {
		t.Fatal("a restart cable owes a restart")
	}
	// The Bento's clock in.
	want(t, send(t, r, http.MethodPut, "/api/settings", `{"MIDI_CLOCK_DEVICE":"Bento"}`), http.StatusOK, "clock in")
	if c, _ := rigCable(readRig(t, r), "clock-in:bento"); c.Pending != "plug" {
		t.Fatalf("clock in %+v", c)
	}
	// Its MIDI ignored -- which takes its clock with it, as MIDI_IGNORE
	// does -- and KEEP on CH2.
	want(t, send(t, r, http.MethodPut, "/api/settings", `{"MIDI_IGNORE":"bento","SAVE_CHANNELS":"5,6"}`), http.StatusOK, "more")
	g = readRig(t, r)
	if c, _ := rigCable(g, "midi:bento"); c.Pending != "unplug" {
		t.Fatalf("ignored %+v", c)
	}
	if _, ok := rigCable(g, "clock-in:bento"); ok {
		t.Fatal("an ignored device's clock isn't read")
	}
	if c, _ := rigCable(g, "keep:ch2"); c.Pending != "plug" || g.Keep.Tap != "ch2" {
		t.Fatalf("keep %+v %+v", c, g.Keep)
	}

	// A jack you draw: a label, in rig.json, and on the tape's input.
	want(t, send(t, r, http.MethodPut, "/api/rig/labels", `{"ep-136.in1":"guitar"}`), http.StatusOK, "label")
	g = readRig(t, r)
	if c, ok := rigCable(g, "jack:ep-136.in1"); !ok || c.Label != "guitar" || !c.Waiting {
		t.Fatalf("jack %+v %v, want guitar, waiting for signal", c, ok)
	}
	var st struct {
		Sources []tape.SourceState `json:"sources"`
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &st)
	for _, s := range st.Sources {
		if (s.Name == "ch1") != (s.Label == "guitar") {
			t.Fatalf("source %s labelled %q", s.Name, s.Label)
		}
	}
}

func TestLabelsLiveInRigJSONBesideTheSettings(t *testing.T) {
	r, a := newRigAPI(t)
	want(t, send(t, r, http.MethodPut, "/api/rig/labels", `{"ep-136.in1":"  guitar  ","ep-136.aux":"Bento out"}`), http.StatusOK, "two")
	want(t, send(t, r, http.MethodPut, "/api/rig/labels", `{"ep-136.aux":""}`), http.StatusOK, "remove one")
	b, err := os.ReadFile(filepath.Join(filepath.Dir(a.settingsFile()), "rig.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Labels map[string]string `json:"labels"`
	}
	json.Unmarshal(b, &f)
	if len(f.Labels) != 1 || f.Labels["ep-136.in1"] != "guitar" {
		t.Fatalf("rig.json %s", b)
	}
	want(t, send(t, r, http.MethodPut, "/api/rig/labels", `{"../settings":"x"}`), http.StatusBadRequest, "not a socket")
	want(t, send(t, r, http.MethodPut, "/api/rig/labels", `[1]`), http.StatusBadRequest, "not an object")
	// Labels never route: the settings and the tape are untouched.
	if _, err := os.Stat(a.settingsFile()); !os.IsNotExist(err) {
		t.Fatal("a label wrote settings.json")
	}
}
