package midi

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// DefaultCardsPath and DefaultSndDir are the real ALSA locations. They are
// parameters rather than constants everywhere below so the tests can run
// against a fixture directory, on a Mac, with no hardware.
const (
	DefaultCardsPath = "/proc/asound/cards"
	DefaultSndDir    = "/dev/snd"
)

// ErrNoDevice reports that no card matched, or that the matching card exposes
// no rawmidi node. This is a normal state, not a failure: the interface is
// frequently unplugged, and a Mac has no /proc/asound at all. Callers must not
// treat it as an error worth shouting about.
var ErrNoDevice = errors.New("no matching MIDI device")

// cardHeader matches the first line of a card entry in /proc/asound/cards.
// The real line is `<space>2 [Sidekick       ]: USB-Audio - EP-136 K.O.
// Sidekick` -- the card number is space-padded, which is why the pattern
// leads with \s* rather than anchoring on the digit.
//
// Continuation lines are indented and carry the long name, which is where the
// full manufacturer and model text lives.
var cardHeader = regexp.MustCompile(`^\s*(\d+)\s+\[([^\]]*)\]:\s*(.*)$`)

// card is one entry of /proc/asound/cards.
type card struct {
	Number int
	ID     string // the bracketed id, truncated and sanitised by ALSA
	Short  string // "USB-Audio - EP-136": driver, then the product string
	Long   string // the indented continuation line(s)
}

// Product is the device's own name: the short name with the driver prefix
// removed. "USB-Audio - EP-136" becomes "EP-136", which is what a DAW track
// should be called. Falls back to the id when the short line has no dash.
func (c card) Product() string {
	if i := strings.Index(c.Short, " - "); i >= 0 {
		if p := strings.TrimSpace(c.Short[i+3:]); p != "" {
			return p
		}
	}
	if s := strings.TrimSpace(c.Short); s != "" {
		return s
	}
	return c.ID
}

// entry is the whole text of the card's entry, for substring matching.
func (c card) entry() string { return c.ID + "\n" + c.Short + "\n" + c.Long }

// readCards parses /proc/asound/cards.
func readCards(cardsPath string) ([]card, error) {
	b, err := os.ReadFile(cardsPath)
	if err != nil {
		return nil, err
	}
	var out []card
	var cur *card
	for _, line := range strings.Split(string(b), "\n") {
		if m := cardHeader.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			out = append(out, card{Number: n, ID: strings.TrimSpace(m[2]), Short: strings.TrimSpace(m[3])})
			cur = &out[len(out)-1]
			continue
		}
		if cur != nil && strings.TrimSpace(line) != "" {
			if cur.Long != "" {
				cur.Long += "\n"
			}
			cur.Long += strings.TrimSpace(line)
		}
	}
	return out, nil
}

// Find returns the path of the rawmidi character device belonging to the first
// card whose /proc/asound/cards entry contains match, case-insensitively.
//
// The whole entry is searched -- both lines -- rather than the bracketed id
// alone. ALSA truncates that id to 15 characters and sanitises it, so the
// EP-136 appears there as "Sidekick" with no model number in it; the string
// DEVICE_MATCH is set to only appears in the short and long names.
func Find(cardsPath, sndDir, match string) (string, error) {
	cards, err := readCards(cardsPath)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrNoDevice, err)
	}
	needle := strings.ToLower(match)
	for _, c := range cards {
		if strings.Contains(strings.ToLower(c.entry()), needle) {
			return rawMIDINode(sndDir, c.Number)
		}
	}
	return "", fmt.Errorf("%w: no card matching %q", ErrNoDevice, match)
}

// rawMIDINode picks the lowest-numbered rawmidi sub-device on a card. The
// EP-136 is hw:2,0,0, so D0 is what this resolves to in practice; taking the
// lowest rather than hardcoding D0 costs nothing and survives a device that
// numbers differently.
func rawMIDINode(sndDir string, card int) (string, error) {
	// The trailing D in the pattern is what stops card 1 matching card 12:
	// "midiC1D*" cannot match "midiC12D0".
	glob := filepath.Join(sndDir, fmt.Sprintf("midiC%dD*", card))
	nodes, err := filepath.Glob(glob)
	if err != nil || len(nodes) == 0 {
		return "", fmt.Errorf("%w: card %d exposes no rawmidi node", ErrNoDevice, card)
	}
	sort.Strings(nodes)
	return nodes[0], nil
}

// Port is one rawmidi node the system exposes right now.
type Port struct {
	Node string // /dev/snd/midiC2D0
	Card int
	Dev  int
	// Name is the device's product string from /proc/asound/cards, or the
	// node's basename when the card table does not know it. It is what a
	// track in the DAW gets called.
	Name string
}

// nodeName parses midiC<card>D<dev>.
var nodeName = regexp.MustCompile(`^midiC(\d+)D(\d+)$`)

// Enumerate lists every rawmidi node under sndDir, named from cardsPath.
//
// A missing sndDir or cards file yields an empty list and no error: a Mac has
// neither, and a Pi with nothing plugged in has the directory and no nodes.
// Both are the normal state.
func Enumerate(cardsPath, sndDir string) []Port {
	matches, _ := filepath.Glob(filepath.Join(sndDir, "midiC*D*"))
	if len(matches) == 0 {
		return nil
	}
	sort.Strings(matches)

	cards, _ := readCards(cardsPath)
	byNum := make(map[int]card, len(cards))
	for _, c := range cards {
		byNum[c.Number] = c
	}

	var out []Port
	for _, node := range matches {
		m := nodeName.FindStringSubmatch(filepath.Base(node))
		if m == nil {
			continue
		}
		cardNo, _ := strconv.Atoi(m[1])
		devNo, _ := strconv.Atoi(m[2])
		p := Port{Node: node, Card: cardNo, Dev: devNo, Name: filepath.Base(node)}
		if c, ok := byNum[cardNo]; ok {
			p.Name = c.Product()
		}
		// A card with more than one rawmidi device gets each one suffixed
		// so the two are distinguishable in a track name.
		if devNo > 0 || hasSibling(matches, cardNo, devNo) {
			p.Name = fmt.Sprintf("%s #%d", p.Name, devNo+1)
		}
		out = append(out, p)
	}
	return out
}

// hasSibling reports whether the card exposes another rawmidi device besides
// dev, so that D0 is only suffixed when a D1 exists to be confused with.
func hasSibling(nodes []string, cardNo, devNo int) bool {
	prefix := fmt.Sprintf("midiC%dD", cardNo)
	for _, n := range nodes {
		b := filepath.Base(n)
		if strings.HasPrefix(b, prefix) && b != fmt.Sprintf("%s%d", prefix, devNo) {
			return true
		}
	}
	return false
}

// Matches reports whether a port matches a substring, case-insensitively,
// against its name or its node path. It is the one matching rule shared by
// the allowlist, the denylist and the clock-device selector, so the three
// cannot disagree about what "EP-136" refers to.
func (p Port) Matches(sub string) bool {
	if sub == "" {
		return false
	}
	s := strings.ToLower(sub)
	return strings.Contains(strings.ToLower(p.Name), s) ||
		strings.Contains(strings.ToLower(p.Node), s)
}
