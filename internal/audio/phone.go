package audio

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// A phone recording: audio streamed from a phone's browser, written into a
// take as it arrives.
//
// The phone sends numbered chunks of interleaved stereo float32 at its own
// sample rate. They are written in order -- a chunk that arrives early, after
// a reconnect, waits for the ones before it -- resampled to 48 kHz if need
// be, and appended as 32-bit PCM to the take's hidden .part file, so the take
// is on the Pi as it is played, not only on the phone. The peaks pyramid
// grows alongside. Finishing patches the WAV header, writes the sidecars and
// renames the WAV into place, as a save does.
//
// A marker file beside the .part (.<stem>.phone.json) records the rate and
// start time, so a recording cut short by a restart is recovered at startup
// as a partial take rather than swept away.

const (
	// PhoneRate and PhoneChannels are what every phone take is stored as:
	// the rate every take has, and stereo (mono is sent as dual mono), so
	// previews, peaks, cuts and shares work on it unchanged.
	PhoneRate     = 48000
	PhoneChannels = 2

	// PhoneLabel is a phone take's label; a recording that never got its
	// Stop gets PhoneLabel + " (partial)".
	PhoneLabel = "Phone"

	// PhoneMaxSeconds caps a recording below the 4.29 GB a WAV header can
	// describe: three hours of 48 kHz stereo 32-bit is 4.15 GB. The
	// recording finishes itself there.
	PhoneMaxSeconds = 3 * 60 * 60

	// phoneMaxEarly bounds how many chunks may wait for an earlier one.
	phoneMaxEarly = 256
)

// ErrPhoneTooLong reports a recording that reached PhoneMaxSeconds.
var ErrPhoneTooLong = errors.New("recording reached its maximum length")

// ErrPhoneFinished reports audio sent to a recording that has ended.
var ErrPhoneFinished = errors.New("recording is finished")

type phoneMarker struct {
	Rate    int       `json:"rate"`
	Started time.Time `json:"started"`
}

func phoneMarkerPath(wav string) string {
	return filepath.Join(filepath.Dir(wav), "."+strings.TrimSuffix(filepath.Base(wav), ".wav")+".phone.json")
}

// PhoneTake is one recording in progress. Its methods are safe to call from
// several goroutines.
type PhoneTake struct {
	mu sync.Mutex

	dir, name, wav, part string
	started              time.Time
	srcRate              int

	f      *os.File
	bw     *bufio.Writer
	rs     *resampler // nil when the phone runs at PhoneRate
	pyr    *pyramidAcc
	frames int64 // output frames written

	next  uint32               // the next chunk to write
	early map[uint32][]float32 // chunks that arrived before an earlier one
	done  bool
	err   error // a write failure; the take stops accepting audio
	raw   [8]byte
}

// StartPhoneTake reserves a take name for a recording that starts now and
// opens its .part file. rate is the phone's sample rate.
func StartPhoneTake(dir string, rate int, started time.Time) (*PhoneTake, error) {
	if rate < 8000 || rate > 192000 {
		return nil, fmt.Errorf("unsupported sample rate %d", rate)
	}
	name, wav, err := freeTakeName(dir, started)
	if err != nil {
		return nil, err
	}
	part := PartPath(wav)
	f, err := os.OpenFile(part, os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		os.Remove(part)
		return nil, err
	}
	t := &PhoneTake{
		dir: dir, name: name, wav: wav, part: part,
		started: started, srcRate: rate,
		f: f, bw: bufio.NewWriterSize(f, 1<<16),
		pyr:   newPyramidAcc(PhoneChannels, 0),
		early: map[uint32][]float32{},
	}
	if rate != PhoneRate {
		t.rs = newResampler(rate, PhoneRate, PhoneChannels)
	}
	// The data size is patched in at the end; a crash leaves it zero, and
	// recovery reads the length from the file instead.
	if err := writeWAVHeader(t.bw, 0, PhoneChannels, PhoneRate, 32); err != nil {
		t.abort()
		return nil, err
	}
	b, _ := json.Marshal(phoneMarker{Rate: rate, Started: started})
	if err := os.WriteFile(phoneMarkerPath(wav), b, 0o644); err != nil {
		t.abort()
		return nil, err
	}
	return t, nil
}

