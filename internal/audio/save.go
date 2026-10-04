package audio

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/shirou/gopsutil/v3/disk"
)

// ErrLowDisk is returned when a save is refused for lack of space. The Python
// implementation had this guard; the Go rewrite dropped it while the README
// still claimed it existed.
var ErrLowDisk = errors.New("insufficient disk space")

// ErrNoAudio is returned when the ring has nothing in it yet.
var ErrNoAudio = errors.New("no audio buffered yet")

// TempoSource reports the tempo over a wall-clock interval, or false when
// there is no defensible reading.
//
// It is an interface, and audio does not import the midi package, so that a
// MIDI failure has no path into the capture thread and this package -- which is
// cgo and PortAudio -- keeps no knowledge of MIDI at all. The implementation is
// midi.Reader; the tests use a fake.
type TempoSource interface {
	BPM(start, end time.Time) (float64, bool)
}

// MIDIExportRequest describes the take a MIDIExporter should write sidecars
// for. Frames are absolute ring frames, the same clock FlagStore uses, so the
// exporter can place a monotonic timestamp against the take through Bridge.
type MIDIExportRequest struct {
	WavPath    string
	StartFrame uint64 // the take's first frame, as an absolute ring frame
	Frames     int    // the take's length
	SampleRate int
	Bridge     *ClockBridge
	SavedAt    time.Time
}

// MIDIExporter writes a take's MIDI sidecars: the .mid and its manifest.
//
// Like TempoSource it is an interface, and audio does not import midi, so a
// failure anywhere in MIDI has no path into the capture thread. The
// implementation is bundle.Exporter; nil means takes carry no MIDI.
type MIDIExporter interface {
	Export(req MIDIExportRequest) error
}

// MIDICutter is the optional half of a MIDIExporter that can carry a take's
// MIDI along when a region of it is cut into a new take: the region of the
// source's .mid, re-based to the cut's first frame. Called after the cut's
// WAV and sidecar exist; a failure is logged and the cut keeps its audio.
type MIDICutter interface {
	CutMIDI(srcWav, dstWav string, startFrame, endFrame int64) error
}

// BarSnapper is the optional half of a MIDIExporter that knows where the
// downbeats are. Given the window Save is about to take, in absolute ring
// frames, it returns the downbeat the window should start on instead: the
// last one at or before start when the ring still holds it, otherwise the
// first one after. false means it does not know -- no clock, or no Start
// message to fix the bar phase -- and the window is left alone.
//
// This is what makes the .mid's tick 0 a bar line. A window that begins
// mid-bar cannot be laid on a DAW grid without a lead-in at an absurd tempo;
// a window that begins on a downbeat needs no lead-in at all. The cost is up
// to one bar more audio than was asked for, at the old end.
type BarSnapper interface {
	SnapStart(bridge *ClockBridge, start, oldest, end uint64) (uint64, bool)
}

// Saver turns a slice of the ring into a take on disk, plus a preview and
// waveform peaks.
type Saver struct {
	cap *Capture

	mu        sync.Mutex
	lastSaved string
	saving    bool
	tempo     TempoSource
	midi      MIDIExporter
}

func NewSaver(c *Capture) *Saver { return &Saver{cap: c} }

// SetTempoSource attaches a clock. Nil, or never called, means takes carry no
// BPM -- which is the correct behaviour on a machine with no MIDI at all.
func (s *Saver) SetTempoSource(t TempoSource) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tempo = t
}

// SetMIDIExporter attaches the MIDI sidecar writer. Nil, or never called,
// means takes carry no MIDI.
func (s *Saver) SetMIDIExporter(e MIDIExporter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.midi = e
}

func (s *Saver) midiExporter() MIDIExporter {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.midi
}

