package audio

import (
	"errors"
	"testing"
)

// piDevices is what PortAudio lists on the Pi with the EP-136 and a Scarlett
// Solo both plugged in: the cards' direct devices, and ALSA's plugs.
var piDevices = []inDev{
	{"bcm2835 Headphones: - (hw:0,0)", 0},
	{"vc4-hdmi-0: MAI PCM i2s-hifi-0 (hw:1,0)", 0},
	{"EP-136 K.O. Sidekick: USB Audio (hw:2,0)", 8},
	{"Scarlett Solo 4th Gen: USB Audio (hw:3,0)", 4},
	{"sysdefault", 128},
	{"front", 0},
	{"surround40", 0},
	{"pulse", 32},
	{"dmix", 0},
	{"dsnoop", 8},
	{"default", 32},
}

func TestPickInputAuto(t *testing.T) {
	tests := []struct {
		name     string
		devs     []inDev
		channels int
		want     string
	}{
		{"most inputs wins over the plugs", piDevices, 0, "EP-136 K.O. Sidekick: USB Audio (hw:2,0)"},
		{"the ring's size is a floor", piDevices, 2, "EP-136 K.O. Sidekick: USB Audio (hw:2,0)"},
		{"only the Solo", []inDev{
			{"bcm2835 Headphones: - (hw:0,0)", 0},
			{"Scarlett Solo 4th Gen: USB Audio (hw:3,0)", 2},
			{"sysdefault", 128}, {"default", 32}, {"pulse", 32},
		}, 0, "Scarlett Solo 4th Gen: USB Audio (hw:3,0)"},
		{"a tie goes to the first listed", []inDev{
			{"USB A: USB Audio (hw:2,0)", 2},
			{"USB B: USB Audio (hw:3,0)", 2},
		}, 0, "USB A: USB Audio (hw:2,0)"},
		{"no hw names: CoreAudio, minus the loopbacks", []inDev{
			{"MacBook Pro Microphone", 1},
			{"BlackHole 16ch", 16},
			{"ZoomAudioDevice", 2},
			{"Scarlett Solo 4th Gen", 2},
			{"MacBook Pro Speakers", 0},
		}, 0, "Scarlett Solo 4th Gen"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			i, fell, err := pickInput(tc.devs, "", tc.channels)
			if err != nil {
				t.Fatalf("pickInput: %v", err)
			}
			if fell {
				t.Errorf("auto reported a fallback")
			}
			if got := tc.devs[i].Name; got != tc.want {
				t.Errorf("picked %q, want %q", got, tc.want)
			}
		})
	}
}

// With nothing plugged in, auto finds nothing -- never the sound server or
// the headphone jack -- and says so as ErrNoDevice, so capture waits.
func TestPickInputAutoNothingPlugged(t *testing.T) {
	devs := []inDev{
		{"bcm2835 Headphones: - (hw:0,0)", 0},
		{"sysdefault", 128}, {"pulse", 32}, {"dmix", 0}, {"dsnoop", 2}, {"default", 32},
	}
	if _, _, err := pickInput(devs, "", 0); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("err = %v, want ErrNoDevice", err)
	}
	// An explicit CHANNELS the only interface can't meet is not there either.
	if _, _, err := pickInput(piDevices[:4], "", 16); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("CHANNELS=16: err = %v, want ErrNoDevice", err)
	}
}

// A named match behaves as it always did: the most direct alias of the card,
// else the first device with enough inputs, flagged as a fallback.
func TestPickInputNamed(t *testing.T) {
	devs := []inDev{
		{"sysdefault", 128},
		{"EP-136 K.O. Sidekick: USB Audio (plughw:2,0)", 8},
		{"EP-136 K.O. Sidekick: USB Audio (hw:2,0)", 8},
		{"dsnoop", 8},
	}
	i, fell, err := pickInput(devs, "EP-136", 8)
	if err != nil || fell || devs[i].Name != "EP-136 K.O. Sidekick: USB Audio (hw:2,0)" {
		t.Fatalf("named: %d %t %v", i, fell, err)
	}
	i, fell, err = pickInput(devs, "Scarlett", 8)
	if err != nil || !fell || devs[i].Name != "sysdefault" {
		t.Fatalf("fallback: %q %t %v", devs[i].Name, fell, err)
	}
	if _, _, err := pickInput(devs, "EP-136", 200); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("too many channels: err = %v, want ErrNoDevice", err)
	}
}

// The settings sheet lists every hardware input, not just the chosen one.
func TestListHardware(t *testing.T) {
	got := listHardware(piDevices)
	want := []Input{
		{"EP-136 K.O. Sidekick: USB Audio (hw:2,0)", 8},
		{"Scarlett Solo 4th Gen: USB Audio (hw:3,0)", 4},
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestIsVirtualInput(t *testing.T) {
	for _, n := range []string{"default", "sysdefault", "surround51", "iec958", "dmix", "dsnoop", "pulse", "pipewire", "jack", "plughw", "BlackHole 2ch", "lavrate", "upmix"} {
		if !isVirtualInput(n) {
			t.Errorf("%q not virtual", n)
		}
	}
	for _, n := range []string{"MacBook Pro Microphone", "Scarlett Solo 4th Gen", "EP-136 K.O. Sidekick"} {
		if isVirtualInput(n) {
			t.Errorf("%q virtual", n)
		}
	}
}
