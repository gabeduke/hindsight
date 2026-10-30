package api

import (
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// readTakesMove reads the socket until a message's takes_rev moves past
// from, and answers it, failing if none does within `within`.
func readTakesMove(t *testing.T, c *websocket.Conn, from uint64, within time.Duration) changesMsg {
	t.Helper()
	until := time.Now().Add(within)
	for {
		left := time.Until(until)
		if left <= 0 {
			t.Fatalf("takes_rev stayed %d for %v", from, within)
		}
		m := readChanges(t, c, left)
		if m.TakesRev != from {
			return m
		}
	}
}

// Every way a person changes the take list through the API moves takes_rev
// on an open socket at once, well inside the scan's second: a save's file
// appearing (as the trigger writes it), a rename, a star, a delete and a
// restore. The page then asks /api/jams, as the tape's nudge has it ask
// /api/tapes/state.
func TestTheTakesRevisionMovesTheMomentAWriteChangesTheList(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	a.takesRev.every = time.Hour // only the pokes can move it in time
	dir := a.cfg.OutputDir
	writeRealTake(t, dir, "jam_a.wav", 4800)
	c := dialChanges(t, r)
	hello := readChanges(t, c, time.Second)
	rev := hello.TakesRev

	step := func(what string, do func()) {
		t.Helper()
		start := time.Now()
		do()
		m := readTakesMove(t, c, rev, 300*time.Millisecond)
		if m.TakesRev <= rev {
			t.Fatalf("%s: takes_rev %d, was %d", what, m.TakesRev, rev)
		}
		if took := time.Since(start); took > 300*time.Millisecond {
			t.Fatalf("%s: the nudge took %v", what, took)
		}
		rev = m.TakesRev
	}
	step("rename", func() {
		want(t, patch(t, r, "jam_a.wav", `{"label":"Pushed"}`), http.StatusOK, "rename")
	})
	step("star", func() {
		want(t, patch(t, r, "jam_a.wav", `{"starred":true}`), http.StatusOK, "star")
	})
	step("delete", func() {
		want(t, send(t, r, http.MethodDelete, "/api/delete?file=jam_a.wav", ""), http.StatusOK, "delete")
	})
	step("restore", func() {
		want(t, send(t, r, http.MethodPost, "/api/trash/restore?file=jam_a.wav", ""), http.StatusOK, "restore")
	})
}

// A take written with no request waiting on it (the keyboard's KEEP, a
// phone's take finishing, a preview landing, the pruner) moves takes_rev
// within the scan, and a write that leaves the list as it was (a file the
// list doesn't show) doesn't.
func TestTheTakesRevisionCatchesAWriterNoRequestWaitedOn(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	a.takesRev.every = 50 * time.Millisecond
	dir := a.cfg.OutputDir
	writeRealTake(t, dir, "jam_a.wav", 4800)
	c := dialChanges(t, r)
	rev := readChanges(t, c, time.Second).TakesRev
	time.Sleep(150 * time.Millisecond) // the first scan sets where it starts

	writeTake(t, dir, ".jam_b.wav.part") // a save under way: not listed
	time.Sleep(200 * time.Millisecond)
	if got := a.takesRev.Rev(); got != rev {
		t.Fatalf("a .part moved takes_rev %d → %d", rev, got)
	}

	writeRealTake(t, dir, "jam_b.wav", 4800)
	m := readTakesMove(t, c, rev, time.Second)
	if m.TakesRev <= rev {
		t.Fatalf("takes_rev %d after a take appeared, was %d", m.TakesRev, rev)
	}
}

// With no changes socket open nothing lists the folder: a Pi nobody is
// looking at does no work for the revision. The first socket to open
// checks at once, and a change made while nobody watched is a move then.
func TestTheTakesRevisionScansOnlyWhileASocketIsOpen(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	dir := a.cfg.OutputDir
	var scans atomic.Int32
	list := a.takesRev.etag
	a.takesRev.etag = func() (string, error) { scans.Add(1); return list() }
	a.takesRev.every = 20 * time.Millisecond

	want(t, send(t, r, http.MethodPost, "/api/tapes", `{"name":"x"}`), http.StatusOK, "a write")
	time.Sleep(100 * time.Millisecond)
	if n := scans.Load(); n != 0 {
		t.Fatalf("%d scans with no socket open", n)
	}

	c := dialChanges(t, r)
	rev := readChanges(t, c, time.Second).TakesRev
	time.Sleep(100 * time.Millisecond)
	if scans.Load() == 0 {
		t.Fatal("an open socket scanned nothing")
	}
	c.Close()
	time.Sleep(100 * time.Millisecond) // the handler sees the close and lets go
	writeRealTake(t, dir, "jam_quiet.wav", 4800)
	n := scans.Load()
	time.Sleep(100 * time.Millisecond)
	if scans.Load() != n {
		t.Fatal("still scanning after the socket closed")
	}

	c2 := dialChanges(t, r)
	readTakesMove(t, c2, rev, time.Second)
}

// saw starts from the first ETag it is told, and moves only on a new one.
func TestTakesRevSawStartsFromTheFirstETag(t *testing.T) {
	tr := newTakesRev(func() (string, error) { return "", nil })
	tr.saw("a")
	if tr.Rev() != 0 {
		t.Fatalf("the first ETag moved it to %d", tr.Rev())
	}
	tr.saw("a")
	tr.saw("b")
	tr.saw("b")
	if tr.Rev() != 1 {
		t.Fatalf("rev %d, want 1", tr.Rev())
	}
}

// GET /api/jams has just listed the folder, so it says what it saw, with no
// socket open and no scan running.
func TestListingTheTakesFeedsTheRevision(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	get := func() { want(t, send(t, r, http.MethodGet, "/api/jams", ""), http.StatusOK, "list") }
	get()
	writeRealTake(t, a.cfg.OutputDir, "jam_a.wav", 4800)
	get()
	if a.takesRev.Rev() != 1 {
		t.Fatalf("takes_rev %d after a listing saw a new take, want 1", a.takesRev.Rev())
	}
}
