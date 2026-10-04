package midi

import (
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

func TestOutTargetsParse(t *testing.T) {
	got, err := ParseOutTargets(" bento , mpc:-3,keystep:+2.5,")
	if err != nil {
		t.Fatal(err)
	}
	want := []OutTarget{{"bento", 0}, {"mpc", -3}, {"keystep", 2.5}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	}
	for _, bad := range []string{"bento:x", "bento:500"} {
		if _, err := ParseOutTargets(bad); err == nil {
			t.Fatalf("%q parsed", bad)
		}
	}
}

// recorder is a device that notes when each message arrived.
type recorder struct {
	mu   sync.Mutex
	got  [][]byte
	at   []int64
	fail bool
}

func (r *recorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return 0, errors.New("unplugged")
	}
	r.got = append(r.got, append([]byte(nil), b...))
	r.at = append(r.at, mono.Now())
	return len(b), nil
}
func (r *recorder) Close() error { return nil }

func TestOutSendsToMatchingDevicesOnTimeWithTheirNudge(t *testing.T) {
	cards, snd := fixture(t, rigCards, "midiC2D0", "midiC3D0", "midiC4D0")
	devs := map[string]*recorder{}
	o := NewOut([]OutTarget{{Match: "keystep", NudgeMS: 20}, {Match: "orchid"}})
	o.cardsPath, o.sndDir = cards, snd
	o.open = func(node string) (io.WriteCloser, error) {
		r := &recorder{}
		devs[node] = r
		return r, nil
	}
	o.scan()
	defer o.Stop()
	if d := o.Devices(); len(d) != 2 || d[0] != "Arturia KeyStep 37" || d[1] != "Orchid" {
		t.Fatalf("devices = %v", d)
	}
	at := mono.Now() + int64(50*time.Millisecond)
	o.Send(at, []byte{ClockByte})
	time.Sleep(150 * time.Millisecond)
	orchid, keystep := devs[snd+"/midiC3D0"], devs[snd+"/midiC4D0"]
	if devs[snd+"/midiC2D0"] != nil {
		t.Fatal("the EP-136 was opened")
	}
	for name, r := range map[string]*recorder{"orchid": orchid, "keystep": keystep} {
		r.mu.Lock()
		if len(r.got) != 1 || r.got[0][0] != ClockByte {
			t.Fatalf("%s got %v", name, r.got)
		}
		r.mu.Unlock()
	}
	// On time, give or take the scheduler; the KeyStep 20 ms later.
	if d := orchid.at[0] - at; d < 0 || d > int64(5*time.Millisecond) {
		t.Fatalf("orchid %v off", time.Duration(d))
	}
	if d := keystep.at[0] - at; d < int64(20*time.Millisecond) || d > int64(25*time.Millisecond) {
		t.Fatalf("keystep %v off, want 20 ms late", time.Duration(d))
	}
	// One that fails is dropped, then found again on the next scan -- and
	// the followers are to be told where they are.
	gen := o.Gen()
	orchid.mu.Lock()
	orchid.fail = true
	orchid.mu.Unlock()
	o.Send(mono.Now(), []byte{ClockByte})
	time.Sleep(20 * time.Millisecond)
	if d := o.Devices(); len(d) != 1 {
		t.Fatalf("after a failed write: %v", d)
	}
	o.scan()
	if d := o.Devices(); len(d) != 2 || o.Gen() == gen {
		t.Fatalf("after a rescan: %v, gen %d", d, o.Gen())
	}
}

func TestADeviceThatGoesAwayIsClosedAndOneThatWontOpenIsLeftAWhile(t *testing.T) {
	cards, snd := fixture(t, rigCards, "midiC3D0", "midiC4D0")
	opened := map[string]int{}
	var mu sync.Mutex
	o := NewOut([]OutTarget{{Match: "keystep"}, {Match: "orchid"}})
	o.cardsPath, o.sndDir = cards, snd
	o.open = func(node string) (io.WriteCloser, error) {
		mu.Lock()
		defer mu.Unlock()
		opened[node]++
		if strings.HasSuffix(node, "midiC4D0") {
			return nil, errors.New("busy")
		}
		return &recorder{}, nil
	}
	defer o.Stop()
	o.scan()
	o.scan()
	if n := opened[snd+"/midiC4D0"]; n != 1 {
		t.Fatalf("a node that wouldn't open was tried %d times in a row", n)
	}
	if d := o.Devices(); len(d) != 1 || d[0] != "Orchid" {
		t.Fatalf("devices = %v", d)
	}
	// Unplugged: its node goes, and so does the port.
	if err := os.Remove(snd + "/midiC3D0"); err != nil {
		t.Fatal(err)
	}
	o.scan()
	if d := o.Devices(); len(d) != 0 {
		t.Fatalf("after unplugging: %v", d)
	}
}

func TestSendNowGoesAheadOfWhatsQueued(t *testing.T) {
	o := NewOut(nil)
	r := &recorder{}
	o.AddWriter("follower", r)
	defer o.Stop()
	soon := mono.Now() + int64(200*time.Millisecond)
	for i := 0; i < 5; i++ {
		o.Send(soon+int64(i)*int64(time.Millisecond), []byte{ClockByte})
	}
	o.SendNow([]byte{StopByte})
	time.Sleep(300 * time.Millisecond)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.got) != 1 || r.got[0][0] != StopByte {
		t.Fatalf("got %x, want the Stop alone", r.got)
	}
}

func TestAFollowerHearsTheTempoAndTheTransport(t *testing.T) {
	f := NewFollower()
	f.Write([]byte{SongPosition, 0x10, 0x01}) // 16 + 128 = 144
	f.Write([]byte{ContinueByte})
	// 120 BPM: 48 pulses a second, about 21 ms apart.
	for i := 0; i < 60; i++ {
		f.Write([]byte{ClockByte})
		time.Sleep(time.Second / 48)
	}
	bpm, ok, running, spp := f.Heard()
	if !ok || bpm < 110 || bpm > 125 || !running || spp != 144 {
		t.Fatalf("heard %.1f %v running %v spp %d", bpm, ok, running, spp)
	}
	f.Write([]byte{StopByte})
	if _, _, running, _ := f.Heard(); running {
		t.Fatal("still running after Stop")
	}
}
