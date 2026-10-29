package api

// The banner on the SMK-37's screen (internal/surface's Banner;
// docs/plan/the-instrument.md, step 7, *The flash*): every press on the
// keyboard answers on its screen, over the top line for a second, with what
// it did in the press's colour, or why it was refused in amber. Only the
// keyboard's own presses say anything there, and only while Hindsight has
// its screen.
//
// The colours are the design's, version 2's palette: the keyboard's client
// draws them in version 1's seven there (surface's v1Colour), where KEEP's
// red is the accent and the commands' white the text's.

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The verbs' own refusals, so the banner can name them.
var (
	errNotArmed      = errors.New("arm a track first")
	errNothingToKeep = errors.New("nothing to keep from")
	errTapeOff       = errors.New("the tape is off")
	errNoAudioOut    = errors.New("nothing plays the tape: this build has no audio output")
	errNoRoom        = errors.New("no room on track")
	errBusy          = errors.New("the verbs before it haven't finished")
)

// The words of the verbs that went through (piVerbs), each well inside the
// banner's 19 characters at its longest (TestTheVerbsWordsFitTheBanner).
func keptWords(seconds int) string { return fmt.Sprintf("KEPT %d S", seconds) }
func caughtWords(seconds float64) string {
	return fmt.Sprintf("CAUGHT %.0f S", min(seconds, 99999))
}
func grabbedWords(n int, unit string) string { return fmt.Sprintf("GRABBED %d %s", n, unit) }
func droppedWords(track int) string          { return fmt.Sprintf("DROPPED ON T%d", track) }

// says is a banner: its words and its colour on the keyboard, and for the
// tablet's note (press.go) its role, what it lit and the track it changed.
type says struct {
	words  string
	colour surface.Colour
	role   string
	lit    []string
	track  int
}

// did is the banner for a verb that went through: PLAY green, STOP the
// text's white, KEEP red, and CATCH, GRAB and DROP white, as the design's
// command pads are. On the tablet, PLAY and STOP light ▶, KEEP (the
// keyboard's REC) lights ●, and CATCH and DROP the head of the track they
// put a clip on.
func did(id string, d verbDone) says {
	switch {
	case id == "transport" && d.says == "PLAY":
		return says{words: d.says, colour: surface.Green, role: rolePlay, lit: []string{litPlay}}
	case id == "transport":
		return says{words: d.says, colour: surface.Text, role: roleStop, lit: []string{litPlay}}
	case id == "keep":
		return says{words: d.says, colour: surface.Red, role: roleRec, lit: []string{litRec}}
	case d.track > 0:
		return says{words: d.says, colour: surface.White, role: roleVerb, lit: []string{litTrack}, track: d.track}
	}
	return says{words: d.says, colour: surface.White, role: roleVerb}
}

// refusals name why a press was refused, in the banner's 19 characters.
// The first that matches says it.
var refusals = []struct {
	err   error
	words string
}{
	{errNotArmed, "NO TRACK ARMED"},
	{errNothingToKeep, "NOTHING TO KEEP"},
	{audio.ErrNoAudio, "NOTHING TO KEEP"},
	{audio.ErrLowDisk, "DISK FULL"},
	{errTapeOff, "TAPE IS OFF"},
	{tape.ErrNoTape, "NO TAPE LOADED"},
	{errNoAudioOut, "NO AUDIO OUTPUT"},
	{tape.ErrNoOutput, "NO AUDIO OUTPUT"},
	{tape.ErrNeedsJamRoom, "PLAYING ON A PHONE"},
	{tape.ErrNoPass, "NO PASS TO CATCH"},
	{tape.ErrNoCapture, "NO CAPTURE"},
	{tape.ErrNotLined, "NOT LINED UP YET"},
	{tape.ErrNotPlayed, "BARS NOT PLAYED"},
	{tape.ErrSlipped, "SLIPPED: TRY AGAIN"},
	{tape.ErrEmptyClipboard, "BUFFER IS EMPTY"},
	{errNoRoom, "NO ROOM ON TRACK"},
	{tape.ErrMixingDown, "MIXDOWN PLAYING"},
	{errBusy, "STILL BUSY"},
}

// refused is the amber banner for a press refused with err: its reason, or
// the press's name and REFUSED for a reason it has no words for.
func refused(id string, err error) says {
	for _, r := range refusals {
		if errors.Is(err, r.err) {
			return says{words: r.words, colour: surface.Amber, role: roleRefused}
		}
	}
	return says{words: strings.ToUpper(id) + " REFUSED", colour: surface.Amber, role: roleRefused}
}

// fromThePress says whose banner is timed from the press: the transport,
// which acts at once. The others are timed from when they are done, as the
// design's command pads flash when done: KEEP writes its take first, and
// GRAB waits for the bar after it.
func fromThePress(id string) bool { return id == "transport" }

// keyboardPressed is the keyboard's clock now, for a press from it: zero
// from any other controller, or with no keyboard.
func (a *API) keyboardPressed(port string) time.Time {
	if a.keyboard == nil || !isKeyboard(port) {
		return time.Time{}
	}
	return a.keyboard.Now()
}

// keyboardSays puts s on the keyboard's screen for a press from it, and
// tells the tablets (press.go). The keyboard draws nothing unless Hindsight
// has its screen; the tablets hear every press from it regardless.
func (a *API) keyboardSays(port string, pressed time.Time, s says) {
	if a.keyboard == nil || pressed.IsZero() || !isKeyboard(port) {
		return
	}
	a.presses.publish(s.press(pressed))
	a.keyboard.Banner(pressed, s.colour, s.words)
}
