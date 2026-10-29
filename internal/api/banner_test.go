package api

import (
	"bytes"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// fakeClock is the keyboard's clock, moved by hand.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// cannedVerbs answers each verb as the test says.
type cannedVerbs func(id, rt string) (verbDone, error)

func (c cannedVerbs) Verb(id, rt string) (verbDone, error) { return c(id, rt) }

// bannerRig is a keyboard whose screen Hindsight has taken, on a fake
// clock, with what it has been sent so far forgotten.
type bannerRig struct {
	t     *testing.T
	a     *API
	fw    *firmware
	clock *fakeClock
	pads  *fakeTricks
}

func newBannerRig(t *testing.T) *bannerRig {
	t.Helper()
	f, _, a, _ := controlsAPI(t, t.TempDir())
	fw := &firmware{acks: make(chan []byte, 16)}
	kb := surface.New(fw.send, func() bool { return true })
	clock := &fakeClock{t: time.Unix(1000, 0)}
	kb.Clock = clock.now
	a.SetKeyboard(kb)
	kb.Start()
	t.Cleanup(kb.Stop)
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || len(fw.sent()) < 6 {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken: %+v", kb.Status())
		}
	}
	answer(a, fw)
	r := &bannerRig{t: t, a: a, fw: fw, clock: clock, pads: f}
	r.take()
	return r
}

// take is the frames sent since the last take.
func (r *bannerRig) take() [][]byte {
	r.fw.mu.Lock()
	defer r.fw.mu.Unlock()
	out := r.fw.frames
	r.fw.frames = nil
	return out
}

// expect acks what the keyboard is sent until want's worth has come and
// then nothing more, and checks it is want: each frame's command and
// payload, as the seq is the client's.
func (r *bannerRig) expect(step string, want ...[]byte) {
	r.t.Helper()
	var got [][]byte
	deadline := time.Now().Add(2 * time.Second)
	for len(got) < len(want) && time.Now().Before(deadline) {
		answer(r.a, r.fw)
		got = append(got, r.take()...)
	}
	answer(r.a, r.fw)
	got = append(got, r.take()...)
	if len(got) != len(want) {
		r.t.Fatalf("%s: sent % x, want % x", step, got, want)
	}
	for i := range want {
		if body := got[i][6 : len(got[i])-1]; !bytes.Equal(body, want[i]) {
			r.t.Fatalf("%s: message %d = % x, want % x", step, i, body, want[i])
		}
	}
}

// expire moves the keyboard's clock on by d and lets its loop see it.
func (r *bannerRig) expire(d time.Duration) {
	r.clock.add(d)
	time.Sleep(60 * time.Millisecond) // three of the client's 20 ms ticks
}

// topText is a TEXT at the top line's place: the banner's, or the line
// it covers.
func topText(scale int, c surface.Colour, s string) []byte {
	return append([]byte{0x02, surface.TopX, 0, surface.TopY, 0, byte(scale), byte(c)}, s...)
}

var hindsightLine = topText(3, surface.Accent, "HINDSIGHT")

const (
	playOn  = 0x9F // a button: note on channel 16
	padOn   = 0x99 // a pad: note on channel 10
	playBtn = 16
	recBtn  = 17
)

// Every press on the keyboard says on its screen what it did, over the top
// line for a second from the press, in its colour; then the top line comes
// back.
func TestEachKeyboardPressBannersItsWordsForASecond(t *testing.T) {
	r := newBannerRig(t)
	playing := false
	r.a.controls.verbs = cannedVerbs(func(id, rt string) (verbDone, error) {
		switch id {
		case "transport":
			playing = !playing
			if playing {
				return verbDone{"play", "PLAY"}, nil
			}
			return verbDone{"stop", "STOP"}, nil
		case "keep":
			return verbDone{"kept", "KEPT 30 S"}, nil
		}
		return verbDone{}, errors.New("not in this test")
	})
	for _, c := range []struct {
		note   byte
		banner []byte
	}{
		{playBtn, topText(surface.BannerScale, surface.Green, "PLAY")},
		{playBtn, topText(surface.BannerScale, surface.Text, "STOP")},
		{recBtn, topText(surface.BannerScale, surface.Accent, "KEPT 30 S")},
	} {
		r.a.ControlMIDI("SMK-37", playOn, c.note, 127)
		r.a.ControlMIDI("SMK-37", playOn, c.note, 0)
		r.expect("the press", c.banner)
		r.expire(surface.BannerFor - time.Millisecond)
		r.expect("just under a second on")
		r.expire(time.Millisecond)
		r.expect("a second on", hindsightLine)
	}
}

