package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gabeduke/hindsight/internal/api"
	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/bundle"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
)

// version is stamped at build time with -ldflags "-X main.version=v2026.09.09.1".
var version = "dev"

func main() {
	log.SetFlags(log.Ltime)

	demo := flag.Bool("demo", false, "run with a synthetic audio source and no hardware")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	cfg.Version = version
	if err := os.MkdirAll(cfg.OutputDir, 0o755); err != nil {
		log.Fatalf("output dir: %v", err)
	}
	log.Printf("[*] hindsight %s — %s", version, cfg)
	// A crash mid-save leaves a hidden .part file; nothing else writes to the
	// directory yet, so this is the moment to clear it.
	audio.SweepPartials(cfg.OutputDir)
	// Takes saved before the peaks pyramid existed get one, one at a time in
	// the background; until then their zooms read the WAV, as they always did.
	// Then any take without a preview gets one -- a phone recording the sweep
	// just recovered, or an encode a restart cut short.
	go func() {
		audio.BackfillPyramids(cfg.OutputDir)
		audio.BackfillPreviews(cfg)
	}()
	// Deleted and pruned takes wait in the trash for a week, or until the
	// disk runs low; this empties it on that schedule. It runs until exit.
	go audio.TrashJanitor(cfg.OutputDir, cfg.MinFreeGB, 10*time.Minute, nil)

	// DemoDevice and Watcher each satisfy every consumer, so both are held
	// through their interfaces rather than asserted back out of one.
	var (
		src      audio.Source
		clock    api.MIDISource
		tempo    audio.TempoSource
		exporter audio.MIDIExporter
	)
	if *demo {
		// The demo's sequencer plays along with its loop: clock, a Start,
		// and the kick, hat and bass as notes, so a demo take gets a real
		// .mid and the whole export path runs with no hardware.
		src = audio.NewDemoSource(cfg)
		dd := midi.NewDemoDevice(cfg.RingSeconds)
		src.(audio.MIDISink).SetMIDISink(dd.Feed)
		clock, tempo = dd, dd
		if cfg.MIDICapture {
			exporter = bundle.New(dd, cfg.MIDILatencyMS, midi.DemoDeviceName)
		}
		log.Printf("[*] demo mode — synthetic audio, no hardware")
	} else {
		src = audio.NewDeviceSource(cfg)
	}

	cap := audio.NewCapture(cfg, src)
	if err := cap.Start(); err != nil {
		log.Fatalf("capture: %v", err)
	}
	defer cap.Stop()

	saver := audio.NewSaver(cap)

	if !*demo {
		// The clock ring covers the same window as the audio ring, so a
		// full-ring save can still ask about its oldest end. Sized in pulses
		// at the fastest tempo the BPM field accepts.
		mc := midi.NewClock(midi.CapacityFor(cfg.RingSeconds))
		var events *midi.EventRing
		if cfg.MIDICapture {
			events = midi.NewEventRing(cfg.MIDIRingEvents)
		}
		watcher := midi.NewWatcher(midi.Policy{
			Capture:     cfg.MIDICapture,
			Allow:       cfg.MIDIDevices,
			Deny:        cfg.MIDIIgnore,
			ClockDevice: cfg.MIDIClockDevice,
		}, mc, events)
		watcher.Start()
		defer watcher.Stop()
		clock, tempo = watcher, watcher
		if cfg.MIDICapture {
			exporter = bundle.New(watcher, cfg.MIDILatencyMS, cfg.MIDIClockDevice)
		}
	}
	saver.SetTempoSource(tempo)
	saver.SetMIDIExporter(exporter)

	r := mux.NewRouter()
	srvAPI := api.New(cfg, cap, saver, cap.Envelope(), clock)
	if cfg.Tape {
		if eng := startTape(cfg, cap, src, *demo); eng != nil {
			srvAPI.SetTape(eng)
			defer eng.Stop()
		}
	}
	srvAPI.SetupRoutes(r)
	r.PathPrefix("/").Handler(noCacheShell(http.FileServer(http.Dir(staticDir()))))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: it would cut off long websocket streams.
	}

	go func() {
		log.Printf("[*] listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Printf("[*] shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// startTape opens the tape store and starts the engine, loading the tape
// that was loaded last. The tape can never cost a recording: any failure here
// is logged and the dashcam runs on without it.
func startTape(cfg *config.Config, cap *audio.Capture, src audio.Source, demo bool) *tape.Engine {
	store, err := tape.OpenStore(cfg.TapeDir, cfg.SampleRate, cfg.TapeTracks, cfg.TapeLengthS)
	if err != nil {
		log.Printf("[!] tape off: %v", err)
		return nil
	}
	sources, err := tape.ParseSources(cfg.TapeSources, cfg.Channels)
	if err != nil {
		log.Printf("[!] tape off: %v", err)
		return nil
	}
	var sink audio.Sink
	if demo {
		sink = audio.NewDemoSink(src, cap, cfg.TapeDemoAlign)
	} else {
		// An output-only stream on the capture's own card, opened through the
		// lifecycle the capture shares; without cgo, none.
		sink = audio.NewDeviceSink(cfg, cap.DeviceName)
		if sink == nil {
			log.Printf("[!] tape: built without cgo, so nothing plays the tape")
		}
	}
	eng := tape.NewEngine(tape.Options{Store: store, Capture: cap, Sink: sink, Sources: sources,
		MinFreeGB: cfg.MinFreeGB, LatencyMS: cfg.TapeLatencyMS})
	if id := store.Remembered(); id != "" {
		if _, err := eng.Load(id); err != nil {
			log.Printf("[!] tape %s: %v", id, err)
		}
	}
	if err := eng.Start(); err != nil {
		log.Printf("[!] tape: %v", err)
	}
	log.Printf("[*] tape on — %s, %d tracks of %ds", cfg.TapeDir, cfg.TapeTracks, cfg.TapeLengthS)
	return eng
}

// staticDir resolves the UI directory. It is a thin wrapper so that the
// decision itself stays pure and testable.
func staticDir() string {
	exe, _ := os.Executable()
	cwd, _ := os.Getwd()
	home, _ := os.UserHomeDir()
	return resolveStaticDir(os.Getenv("STATIC_DIR"), exe, cwd, home, dirExists)
}

// resolveStaticDir picks the UI directory from the layouts this ships in.
//
// Executable-relative candidates come first so an installed binary is never
// confused by whatever directory systemd happened to start it in. The
// working directory is consulted only afterwards, which is what makes
// `go run ./cmd/hindsight` work from a checkout -- there the binary lives in
// a temporary build directory with no UI anywhere near it.
func resolveStaticDir(envDir, exePath, cwd, home string, exists func(string) bool) string {
	if envDir != "" {
		return envDir
	}
	dir := filepath.Dir(exePath)
	candidates := []string{
		filepath.Join(dir, "..", "web", "static"), // release / deploy.sh
		filepath.Join(dir, "static"),              // flat
		filepath.Join(dir, "..", "static"),        // flat, one level down
		filepath.Join(cwd, "web", "static"),       // go run from a checkout
	}
	for _, c := range candidates {
		if exists(c) {
			return filepath.Clean(c)
		}
	}
	return filepath.Join(home, "hindsight", "web", "static")
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

// noCacheShell sends Cache-Control: no-cache for the app shell -- HTML, JS,
// CSS, JSON and directory indexes -- so the browser revalidates them and a
// redeploy is picked up on reload rather than on a cache expiry.
//
// Nothing under web/static is fingerprinted, so every module is covered.
// Everything else -- the icons, and anything else without one of those
// extensions -- falls through to http.FileServer's ETag and Last-Modified
// handling untouched.
func noCacheShell(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch filepath.Ext(r.URL.Path) {
		case ".html", ".js", ".css", ".json", "":
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}
