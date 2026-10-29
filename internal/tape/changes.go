package tape

import (
	"sync"
	"sync/atomic"
)

// Changes is the engine's revision: a number that moves whenever what
// /api/tapes/state shows moves, apart from the playhead and the device's
// counts, which move all the time (docs/plan/pushing-tape-state.md). A
// page that is told of a new revision polls at once, instead of waiting
// for its next poll.
//
// Bump is called on the render goroutine, so it takes no lock and never
// blocks: it moves the number and taps each subscriber's channel, which
// holds one tap. A subscriber that hasn't read its last tap misses nothing
// by missing the next: it reads Rev when it wakes, and that is the newest.
type Changes struct {
	rev  atomic.Uint64
	subs atomic.Pointer[[]chan struct{}]
	mu   sync.Mutex // Subscribe's and cancel's, so two never lose each other's
}

// Bump says something changed.
func (c *Changes) Bump() {
	c.rev.Add(1)
	if p := c.subs.Load(); p != nil {
		for _, ch := range *p {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	}
}

// Rev is the revision now.
func (c *Changes) Rev() uint64 { return c.rev.Load() }

// Subscribe returns a channel tapped after each Bump, and a cancel that
// stops the taps. The channel is never closed: a Bump racing the cancel
// could otherwise send on a closed channel.
func (c *Changes) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	c.mu.Lock()
	var next []chan struct{}
	if p := c.subs.Load(); p != nil {
		next = append(next, *p...)
	}
	next = append(next, ch)
	c.subs.Store(&next)
	c.mu.Unlock()
	return ch, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		p := c.subs.Load()
		if p == nil {
			return
		}
		next := make([]chan struct{}, 0, len(*p))
		for _, s := range *p {
			if s != ch {
				next = append(next, s)
			}
		}
		c.subs.Store(&next)
	}
}
