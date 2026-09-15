// Package mono is the one clock every timestamp that has to line up against
// audio is taken from.
//
// It is a nanosecond count on Go's monotonic reading of time.Now(), measured
// from process start. Wall-clock time is never used for alignment: an NTP step
// mid-jam would move every MIDI event against the audio by the size of the
// step, and the Pi's clock is disciplined by exactly that.
//
// It lives in its own package because both internal/audio and internal/midi
// stamp with it, and audio must not import midi.
package mono

import "time"

// epoch is process start. Every value this package returns is relative to it,
// so a value is meaningful only within one run of the binary -- which is why
// the manifest records the window's start in these units rather than a wall
// time: it is an anchor for other values in the same bundle, not a date.
var epoch = time.Now()

// Now is the current monotonic nanosecond count.
func Now() int64 { return int64(time.Since(epoch)) }

// Of converts a time.Time carrying a monotonic reading into the same count.
// A time.Time that has lost its monotonic reading (round-tripped through a
// string, say) falls back to wall-clock arithmetic, which is the caller's
// problem to avoid; every producer in this codebase stamps with time.Now()
// directly.
func Of(t time.Time) int64 { return int64(t.Sub(epoch)) }

// Time converts back, for callers that want to hand a wall-clock interval to
// code that still speaks time.Time (the BPM estimator does).
func Time(ns int64) time.Time { return epoch.Add(time.Duration(ns)) }
