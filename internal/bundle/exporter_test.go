package bundle

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/mono"
	"github.com/gabeduke/hindsight/internal/smf"
)

const (
	rate  = 48000
	block = 2048
)

// fakeSource is a MIDI source built from fixtures.
type fakeSource struct {
	events  *midi.EventRing
	clock   *midi.Clock
	devices []midi.DeviceInfo
}

func (f *fakeSource) Events(s, e int64) []midi.Event { return f.events.Between(s, e) }
func (f *fakeSource) Clock() *midi.Clock             { return f.clock }
func (f *fakeSource) Devices() []midi.DeviceInfo     { return f.devices }
func (f *fakeSource) Ring() *midi.EventRing          { return f.events }
func (f *fakeSource) Device(id uint16) (midi.DeviceInfo, bool) {
	for _, d := range f.devices {
		if d.ID == id {
			return d, true
		}
	}
	return midi.DeviceInfo{}, false
}

// rig is a bridge fed at the nominal rate from t0, with a fake source. The
// audio "starts" at mono time t0 and runs for seconds.
type rig struct {
	bridge *audio.ClockBridge
	src    *fakeSource
	t0     int64
	dir    string
	wav    string
}

func newRig(t *testing.T, seconds float64) *rig {
	t.Helper()
	t0 := mono.Now()
	b := audio.NewClockBridge(int(seconds*rate/block)+64, rate)
	blocks := int(seconds * rate / block)
	for k := 1; k <= blocks; k++ {
		frame := uint64(k * block)
		b.Record(t0+int64(float64(frame)/rate*1e9), frame)
	}
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_test.wav")
	os.WriteFile(wav, []byte("wav"), 0o644)
	return &rig{
		bridge: b,
		src: &fakeSource{
			events: midi.NewEventRing(10000),
			clock:  midi.NewClock(100000),
			devices: []midi.DeviceInfo{
				{ID: 1, Name: "EP-136", Node: "/dev/snd/midiC2D0", Clock: true, Connected: true},
				{ID: 2, Name: "Orchid", Node: "/dev/snd/midiC3D0", Connected: true},
			},
		},
		t0:  t0,
		dir: dir,
		wav: wav,
	}
}

// at is the mono time of a moment `sec` seconds into the audio.
func (r *rig) at(sec float64) int64 { return r.t0 + int64(sec*1e9) }

func (r *rig) note(dev uint16, sec float64, ch, note, vel byte) {
	r.src.events.Push(midi.Event{NS: r.at(sec), Device: dev, Status: 0x90 | ch, D1: note, D2: vel})
}

// clock feeds steady pulses at bpm from `from` to `to`, with a Start first.
func (r *rig) clock(from, to, bpm float64, withStart bool) {
	if withStart {
		r.src.clock.Feed(mono.Time(r.at(from-0.001)), midi.StartByte)
	}
	per := 60 / bpm / midi.PulsesPerQuarter
	for sec := from; sec < to; sec += per {
		r.src.clock.Feed(mono.Time(r.at(sec)), midi.ClockByte)
	}
}

func (r *rig) request(startSec, seconds float64) audio.MIDIExportRequest {
	return audio.MIDIExportRequest{
		WavPath:    r.wav,
		StartFrame: uint64(startSec * rate),
		Frames:     int(seconds * rate),
		SampleRate: rate,
		Bridge:     r.bridge,
		SavedAt:    time.Now(),
	}
}

func readManifest(t *testing.T, wav string) Manifest {
	t.Helper()
	b, err := os.ReadFile(audio.ManifestPath(wav))
	if err != nil {
		t.Fatalf("manifest: %v", err)
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("manifest json: %v", err)
	}
	return m
}

