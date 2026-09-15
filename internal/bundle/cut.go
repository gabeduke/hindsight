package bundle

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/smf"
)

// ManifestSource records, on a cut's manifest, the take it was cut from.
type ManifestSource struct {
	Take       string `json:"take"`
	StartFrame int64  `json:"start_frame"`
	EndFrame   int64  `json:"end_frame"`
}

// trackChannel is the " chN" suffix BuildSMF puts on every track name.
var trackChannel = regexp.MustCompile(` ch(\d{1,2})$`)

// CutMIDI implements audio.MIDICutter: when a region of a take is cut into
// a new take, the region of its .mid goes with it. The work is RegionMIDI's;
// this only writes the two files beside the cut.
func (e *Exporter) CutMIDI(srcWav, dstWav string, startFrame, endFrame int64) error {
	mid, m, err := RegionMIDI(srcWav, filepath.Base(dstWav), startFrame, endFrame)
	if err != nil || mid == nil {
		return err
	}
	if err := writeAtomic(audio.MIDIPath(dstWav), mid); err != nil {
		return err
	}
	mb, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomic(audio.ManifestPath(dstWav), mb); err != nil {
		return err
	}
	placed := 0
	for _, tr := range m.Tracks {
		placed += tr.Events
	}
	log.Printf("[*] %s — %d MIDI events on %d track(s), cut from %s",
		filepath.Base(audio.MIDIPath(dstWav)), placed, len(m.Tracks), filepath.Base(srcWav))

	// The cut's grid: the same rule as a save, a Start-fixed downbeat and
	// only when the sidecar has none.
	if m.Downbeat != nil && m.Downbeat.Source == "midi-start" {
		meta := audio.ReadMeta(dstWav)
		if meta.DownbeatFrame == nil {
			frame := int64(m.Downbeat.Sec * float64(m.SampleRate))
			meta.DownbeatFrame = &frame
			if err := audio.WriteMeta(dstWav, meta); err != nil {
				log.Printf("[!] midi: downbeat for %s: %v", filepath.Base(dstWav), err)
			}
		}
	}
	return nil
}

