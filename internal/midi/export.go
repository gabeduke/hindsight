package midi

import (
	"fmt"
	"sort"

	"github.com/gabeduke/hindsight/internal/smf"
)

// ExportInput is everything BuildSMF needs to lay a window's events on a
// take's timeline.
type ExportInput struct {
	// Events in the window, any order.
	Events []Event
	// Seconds places an event on the take's timeline: seconds from the
	// take's first frame. false means the moment cannot be placed (no bridge
	// history covers it) and the event is dropped.
	Seconds func(ns int64) (float64, bool)
	// Duration is the take's length in seconds; events past it are dropped.
	Duration float64
	// Tempo converts seconds to ticks and supplies the conductor track.
	Tempo *TempoMap
	// Name resolves a device id to its track-name prefix.
	Name func(dev uint16) string
}

// TrackStats describes one written track, for the manifest.
type TrackStats struct {
	Track   int    `json:"track"`
	Device  uint16 `json:"device_id"`
	Name    string `json:"device"`
	Channel int    `json:"channel"`
	Events  int    `json:"events"`
	Notes   int    `json:"notes"`
	Hanging int    `json:"hanging_notes_closed,omitempty"`
}

// ExportStats is what BuildSMF did.
type ExportStats struct {
	Tracks         []TrackStats
	Placed         int // events written
	Unplaceable    int // Seconds said no
	OutOfWindow    int // placed before 0 or after Duration
	OrphanNoteOffs int // note-off with no note-on in the window
	NonChannel     int // system messages other than transport, not written
}

// trackKey is one (device, channel) pair.
type trackKey struct {
	dev uint16
	ch  int
}

// BuildSMF demuxes the window's events into one track per (device, channel)
// pair that saw at least one, behind a conductor track carrying the tempo
// map. Track names are "<device> ch<N>" with N 1-based, which is what a DAW
// shows; two devices with the same product string are told apart by id.
//
// Note-ons still open at the end of the window are closed at the last tick,
// so a DAW never renders a note that lasts forever. Note-offs whose note-on
// fell before the window are dropped: there is nothing for them to end.
func BuildSMF(in ExportInput) (*smf.File, ExportStats) {
	var st ExportStats
	tempo := in.Tempo
	if tempo == nil {
		tempo = FixedTempoMap(FallbackBPM)
	}
	endTick := tempo.Tick(in.Duration)

	type placed struct {
		sec float64
		ev  Event
	}
	byTrack := make(map[trackKey][]placed)
	var transport []placed

	for _, e := range in.Events {
		sec, ok := in.Seconds(e.NS)
		if !ok {
			st.Unplaceable++
			continue
		}
		if sec < 0 || sec > in.Duration {
			st.OutOfWindow++
			continue
		}
		switch {
		case e.IsChannel():
			k := trackKey{e.Device, e.Channel()}
			byTrack[k] = append(byTrack[k], placed{sec, e})
		case e.IsTransport():
			transport = append(transport, placed{sec, e})
		default:
			st.NonChannel++
		}
	}

	// Track order: by device id, then channel. Ids are assigned in the order
	// devices appeared, so the layout is stable across saves of one session.
	keys := make([]trackKey, 0, len(byTrack))
	for k := range byTrack {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].dev != keys[j].dev {
			return keys[i].dev < keys[j].dev
		}
		return keys[i].ch < keys[j].ch
	})

	// Name every device that contributed anything, tracks and markers alike.
	// Same product string on two devices: suffix the id so the tracks are
	// distinguishable. Decided over the whole set so the first one is
	// suffixed too, rather than only the second.
	names := make(map[uint16]string)
	seen := make(map[string]int)
	name := func(dev uint16) {
		if _, ok := names[dev]; ok {
			return
		}
		n := in.Name(dev)
		names[dev] = n
		seen[n]++
	}
	for _, k := range keys {
		name(k.dev)
	}
	for _, p := range transport {
		name(p.ev.Device)
	}
	for dev, n := range names {
		if seen[n] > 1 {
			names[dev] = fmt.Sprintf("%s (%d)", n, dev)
		}
	}

	f := &smf.File{PPQ: tempo.ppq()}
	cond := smf.Track{Events: tempo.Conductor()}
	sort.SliceStable(transport, func(a, b int) bool { return transport[a].sec < transport[b].sec })
	for _, p := range transport {
		var text string
		switch p.ev.Status {
		case StartByte:
			text = "Start"
		case ContinueByte:
			text = "Continue"
		case StopByte:
			text = "Stop"
		}
		cond.Events = append(cond.Events, smf.Marker(tempo.Tick(p.sec), names[p.ev.Device]+": "+text))
		st.Placed++
	}
	f.Tracks = append(f.Tracks, cond)

	for i, k := range keys {
		evs := byTrack[k]
		sort.SliceStable(evs, func(a, b int) bool { return evs[a].sec < evs[b].sec })

		ts := TrackStats{Track: i + 1, Device: k.dev, Name: names[k.dev], Channel: k.ch + 1}
		tr := smf.Track{Events: []smf.Event{smf.TrackName(0, fmt.Sprintf("%s ch%d", names[k.dev], k.ch+1))}}
		open := make(map[byte]bool) // note number -> sounding
		for _, p := range evs {
			e := p.ev
			tick := tempo.Tick(p.sec)
			switch {
			case e.IsNoteOn():
				open[e.D1] = true
				ts.Notes++
			case e.IsNoteOff():
				if !open[e.D1] {
					st.OrphanNoteOffs++
					continue
				}
				delete(open, e.D1)
			}
			tr.Events = append(tr.Events, smf.Channel(tick, e.Status, e.D1, e.D2))
			ts.Events++
			st.Placed++
		}
		// Close what is still sounding, in note order so the output is
		// deterministic.
		hanging := make([]int, 0, len(open))
		for n := range open {
			hanging = append(hanging, int(n))
		}
		sort.Ints(hanging)
		for _, n := range hanging {
			tr.Events = append(tr.Events, smf.Channel(endTick, NoteOff|byte(k.ch), byte(n), 0))
			ts.Hanging++
		}
		f.Tracks = append(f.Tracks, tr)
		st.Tracks = append(st.Tracks, ts)
	}
	return f, st
}