func TestExportWritesNothingWithNothingReceived(t *testing.T) {
	r := newRig(t, 30)
	ex := New(r.src, 0, "EP-136")
	if err := ex.Export(r.request(5, 10)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(audio.MIDIPath(r.wav)); err == nil {
		t.Error("a .mid was written with nothing received")
	}
	if _, err := os.Stat(audio.ManifestPath(r.wav)); err == nil {
		t.Error("a manifest was written with nothing received")
	}
}

func TestExportWithNoBridgeHistoryWritesNothing(t *testing.T) {
	r := newRig(t, 30)
	r.note(2, 6, 0, 60, 100)
	req := r.request(5, 10)
	req.Bridge = audio.NewClockBridge(8, rate) // empty
	if err := New(r.src, 0, "EP-136").Export(req); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(audio.MIDIPath(r.wav)); err == nil {
		t.Error("a .mid was written with no bridge history")
	}
}

// Notes land on the take's timeline at the second they were played, the
// clock becomes the tempo map, and the manifest describes both.
func TestExportPlacesNotesOnTheTakeTimeline(t *testing.T) {
	r := newRig(t, 60)
	// Audio window: seconds 10..40 of the ring. Clock at 120 from 10.5 s
	// with a Start; a note at 12.0 s (1.5 s into the take) held for a
	// quarter note; a note on ch10 from the EP; one before the window and
	// one after, which must not appear.
	r.clock(10.5, 40, 120, true)
	r.note(2, 12.0, 0, 60, 100)
	r.note(2, 12.5, 0, 60, 0)
	r.note(1, 20.0, 9, 36, 127)
	r.note(2, 9.0, 0, 50, 100)
	r.note(2, 41.0, 0, 51, 100)

	ex := New(r.src, 0, "EP-136")
	if err := ex.Export(r.request(10, 30)); err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(audio.MIDIPath(r.wav))
	if err != nil {
		t.Fatal(err)
	}
	f, err := smf.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Tracks) != 3 {
		t.Fatalf("got %d tracks, want conductor + EP ch10 + Orchid ch1", len(f.Tracks))
	}
	ep, orchid := f.Tracks[1].Events, f.Tracks[2].Events
	if ep[0].Text() != "EP-136 ch10" || orchid[0].Text() != "Orchid ch1" {
		t.Errorf("track names %q %q", ep[0].Text(), orchid[0].Text())
	}

	// The tempo map converts ticks back to seconds; check the Orchid note.
	m := readManifest(t, r.wav)
	tempo := tempoMapOf(t, f, m.PPQ)
	on, off := orchid[1], orchid[2]
	if got := tempo.Seconds(on.Tick); math.Abs(got-2.0) > 0.003 {
		t.Errorf("note-on at %.4fs, want 2.0", got)
	}
	if got := tempo.Seconds(off.Tick); math.Abs(got-2.5) > 0.003 {
		t.Errorf("note-off at %.4fs, want 2.5", got)
	}
	// And the note is exactly one quarter note long on the grid: the
	// clock is 120 BPM and the note lasted 0.5 s.
	if d := off.Tick - on.Tick; d < 955 || d > 965 {
		t.Errorf("note length %d ticks, want ~960", d)
	}
	// The downbeat is 0.5 s in, on a bar line, from the Start.
	if m.Downbeat == nil || m.Downbeat.Source != "midi-start" || m.Downbeat.Tick%3840 != 0 || math.Abs(m.Downbeat.Sec-0.5) > 0.003 {
		t.Errorf("downbeat = %+v", m.Downbeat)
	}
	if m.TempoSource != midi.SourceClock || m.TempoBPM == nil || math.Abs(*m.TempoBPM-120) > 0.1 {
		t.Errorf("tempo_source=%q bpm=%v", m.TempoSource, m.TempoBPM)
	}
	if m.Take != "jam_test.wav" || m.MIDI != "jam_test.mid" || m.Frames != 30*rate || m.PPQ != 960 {
		t.Errorf("manifest identity: %+v", m)
	}
	if len(m.Tracks) != 2 || m.Tracks[1].Notes != 1 || m.Tracks[1].Name != "Orchid" || m.Tracks[1].Channel != 1 {
		t.Errorf("tracks = %+v", m.Tracks)
	}
	if len(m.Devices) != 2 || m.Devices[1].Events != 2 || len(m.Devices[1].Channels) != 1 || m.Devices[1].Channels[0] != 1 {
		t.Errorf("devices = %+v", m.Devices)
	}
	if !m.Devices[0].Clock || m.ClockDevice != "EP-136" {
		t.Errorf("clock device not marked: %+v %q", m.Devices[0], m.ClockDevice)
	}
	// The note before the window sits inside the query's slack and is
	// dropped at placement; the one a second past the end is never queried.
	if m.Dropped.OutOfWindow != 1 {
		t.Errorf("dropped = %+v, want 1 out of window", m.Dropped)
	}

	// The take's sidecar gets the Start-fixed downbeat.
	meta := audio.ReadMeta(r.wav)
	if meta.DownbeatFrame == nil || math.Abs(float64(*meta.DownbeatFrame)-0.5*rate) > 0.003*rate {
		t.Errorf("DownbeatFrame = %v, want ~%d", meta.DownbeatFrame, int(0.5*rate))
	}
}