// CutMIDI carries the source's MIDI over to a cut, if the exporter can. It
// runs under the same recover as every other MIDI step: nothing here may
// fail the cut.
func (s *Saver) CutMIDI(dir, srcName, dstName string, startFrame, endFrame int64) {
	c, ok := s.midiExporter().(MIDICutter)
	if !ok {
		return
	}
	defer func() {
		if p := recover(); p != nil {
			log.Printf("[!] midi: cutter panicked for %s: %v", dstName, p)
		}
	}()
	src := filepath.Join(dir, filepath.Base(srcName))
	dst := filepath.Join(dir, filepath.Base(dstName))
	if err := c.CutMIDI(src, dst, startFrame, endFrame); err != nil {
		log.Printf("[!] midi: cut for %s: %v", dstName, err)
	}
}

func (s *Saver) tempoSource() TempoSource {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tempo
}

func (s *Saver) LastSaved() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastSaved
}

func (s *Saver) Saving() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saving
}

// FreeGB reports free space on the output volume.
func (s *Saver) FreeGB() (float64, float64) { return FreeGB(s.cap.cfg.OutputDir) }

// FreeGB reports free gigabytes and used percent for the volume holding dir.
func FreeGB(dir string) (float64, float64) {
	u, err := disk.Usage(dir)
	if err != nil {
		return 0, 0
	}
	return float64(u.Free) / (1024 * 1024 * 1024), u.UsedPercent
}

// Save writes the most recent `seconds` of audio. seconds <= 0 means the whole
// ring. It returns the take's filename.
func (s *Saver) Save(seconds float64) (string, error) {
	cfg := s.cap.cfg

	// The trash goes first, oldest deletion first: it must never be why a
	// capture is refused.
	freeGB := EnsureFree(cfg.OutputDir, cfg.MinFreeGB)
	if freeGB < cfg.MinFreeGB {
		return "", fmt.Errorf("%w: %.2f GB free, need %.2f GB", ErrLowDisk, freeGB, cfg.MinFreeGB)
	}

	frames := 0
	if seconds > 0 {
		frames = int(seconds * float64(cfg.SampleRate))
	}

	// Ask where the window would start, and whether a bar line is close
	// enough to start on instead. The snapshot below takes the most recent
	// N frames, and more arrive between here and there, so the answer is
	// applied by trimming the snapshot's front to the exact frame rather
	// than by trusting N to land on it.
	var snapTo uint64
	snapping := false
	if bs, ok := s.midiExporter().(BarSnapper); ok && cfg.MIDISnapBars {
		oldest, total := s.cap.Ring().Window()
		start := oldest
		if frames > 0 && uint64(frames) < total-oldest {
			start = total - uint64(frames)
		}
		if snapped, ok := snapBars(bs, s.cap.Bridge(), start, oldest, total); ok && snapped != start {
			snapTo, snapping = snapped, true
			if snapped < start {
				// Ask for the frames back to the downbeat plus a few blocks
				// of slack: audio keeps arriving while the snapper runs,
				// SnapshotAt counts back from whatever the newest frame is
				// by then, and the trim below can only cut, never extend.
				frames = int(total-snapped) + 4*cfg.FramesPerBuf
			}
		}
	}

	data, gotFrames, endFrame := s.cap.Ring().SnapshotAt(frames)
	if snapping && gotFrames > 0 {
		winStart := endFrame - uint64(gotFrames)
		if snapTo > winStart && snapTo < endFrame {
			trim := int(snapTo - winStart)
			data = data[trim*cfg.Channels:]
			gotFrames -= trim
		}
	}
	// The end of the captured window, in wall-clock terms. The ring stores
	// frames and a counter and carries no clock of its own, so this is derived
	// rather than read: now, minus the snapshot's duration.
	//
	// It runs late by the capture pipeline's latency -- INPUT_LATENCY_MS plus
	// one FRAMES_PER_BUFFER block plus the hand-off, so 150-250ms. Against a
	// 30-second window that is under 1%, and the tempo is a median over the
	// whole window rather than a value placed at an instant. Frame-exact
	// alignment is the scrubber's problem, not this one's.
	capturedAt := time.Now()
	if gotFrames == 0 {
		return "", ErrNoAudio
	}

	// Read the marks against the same window the snapshot describes. Active
	// also prunes anything that has aged out, which is the only way a live mark
	// ever leaves the store.
	winStart := endFrame - uint64(gotFrames)
	takeFlags := flagsForWindow(
		s.cap.Flags().Active(endFrame, uint64(s.cap.cfg.RingFrames())),
		winStart, endFrame,
	)

	s.mu.Lock()
	s.saving = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.saving = false
		s.mu.Unlock()
	}()

	savedAt := time.Now()
	name, wavPath, err := freeTakeName(cfg.OutputDir, savedAt)
	if err != nil {
		return "", fmt.Errorf("name take: %w", err)
	}
	// The audio goes to a hidden temporary file and is renamed into place
	// only once its sidecars are written: the list is polled every five
	// seconds, and a 15-minute take takes long enough to write that it used
	// to be listed, and openable, while still half on disk.
	tmpPath := PartPath(wavPath)

	pick := cfg.OutChannels()
	start := time.Now()
	peaks, pyr, err := writeWAV(tmpPath, data, cfg.Channels, pick, cfg.SampleRate)
	if err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("write wav: %w", err)
	}
	log.Printf("[*] saved %s — %.1fs, %d ch, %s in %s",
		name, float64(gotFrames)/float64(cfg.SampleRate), len(pick),
		sizeOf(tmpPath), time.Since(start).Round(time.Millisecond))

	if err := WritePeaks(peaksPath(wavPath), peaks); err != nil {
		log.Printf("[!] peaks for %s: %v", name, err)
	}
	if err := pyr.write(wavPath, cfg.SampleRate); err != nil {
		log.Printf("[!] peaks pyramid for %s: %v", name, err)
	}
	stampCreated(wavPath, savedAt)
	stampFlagsAt(wavPath, tmpPath, takeFlags)

	stampTempo(wavPath, s.tempoSource(), capturedAt,
		time.Duration(float64(gotFrames)/float64(cfg.SampleRate)*float64(time.Second)))

	exportMIDI(s.midiExporter(), MIDIExportRequest{
		WavPath:    wavPath,
		StartFrame: winStart,
		Frames:     gotFrames,
		SampleRate: cfg.SampleRate,
		Bridge:     s.cap.Bridge(),
		SavedAt:    capturedAt,
	})

	if err := os.Rename(tmpPath, wavPath); err != nil {
		os.Remove(tmpPath)
		RemoveTake(cfg.OutputDir, name) // the sidecars, which would otherwise be orphans
		return "", fmt.Errorf("finish wav: %w", err)
	}

	s.mu.Lock()
	s.lastSaved = name
	s.mu.Unlock()

	go s.makePreview(wavPath, len(pick))
	go s.prune()

	return name, nil
}

