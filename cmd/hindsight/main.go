package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"mime"
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
	"github.com/gabeduke/hindsight/internal/hub"
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
	// DEVICE_MATCH=auto and CHANNELS=auto are settled here, once, before the
	// ring and the meters are sized from them: look at what is plugged in
	// now. The demo's synthetic interface has eight inputs, like the EP-136.
	probed, probedChannels := "", 8
	if !*demo {
		probed, probedChannels = audio.ProbeInput(cfg)
	}
	if cfg.Channels == 0 {
		if note := cfg.SetChannels(probedChannels); note != "" {
			log.Printf("[!] %s", note)
		}
	}
	if cfg.MIDIClockAuto && cfg.DeviceMatch == "" && probed != "" {
		cfg.MIDIClockDevice = audio.CardName(probed)
	}
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
		overflowOnSignal(src)
	} else {
		src = audio.NewDeviceSource(cfg)
	}

	// What a defer would stop, kept so a restart can stop it too before exec,
	// which runs no defers. Last started, first stopped.
	var stops []func()
	stopAll := func() {
		for i := len(stops) - 1; i >= 0; i-- {
			stops[i]()
		}
		stops = nil
	}
	defer stopAll()

	cap := audio.NewCapture(cfg, src)
	// Under CHANNELS=auto the ring fits the interface found at startup. One
	// with a different number of inputs turning up later (booted with
	// nothing plugged in, then the EP-136) is handed to fitInterface below,
	// which restarts to fit it; the startup probe then sizes it right, so
	// this fires at most once per interface change.
	misfit := make(chan string, 1)
	if cfg.ChannelsAuto && !*demo {
		cap.SetOnMismatch(func(name string, inputs int) {
			select {
			case misfit <- fmt.Sprintf("%q has %d inputs, the ring %d", name, inputs, cfg.Channels):
			default:
			}
		})
	}
	if err := cap.Start(); err != nil {
		log.Fatalf("capture: %v", err)
	}
	stops = append(stops, cap.Stop)

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
		stops = append(stops, watcher.Stop)
		clock, tempo = watcher, watcher
		if cfg.MIDICapture {
			exporter = bundle.New(watcher, cfg.MIDILatencyMS, cfg.MIDIClockDevice)
		}
	}
	saver.SetTempoSource(tempo)
	saver.SetMIDIExporter(exporter)

	srvAPI := api.New(cfg, cap, saver, cap.Envelope(), clock)
	if cfg.Tape {
		if eng := startTape(cfg, cap, saver, src, *demo); eng != nil {
			srvAPI.SetTape(eng)
			stops = append(stops, eng.Stop)
		}
	}
	// The hub: a public HTTPS name for this Pi's LAN address, and Caddy's
	// certificate for it on a loopback listener of its own -- never a route
	// on :5000, which Caddy proxies to the whole LAN. Off without
	// HUB_URL/HUB_TOKEN, and never in the way of capture.
	if cfg.HubOn() {
		home, _ := os.UserHomeDir()
		hc, err := hub.New(hub.Options{URL: cfg.HubURL, Token: cfg.HubToken, Version: version,
			Dir: filepath.Join(home, "hindsight", "tls"), TLSAddr: cfg.HubTLSAddr})
		if err != nil {
			log.Printf("[!] hub off: %v", err)
		} else {
			hc.Start()
			stops = append(stops, hc.Stop)
			srvAPI.SetHub(hc)
		}
	}
	// The Update button, where deploy/hindsight-update is installed beside
	// the binary (install.sh, deploy.sh); nil, and no button, elsewhere.
	if u := api.NewUpdater(cfg.UpdateRepo); u != nil {
		srvAPI.SetUpdater(u)
	}
	// POST /api/restart, and the capture finding an interface that doesn't
	// fit the ring, both end here: shut down as on SIGTERM, then exec.
	restart := make(chan struct{}, 1)
	requestRestart := func() {
		select {
		case restart <- struct{}{}:
		default:
		}
	}
	srvAPI.SetRestart(requestRestart)
	go fitInterface(misfit, srvAPI.Busy, requestRestart, 5*time.Second)
	r := newRouter(srvAPI, staticDir())

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
	again := false
	select {
	case <-sig:
		log.Printf("[*] shutting down")
	case <-restart:
		log.Printf("[*] restarting to apply settings")
		again = true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	if again {
		// The tape, the MIDI watcher and the capture release the interface
		// first, or the new process would find it busy; exec runs no defers.
		// Then this process is replaced by a fresh one: same PID, so systemd
		// sees one service.
		cancel()
		stopAll()
		exe, err := os.Executable()
		if err != nil {
			log.Fatalf("restart: %v", err)
		}
		log.Fatalf("restart: %v", syscall.Exec(exe, os.Args, os.Environ()))
	}
}

