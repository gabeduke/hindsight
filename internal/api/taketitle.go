package api

import (
	"os"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// takeTitle is a take as the page names it: its label, else when it was made.
func takeTitle(name, path string) string {
	m := audio.ReadMeta(path)
	if l := strings.TrimSpace(m.Label); l != "" {
		return l
	}
	var mod time.Time
	if fi, err := os.Stat(path); err == nil {
		mod = fi.ModTime()
	}
	return audio.TakeCreated(name, m, mod).Format("Mon 2 Jan 15:04") // as its cassette says it
}