// freeTakeName picks the take's name from the time it was saved: jam_<ts>.wav,
// or jam_<ts>_N.wav when that second is taken -- by a finished take or by one
// still being written -- and reserves it by creating its empty .part file.
// Two takes in the same second must not collide: overwriting a take is the
// one failure that loses audio outright, and a save and a cut landing
// together is how it would happen. The .part is created exclusively, so only
// one writer can hold a name, and the final name is checked again once it is
// held, in case another writer renamed its take into place in between.
func freeTakeName(dir string, at time.Time) (name, path string, err error) {
	ts := at.Format(takeNameLayout)
	for n := 1; ; n++ {
		name = fmt.Sprintf("jam_%s.wav", ts)
		if n > 1 {
			name = fmt.Sprintf("jam_%s_%d.wav", ts, n)
		}
		path = filepath.Join(dir, name)
		if exists(path) {
			continue
		}
		f, err := os.OpenFile(PartPath(path), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", "", err
		}
		f.Close()
		if exists(path) {
			os.Remove(PartPath(path))
			continue
		}
		return name, path, nil
	}
}

// PartPath is where a take's audio is written before it is complete: the
// same directory, a dot-prefixed name and a .part extension, both of which
// keep it out of ListTakes.
func PartPath(wav string) string {
	return filepath.Join(filepath.Dir(wav), "."+filepath.Base(wav)+".part")
}

