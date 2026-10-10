package audio

import (
	"errors"
	"testing"
)

// recorder captures the order of init/term calls so a test can assert on the
// sequence, not just the counts. Rescan's whole purpose is that terminate
// happens before initialise, and only an ordered log can prove that.
type recorder struct {
	calls   []string
	initErr error
	termErr error
}

func (r *recorder) init() error {
	r.calls = append(r.calls, "init")
	return r.initErr
}

func (r *recorder) term() error {
	r.calls = append(r.calls, "term")
	return r.termErr
}

func TestInitIsIdempotent(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)

	if err := p.Init(); err != nil {
		t.Fatalf("first Init: %v", err)
	}
	if err := p.Init(); err != nil {
		t.Fatalf("second Init: %v", err)
	}

	if len(r.calls) != 1 || r.calls[0] != "init" {
		t.Fatalf("want exactly one init, got %v", r.calls)
	}
}

func TestTermIsIdempotentAndSkipsWhenDown(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)

	// Terminating a PortAudio that was never initialised is a double free in
	// the C library, so it must not reach termFn at all.
	if err := p.Term(); err != nil {
		t.Fatalf("Term while down: %v", err)
	}
	if len(r.calls) != 0 {
		t.Fatalf("Term while down must not call termFn, got %v", r.calls)
	}

	if err := p.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if err := p.Term(); err != nil {
		t.Fatalf("Term: %v", err)
	}
	if err := p.Term(); err != nil {
		t.Fatalf("second Term: %v", err)
	}

	want := []string{"init", "term"}
	if len(r.calls) != len(want) {
		t.Fatalf("want %v, got %v", want, r.calls)
	}
	for i := range want {
		if r.calls[i] != want[i] {
			t.Fatalf("want %v, got %v", want, r.calls)
		}
	}
}

func TestRescanTerminatesThenInitialises(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)

	if err := p.Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	if err := p.Rescan(); err != nil {
		t.Fatalf("Rescan: %v", err)
	}

	want := []string{"init", "term", "init"}
	if len(r.calls) != len(want) {
		t.Fatalf("want %v, got %v", want, r.calls)
	}
	for i := range want {
		if r.calls[i] != want[i] {
			t.Fatalf("want %v, got %v", want, r.calls)
		}
	}
}

func TestRescanFromDownStateStillInitialises(t *testing.T) {
	// supervise() may call Rescan before anything successfully came up, e.g.
	// when the very first Init failed. It must still leave PortAudio up.
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)

	if err := p.Rescan(); err != nil {
		t.Fatalf("Rescan from down: %v", err)
	}

	want := []string{"init"}
	if len(r.calls) != len(want) || r.calls[0] != want[0] {
		t.Fatalf("want %v, got %v", want, r.calls)
	}
}

func TestInitErrorLeavesLifecycleDownSoRetryWorks(t *testing.T) {
	r := &recorder{initErr: errors.New("boom")}
	p := newPALifecycle(r.init, r.term)

	if err := p.Init(); err == nil {
		t.Fatal("want an error from Init")
	}

	// A failed Init must not latch "up", or every later retry would no-op and
	// the process would never recover.
	r.initErr = nil
	if err := p.Init(); err != nil {
		t.Fatalf("retry Init: %v", err)
	}
	if len(r.calls) != 2 {
		t.Fatalf("want two init attempts, got %v", r.calls)
	}
}

func TestARescanClosesOpenStreamsFirstAndMovesTheGeneration(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)
	h, gen, err := p.Open(func() (func(), error) {
		r.calls = append(r.calls, "open")
		return func() { r.calls = append(r.calls, "close") }, nil
	})
	if err != nil || h == 0 {
		t.Fatalf("Open = %d, %v", h, err)
	}
	if err := p.Rescan(); err != nil {
		t.Fatal(err)
	}
	want := []string{"init", "open", "close", "term", "init"}
	if len(r.calls) != len(want) {
		t.Fatalf("calls %v, want %v", r.calls, want)
	}
	for i := range want {
		if r.calls[i] != want[i] {
			t.Fatalf("calls %v, want %v", r.calls, want)
		}
	}
	if p.Gen() == gen {
		t.Fatal("a rescan should move the generation")
	}
	// The owner's own close, after the rescan closed it, does nothing.
	p.Close(h)
	if n := len(r.calls); n != len(want) {
		t.Fatalf("a second close reached the stream: %v", r.calls)
	}
}

