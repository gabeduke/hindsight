package audio

import (
	"fmt"
	"sync"
)

// paLifecycle owns PortAudio's process-global initialise/terminate pair, and
// every stream open on it.
//
// PortAudio enumerates devices exactly once, inside Pa_Initialize, and never
// rescans. An interface that is powered off therefore stays in the device list
// forever, pointing at an ALSA card index that no longer exists, and every
// open attempt fails with "Illegal combination of I/O devices". Terminating
// and initialising again is the only way to see hardware that appeared or
// disappeared after start-up, which is what Rescan is for.
//
// The library is process-global, so the capture and the tape's output share
// one lifecycle. Pa_Terminate closes every stream underneath its owner, which
// would leave the owner a dangling pointer to close a second time, so a
// stream is opened through Open, which registers how to close it, and
// Terminate closes every registered stream first. Each terminate starts a
// new generation: an owner that sees the generation move knows its stream is
// gone and opens a new one.
type paLifecycle struct {
	mu     sync.Mutex
	up     bool
	gen    uint64
	initFn func() error
	termFn func() error

	streams map[int]func() // how to close each open stream
	next    int
}

func newPALifecycle(initFn, termFn func() error) *paLifecycle {
	return &paLifecycle{initFn: initFn, termFn: termFn, streams: map[int]func(){}}
}

// Init brings PortAudio up. Calling it when it is already up is a no-op, so no
// caller has to track state to stay safe.
func (p *paLifecycle) Init() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.initLocked()
}

func (p *paLifecycle) initLocked() error {
	if p.up {
		return nil
	}
	if err := p.initFn(); err != nil {
		// Deliberately stay "down" so the next attempt really retries.
		return fmt.Errorf("portaudio init: %w", err)
	}
	p.up = true
	return nil
}

// Term takes PortAudio down, closing every stream still open on it first.
// Terminating twice is a double free in the C library, so a second call is
// deliberately a no-op.
func (p *paLifecycle) Term() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.termLocked()
}

func (p *paLifecycle) termLocked() error {
	for h, closeFn := range p.streams {
		delete(p.streams, h)
		closeFn()
	}
	if !p.up {
		return nil
	}
	// Marked down before the call: if Pa_Terminate fails there is nothing
	// useful to do with a half-torn-down library except initialise it again,
	// and latching "up" would block exactly that.
	p.up = false
	p.gen++
	if err := p.termFn(); err != nil {
		return fmt.Errorf("portaudio terminate: %w", err)
	}
	return nil
}

// Rescan forces PortAudio to re-enumerate devices, which is what picks up an
// interface that was unplugged or power-cycled while the process was running.
// Any stream still open is closed first; its owner sees the generation move.
func (p *paLifecycle) Rescan() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.termLocked(); err != nil {
		return err
	}
	return p.initLocked()
}

// Open brings PortAudio up if it isn't, then runs open -- which picks a
// device and opens and starts a stream -- with no rescan able to run in the
// middle of it. On success the stream's close function is registered, and
// Open answers a handle for Close and the generation the stream belongs to.
func (p *paLifecycle) Open(open func() (closeFn func(), err error)) (handle int, gen uint64, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.initLocked(); err != nil {
		return 0, 0, err
	}
	closeFn, err := open()
	if err != nil {
		return 0, 0, err
	}
	p.next++
	p.streams[p.next] = closeFn
	return p.next, p.gen, nil
}

// Close closes a stream Open registered, unless a terminate already did. It
// is safe to call twice, and with a handle of 0.
func (p *paLifecycle) Close(handle int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if closeFn, ok := p.streams[handle]; ok {
		delete(p.streams, handle)
		closeFn()
	}
}

// Gen is the current generation: it moves on every terminate.
func (p *paLifecycle) Gen() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.gen
}

// Do runs f with PortAudio up and no rescan able to run meanwhile: for
// enumerating devices.
func (p *paLifecycle) Do(f func() error) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.initLocked(); err != nil {
		return err
	}
	return f()
}