// Name is the take's filename once it is finished.
func (t *PhoneTake) Name() string { return t.name }

// Next is the number of the next chunk the take is waiting for: every chunk
// before it is written.
func (t *PhoneTake) Next() uint32 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.next
}

// Seconds is how much audio has been written.
func (t *PhoneTake) Seconds() float64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return float64(t.frames) / PhoneRate
}

// Write takes chunk seq: interleaved stereo float32 at the phone's rate. A
// chunk already written is ignored; one that arrives early waits for those
// before it. It returns the next chunk the take is waiting for.
func (t *PhoneTake) Write(seq uint32, samples []float32) (uint32, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return t.next, ErrPhoneFinished
	}
	if t.err != nil {
		return t.next, t.err
	}
	if len(samples)%PhoneChannels != 0 {
		return t.next, errors.New("a chunk must hold whole stereo frames")
	}
	switch {
	case seq < t.next:
		return t.next, nil // a resend of something already written
	case seq > t.next:
		if len(t.early) >= phoneMaxEarly {
			return t.next, errors.New("too many chunks ahead of a missing one")
		}
		if _, ok := t.early[seq]; !ok {
			t.early[seq] = append([]float32(nil), samples...)
		}
		return t.next, nil
	}
	if err := t.append(samples); err != nil {
		return t.next, err
	}
	t.next++
	for {
		s, ok := t.early[t.next]
		if !ok {
			break
		}
		delete(t.early, t.next)
		if err := t.append(s); err != nil {
			return t.next, err
		}
		t.next++
	}
	return t.next, nil
}

// append converts, resamples and writes one chunk. The caller holds mu.
func (t *PhoneTake) append(samples []float32) error {
	out := samples
	if t.rs != nil {
		out = t.rs.Process(samples)
	}
	return t.writeFrames(out)
}

func (t *PhoneTake) writeFrames(out []float32) error {
	n := int64(len(out) / PhoneChannels)
	if t.frames+n > PhoneMaxSeconds*PhoneRate {
		t.err = ErrPhoneTooLong
		return t.err
	}
	t.pyr.grow(t.frames + n)
	for i := int64(0); i < n; i++ {
		for c := 0; c < PhoneChannels; c++ {
			v := floatToPCM32(out[i*PhoneChannels+int64(c)])
			binary.LittleEndian.PutUint32(t.raw[:4], uint32(v))
			if _, err := t.bw.Write(t.raw[:4]); err != nil {
				t.err = err
				return err
			}
			t.pyr.add(c, t.frames+i, v)
		}
	}
	t.frames += n
	return nil
}

// floatToPCM32 maps a [-1, 1] float sample onto int32, clipping outside it.
func floatToPCM32(v float32) int32 {
	x := math.Round(float64(v) * 2147483648)
	if x > math.MaxInt32 {
		return math.MaxInt32
	}
	if x < math.MinInt32 {
		return math.MinInt32
	}
	return int32(x)
}

// Finish writes what has arrived as a finished take and returns its name.
// partial marks a recording that never got its Stop. A recording with no
// audio at all is discarded, and Finish returns "".
func (t *PhoneTake) Finish(partial bool) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return t.name, nil
	}
	t.done = true
	if t.rs != nil && t.err == nil {
		if err := t.writeFrames(t.rs.Flush()); err != nil && !errors.Is(err, ErrPhoneTooLong) {
			t.abortLocked()
			return "", err
		}
	}
	if t.frames == 0 {
		t.abortLocked()
		return "", nil
	}
	if err := t.bw.Flush(); err != nil {
		t.abortLocked()
		return "", err
	}
	if err := patchWAVSizes(t.f, t.frames*PhoneChannels*4); err != nil {
		t.abortLocked()
		return "", err
	}
	if err := t.f.Sync(); err != nil {
		t.abortLocked()
		return "", err
	}
	t.f.Close()
	if err := finishPhoneTake(t.dir, t.name, t.wav, t.part, t.started, t.pyr, partial || len(t.early) > 0); err != nil {
		return "", err
	}
	if len(t.early) > 0 {
		log.Printf("[!] phone take %s finished with %d chunk(s) never filled in", t.name, len(t.early))
	}
	return t.name, nil
}

