package tape

import (
	"errors"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The default sources gain a mono source per extra input's channel, named
// after the card, numbered after the main interface's.
func TestTheDefaultSourcesGainTheExtraInputs(t *testing.T) {
	spec := WithExtraSources(DefaultSourcesSpec, 8, []string{"AMS-24"}, 2)
	if want := DefaultSourcesSpec + " ams1=9,9 ams2=10,10"; spec != want {
		t.Fatalf("got %q, want %q", spec, want)
	}
	srcs, err := ParseSources(spec, 10)
	if err != nil {
		t.Fatal(err)
	}
	if s := srcs[4]; s.Name != "ams1" || s.Pair != [2]int{8, 8} || len(s.Leaks) != 0 {
		t.Fatalf("ams1 = %+v", s)
	}
	if got := WithExtraSources("main=1,2", 2, []string{"1686:067f"}, 2); got != "main=1,2 in1=3,3 in2=4,4" {
		t.Fatalf("by USB id: %q", got)
	}
	if got := WithExtraSources("main=1,2", 2, []string{"AMS-24", "AMS-22"}, 2); got != "main=1,2 ams1=3,3 ams2=4,4 in5=5,5 in6=6,6" {
		t.Fatalf("two cards of one prefix: %q", got)
	}
	if got := WithExtraSources(DefaultSourcesSpec, 8, nil, 2); got != DefaultSourcesSpec {
		t.Fatalf("with no extra input: %q", got)
	}
}

// The real capture is ExtraAware: if a signature drifted, the lag would
// quietly stop being kept.
var _ ExtraAware = (*audio.Capture)(nil)

// extraCapture is a capture whose channel 2 is an extra input's, lagging the
// head by lag, with a gap at frame gap.
type extraCapture struct {
	ring     *audio.Ring
	lag, gap uint64
}

func (c *extraCapture) Ring() *audio.Ring { return c.ring }
func (c *extraCapture) NewestFor(chs []int) (uint64, uint64) {
	oldest, newest := c.ring.Window()
	for _, ch := range chs {
		if ch >= 2 {
			return oldest, newest - c.lag
		}
	}
	return oldest, newest
}
func (c *extraCapture) ExtraGaps(ch int, start, end uint64) []int64 {
	if ch >= 2 && c.gap > start && c.gap < end {
		return []int64{int64(c.gap - start)}
	}
	return nil
}

// A source on an extra input sees the ring end the lag short of the head,
// a main one sees it all; a span across an extra input's gap is refused for
// its sources only. A capture without extra inputs is the ring as it is.
func TestTheTapeReadsAnExtraInputALagBehind(t *testing.T) {
	ring := audio.NewRing(48000, 3)
	ring.WriteFrames(make([]int32, 3*10000))
	c := &extraCapture{ring: ring, lag: 2000, gap: 5000}
	e := NewEngine(Options{Store: nil, Capture: c})
	main, gtr := Source{Name: "main", Pair: [2]int{0, 1}}, Source{Name: "ams1", Pair: [2]int{2, 2}}
	if _, n := e.window(main); n != 10000 {
		t.Fatalf("main sees %d, want the head", n)
	}
	if _, n := e.window(main, gtr); n != 8000 {
		t.Fatalf("with the guitar, %d, want the head less the lag", n)
	}
	if _, hi := e.ringHandles(48000, 100, 7000, 5000, gtr); hi != 8000 {
		t.Fatalf("a handle runs to %d, past what the extra input has written", hi)
	}
	if err := e.extraGap(4000, 6000, gtr); !errors.Is(err, ErrExtraGap) {
		t.Fatalf("across the gap: %v, want ErrExtraGap", err)
	}
	if err := e.extraGap(4000, 6000, main); err != nil {
		t.Fatalf("a main source across it: %v", err)
	}
	if err := e.extraGap(6000, 7000, gtr); err != nil {
		t.Fatalf("after the gap: %v", err)
	}
	plain := NewEngine(Options{Capture: &loopSink{ring: ring}})
	if _, n := plain.window(gtr); n != 10000 {
		t.Fatalf("without extra inputs, %d", n)
	}
}
