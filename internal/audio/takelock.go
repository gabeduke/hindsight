package audio

import (
	"path/filepath"
	"sync"
)

// takeLocks holds one mutex per take, keyed by the take's cleaned WAV path.
//
// Several writers touch a take's sidecar after it exists: the PATCH handler,
// the flag endpoints, the saver's tempo and flag stamps, the MIDI exporter's
// downbeat, a cut's MIDI. Each is a read-modify-write of one JSON file. Two
// at once used to mean the second write silently discarded the first's change
// -- a flag added from the phone vanishing because the tablet saved a
// selection a moment later. The lock makes each read-modify-write atomic, and
// it also covers the cue-chunk rewrite that mirrors the flags into the WAV, so
// two of those never interleave either.
//
// Entries are never removed. A Pi holds hundreds of takes, not millions, and a
// mutex is a few bytes; removing one safely would need reference counting for
// no real gain.
var takeLocks sync.Map

// LockTake locks a take for a read-modify-write of its sidecar (and cue
// chunk) and returns the unlock. Callers must not call it again for the same
// take before unlocking: it is not reentrant.
func LockTake(wav string) (unlock func()) {
	v, _ := takeLocks.LoadOrStore(filepath.Clean(wav), &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// UpdateMeta is the locked read-modify-write every sidecar writer outside the
// API uses: read the sidecar, let fn change it, write it back. An error from
// fn aborts without writing. It returns the sidecar as written, normalised the
// same way WriteMeta normalises it.
func UpdateMeta(wav string, fn func(m *Meta) error) (Meta, error) {
	unlock := LockTake(wav)
	defer unlock()
	return updateMetaLocked(wav, fn)
}

// updateMetaLocked is UpdateMeta for a caller already holding the take's lock.
func updateMetaLocked(wav string, fn func(m *Meta) error) (Meta, error) {
	m := ReadMeta(wav)
	if err := fn(&m); err != nil {
		return m, err
	}
	m.Flags = EnsureFlagIDs(NormalizeFlags(m.Flags))
	if err := WriteMeta(wav, m); err != nil {
		return m, err
	}
	return m, nil
}
