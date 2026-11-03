//go:build linux && cgo

package audio

/*
#cgo LDFLAGS: -lasound
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>
#include <alsa/asoundlib.h>

// hs_extra_open opens a capture PCM non-blocking and sets it up exactly as
// asked: interleaved S32_LE, the channels and the rate the card has (hw:,
// never plughw:, so nothing converts or resamples), a period near *period
// and a buffer near *buffer frames. It writes back what the card gave, and
// on failure closes the PCM and says which step failed in *stage.
static int hs_extra_open(snd_pcm_t **out, const char *dev, unsigned channels, unsigned rate,
		snd_pcm_uframes_t *period, snd_pcm_uframes_t *buffer, const char **stage) {
	snd_pcm_t *pcm = NULL;
	snd_pcm_hw_params_t *hw = NULL;
	snd_pcm_sw_params_t *sw = NULL;
	int err;

	*stage = "open";
	if ((err = snd_pcm_open(&pcm, dev, SND_PCM_STREAM_CAPTURE, SND_PCM_NONBLOCK)) < 0) return err;

	*stage = "hw params";
	if ((err = snd_pcm_hw_params_malloc(&hw)) < 0) goto fail;
	if ((err = snd_pcm_hw_params_any(pcm, hw)) < 0) goto fail;
	*stage = "resampling off";
	if ((err = snd_pcm_hw_params_set_rate_resample(pcm, hw, 0)) < 0) goto fail;
	*stage = "interleaved access";
	if ((err = snd_pcm_hw_params_set_access(pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED)) < 0) goto fail;
	*stage = "format S32_LE";
	if ((err = snd_pcm_hw_params_set_format(pcm, hw, SND_PCM_FORMAT_S32_LE)) < 0) goto fail;
	*stage = "channels";
	if ((err = snd_pcm_hw_params_set_channels(pcm, hw, channels)) < 0) goto fail;
	*stage = "rate";
	if ((err = snd_pcm_hw_params_set_rate(pcm, hw, rate, 0)) < 0) goto fail;
	*stage = "period size";
	if ((err = snd_pcm_hw_params_set_period_size_near(pcm, hw, period, NULL)) < 0) goto fail;
	*stage = "buffer size";
	if ((err = snd_pcm_hw_params_set_buffer_size_near(pcm, hw, buffer)) < 0) goto fail;
	*stage = "hw params";
	if ((err = snd_pcm_hw_params(pcm, hw)) < 0) goto fail;
	snd_pcm_hw_params_get_period_size(hw, period, NULL);
	snd_pcm_hw_params_get_buffer_size(hw, buffer);

	// Wake for a whole period; start on the first read if snd_pcm_start
	// hasn't already.
	*stage = "sw params";
	if ((err = snd_pcm_sw_params_malloc(&sw)) < 0) goto fail;
	if ((err = snd_pcm_sw_params_current(pcm, sw)) < 0) goto fail;
	if ((err = snd_pcm_sw_params_set_avail_min(pcm, sw, *period)) < 0) goto fail;
	if ((err = snd_pcm_sw_params_set_start_threshold(pcm, sw, 1)) < 0) goto fail;
	if ((err = snd_pcm_sw_params(pcm, sw)) < 0) goto fail;

	*stage = "start";
	if ((err = snd_pcm_start(pcm)) < 0) goto fail;

	snd_pcm_hw_params_free(hw);
	snd_pcm_sw_params_free(sw);
	*out = pcm;
	return 0;

fail:
	if (hw) snd_pcm_hw_params_free(hw);
	if (sw) snd_pcm_sw_params_free(sw);
	snd_pcm_close(pcm);
	return err;
}

// hs_extra_read reads up to frames frames into buf, at offset frames in.
static long hs_extra_read(snd_pcm_t *pcm, int32_t *buf, unsigned channels, unsigned long offset, unsigned long frames) {
	return (long)snd_pcm_readi(pcm, buf + offset*channels, frames);
}

// hs_extra_recover brings the PCM back after an overrun (-EPIPE) or a
// suspend (-ESTRPIPE), and starts it again.
static int hs_extra_recover(snd_pcm_t *pcm, int err) {
	if (err == -ESTRPIPE) {
		while ((err = snd_pcm_resume(pcm)) == -EAGAIN) usleep(10000);
		if (err == 0) return 0;
	}
	if ((err = snd_pcm_prepare(pcm)) < 0) return err;
	return snd_pcm_start(pcm);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// alsaWaitMS is how long the reader waits for a period before looking at
// whether Close wants it to stop: the most Close can take.
const alsaWaitMS = 100

// alsaExtra is an extra input opened on libasound directly, outside
// PortAudio (docs/plan/extra-inputs.md, decision 1). PortAudio can only see
// a replugged card after a rescan, and a rescan closes the main interface's
// stream too; an ALSA open by the card's id just works again once the card
// is back.
type alsaExtra struct {
	match      string
	channels   int
	rate       int
	period     int
	latency    time.Duration
	overflows  atomic.Uint64
	latencyNS  atomic.Int64
	mu         sync.Mutex
	pcm        *C.snd_pcm_t
	stop, done chan struct{}
}

// NewExtraSource opens the card matching match (its ALSA id, USB id or name:
// findALSACard) at exactly channels and rate, delivering blocks of about
// framesPerPeriod frames, with about latency of buffer behind them.
func NewExtraSource(match string, channels, rate, framesPerPeriod int, latency time.Duration) ExtraSource {
	return &alsaExtra{match: match, channels: channels, rate: rate, period: framesPerPeriod, latency: latency}
}

func (s *alsaExtra) Open(sink func(block []int32)) (string, error) {
	if s.channels <= 0 || s.rate <= 0 || s.period <= 0 {
		return "", fmt.Errorf("extra input %q: %d channels at %d Hz in periods of %d frames", s.match, s.channels, s.rate, s.period)
	}
	s.Close() // an Open over an open stream starts it again, never leaks it
	card, err := findCard("/proc/asound", s.match)
	if err != nil {
		return "", err
	}
	dev := "hw:CARD=" + card.id + ",0"

	// The buffer is latency's worth of frames, and never under 4 periods:
	// it is the slack while this goroutine isn't scheduled.
	period := C.snd_pcm_uframes_t(s.period)
	buffer := C.snd_pcm_uframes_t(int64(s.latency) * int64(s.rate) / int64(time.Second))
	if buffer < 4*period {
		buffer = 4 * period
	}
	cdev := C.CString(dev)
	defer C.free(unsafe.Pointer(cdev))
	var pcm *C.snd_pcm_t
	var stage *C.char
	if rc := C.hs_extra_open(&pcm, cdev, C.uint(s.channels), C.uint(s.rate), &period, &buffer, &stage); rc < 0 {
		err := fmt.Errorf("%s %s: %s", dev, C.GoString(stage), alsaErr(rc))
		// Gone between the look in /proc/asound and the open: still a card
		// that isn't there, so the supervisor waits for it.
		if rc == -C.ENODEV || rc == -C.ENOENT {
			err = fmt.Errorf("%w: %v", ErrNoDevice, err)
		}
		return "", err
	}

	// Approximate, in PortAudio's way for an ALSA input (the buffer less a
	// period), so the main interface's latency and this one are reckoned
	// alike; what is left between the two is EXTRA_INPUT_OFFSET_MS's.
	s.latencyNS.Store(int64(buffer-period) * int64(time.Second) / int64(s.rate))

	s.mu.Lock()
	s.pcm = pcm
	s.stop, s.done = make(chan struct{}), make(chan struct{})
	go s.read(pcm, int(period), dev, sink, s.stop, s.done)
	s.mu.Unlock()

	name := card.short
	if name == "" {
		name = card.id
	}
	return fmt.Sprintf("%s (%s)", name, dev), nil
}

// read delivers whole periods until stop closes or the card fails.
//
// The PCM is non-blocking and the wait has a timeout, so this goroutine is
// the only one that ever touches the PCM while it runs, and Close needs no
// call into alsa-lib from another thread to wake it: it closes stop and the
// next wait, at most alsaWaitMS later, sees it. (The other way, a blocking
// readi woken by snd_pcm_drop from Close, leans on alsa-lib and the kernel
// tolerating two threads in one PCM at once.)
//
// The samples land in C memory, so no Go pointer ever reaches C, and are
// copied into one Go slice that is handed to sink every time: nothing is
// allocated per block.
func (s *alsaExtra) read(pcm *C.snd_pcm_t, period int, dev string, sink func([]int32), stop, done chan struct{}) {
	defer close(done)
	n := period * s.channels
	cbuf := C.malloc(C.size_t(n) * C.size_t(unsafe.Sizeof(int32(0))))
	defer C.free(cbuf)
	samples := unsafe.Slice((*int32)(cbuf), n)
	block := make([]int32, n)

	fail := func(what string, rc C.long) {
		log.Printf("[!] extra input %s: %s: %s; waiting to reopen", dev, what, alsaErr(C.int(rc)))
	}
	filled := 0
	for {
		select {
		case <-stop:
			return
		default:
		}
		got := C.long(C.snd_pcm_wait(pcm, alsaWaitMS))
		if got == 0 {
			continue // no period yet; look at stop again
		}
		if got > 0 {
			got = C.hs_extra_read(pcm, (*C.int32_t)(cbuf), C.uint(s.channels), C.ulong(filled), C.ulong(period-filled))
		}
		switch {
		case got > 0:
			filled += int(got)
			if filled == period {
				copy(block, samples)
				sink(block)
				filled = 0
			}
		case got == -C.EAGAIN:
		case got == -C.EPIPE || got == -C.ESTRPIPE:
			// An overrun: frames were lost before we read them. The ones
			// already in this period are good, so they are kept and the
			// count tells the capture the stream skipped.
			if got == -C.EPIPE {
				s.overflows.Add(1)
			}
			if rc := C.hs_extra_recover(pcm, C.int(got)); rc < 0 {
				fail("recovering", C.long(rc))
				return
			}
		default:
			// -ENODEV, -EIO, anything else: the card is gone or broken. Stop
			// delivering; the supervisor sees no blocks, closes and reopens.
			fail("reading", got)
			return
		}
	}
}

func (s *alsaExtra) Close() {
	s.mu.Lock()
	pcm, stop, done := s.pcm, s.stop, s.done
	s.pcm, s.stop, s.done = nil, nil, nil
	s.mu.Unlock()
	if pcm == nil {
		return
	}
	close(stop)
	<-done // the reader is out of the PCM before it is freed
	C.snd_pcm_close(pcm)
}

func (s *alsaExtra) Overflows() uint64 { return s.overflows.Load() }

func (s *alsaExtra) InputLatency() time.Duration { return time.Duration(s.latencyNS.Load()) }

func alsaErr(rc C.int) error {
	return errors.New(C.GoString(C.snd_strerror(rc)))
}
