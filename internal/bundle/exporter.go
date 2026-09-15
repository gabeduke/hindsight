// Package bundle writes a take's MIDI sidecars: the Standard MIDI File of
// everything the connected instruments sent over the take's window, placed on
// the take's timeline, and a manifest describing how.
//
// It is the one package that imports both audio and midi. audio supplies the
// window and the clock bridge; midi supplies the events, the pulses and the
// writers; this package only has to put them together in the right order.
package bundle

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/smf"
)

// ManifestVersion is the manifest schema version.
const ManifestVersion = 1

// querySlack is how far outside the window's own timestamps the event and
// pulse queries reach. The bridge places events precisely afterwards and
// BuildSMF drops what falls outside; the slack only has to cover the latency
// correction and the bridge's own pipeline offset, both well under a second.
const querySlack = int64(time.Second)

// Source is what the exporter reads from. Satisfied by *midi.Watcher; an
// interface so the tests can drive the exporter from fixtures.
type Source interface {
	Events(startNS, endNS int64) []midi.Event
	Clock() *midi.Clock
	Device(id uint16) (midi.DeviceInfo, bool)
	Devices() []midi.DeviceInfo
	Ring() *midi.EventRing
}

// Exporter implements audio.MIDIExporter over a MIDI source.
type Exporter struct {
	src Source
	// LatencyMS is MIDI_LATENCY_MS: added to every MIDI timestamp before it
	// is placed, so a positive value moves the notes later. The normal case
	// is positive: a note-on leaves the instrument before the sound it
	// triggers has been synthesised, sent down a cable and converted.
	LatencyMS float64
	// ClockDevice names the tempo source, for the manifest.
	ClockDevice string
}

// New builds an exporter.
func New(src Source, latencyMS float64, clockDevice string) *Exporter {
	return &Exporter{src: src, LatencyMS: latencyMS, ClockDevice: clockDevice}
}

// Manifest is jam_<ts>.manifest.json.
type Manifest struct {
	Version       int       `json:"version"`
	Take          string    `json:"take"`
	MIDI          string    `json:"midi"`
	SavedAt       time.Time `json:"saved_at"`
	WindowSeconds float64   `json:"window_seconds"`
	SampleRate    int       `json:"sample_rate"`
	Frames        int       `json:"frames"`
	PPQ           int       `json:"ppq"`

	// WindowStartMonotonicNS is the take's first frame on the process's
	// monotonic clock. An anchor for other values in this run, not a date.
	WindowStartMonotonicNS int64 `json:"window_start_monotonic_ns"`
	// PipelineLatencyMS is what PortAudio reported and the bridge applied.
	PipelineLatencyMS float64 `json:"pipeline_latency_ms"`
	// LatencyCorrectionMS is MIDI_LATENCY_MS as applied.
	LatencyCorrectionMS float64 `json:"latency_correction_ms"`

	TempoSource string         `json:"tempo_source"`
	ClockDevice string         `json:"clock_device"`
	TempoBPM    *float64       `json:"tempo_bpm,omitempty"` // at the downbeat, or the first segment
	Downbeat    *midi.Downbeat `json:"downbeat,omitempty"`
	Pulses      int            `json:"clock_pulses"`

	Devices []ManifestDevice  `json:"devices"`
	Tracks  []midi.TrackStats `json:"tracks"`
	Dropped ManifestDropped   `json:"dropped"`
}

// ManifestDevice is one device that contributed to the file.
type ManifestDevice struct {
	ID       uint16 `json:"id"`
	Name     string `json:"name"`
	Node     string `json:"node"`
	Clock    bool   `json:"clock"`
	Events   int    `json:"events"`
	Channels []int  `json:"channels"`
	// SysExDropped is the device's lifetime count of skipped SysEx messages,
	// not the window's: the parser counts, the ring never sees them.
	SysExDropped uint64 `json:"sysex_dropped"`
}

// ManifestDropped counts what did not make it into the file.
type ManifestDropped struct {
	Overflow       uint64 `json:"ring_overflow"`
	Unplaceable    int    `json:"unplaceable"`
	OutOfWindow    int    `json:"out_of_window"`
	OrphanNoteOffs int    `json:"orphan_note_offs"`
	NonChannel     int    `json:"non_channel"`
}

