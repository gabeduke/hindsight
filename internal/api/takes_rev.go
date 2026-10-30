package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/tape"
)

// takesRev is the take library's revision: a number that moves whenever
// what /api/jams lists moves (docs/architecture/push.md, *The takes'
// revision*). It goes out on /api/tapes/changes as takes_rev, beside the
// tape's rev, and a page that hears a new one asks /api/jams again: a
// nudge, not the list, as the tape's is (decision 0013).
//
// It is not bumped by each writer. A take is written by a save, a cut, a
// phone, the preview encoder, the MIDI exporter, the trash, the pruner, the
// keyboard's KEEP and every edit, some of them on goroutines of their own,
// and a list of Bump calls is a list that misses the next one. It watches
// the list instead: the list's ETag (audio.TakeList.ETag), one directory
// listing and an lstat an entry, opening no file, is what /api/jams answers
// 304 by, so a change to it is a change the page would see. It is checked
//
//   - at once after a request that writes (any method but GET and HEAD:
//     a save, a delete, a restore, a rename, a star, a tag, a flag, an
//     undo), so the page that asked and every other one hear it in the
//     time a listing takes;
//   - every takesScan while a changes socket is open, for the writers no
//     request is waiting on (the keyboard's KEEP, a phone's take finishing,
//     a preview landing, the pruner and the trash's janitor);
//   - by each GET /api/jams, which has just worked it out anyway.
//
// With no changes socket open nothing scans: a Pi nobody is looking at
// lists nothing.
type takesRev struct {
	etag  func() (string, error)
	every time.Duration // takesScan; tests shorten it

	changes tape.Changes

	mu      sync.Mutex
	last    string // the ETag the revision was last moved for; "" before the first scan
	holders int
	stop    chan struct{}
	poke    chan struct{}
}

// takesScan is how often an open changes socket has the list checked for a
// writer no request waited on.
const takesScan = time.Second

func newTakesRev(etag func() (string, error)) *takesRev {
	return &takesRev{etag: etag, every: takesScan, poke: make(chan struct{}, 1)}
}

// Rev is the revision now.
func (t *takesRev) Rev() uint64 { return t.changes.Rev() }

// Subscribe is tape.Changes's: a tap after each move, and a cancel.
func (t *takesRev) Subscribe() (<-chan struct{}, func()) { return t.changes.Subscribe() }

// saw is told the list's ETag as it is now, and moves the revision if it
// isn't the one last seen. The first ETag seen is where it starts, not a
// change.
func (t *takesRev) saw(etag string) {
	t.mu.Lock()
	moved := t.last != "" && etag != t.last
	t.last = etag
	t.mu.Unlock()
	if moved {
		t.changes.Bump()
	}
}

// check lists the directory once and says what it saw. A listing that
// fails says nothing: the next one will.
func (t *takesRev) check() {
	if etag, err := t.etag(); err == nil {
		t.saw(etag)
	}
}

// hold keeps the scan running until the answer is called: a changes socket
// holds it while it is open. The first holder starts it, with a check, so a
// change made while nobody watched is a move as the first socket opens.
func (t *takesRev) hold() func() {
	t.mu.Lock()
	t.holders++
	if t.holders == 1 {
		t.stop = make(chan struct{})
		go t.run(t.stop)
	}
	t.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			t.mu.Lock()
			t.holders--
			if t.holders == 0 {
				close(t.stop)
			}
			t.mu.Unlock()
		})
	}
}

// Poke asks for a check now. It never blocks; with nobody holding the scan
// it does nothing, and the first socket to open checks anyway.
func (t *takesRev) Poke() {
	select {
	case t.poke <- struct{}{}:
	default:
	}
}

func (t *takesRev) run(stop chan struct{}) {
	t.check()
	tick := time.NewTicker(t.every)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.poke:
			t.check()
		case <-tick.C:
			t.check()
		}
	}
}

// pokeTakesAfterWrites has the takes' revision checked after every request
// that could have written a take, the moment its handler returns.
func (a *API) pokeTakesAfterWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			a.takesRev.Poke()
		}
	})
}