// SweepPartials removes what a crash mid-save or mid-cut can leave behind: a
// .part file, and the sidecars written for a take whose WAV never made it --
// and any peaks pyramid whose take is gone. Called once at startup, before
// anything else writes to the directory.
func SweepPartials(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() {
			continue
		}
		// A phone recording's marker whose recording is gone (finished, but
		// the process died before the marker was removed).
		if strings.HasPrefix(n, ".") && strings.HasSuffix(n, ".phone.json") {
			stem := strings.TrimSuffix(strings.TrimPrefix(n, "."), ".phone.json")
			if !exists(PartPath(filepath.Join(dir, stem+".wav"))) {
				os.Remove(filepath.Join(dir, n))
			}
			continue
		}
		// A sidecar write's temporary file, from a crash mid-write.
		if (strings.HasPrefix(n, ".meta-") || strings.HasPrefix(n, ".pyramid-")) && strings.HasSuffix(n, ".tmp") {
			os.Remove(filepath.Join(dir, n))
			continue
		}
		// This program's own sidecars whose take is gone: a pyramid built
		// while its take was being deleted, a take removed by hand. Exports
		// a person might want (.mp3, .mid, the manifest) are left alone.
		if stem, ok := internalSidecarStem(n); ok {
			wav := filepath.Join(dir, stem+".wav")
			if !exists(wav) && !exists(PartPath(wav)) {
				os.Remove(filepath.Join(dir, n))
			}
			continue
		}
		if e.IsDir() || !strings.HasPrefix(n, ".") || !strings.HasSuffix(n, ".wav.part") {
			continue
		}
		final := strings.TrimSuffix(strings.TrimPrefix(n, "."), ".part")
		// A phone recording cut short is kept as a partial take: that audio
		// exists nowhere else.
		if wav := filepath.Join(dir, final); exists(phoneMarkerPath(wav)) && !exists(wav) {
			if err := recoverPhonePart(dir, filepath.Join(dir, n), wav); err != nil {
				// Left as it is, to try again next time: never delete audio
				// that exists nowhere else.
				log.Printf("[!] could not recover phone recording %s: %v", final, err)
			}
			continue
		}
		log.Printf("[*] removing unfinished take %s", final)
		os.Remove(filepath.Join(dir, n))
		os.Remove(phoneMarkerPath(filepath.Join(dir, final)))
		if !exists(filepath.Join(dir, final)) {
			RemoveTake(dir, final)
		}
	}
}

// internalSidecarStem returns the take stem of a .meta.json, .peaks.json,
// .peaks.bin or .history.json name.
func internalSidecarStem(name string) (string, bool) {
	if strings.HasPrefix(name, ".") {
		return "", false
	}
	for _, suf := range []string{".meta.json", ".peaks.json", ".peaks.bin", ".history.json"} {
		if strings.HasSuffix(name, suf) {
			return strings.TrimSuffix(name, suf), true
		}
	}
	return "", false
}

// stampCreated records when a take was made. Like the other stamps it runs
// after the audio is safely written and never fails the save.
func stampCreated(wavPath string, at time.Time) {
	if _, err := UpdateMeta(wavPath, func(m *Meta) error { m.Created = &at; return nil }); err != nil {
		log.Printf("[!] created time for %s: %v", filepath.Base(wavPath), err)
	}
}

// flagsForWindow maps live marks, which are absolute ring frames, into frames
// relative to a take covering absolute [start, end). Marks outside the window
// are not in this take and are simply skipped -- they stay in the store until
// they age out of the ring.
func flagsForWindow(marks []uint64, start, end uint64) []Flag {
	if end <= start {
		return nil
	}
	var out []Flag
	for _, m := range marks {
		if m < start || m >= end {
			continue
		}
		out = append(out, Flag{Frame: int64(m - start)})
	}
	return out
}

