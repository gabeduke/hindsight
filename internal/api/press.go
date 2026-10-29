package api

// The keyboard's press on the tablet (docs/plan/the-instrument.md, step 7,
// *The surface, designed*: *The tablet*). Each press on the SMK-37 that says
// something on its screen (banner.go) is told to every page listening on
// /api/tapes/changes as well, as an event carrying the words and what the
// press changed, not a diff of the tape: the bar shows the words over its
// display for the banner's second, marked as the keyboard's, and lights
// what changed. The tape's own change still reaches the page as a new
// revision, and its poll; the press only says what the player did.

import (
	"sync"
	"time"
)

// A press's role: the colour it is drawn in, on the tablet as on the
// keyboard. Mixer is a Mixer page press, in its track's colour (K6, not
// built: nothing says it yet).
const (
	rolePlay    = "play"    // PLAY: green
	roleStop    = "stop"    // STOP: the text colour
	roleRec     = "rec"     // KEEP (the keyboard's REC), PUNCH IN: red
	roleVerb    = "verb"    // CATCH, GRAB, DROP: the text colour
	roleRefused = "refused" // why not: amber
	roleMixer   = "mixer"   // a Mixer pad: its track's colour
)

// What a press lit: the bar's ▶ and ●, and a track's head in the Studio.
const (
	litPlay  = "play"
	litRec   = "rec"
	litTrack = "track"
)

// keyPress is the event, as /api/tapes/changes sends it under "press":
//
//	{"words":"PLAY","role":"play","lit":["play"],"at_ms":…}
//	{"words":"DROPPED ON T2","role":"verb","lit":["track"],"track":2,"at_ms":…}
//	{"words":"NO TRACK ARMED","role":"refused","lit":[],"at_ms":…}
//
// words are the banner's, role one of the roles above, lit what it
// changed (never what a refusal didn't), track the track lit (1 up), and
// at_ms the Pi's clock when the banner's second began: the press, or for a
// verb timed from when it was done, then (banner.go, fromThePress).
type keyPress struct {
	Words string   `json:"words"`
	Role  string   `json:"role"`
	Lit   []string `json:"lit"`
	Track int      `json:"track,omitempty"`
	AtMS  int64    `json:"at_ms"`
}

// press is s as the tablets hear it, its second begun at pressed.
func (s says) press(pressed time.Time) keyPress {
	lit := s.lit
	if lit == nil {
		lit = []string{}
	}
	return keyPress{Words: s.words, Role: s.role, Lit: lit, Track: s.track, AtMS: pressed.UnixMilli()}
}

// pressFeed hands each press to every socket listening. It never blocks the
// verb that says it: a socket too slow to take a press within its few
// places misses it, as a banner a second old is no news.
type pressFeed struct {
	mu   sync.Mutex
	subs map[chan keyPress]struct{}
}

const pressBacklog = 4

// subscribe answers the presses from now on, and the cancel that ends them.
func (f *pressFeed) subscribe() (<-chan keyPress, func()) {
	ch := make(chan keyPress, pressBacklog)
	f.mu.Lock()
	if f.subs == nil {
		f.subs = map[chan keyPress]struct{}{}
	}
	f.subs[ch] = struct{}{}
	f.mu.Unlock()
	return ch, func() {
		f.mu.Lock()
		delete(f.subs, ch)
		f.mu.Unlock()
	}
}

func (f *pressFeed) publish(p keyPress) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for ch := range f.subs {
		select {
		case ch <- p:
		default:
		}
	}
}
