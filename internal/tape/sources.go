package tape

import (
	"fmt"
	"strconv"
	"strings"
)

// ParseSources reads TAPE_SOURCES: space-separated name=L,R[:buses], with
// 1-indexed capture channels and the buses that leak into each, e.g.
// "main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8".
func ParseSources(s string, channels int) ([]Source, error) {
	var out []Source
	for _, f := range strings.Fields(s) {
		name, rest, ok := strings.Cut(f, "=")
		if !ok || name == "" {
			return nil, fmt.Errorf("TAPE_SOURCES: %q isn't name=L,R", f)
		}
		pair, leaks, _ := strings.Cut(rest, ":")
		l, r, ok := strings.Cut(pair, ",")
		if !ok {
			return nil, fmt.Errorf("TAPE_SOURCES: %q needs a channel pair", f)
		}
		src := Source{Name: name}
		for i, v := range []string{l, r} {
			n, err := strconv.Atoi(strings.TrimSpace(v))
			if err != nil || n < 1 || n > channels {
				return nil, fmt.Errorf("TAPE_SOURCES: %q: channel %q isn't 1..%d", f, v, channels)
			}
			src.Pair[i] = n - 1
		}
		for _, b := range strings.ToUpper(leaks) {
			if b != 'A' && b != 'B' {
				return nil, fmt.Errorf("TAPE_SOURCES: %q: bus %q isn't A or B", f, b)
			}
			src.Leaks = append(src.Leaks, string(b))
		}
		out = append(out, src)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("TAPE_SOURCES is empty")
	}
	return out, nil
}

// DefaultSourcesSpec is TAPE_SOURCES until someone sets it: the Sidekick's four
// pairs. An interface with fewer channels keeps the pairs that fit (FitSources).
const DefaultSourcesSpec = "main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8"

// WithExtraSources adds a mono source for each channel of each extra input
// (EXTRA_INPUTS) to s, numbered on after the main interface's main channels:
// "ams1=9,9 ams2=10,10" for the AMS-24 beside the EP-136. They hear no bus:
// the tape never reaches an extra input. Named after the card ("AMS-24" is
// ams), or in for a card named only by its USB id. A name already taken (a
// second card with the same prefix, or a ch1 beside the Sidekick's) is
// numbered by the bus channel instead: in9, in10.
func WithExtraSources(s string, main int, extras []string, perInput int) string {
	fields := strings.Fields(s)
	taken := map[string]bool{}
	for _, f := range fields {
		name, _, _ := strings.Cut(f, "=")
		taken[name] = true
	}
	ch := main
	for _, x := range extras {
		prefix := cardPrefix(x)
		for i := 1; i <= perInput; i++ {
			ch++
			name := fmt.Sprintf("%s%d", prefix, i)
			if taken[name] {
				name = fmt.Sprintf("in%d", ch)
			}
			taken[name] = true
			fields = append(fields, fmt.Sprintf("%s=%d,%d", name, ch, ch))
		}
	}
	return strings.Join(fields, " ")
}

// cardPrefix is a card's name as a source's: its letters, lower case, up to
// the first that isn't one ("AMS-24" is "ams").
func cardPrefix(card string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(card) {
		if r < 'a' || r > 'z' {
			break
		}
		b.WriteRune(r)
	}
	if b.Len() == 0 {
		return "in"
	}
	return b.String()
}

// FitSources drops the sources of s that name a channel beyond the
// interface's, so the default works on a two-channel Scarlett as it does on
// the Sidekick. A source that is malformed is kept, for ParseSources to name.
func FitSources(s string, channels int) string {
	var keep []string
	for _, f := range strings.Fields(s) {
		_, rest, _ := strings.Cut(f, "=")
		pair, _, _ := strings.Cut(rest, ":")
		l, r, _ := strings.Cut(pair, ",")
		a, errA := strconv.Atoi(strings.TrimSpace(l))
		b, errB := strconv.Atoi(strings.TrimSpace(r))
		if errA == nil && errB == nil && (a > channels || b > channels) {
			continue
		}
		keep = append(keep, f)
	}
	return strings.Join(keep, " ")
}
