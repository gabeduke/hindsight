package tape

import "testing"

func TestFitSourcesKeepsWhatTheInterfaceHas(t *testing.T) {
	for _, c := range []struct {
		channels int
		want     string
	}{
		{8, DefaultSourcesSpec},
		{6, "main=1,2:AB ch1=3,4:A ch2=5,6:B"},
		{2, "main=1,2:AB"},
		{1, ""},
	} {
		if got := FitSources(DefaultSourcesSpec, c.channels); got != c.want {
			t.Errorf("%d channels: %q, want %q", c.channels, got, c.want)
		}
	}
}

// A two-channel Scarlett's default sources must parse: the tape used to be
// left off there with `channel "3" isn't 1..2`.
func TestDefaultSourcesParseOnTwoChannels(t *testing.T) {
	src, err := ParseSources(FitSources(DefaultSourcesSpec, 2), 2)
	if err != nil || len(src) != 1 || src[0].Name != "main" {
		t.Fatalf("%v, %v", src, err)
	}
}

func TestFitSourcesLeavesMalformedForParseSources(t *testing.T) {
	if got := FitSources("oops main=1,2", 2); got != "oops main=1,2" {
		t.Fatalf("%q", got)
	}
}