// Abort throws the recording away.
func (t *PhoneTake) Abort() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return
	}
	t.done = true
	t.abortLocked()
}

func (t *PhoneTake) abort() { t.abortLocked() }

func (t *PhoneTake) abortLocked() {
	if t.f != nil {
		t.f.Close()
	}
	os.Remove(t.part)
	os.Remove(phoneMarkerPath(t.wav))
	RemoveTake(t.dir, t.name)
}

// patchWAVSizes writes the RIFF and data chunk sizes into a canonical
// 44-byte header.
func patchWAVSizes(f *os.File, dataBytes int64) error {
	if dataBytes > math.MaxUint32-36 {
		return errors.New("recording too long for a WAV header")
	}
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], uint32(dataBytes+36))
	if _, err := f.WriteAt(b[:], 4); err != nil {
		return err
	}
	binary.LittleEndian.PutUint32(b[:], uint32(dataBytes))
	_, err := f.WriteAt(b[:], 40)
	return err
}

// finishPhoneTake writes a finished recording's sidecars under the final
// name, then renames the WAV into place.
func finishPhoneTake(dir, name, wav, part string, started time.Time, pyr *pyramidAcc, partial bool) error {
	fail := func(err error) error {
		os.Remove(part)
		os.Remove(phoneMarkerPath(wav))
		RemoveTake(dir, name)
		return err
	}
	if err := WritePeaks(peaksPath(wav), pyr.wholePeaks(PhoneRate)); err != nil {
		log.Printf("[!] peaks for %s: %v", name, err)
	}
	if err := pyr.write(wav, PhoneRate); err != nil {
		log.Printf("[!] peaks pyramid for %s: %v", name, err)
	}
	label := PhoneLabel
	if partial {
		label += " (partial)"
	}
	created := started
	if err := WriteMeta(wav, Meta{Label: label, Created: &created}); err != nil {
		return fail(fmt.Errorf("sidecar: %w", err))
	}
	if err := os.Rename(part, wav); err != nil {
		return fail(fmt.Errorf("finish wav: %w", err))
	}
	os.Remove(phoneMarkerPath(wav))
	log.Printf("[*] phone take %s — %.1fs (%s)", name, float64(pyr.frames)/PhoneRate, label)
	return nil
}

// recoverPhonePart turns the .part of a phone recording cut short by a
// restart into a partial take: whatever reached the disk, with its header
// sizes filled in from the file's length. Called by SweepPartials, which
// would otherwise delete it.
func recoverPhonePart(dir, part, wav string) error {
	b, err := os.ReadFile(phoneMarkerPath(wav))
	if err != nil {
		return err
	}
	var m phoneMarker
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	f, err := os.OpenFile(part, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	frameBytes := int64(PhoneChannels * 4)
	frames := (fi.Size() - wavHeaderBytes) / frameBytes
	name := filepath.Base(wav)
	if frames <= 0 {
		f.Close()
		os.Remove(part)
		os.Remove(phoneMarkerPath(wav))
		return nil
	}
	if err := f.Truncate(wavHeaderBytes + frames*frameBytes); err != nil {
		return err
	}
	if err := patchWAVSizes(f, frames*frameBytes); err != nil {
		return err
	}
	// Rebuild the pyramid from what is on disk.
	pyr := newPyramidAcc(PhoneChannels, frames)
	if _, err := f.Seek(wavHeaderBytes, io.SeekStart); err != nil {
		return err
	}
	r := bufio.NewReaderSize(f, 1<<16)
	var s [4]byte
	for i := int64(0); i < frames; i++ {
		for c := 0; c < PhoneChannels; c++ {
			if _, err := io.ReadFull(r, s[:]); err != nil {
				return err
			}
			pyr.add(c, i, int32(binary.LittleEndian.Uint32(s[:])))
		}
	}
	if err := f.Sync(); err != nil {
		return err
	}
	f.Close()
	log.Printf("[*] recovering phone recording %s cut short by a restart", name)
	return finishPhoneTake(dir, name, wav, part, m.Started, pyr, true)
}
