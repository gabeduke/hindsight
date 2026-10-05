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
	mu    sync.Mutex
	got   [][]byte
	at    []int64
	fail  bool
	clock func() int64 // nil: mono.Now
}

func (r *recorder) Write(b []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return 0, errors.New("unplugged")
	}
	r.got = append(r.got, append([]byte(nil), b...))
	now := mono.Now
	if r.clock != nil {
		now = r.clock
	}
	r.at = append(r.at, now())
	return len(b), nil
}
func (r *recorder) Close() error { return nil }

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.got)
}

// fakeClock is a mono clock that moves only when the test moves it. A port
// asleep on it wakes when it's set past the port's time, and a recorder on it
// stamps the time that was set, so a message is seen at exactly the moment it
// was meant for however loaded the machine is: the scheduler waking a
// goroutine a few ms late is Go's business, the nudge is ours.
type fakeClock struct {
	mu     sync.Mutex
	ns     int64
	asleep []fakeSleeper
}

type fakeSleeper struct {
	until int64
	wake  chan struct{}
}

func (c *fakeClock) Now() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ns
}

func (c *fakeClock) Sleep(d time.Duration) {
	c.mu.Lock()
	s := fakeSleeper{until: c.ns + int64(d), wake: make(chan struct{})}
	c.asleep = append(c.asleep, s)
	c.mu.Unlock()
	<-s.wake
}

// Sleeping is how many are waiting on the clock.
func (c *fakeClock) Sleeping() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.asleep)
}

// Set moves the clock to ns and wakes whoever's time that is.
func (c *fakeClock) Set(ns int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ns = ns
	still := c.asleep[:0]
	for _, s := range c.asleep {
		if s.until <= ns {
			close(s.wake)
		} else {
			still = append(still, s)
		}
	}
	c.asleep = still
}

func TestOutSendsToMatchingDevicesOnTimeWithTheirNudge(t *testing.T) {
	cards, snd := fixture(t, rigCards, "midiC2D0", "midiC3D0", "midiC4D0")
	devs := map[string]*recorder{}
	clk := &fakeClock{ns: int64(time.Hour)}
	o := NewOut([]OutTarget{{Match: "keystep", NudgeMS: 20}, {Match: "orchid"}})
	o.cardsPath, o.sndDir = cards, snd
	o.now, o.sleep = clk.Now, clk.Sleep
	o.open = func(node string) (io.WriteCloser, error) {
		r := &recorder{clock: clk.Now}
		devs[node] = r
		return r, nil
	}
	o.scan()
	defer o.Stop()
	if d := o.Devices(); len(d) != 2 || d[0] != "Arturia KeyStep 37" || d[1] != "Orchid" {
		t.Fatalf("devices = %v", d)
	}
	orchid, keystep := devs[snd+"/midiC3D0"], devs[snd+"/midiC4D0"]
	if devs[snd+"/midiC2D0"] != nil {
		t.Fatal("the EP-136 was opened")
	}
	// Both wait for the moment; at it the Orchid hears it and the KeyStep,
	// 20 ms late, is still waiting; 20 ms on, it hears it too.
	at := clk.Now() + int64(50*time.Millisecond)
	o.Send(at, []byte{ClockByte})
	waitFor(t, "both ports to wait", func() bool { return clk.Sleeping() == 2 })
	clk.Set(at)
	waitFor(t, "the orchid's clock", func() bool { return orchid.count() == 1 })
	if n := keystep.count(); n != 0 || clk.Sleeping() != 1 {
		t.Fatalf("at the moment the keystep got %d and %d are waiting", n, clk.Sleeping())
	}
	clk.Set(at + int64(20*time.Millisecond))
	waitFor(t, "the keystep's clock", func() bool { return keystep.count() == 1 })
	for name, r := range map[string]*recorder{"orchid": orchid, "keystep": keystep} {
		r.mu.Lock()
		if len(r.got) != 1 || r.got[0][0] != ClockByte {
			t.Fatalf("%s got %v", name, r.got)
		}
		r.mu.Unlock()
	}
	if d := orchid.at[0] - at; d != 0 {
		t.Fatalf("orchid %v off", time.Duration(d))
	}
	if d := keystep.at[0] - at; d != int64(20*time.Millisecond) {
		t.Fatalf("keystep %v off, want 20 ms late", time.Duration(d))
	}
	// One that fails is dropped, then found again on the next scan -- and
	// the followers are to be told where they are.
	gen := o.Gen()
	orchid.mu.Lock()
	orchid.fail = true
	orchid.mu.Unlock()
	o.Send(clk.Now(), []byte{ClockByte})
	waitFor(t, "the failed device to go", func() bool { return len(o.Devices()) == 1 })
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
	// Its clock steps exactly between pulses: sleeping between them would
	// test how promptly a loaded machine wakes, and hear that as the tempo.
	now := time.Now()
	f.now = func() time.Time { return now }
	f.Write([]byte{SongPosition, 0x10, 0x01}) // 16 + 128 = 144
	f.Write([]byte{ContinueByte})
	// 120 BPM: 48 pulses a second, about 21 ms apart.
	for i := 0; i < 60; i++ {
		f.Write([]byte{ClockByte})
		now = now.Add(time.Second / 48)
	}
	bpm, ok, running, spp := f.Heard()
	if !ok || bpm < 119.9 || bpm > 120.1 || !running || spp != 144 {
		t.Fatalf("heard %.1f %v running %v spp %d", bpm, ok, running, spp)
	}
	f.Write([]byte{StopByte})
	if _, _, running, _ := f.Heard(); running {
		t.Fatal("still running after Stop")
	}
}