// Export writes the .mid and manifest for a take, or nothing at all when
// there is nothing to write. It returns an error only for a failure to
// write; an empty window is not one.
func (e *Exporter) Export(req audio.MIDIExportRequest) error {
	bridge := req.Bridge
	if bridge == nil || req.Frames <= 0 || req.SampleRate <= 0 {
		return nil
	}
	endFrame := req.StartFrame + uint64(req.Frames)
	startNS, ok1 := bridge.NSAt(req.StartFrame)
	endNS, ok2 := bridge.NSAt(endFrame)
	if !ok1 || !ok2 {
		log.Printf("[*] midi: no clock bridge history for %s — no .mid", filepath.Base(req.WavPath))
		return nil
	}
	latencyNS := int64(e.LatencyMS * 1e6)

	// A moment on the monotonic clock, as seconds from the take's first
	// frame. The bridge does the drift-tracking part; this does the rest.
	seconds := func(ns int64) (float64, bool) {
		f, ok := bridge.FrameAt(ns + latencyNS)
		if !ok {
			return 0, false
		}
		return (f - float64(req.StartFrame)) / float64(req.SampleRate), true
	}
	duration := float64(req.Frames) / float64(req.SampleRate)

	events := e.src.Events(startNS-querySlack-latencyNS, endNS+querySlack-latencyNS)
	raw := e.src.Clock().PulsesBetween(startNS-querySlack-latencyNS, endNS+querySlack-latencyNS)
	if len(events) == 0 && len(raw) == 0 {
		log.Printf("[*] midi: nothing received during %s — no .mid", filepath.Base(req.WavPath))
		return nil
	}

	pulses := make([]midi.TimedPulse, 0, len(raw))
	for _, p := range raw {
		sec, ok := seconds(p.NS)
		// Pulses just before 0 are kept: a bar-snapped window's downbeat
		// lands within the bridge's precision of 0 on either side, and
		// BuildTempoMap is where it is recognised.
		if !ok || sec < -0.01 || sec > duration {
			continue
		}
		pulses = append(pulses, midi.TimedPulse{Sec: sec, Index: p.Index})
	}
	tempo, downbeat := midi.BuildTempoMap(pulses, duration)

	name := func(id uint16) string {
		if d, ok := e.src.Device(id); ok {
			return d.Name
		}
		return fmt.Sprintf("device %d", id)
	}
	file, stats := midi.BuildSMF(midi.ExportInput{
		Events:   events,
		Seconds:  seconds,
		Duration: duration,
		Tempo:    tempo,
		Name:     name,
	})

	midiPath := audio.MIDIPath(req.WavPath)
	if err := writeAtomic(midiPath, file.Encode()); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(midiPath), err)
	}

	m := Manifest{
		Version:                ManifestVersion,
		Take:                   filepath.Base(req.WavPath),
		MIDI:                   filepath.Base(midiPath),
		SavedAt:                req.SavedAt,
		WindowSeconds:          duration,
		SampleRate:             req.SampleRate,
		Frames:                 req.Frames,
		PPQ:                    smf.DefaultPPQ,
		WindowStartMonotonicNS: startNS,
		PipelineLatencyMS:      float64(bridge.PipelineLatency()) / 1e6,
		LatencyCorrectionMS:    e.LatencyMS,
		TempoSource:            tempo.Source,
		ClockDevice:            e.ClockDevice,
		Downbeat:               downbeat,
		Pulses:                 len(pulses),
		Tracks:                 stats.Tracks,
		Dropped: ManifestDropped{
			Overflow:       e.src.Ring().Overflow(),
			Unplaceable:    stats.Unplaceable,
			OutOfWindow:    stats.OutOfWindow,
			OrphanNoteOffs: stats.OrphanNoteOffs,
			NonChannel:     stats.NonChannel,
		},
	}
	if m.Tracks == nil {
		m.Tracks = []midi.TrackStats{}
	}
	if tempo.Source != midi.SourceFallback {
		at := 0.0
		if downbeat != nil {
			at = downbeat.Sec
		}
		bpm := tempo.BPMAt(at)
		m.TempoBPM = &bpm
	}
	m.Devices = e.manifestDevices(stats)

	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomic(audio.ManifestPath(req.WavPath), b); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	log.Printf("[*] %s — %d MIDI events on %d track(s), tempo %s",
		filepath.Base(midiPath), stats.Placed, len(stats.Tracks), tempo.Source)

	// The waveform page's grid and the DAW should agree on bar 1. Only a
	// Start-fixed downbeat is worth writing; a by-convention one would put
	// an arbitrary bar line on a take the owner has not looked at yet. And
	// only when the sidecar has none: an owner's placement is never moved.
	if downbeat != nil && downbeat.Source == "midi-start" {
		meta := audio.ReadMeta(req.WavPath)
		if meta.DownbeatFrame == nil {
			frame := int64(downbeat.Sec * float64(req.SampleRate))
			meta.DownbeatFrame = &frame
			if err := audio.WriteMeta(req.WavPath, meta); err != nil {
				log.Printf("[!] midi: downbeat for %s: %v", filepath.Base(req.WavPath), err)
			}
		}
	}
	return nil
}