// RegionMIDI re-bases the region [startFrame, endFrame) of the source's .mid
// so the region's first frame is tick 0, with the source's tempo lane over
// that stretch, notes sounding at the start clipped to it and notes still
// sounding at the end closed there. dstName is the take name the manifest
// will describe ("jam_cut.wav"). A source with no .mid, or a region with
// nothing in it, returns (nil, nil, nil).
func RegionMIDI(srcWav, dstName string, startFrame, endFrame int64) ([]byte, *Manifest, error) {
	srcMID := audio.MIDIPath(srcWav)
	b, err := os.ReadFile(srcMID)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	f, err := smf.Decode(b)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", filepath.Base(srcMID), err)
	}
	info, err := audio.ReadWAVInfo(srcWav)
	if err != nil {
		return nil, nil, err
	}
	rate := float64(info.SampleRate)
	startSec := float64(startFrame) / rate
	endSec := float64(endFrame) / rate
	if len(f.Tracks) == 0 || endSec <= startSec {
		return nil, nil, nil
	}

	var srcManifest Manifest
	if mb, err := os.ReadFile(audio.ManifestPath(srcWav)); err == nil {
		_ = json.Unmarshal(mb, &srcManifest)
	}

	tempo := midi.FromConductor(f.Tracks[0], f.PPQ)
	for _, ev := range f.Tracks[0].Events {
		if ev.IsMeta() && ev.Meta == smf.MetaMarker {
			tempo.Markers = append(tempo.Markers, midi.Marker{Sec: tempo.Seconds(ev.Tick), Text: ev.Text()})
		}
	}
	tempo.Source = srcManifest.TempoSource
	if tempo.Source == "" {
		tempo.Source = midi.SourceFallback
	}

	// Every note track becomes events on the source's timeline, tagged
	// with a device id derived from the track name's prefix, so BuildSMF
	// demuxes them back into the same layout.
	names := make(map[string]uint16)
	var order []string
	deviceOf := func(track string) uint16 {
		name := trackChannel.ReplaceAllString(track, "")
		if id, ok := names[name]; ok {
			return id
		}
		id := uint16(len(order) + 1)
		names[name] = id
		order = append(order, name)
		return id
	}
	type noteKey struct {
		dev  uint16
		ch   int
		note byte
	}
	active := make(map[noteKey]byte) // sounding at startSec, with velocity
	var events []midi.Event
	for _, tr := range f.Tracks[1:] {
		if len(tr.Events) == 0 {
			continue
		}
		dev := deviceOf(tr.Events[0].Text())
		for _, ev := range tr.Events {
			if ev.IsMeta() {
				continue
			}
			sec := tempo.Seconds(ev.Tick)
			me := midi.Event{NS: int64(sec * 1e9), Device: dev, Status: ev.Status, D1: ev.D1, D2: ev.D2}
			if sec < startSec {
				k := noteKey{dev, me.Channel(), me.D1}
				switch {
				case me.IsNoteOn():
					active[k] = me.D2
				case me.IsNoteOff():
					delete(active, k)
				}
				continue
			}
			events = append(events, me)
		}
	}
	// Clip what was sounding at the region's start to a note-on at 0.
	keys := make([]noteKey, 0, len(active))
	for k := range active {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].dev != keys[j].dev {
			return keys[i].dev < keys[j].dev
		}
		if keys[i].ch != keys[j].ch {
			return keys[i].ch < keys[j].ch
		}
		return keys[i].note < keys[j].note
	})
	clipped := make([]midi.Event, 0, len(keys))
	for _, k := range keys {
		clipped = append(clipped, midi.Event{NS: int64(startSec * 1e9), Device: k.dev,
			Status: midi.NoteOn | byte(k.ch), D1: k.note, D2: active[k]})
	}
	events = append(clipped, events...)

	sliced := tempo.Slice(startSec, endSec)
	duration := endSec - startSec
	out, stats := midi.BuildSMF(midi.ExportInput{
		Events:   events,
		Seconds:  func(ns int64) (float64, bool) { return float64(ns)/1e9 - startSec, true },
		Duration: duration,
		Tempo:    sliced,
		Name: func(id uint16) string {
			if int(id) >= 1 && int(id) <= len(order) {
				return order[id-1]
			}
			return fmt.Sprintf("device %d", id)
		},
	})
	if stats.Placed == 0 {
		return nil, nil, nil
	}
	encoded := out.Encode()

	// The first bar line of the source at or after the region's start. Its
	// tick in the cut is generally not a multiple of a bar -- the region was
	// chosen by ear, not by the grid -- so it is reported, not aligned.
	var downbeat *midi.Downbeat
	if srcManifest.Downbeat != nil {
		t0 := tempo.Tick(startSec)
		bar := uint64(4 * midi.PulsesPerQuarter * (smf.DefaultPPQ / midi.PulsesPerQuarter))
		first := srcManifest.Downbeat.Tick
		for first < t0 {
			first += bar
		}
		if sec := tempo.Seconds(first); sec < endSec {
			d := &midi.Downbeat{Sec: sec - startSec, Tick: first - t0, Source: srcManifest.Downbeat.Source, Aligned: "none"}
			if d.Tick%bar == 0 {
				d.Aligned = "bar"
			}
			downbeat = d
		}
	}

	m := Manifest{
		Version:             ManifestVersion,
		Take:                dstName,
		MIDI:                strings.TrimSuffix(dstName, ".wav") + ".mid",
		SavedAt:             time.Now(),
		WindowSeconds:       duration,
		SampleRate:          info.SampleRate,
		Frames:              int(endFrame - startFrame),
		PPQ:                 int(out.PPQ),
		PipelineLatencyMS:   srcManifest.PipelineLatencyMS,
		LatencyCorrectionMS: srcManifest.LatencyCorrectionMS,
		TempoSource:         sliced.Source,
		ClockDevice:         srcManifest.ClockDevice,
		Downbeat:            downbeat,
		Tracks:              stats.Tracks,
		Devices:             []ManifestDevice{},
		Source:              &ManifestSource{Take: filepath.Base(srcWav), StartFrame: startFrame, EndFrame: endFrame},
	}
	if sliced.Source != midi.SourceFallback {
		bpm := sliced.BPMAt(0)
		m.TempoBPM = &bpm
	}
	for i, name := range order {
		id := uint16(i + 1)
		md := ManifestDevice{ID: id, Name: name, Node: "", Events: stats.PlacedByDevice[id], Channels: stats.Channels[id]}
		if md.Channels == nil {
			md.Channels = []int{}
		}
		for _, sd := range srcManifest.Devices {
			if sd.Name == name || strings.HasPrefix(name, sd.Name) {
				md.Node, md.Clock = sd.Node, sd.Clock
			}
		}
		m.Devices = append(m.Devices, md)
	}
	return encoded, &m, nil
}