// stampTempo merges a BPM into a take's sidecar, if the clock has one to give.
//
// The spec's hard rule is that a save must never fail because of MIDI: no
// device, no clock, a parse error, an unplugged interface, or an implementation
// that panics all produce a take with no BPM and nothing else. The recover is
// not defensive habit -- it is the only thing standing between a third-party
// bug and a lost recording, and by this point the WAV is already safely on disk.
func stampTempo(wavPath string, src TempoSource, end time.Time, window time.Duration) {
	if src == nil {
		return
	}
	defer func() {
		if p := recover(); p != nil {
			log.Printf("[!] midi: tempo source panicked for %s: %v", filepath.Base(wavPath), p)
		}
	}()

	bpm, ok := src.BPM(end.Add(-window), end)
	if !ok {
		return
	}
	// Two decimals: the estimator's precision is not meaningful past that, and
	// the field is a starting point the owner edits, not a measurement.
	bpm = math.Round(bpm*100) / 100

	if _, err := UpdateMeta(wavPath, func(m *Meta) error { m.BPM = &bpm; return nil }); err != nil {
		log.Printf("[!] midi: bpm for %s: %v", filepath.Base(wavPath), err)
		return
	}
	log.Printf("[*] %s — %.2f BPM", filepath.Base(wavPath), bpm)
}

// snapBars asks the snapper under the same recover as the export: a bar
// snapper that panics costs a bar-aligned take, never the take.
func snapBars(bs BarSnapper, bridge *ClockBridge, start, oldest, end uint64) (snapped uint64, ok bool) {
	defer func() {
		if p := recover(); p != nil {
			log.Printf("[!] midi: bar snapper panicked: %v", p)
			snapped, ok = 0, false
		}
	}()
	return bs.SnapStart(bridge, start, oldest, end)
}

// exportMIDI writes the take's MIDI sidecars, if there is an exporter.
//
// The same rule as stampTempo, for the same reason: the WAV is on disk, and
// nothing MIDI -- no devices, no events, a panic in the SMF writer -- may
// turn that into a failed save. The worst case is a take with no .mid.
func exportMIDI(e MIDIExporter, req MIDIExportRequest) {
	if e == nil {
		return
	}
	defer func() {
		if p := recover(); p != nil {
			log.Printf("[!] midi: exporter panicked for %s: %v", filepath.Base(req.WavPath), p)
		}
	}()
	if err := e.Export(req); err != nil {
		log.Printf("[!] midi: export for %s: %v", filepath.Base(req.WavPath), err)
	}
}

// stampFlags records a take's flags in its sidecar and mirrors them into the
// WAV as cue points.
//
// Like stampTempo, this runs after the audio is safely on disk and must never
// fail the save. The sidecar is the source of truth; the cue chunk is a derived
// export, so a cue failure is logged and the flags are kept.
func stampFlags(wavPath string, flags []Flag) { stampFlagsAt(wavPath, wavPath, flags) }

// stampFlagsAt is stampFlags for a take whose audio is still being written
// under another name: the sidecar belongs to the take's final name, metaWav,
// while the cue chunk goes into the file that holds the audio right now,
// cueWav. A save and a cut both write the WAV under a temporary name and
// rename it into place last, so the list never shows a half-written take.
func stampFlagsAt(metaWav, cueWav string, flags []Flag) {
	flags = NormalizeFlags(flags)
	if len(flags) == 0 {
		return
	}

	unlock := LockTake(metaWav)
	defer unlock()
	m, err := updateMetaLocked(metaWav, func(m *Meta) error { m.Flags = flags; return nil })
	if err != nil {
		log.Printf("[!] flags for %s: %v", filepath.Base(metaWav), err)
		return
	}

	if err := WriteCuePoints(cueWav, m.Flags); err != nil {
		log.Printf("[!] cue points for %s: %v", filepath.Base(metaWav), err)
		return
	}
	log.Printf("[*] %s — %d flag(s)", filepath.Base(metaWav), len(m.Flags))
}

func (s *Saver) makePreview(wavPath string, outCh int) { MakePreview(s.cap.cfg, wavPath, outCh) }

