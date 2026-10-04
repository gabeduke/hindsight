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
