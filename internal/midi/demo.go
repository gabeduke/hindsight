package midi

import (
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// DemoDeviceName is what the demo's synthetic sequencer is called in the
// takes' MIDI tracks and the manifest.
const DemoDeviceName = "Demo sequencer"

// DemoDevice is the demo's MIDI source: one imaginary sequencer whose
// messages arrive through Feed rather than a rawmidi node. It satisfies the
// same interface the exporter reads a Watcher through, so `--demo` produces a
// real .mid and the whole export path runs in CI with no hardware.
type DemoDevice struct {
	clock  *Clock
	events *EventRing
}

// NewDemoDevice builds the device with a clock ring sized for ringSeconds.
func NewDemoDevice(ringSeconds int) *DemoDevice {
	return &DemoDevice{
		clock:  NewClock(CapacityFor(ringSeconds)),
		events: NewEventRing(200_000),
	}
}

// Feed accepts one message, as audio.MIDISink delivers them. Realtime bytes
// go to the clock; channel messages and transport go to the event ring, the
// way a Watcher routes them.
func (d *DemoDevice) Feed(ns int64, status, d1, d2 byte) {
	ts := mono.Time(ns)
	if status >= 0xF8 {
		d.clock.Feed(ts, status)
		if status == StartByte || status == ContinueByte || status == StopByte {
			d.events.Push(Event{NS: ns, Device: 1, Status: status})
		}
		return
	}
	d.events.Push(Event{NS: ns, Device: 1, Status: status, D1: d1, D2: d2})
}

func (d *DemoDevice) Events(startNS, endNS int64) []Event { return d.events.Between(startNS, endNS) }
func (d *DemoDevice) Clock() *Clock                       { return d.clock }
func (d *DemoDevice) Ring() *EventRing                    { return d.events }
func (d *DemoDevice) Connected() bool                     { return true }

// BPM forwards to the clock, so the demo's status tile shows the estimator
// reading the synthetic clock rather than a constant.
func (d *DemoDevice) BPM(start, end time.Time) (float64, bool) { return d.clock.BPM(start, end) }

func (d *DemoDevice) Devices() []DeviceInfo {
	return []DeviceInfo{{ID: 1, Name: DemoDeviceName, Node: "demo", Clock: true, Connected: true,
		Events: d.events.Total(), Bytes: 0}}
}

func (d *DemoDevice) Device(id uint16) (DeviceInfo, bool) {
	if id != 1 {
		return DeviceInfo{}, false
	}
	return d.Devices()[0], true
}