// snapSlackFrames is how far below the ring's oldest frame a downbeat may be
// placed and still be taken as that frame: one millisecond at 48 kHz.
const snapSlackFrames = 48

// SnapStart implements audio.BarSnapper: the downbeat a window should start
// on. Downbeats are the clock device's pulses whose index since the last
// Start is a whole number of bars; without a Start the phase is unknown and
// the window is left where it was asked for.
func (e *Exporter) SnapStart(bridge *audio.ClockBridge, start, oldest, end uint64) (uint64, bool) {
	if bridge == nil || end <= oldest {
		return 0, false
	}
	oldestNS, ok1 := bridge.NSAt(oldest)
	endNS, ok2 := bridge.NSAt(end)
	if !ok1 || !ok2 {
		return 0, false
	}
	latencyNS := int64(e.LatencyMS * 1e6)
	pulses := e.src.Clock().PulsesBetween(oldestNS-querySlack-latencyNS, endNS+querySlack-latencyNS)

	var before, after uint64
	haveBefore, haveAfter := false, false
	for _, p := range pulses {
		if p.Index == midi.PulseIndexUnknown || p.Index%(4*midi.PulsesPerQuarter) != 0 {
			continue
		}
		f, ok := bridge.FrameAt(p.NS + latencyNS)
		if !ok {
			continue
		}
		// A downbeat the bridge places a hair before the ring's first frame
		// is that frame for every purpose: the bridge's precision is a
		// fraction of a millisecond, and refusing it would move the window
		// forward a whole bar for nothing.
		if f < float64(oldest) && f >= float64(oldest)-snapSlackFrames {
			f = float64(oldest)
		}
		if f < 0 {
			continue
		}
		frame := uint64(f + 0.5)
		switch {
		case frame < oldest || frame >= end:
			continue
		case frame <= start:
			before, haveBefore = frame, true // ascending, so the last one wins
		case !haveAfter:
			after, haveAfter = frame, true
		}
	}
	if haveBefore {
		return before, true
	}
	if haveAfter {
		return after, true
	}
	return 0, false
}

// manifestDevices lists every device that contributed to the file, plus
// every device currently open, so a device that was connected and silent is
// visible as such.
func (e *Exporter) manifestDevices(stats midi.ExportStats) []ManifestDevice {
	var order []uint16
	seen := make(map[uint16]bool)
	for _, d := range e.src.Devices() {
		if !seen[d.ID] {
			seen[d.ID] = true
			order = append(order, d.ID)
		}
	}
	ids := make([]int, 0, len(stats.PlacedByDevice))
	for id := range stats.PlacedByDevice {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	for _, id := range ids {
		if !seen[uint16(id)] {
			seen[uint16(id)] = true
			order = append(order, uint16(id))
		}
	}
	out := make([]ManifestDevice, 0, len(order))
	for _, id := range order {
		d, _ := e.src.Device(id)
		md := ManifestDevice{ID: id, Name: d.Name, Node: d.Node, Clock: d.Clock,
			Events: stats.PlacedByDevice[id], Channels: stats.Channels[id], SysExDropped: d.SysEx}
		if md.Name == "" {
			md.Name = fmt.Sprintf("device %d", id)
		}
		if md.Channels == nil {
			md.Channels = []int{}
		}
		out = append(out, md)
	}
	return out
}

// writeAtomic writes via a temp file and rename, like WriteMeta: the takes
// list is polled every five seconds and must never see a half-written file.
func writeAtomic(path string, b []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".midi-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, path)
}
