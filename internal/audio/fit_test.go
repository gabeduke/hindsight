package audio

import (
	"sync"
	"testing"
	"time"
)

// fittedSource is a fakeSource that reports what it picked, as the real
// device source does.
type fittedSource struct {
	fakeSource
	name   string
	inputs int
}

func (f *fittedSource) Picked() (string, int) { return f.name, f.inputs }

func runFit(t *testing.T, src Source, set bool) []int {
	t.Helper()
	c := NewCapture(testConfig(), src) // a ring of 2 channels
	var mu sync.Mutex
	var got []int
	if set {
		c.SetOnMismatch(func(_ string, n int) {
			mu.Lock()
			got = append(got, n)
			mu.Unlock()
		})
	}
	if err := c.Start(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, func() bool { o, _, _, _ := src.(*fittedSource).counts(); return o > 0 }, "an open")
	c.Stop()
	mu.Lock()
	defer mu.Unlock()
	return got
}

// The EP-136 turning up under a ring sized for two is reported, so main can
// restart to fit it; the capture records its first two meanwhile.
func TestMismatchReported(t *testing.T) {
	got := runFit(t, &fittedSource{name: "EP-136", inputs: 8}, true)
	if len(got) == 0 || got[0] != 8 {
		t.Fatalf("mismatch calls = %v, want [8]", got)
	}
}

// The interface the ring was sized for is not a mismatch: no restart loop.
func TestFitNotReported(t *testing.T) {
	if got := runFit(t, &fittedSource{name: "Solo", inputs: 2}, true); len(got) != 0 {
		t.Fatalf("mismatch calls = %v, want none", got)
	}
	// Nothing picked (no interface) isn't one either.
	if got := runFit(t, &fittedSource{}, true); len(got) != 0 {
		t.Fatalf("nothing picked: mismatch calls = %v, want none", got)
	}
}

// Past MaxChannels the ring is capped, and that cap is the fit.
func TestFitCappedAtMaxChannels(t *testing.T) {
	src := &fittedSource{name: "Big", inputs: 64}
	c := NewCapture(testConfig(), src)
	c.cfg.Channels = 32
	called := false
	c.SetOnMismatch(func(string, int) { called = true })
	c.checkFit()
	if called {
		t.Fatal("a 64-input interface under a 32-channel ring reported a mismatch")
	}
}