// A press refused says why, in amber: the Pi's own verbs, with no tape
// and nothing to keep from, and a pad Play mode turns down.
func TestARefusedPressBannersWhyInAmber(t *testing.T) {
	r := newBannerRig(t)
	r.pads.refuse = map[string]error{"track1": tape.ErrMixingDown}
	for _, c := range []struct {
		status, note byte
		banner       []byte
	}{
		{playOn, recBtn, topText(surface.BannerScale, surface.Amber, "NOTHING TO KEEP")},
		{playOn, playBtn, topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED")},
		{padOn, 50, topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED")}, // CATCH
		{padOn, 36, topText(surface.BannerScale, surface.Amber, "MIXDOWN PLAYING")},
	} {
		r.a.ControlMIDI("SMK-37", c.status, c.note, 127)
		r.a.ControlMIDI("SMK-37", c.status-0x10, c.note, 0)
		r.expect("the press", c.banner)
		r.expire(surface.BannerFor)
		r.expect("a second on", hindsightLine)
	}
}

// A new press replaces the banner showing, and its second starts again.
func TestANewKeyboardPressReplacesTheBanner(t *testing.T) {
	r := newBannerRig(t)
	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	r.expect("PLAY", topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED"))
	r.expire(500 * time.Millisecond)
	r.a.ControlMIDI("SMK-37", playOn, recBtn, 127)
	r.expect("REC", topText(surface.BannerScale, surface.Amber, "NOTHING TO KEEP"))
	r.expire(500 * time.Millisecond)
	r.expect("PLAY's second")
	r.expire(500 * time.Millisecond)
	r.expect("REC's", hindsightLine)
}

// Only the keyboard's own presses say anything on it, and nothing after
// HOME: neither a banner then showing put back, nor a new one.
func TestNoBannerForAnotherControllerOrAfterHome(t *testing.T) {
	r := newBannerRig(t)
	r.a.ControlMIDI("Keystation 49", 0xFA, 0, 0) // Start
	r.a.ControlMIDI("Keystation 49", 0x90, 53, 100)
	r.expect("another controller's presses")

	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	r.expect("PLAY", topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED"))
	r.a.ControlSysEx("SMK-37", keyboardHome)
	r.expire(surface.BannerFor)
	r.expect("a second after HOME")
	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	time.Sleep(100 * time.Millisecond) // its verb answers
	r.expect("a press after HOME")
	r.expire(surface.BannerFor)
	r.expect("its second")
}

// The banner's words for each refusal the verbs know, in 19 characters.
func TestEveryRefusalFitsTheBanner(t *testing.T) {
	for _, c := range refusals {
		if len(c.words) > (surface.Width-surface.TopX)/(6*surface.BannerScale) {
			t.Errorf("%q runs off the banner", c.words)
		}
	}
	for err, want := range map[error]string{
		errNotArmed:                     "NO TRACK ARMED",
		audio.ErrNoAudio:                "NOTHING TO KEEP",
		tape.ErrNeedsJamRoom:            "PLAYING ON A PHONE",
		errors.New("something new"):     "GRAB REFUSED",
		errors.Join(errNoRoom, errBusy): "NO ROOM ON TRACK",
		tape.ErrEmptyClipboard:          "BUFFER IS EMPTY",
	} {
		if got := refused("grab", err); got.words != want || got.colour != surface.Amber {
			t.Errorf("refused(grab, %v) = %+v, want %q in amber", err, got, want)
		}
	}
	if _, err := (piVerbs{&API{}}).Verb("keep", ""); !errors.Is(err, errNothingToKeep) {
		t.Fatalf("KEEP with nothing to keep from: %v", err)
	}
}