func TestAFailedOpenRegistersNothing(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)
	if _, _, err := p.Open(func() (func(), error) { return nil, errors.New("busy") }); err == nil {
		t.Fatal("want the open's error")
	}
	if err := p.Term(); err != nil {
		t.Fatal(err)
	}
	if len(r.calls) != 2 || r.calls[0] != "init" || r.calls[1] != "term" {
		t.Fatalf("calls %v", r.calls)
	}
}

func TestTheTapeOutputGoesToTheCapturesCardOrNowhere(t *testing.T) {
	devs := []outDev{
		{Name: "bcm2835 HDMI 1: (hw:0,0)", MaxOut: 8},
		{Name: "EP-136: USB Audio (plughw:2,0)", MaxOut: 4},
		{Name: "EP-136: USB Audio (hw:2,0)", MaxOut: 4},
		{Name: "default", MaxOut: 32},
	}
	if i, err := pickOutput(devs, "EP-136: USB Audio (hw:2,0)", "EP-136", 4); err != nil || i != 2 {
		t.Fatalf("with the capture's device = %d, %v", i, err)
	}
	// Without the capture's name, the most direct match.
	if i, err := pickOutput(devs, "", "EP-136", 4); err != nil || i != 2 {
		t.Fatalf("by match = %d, %v", i, err)
	}
	// Never HDMI or "default", even with nothing else -- and not even when
	// the capture itself fell back to one.
	if _, err := pickOutput(devs[:1], "", "EP-136", 4); !errors.Is(err, ErrNoDevice) {
		t.Fatalf("no match = %v, want ErrNoDevice", err)
	}
	if i, err := pickOutput(devs, "default", "EP-136", 4); err != nil || i != 2 {
		t.Fatalf("with the capture on default = %d, %v; want the EP-136", i, err)
	}
	if _, err := pickOutput([]outDev{{Name: "default", MaxOut: 32}, {Name: "pulse", MaxOut: 32}}, "default", "EP-136", 4); err == nil {
		t.Fatal("the capture on default with no EP-136 should give no output")
	}
	if _, err := pickOutput(devs, "", "", 4); err == nil {
		t.Fatal("DEVICE_MATCH=auto with no capture open should give no output")
	}
	// DEVICE_MATCH=auto plays out of the capture's own card.
	if i, err := pickOutput(devs, "EP-136: USB Audio (hw:2,0)", "", 4); err != nil || i != 2 {
		t.Fatalf("auto = %d, %v; want the capture's card", i, err)
	}
	// A plug device on the right card isn't direct enough.
	if _, err := pickOutput([]outDev{{Name: "EP-136: USB Audio (plughw:2,0)", MaxOut: 4}}, "", "EP-136", 4); err == nil {
		t.Fatal("plughw should be refused")
	}
	// Too few channels doesn't count.
	if _, err := pickOutput([]outDev{{Name: "EP-136: USB Audio (hw:2,0)", MaxOut: 2}}, "", "EP-136", 4); err == nil {
		t.Fatal("a 2-channel output can't play two buses")
	}
}

// IfUp looks only at a library something else brought up: listing inputs
// must never initialise PortAudio by itself.
func TestIfUpNeverInits(t *testing.T) {
	r := &recorder{}
	p := newPALifecycle(r.init, r.term)
	ran := false
	p.IfUp(func() { ran = true })
	if ran || len(r.calls) != 0 {
		t.Fatalf("down: ran=%t calls=%v", ran, r.calls)
	}
	_ = p.Init()
	p.IfUp(func() { ran = true })
	if !ran || len(r.calls) != 1 {
		t.Fatalf("up: ran=%t calls=%v", ran, r.calls)
	}
}
