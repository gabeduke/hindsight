// An external test package: api imports midi for DeviceInfo, so an internal
// test importing api would be an import cycle.
package midi_test

import (
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/api"
	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
)

func TestFixedClockSatisfiesBothConsumers(t *testing.T) {
	var _ api.MIDISource = midi.NewFixedClock(96)
	var _ audio.TempoSource = midi.NewFixedClock(96)
}

func TestFixedClockAlwaysReports(t *testing.T) {
	c := midi.NewFixedClock(96)

	if !c.Connected() {
		t.Error("Connected() = false; the demo clock is always present")
	}
	bpm, ok := c.BPM(time.Now().Add(-time.Minute), time.Now())
	if !ok {
		t.Fatal("BPM() reported no reading")
	}
	if bpm != 96 {
		t.Errorf("BPM() = %v, want 96", bpm)
	}
}