// MakePreview renders the mp3 proxy. The channel mapping is explicit: a bare
// `-ac 2` on an 8-channel file makes ffmpeg assume a 7.1 layout, which folds
// channel 3 into a mono centre and discards channel 4 as LFE entirely — which
// is exactly what made previews sound wrong.
func MakePreview(cfg *config.Config, wavPath string, outCh int) {
	mp3Path := previewPath(wavPath)
	tmp := mp3Path + ".tmp"

	args := []string{"-y", "-hide_banner", "-loglevel", "error", "-i", wavPath}
	if outCh > 2 {
		// Take the configured pair out of a multichannel take by index.
		l, r := cfg.SaveChannels[0], cfg.SaveChannels[0]
		if len(cfg.SaveChannels) > 1 {
			r = cfg.SaveChannels[1]
		}
		args = append(args, "-filter_complex", fmt.Sprintf("pan=stereo|c0=c%d|c1=c%d", l, r))
	} else if outCh == 1 {
		args = append(args, "-af", "pan=stereo|c0=c0|c1=c0")
	}
	// -f mp3 is required because the temp file is written with a .tmp
	// extension, which ffmpeg cannot infer a muxer from.
	args = append(args, "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", tmp)

	// nice so a long encode never competes with the audio thread.
	cmd := exec.Command("nice", append([]string{"-n", "10", "ffmpeg"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("[!] preview for %s failed: %v %s", filepath.Base(wavPath), err, strings.TrimSpace(string(out)))
		os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, mp3Path); err != nil {
		log.Printf("[!] preview rename: %v", err)
		return
	}
	log.Printf("[*] preview ready: %s", filepath.Base(mp3Path))
}

// BackfillPreviews encodes the preview of any take that lacks one: a phone
// recording recovered at startup, or a take whose encode was cut short by a
// restart. Takes made in the last two minutes are left to the encode their
// own save started. Run once, in the background, at startup.
func BackfillPreviews(cfg *config.Config) {
	takes, err := ListTakes(cfg.OutputDir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-2 * time.Minute)
	for _, t := range takes {
		if t.HasPreview || t.Channels == 0 || t.Created.After(cutoff) {
			continue
		}
		log.Printf("[*] encoding the missing preview of %s", t.Name)
		MakePreview(cfg, filepath.Join(cfg.OutputDir, t.Name), t.Channels)
	}
}

// Prune enforces MAX_SAVES now, sparing the takes named in keep. Save does
// it itself; anything else that makes a take -- a cut, for now -- calls this.
func (s *Saver) Prune(keep ...string) { s.prune(keep...) }

// prune enforces MAX_SAVES by moving the oldest takes to the trash, where
// they wait out TrashKeep (or disk pressure) like a deleted take. A take in
// keep is skipped, which can leave the list one or two over until the next
// save prunes again.
func (s *Saver) prune(keep ...string) {
	max := s.cap.cfg.MaxSaves
	if max <= 0 {
		return
	}
	takes, err := ListTakes(s.cap.cfg.OutputDir)
	if err != nil || len(takes) <= max {
		return
	}
	for _, t := range takes[max:] {
		if slices.Contains(keep, t.Name) {
			continue
		}
		log.Printf("[*] pruning %s to the trash (over MAX_SAVES=%d)", t.Name, max)
		if err := TrashTake(s.cap.cfg.OutputDir, t.Name, TrashPruned, time.Now()); err != nil {
			log.Printf("[!] prune %s: %v", t.Name, err)
		}
	}
}

// Take describes one saved recording.
type Take struct {
	Name       string    `json:"name"`
	SizeMB     float64   `json:"size_mb"`
	Duration   float64   `json:"duration_seconds"`
	Created    time.Time `json:"created"`
	Channels   int       `json:"channels"`
	SampleRate int       `json:"sample_rate"`
	HasPreview bool      `json:"has_preview"`
	HasPeaks   bool      `json:"has_peaks"`
	HasMIDI    bool      `json:"has_midi"`
	Preview    string    `json:"preview_name"`
	MIDI       string    `json:"midi_name"`

	// From the sidecar. Name above is the filename; Label is what the user
	// called it.
	Label         string            `json:"label"`
	Starred       bool              `json:"starred"`
	Trim          *Trim             `json:"trim,omitempty"`
	BPM           *float64          `json:"bpm,omitempty"`
	Flags         []Flag            `json:"flags,omitempty"`
	DownbeatFrame *int64            `json:"downbeat_frame,omitempty"`
	Source        *CutSource        `json:"source,omitempty"`
	LaneKinds     map[string]string `json:"lane_kinds,omitempty"`
}

// ListTakes returns starred takes first, then the rest newest first. Duration
// and layout come from each file's own header, so takes recorded under an
// older channel configuration still report correctly.
func ListTakes(dir string) ([]Take, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []Take
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".wav" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, takeFromFile(dir, e.Name(), info))
	}
	SortTakes(out)
	return out, nil
}

