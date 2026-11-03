package audio

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ExtraSource is an extra input's stream (EXTRA_INPUTS): a second interface
// that only records, on its own clock. It delivers interleaved int32 blocks
// of its own channels, from one goroutine, until Close.
//
// The block handed to sink is reused for the next one, as PortAudio's is:
// sink copies what it keeps, and doesn't block.
type ExtraSource interface {
	// Open finds the card and starts delivering. A card that isn't there is
	// ErrNoDevice, so the supervisor waits rather than fails.
	Open(sink func(block []int32)) (name string, err error)
	// Close stops delivery; sink is not called after it returns. Safe to call
	// twice, or after a failed Open.
	Close()
	// Overflows counts the overruns the device reported: frames lost before
	// they reached sink.
	Overflows() uint64
	// InputLatency is the delay between a frame being converted and the
	// block holding it reaching sink, for placing it in time.
	InputLatency() time.Duration
}

// alsaCard is one sound card as /proc/asound describes it.
type alsaCard struct {
	num   int
	id    string // cardN/id: "AMS24", what hw:CARD= takes
	usbid string // cardN/usbid: "1686:067f"; empty for a card that isn't USB
	short string // the name after the driver in cards: "AMS-24"
	long  string // the cards entry's two lines, for matching
}

// findALSACard returns the ALSA id of the first card (by number) whose id,
// USB id or name in root/cards holds match, ignoring case. The extra input
// is found this way rather than through PortAudio because PortAudio's list
// is frozen at start-up: reading /proc/asound again sees a replugged card.
func findALSACard(root, match string) (id string, err error) {
	c, err := findCard(root, match)
	if err != nil {
		return "", err
	}
	return c.id, nil
}

func findCard(root, match string) (alsaCard, error) {
	if strings.TrimSpace(match) == "" {
		return alsaCard{}, fmt.Errorf("%w: no card to look for", ErrNoDevice)
	}
	cards, err := alsaCards(root)
	if err != nil {
		return alsaCard{}, fmt.Errorf("%w: %v", ErrNoDevice, err)
	}
	for _, c := range cards {
		for _, field := range []string{c.id, c.usbid, c.long} {
			if field != "" && cardMatches(field, match) {
				return c, nil
			}
		}
	}
	return alsaCard{}, fmt.Errorf("%w: no sound card matching %q (is it unplugged?)", ErrNoDevice, match)
}

// cardMatches is a case-blind substring test, tried again with hyphens and
// spaces taken out of both, so "AMS-24" finds the card ALSA calls "AMS24".
func cardMatches(field, match string) bool {
	f, m := strings.ToLower(field), strings.ToLower(match)
	if strings.Contains(f, m) {
		return true
	}
	squash := strings.NewReplacer("-", "", " ", "")
	m = squash.Replace(m)
	return m != "" && strings.Contains(squash.Replace(f), m)
}

// alsaCards reads every cardN directory under root, in card order. A card
// whose id can't be read (unplugged as we looked) is skipped.
func alsaCards(root string) ([]alsaCard, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	names := cardNames(filepath.Join(root, "cards"))

	var cards []alsaCard
	for _, e := range entries {
		// root also holds a link per card named by its id; take only cardN.
		n, ok := strings.CutPrefix(e.Name(), "card")
		if !ok {
			continue
		}
		num, err := strconv.Atoi(n)
		if err != nil {
			continue
		}
		dir := filepath.Join(root, e.Name())
		id := readTrim(filepath.Join(dir, "id"))
		if id == "" {
			continue
		}
		c := names[num]
		c.num, c.id, c.usbid = num, id, readTrim(filepath.Join(dir, "usbid"))
		cards = append(cards, c)
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].num < cards[j].num })
	return cards, nil
}

// cardNames parses /proc/asound/cards, two lines a card:
//
//	3 [AMS24          ]: USB-Audio - AMS-24
//	                     ZOOM Corporation AMS-24 at usb-xhci-hcd.1-1, high speed
//
// A missing file is no names, not an error: the ids still match.
func cardNames(path string) map[int]alsaCard {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	out := map[int]alsaCard{}
	last := -1
	for _, line := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		num, rest, ok := strings.Cut(t, " ")
		if n, err := strconv.Atoi(num); err == nil && ok && strings.HasPrefix(strings.TrimSpace(rest), "[") {
			c := alsaCard{long: t}
			if _, after, ok := strings.Cut(rest, "]:"); ok {
				// "USB-Audio - AMS-24": the driver, then the card's name.
				after = strings.TrimSpace(after)
				if _, name, ok := strings.Cut(after, " - "); ok {
					after = name
				}
				c.short = strings.TrimSpace(after)
			}
			out[n], last = c, n
			continue
		}
		if last >= 0 {
			c := out[last]
			c.long += "\n" + t
			out[last] = c
		}
	}
	return out
}

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
