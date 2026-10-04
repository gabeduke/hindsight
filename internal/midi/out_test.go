package midi

import (
	"errors"
	"io"
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
	// One that fails is dropped, then found again on the next scan.
	orchid.mu.Lock()
	orchid.fail = true
	orchid.mu.Unlock()
	o.Send(mono.Now(), []byte{ClockByte})
	time.Sleep(20 * time.Millisecond)
	if d := o.Devices(); len(d) != 1 {
		t.Fatalf("after a failed write: %v", d)
	}
	o.scan()
	if d := o.Devices(); len(d) != 2 {
		t.Fatalf("after a rescan: %v", d)
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