// SortTakes orders takes the way the list shows them: starred first, then
// newest. Starring is how a take is kept in reach once newer ones have pushed
// it down the list.
func SortTakes(takes []Take) {
	sort.SliceStable(takes, func(i, j int) bool {
		if takes[i].Starred != takes[j].Starred {
			return takes[i].Starred
		}
		if !takes[i].Created.Equal(takes[j].Created) {
			return takes[i].Created.After(takes[j].Created)
		}
		return takes[i].Name > takes[j].Name
	})
}

// ReadTake describes one take, exactly as ListTakes would.
func ReadTake(dir, name string) (Take, error) {
	info, err := os.Stat(filepath.Join(dir, filepath.Base(name)))
	if err != nil {
		return Take{}, err
	}
	if !info.Mode().IsRegular() {
		return Take{}, os.ErrNotExist
	}
	return takeFromFile(dir, filepath.Base(name), info), nil
}

// takeFromFile reads one take's header and sidecar into a Take.
func takeFromFile(dir, name string, info os.FileInfo) Take {
	full := filepath.Join(dir, name)
	t := Take{
		Name:       name,
		SizeMB:     float64(info.Size()) / (1024 * 1024),
		HasPreview: exists(previewPath(full)),
		HasPeaks:   exists(peaksPath(full)),
		HasMIDI:    exists(MIDIPath(full)),
		Preview:    filepath.Base(previewPath(full)),
		MIDI:       filepath.Base(MIDIPath(full)),
	}
	if wi, err := ReadWAVInfo(full); err == nil {
		t.Duration = wi.Duration()
		t.Channels = wi.Channels
		t.SampleRate = wi.SampleRate
	}

	m := ReadMeta(full)
	t.Created = TakeCreated(name, m, info.ModTime())
	t.Label = m.Label
	t.Starred = m.Starred
	t.Trim = m.Trim
	t.BPM = m.BPM
	t.Flags = EnsureFlagIDs(m.Flags)
	t.DownbeatFrame = m.DownbeatFrame
	t.Source = m.Source
	t.LaneKinds = m.LaneKinds
	return t
}

// RemoveTake deletes a take and its sidecar files for good. It holds the
// take's lock so a sidecar write in flight cannot recreate a .meta.json for a
// take that is already gone. A person's delete and MAX_SAVES pruning go to
// the trash instead (TrashTake); this is for what was never a finished take.
func RemoveTake(dir, name string) {
	base := filepath.Join(dir, filepath.Base(name))
	unlock := LockTake(base)
	defer unlock()
	for _, f := range takeFiles(base) {
		os.Remove(f)
	}
}

func previewPath(wav string) string { return strings.TrimSuffix(wav, ".wav") + "_preview.mp3" }
func peaksPath(wav string) string   { return strings.TrimSuffix(wav, ".wav") + ".peaks.json" }

// MIDIPath and ManifestPath are the MIDI sidecars for a take's wav path. They
// are exported because the exporter that writes them lives outside this
// package, and the two must agree on the names RemoveTake deletes.
func MIDIPath(wav string) string     { return strings.TrimSuffix(wav, ".wav") + ".mid" }
func ManifestPath(wav string) string { return strings.TrimSuffix(wav, ".wav") + ".manifest.json" }

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func sizeOf(p string) string {
	fi, err := os.Stat(p)
	if err != nil {
		return "?"
	}
	mb := float64(fi.Size()) / (1024 * 1024)
	return fmt.Sprintf("%.1f MB", mb)
}