// newRouter is everything :5000 serves: the API and the UI. The hub's /tls
// is deliberately not here (see internal/hub).
func newRouter(a *api.API, static string) *mux.Router {
	r := mux.NewRouter()
	a.SetupRoutes(r)
	r.PathPrefix("/").Handler(noCacheShell(http.FileServer(http.Dir(static))))
	return r
}

// startTape opens the tape store and starts the engine, loading the tape
// that was loaded last. The tape can never cost a recording: any failure here
// is logged and the dashcam runs on without it.
// fitInterface waits for the capture to report an interface that doesn't fit
// the ring, then restarts Hindsight -- once nothing is busy: a take saving, a
// phone or the tape recording is never cut short for it. Meanwhile the
// capture records the interface's first channels if it has enough, or waits.
func fitInterface(misfit <-chan string, busy func() string, restart func(), every time.Duration) {
	why := <-misfit
	said := ""
	for {
		b := busy()
		if b == "" {
			log.Printf("[*] interface changed: %s; restarting to fit it", why)
			restart()
			return
		}
		if b != said {
			log.Printf("[!] interface changed: %s; restarting to fit it once nothing is busy (now: %s)", why, b)
			said = b
		}
		time.Sleep(every)
	}
}

func startTape(cfg *config.Config, cap *audio.Capture, saver *audio.Saver, src audio.Source, demo bool) *tape.Engine {
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
	if sink != nil {
		// Between the engine and the device: the output can move to a phone.
		sink = tape.NewOutput(sink)
	}
	opts := tape.Options{Store: store, Capture: cap, Sink: sink, Sources: sources,
		MinFreeGB: cfg.MinFreeGB, LatencyMS: cfg.TapeLatencyMS,
		Saver: saver, TakesDir: cfg.OutputDir, MixdownTail: cfg.TapeMixdownTailS,
		HandleSeconds: cfg.TapeHandleS}
	if out := clockOut(cfg, demo); out != nil {
		opts.Clock = out
	}
	eng := tape.NewEngine(opts)
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

// clockOut is where the tape's clock goes when it leads: the devices in
// TAPE_CLOCK_OUT, or in the demo, a follower that stands in for the Bento.
func clockOut(cfg *config.Config, demo bool) *midi.Out {
	switch cfg.TapeClock {
	case "lead":
	case "follow":
		log.Printf("[!] tape: TAPE_CLOCK=follow isn't built yet; the tape runs free")
		return nil
	default:
		return nil
	}
	if demo {
		log.Printf("[*] tape clock: leading the demo's follower")
		return midi.NewDemoOut()
	}
	targets, err := midi.ParseOutTargets(cfg.TapeClockOut)
	if err != nil {
		log.Printf("[!] tape clock off: TAPE_CLOCK_OUT %v", err)
		return nil
	}
	if len(targets) == 0 {
		log.Printf("[!] tape clock: TAPE_CLOCK=lead, but TAPE_CLOCK_OUT names no device to lead")
	}
	out := midi.NewOut(targets)
	out.Start()
	log.Printf("[*] tape clock: leading %s", cfg.TapeClockOut)
	return out
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

// The UI's fonts are woff2. Go's built-in table lacks the extension and a
// Pi's /etc/mime.types may too, which would serve them as
// application/octet-stream; register it rather than rely on the host.
func init() {
	_ = mime.AddExtensionType(".woff2", "font/woff2")
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