// tempoMapOf rebuilds a TempoMap from a decoded file's conductor track, so a
// test can convert ticks back to seconds the way a DAW would.
func tempoMapOf(t *testing.T, f *smf.File, ppq int) *midi.TempoMap {
	t.Helper()
	m := &midi.TempoMap{PPQ: uint16(ppq)}
	var sec float64
	var lastTick uint64
	var lastUS uint32
	for _, e := range f.Tracks[0].Events {
		if us := e.Tempo(); us != 0 {
			if lastUS != 0 {
				sec += float64(e.Tick-lastTick) * float64(lastUS) / 1e6 / float64(ppq)
			}
			m.Segments = append(m.Segments, midi.Segment{StartSec: sec, StartTick: e.Tick, USPerQuarter: us})
			lastTick, lastUS = e.Tick, us
		}
	}
	if len(m.Segments) == 0 {
		t.Fatal("no tempo events in the conductor track")
	}
	return m
}

func TestExportWithoutClockIsFallbackAndStampsNoDownbeat(t *testing.T) {
	r := newRig(t, 30)
	r.note(2, 6, 0, 60, 100)
	r.note(2, 7, 0, 60, 0)
	if err := New(r.src, 0, "EP-136").Export(r.request(5, 10)); err != nil {
		t.Fatal(err)
	}
	m := readManifest(t, r.wav)
	if m.TempoSource != midi.SourceFallback || m.Downbeat != nil || m.TempoBPM != nil {
		t.Errorf("manifest = %+v", m)
	}
	if meta := audio.ReadMeta(r.wav); meta.DownbeatFrame != nil {
		t.Errorf("a downbeat was stamped with no clock: %v", *meta.DownbeatFrame)
	}
	b, _ := os.ReadFile(audio.MIDIPath(r.wav))
	f, err := smf.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	// Fallback 120 BPM: a note 1 s into the take is at tick 1920.
	if on := f.Tracks[1].Events[1]; on.Tick != 1920 {
		t.Errorf("note-on at tick %d, want 1920", on.Tick)
	}
}

// MIDI_LATENCY_MS moves the notes later by that much. Positive is the normal
// direction: the sound of a note lands after its note-on.
func TestExportAppliesTheLatencyCorrection(t *testing.T) {
	r := newRig(t, 30)
	r.note(2, 6, 0, 60, 100)
	if err := New(r.src, 25, "EP-136").Export(r.request(5, 10)); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(audio.MIDIPath(r.wav))
	f, _ := smf.Decode(b)
	on := f.Tracks[1].Events[1]
	// 1.025 s at 120 BPM fallback = 1968 ticks.
	if on.Tick != 1968 {
		t.Errorf("note-on at tick %d, want 1968 with 25 ms correction", on.Tick)
	}
	if m := readManifest(t, r.wav); m.LatencyCorrectionMS != 25 {
		t.Errorf("manifest latency = %v", m.LatencyCorrectionMS)
	}
}

// An owner-placed downbeat is never moved by a save.
func TestExportKeepsAnExistingDownbeat(t *testing.T) {
	r := newRig(t, 60)
	r.clock(10.5, 40, 120, true)
	r.note(2, 12, 0, 60, 100)
	own := int64(12345)
	audio.WriteMeta(r.wav, audio.Meta{DownbeatFrame: &own})
	if err := New(r.src, 0, "EP-136").Export(r.request(10, 30)); err != nil {
		t.Fatal(err)
	}
	if meta := audio.ReadMeta(r.wav); meta.DownbeatFrame == nil || *meta.DownbeatFrame != own {
		t.Errorf("DownbeatFrame = %v, want the owner's 12345", meta.DownbeatFrame)
	}
}

func TestExportNamesDepartedDevicesFromTheEvent(t *testing.T) {
	r := newRig(t, 30)
	r.src.events.Push(midi.Event{NS: r.at(6), Device: 9, Status: 0x90, D1: 1, D2: 1})
	if err := New(r.src, 0, "EP-136").Export(r.request(5, 10)); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(audio.MIDIPath(r.wav))
	f, _ := smf.Decode(b)
	if name := f.Tracks[1].Events[0].Text(); name != "device 9 ch1" {
		t.Errorf("track name %q", name)
	}
}

// A save starting mid-bar is moved back to the last downbeat the ring still
// holds; a whole-ring save, which cannot go back, is moved forward to the
// first one. Without a Start the phase is unknown and nothing moves.
func TestSnapStartFindsTheDownbeat(t *testing.T) {
	r := newRig(t, 60)
	ex := New(r.src, 0, "EP-136")

	// No clock at all: no opinion.
	if _, ok := ex.SnapStart(r.bridge, 30*rate, 5*rate, 60*rate); ok {
		t.Error("snapped with no clock")
	}

	// Clock at 120 from 10 s with a Start: downbeats every 2 s from 10.
	r.clock(10, 60, 120, true)
	got, ok := ex.SnapStart(r.bridge, 31*rate, 5*rate, 60*rate)
	if !ok || math.Abs(float64(got)-30*rate) > 0.003*rate {
		t.Errorf("SnapStart(31s) = %d %v, want ~%d (30 s)", got, ok, 30*rate)
	}
	// Exactly on a downbeat: stays.
	got, ok = ex.SnapStart(r.bridge, 30*rate, 5*rate, 60*rate)
	if !ok || math.Abs(float64(got)-30*rate) > 0.003*rate {
		t.Errorf("SnapStart(30s) = %d %v, want ~%d", got, ok, 30*rate)
	}
	// The ring's oldest frame is 11 s: the downbeat at 10 is gone, so the
	// window moves forward to 12.
	got, ok = ex.SnapStart(r.bridge, 11*rate, 11*rate, 60*rate)
	if !ok || math.Abs(float64(got)-12*rate) > 0.003*rate {
		t.Errorf("SnapStart(whole ring from 11s) = %d %v, want ~%d (12 s)", got, ok, 12*rate)
	}
	// A latency correction moves the downbeats with the notes.
	ex.LatencyMS = 100
	got, ok = ex.SnapStart(r.bridge, 31*rate, 5*rate, 60*rate)
	if !ok || math.Abs(float64(got)-30.1*rate) > 0.003*rate {
		t.Errorf("SnapStart with 100 ms = %d %v, want ~%d", got, ok, int(30.1*rate))
	}
}

// Without a Start, pulses have no bar phase and there is nothing to snap to.
func TestSnapStartNeedsAStart(t *testing.T) {
	r := newRig(t, 60)
	r.clock(10, 60, 120, false)
	if _, ok := New(r.src, 0, "EP-136").SnapStart(r.bridge, 31*rate, 5*rate, 60*rate); ok {
		t.Error("snapped without a Start to fix the phase")
	}
}
