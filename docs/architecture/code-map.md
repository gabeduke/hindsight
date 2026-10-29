# The code, and how data flows through it

```
cmd/hindsight          wiring and flags
cmd/hindsight-hub      the hub: certificates and heartbeats for every kit (docs/hub.md)
internal/config        environment → Config
internal/audio         device, ring, levels, envelope, saving  (cgo, PortAudio)
internal/midi          rawmidi watcher, parser, event ring, clock, tempo map, SMF export
internal/surface       the SMK-37 on Hindsight's firmware: its screen and its panel
internal/smf           Standard MIDI File writer and reader
internal/bundle        writes a take's .mid and manifest from audio's window and midi's events
internal/mono          the one monotonic clock audio and MIDI both stamp with
internal/tempo         the tempo a take was played at, measured from its audio
internal/tape          the tape: model and undo, store and pool, renderer, transport, player, catching, cue lane, latency in use
internal/rig           the kit drawn as hardware: device profiles, sockets, cables
internal/hub           the Pi's side of the hub
internal/hubserver     the hub itself
internal/api           HTTP and WebSocket handlers
web/static             the UI, served from disk per request
web/static/shell.html  the one document: the Studio, the Listening Room and Capture
web/static/lib/shell   the router, the view contract and the three views
web/static/lib/bar     the bar (#np) and the engine that owns its audio
web/static/lib/tape    the Studio's tape: lanes, parts, ranges, the cue lane
web/static/lib/rooms   the Studio around the tape: feed, KEEP, bounce, words
web/static/lib/buffer  the buffer: GRAB, trim, DROP
web/static/lib/room    the Listening Room: the shelf, the deck, the Sketchbook
web/static/lib/play    the instrument strip (Play mode); the Pi's clock and the latency readouts
web/static/lib/rig     the rig page
web/static/lib/objects the physical things: reels, cassettes, VU meters, the shared ticker
web/static/lib/scene   the scene contract the renderers follow
web/static/lib/wave    the take page (wave.html): view, geometry, draw, tiles, clock, lanes
web/static/lib/edit    the gestures and curves every editing surface shares
web/static/lib/ui      the shared parts: one press (GESTURE), a key's tap, double tap and hold, and its down pose;
                       one stack of open things, one menu;
                       one icon set: icons.js, drawing from web/static/icons/ui.svg
web/static/lib/help    tips, help mode, and the guide renderer
web/static/lib/phone   the phone recorder
docs/embed.go          the guide, compiled into the binary
```

## Data flow

```
USB audio interface (8ch)                 USB MIDI (every rawmidi port)
   │  PortAudio callback: levels,            │  watcher polls /dev/snd; one reader
   │  then hand off. Never blocks.           │  goroutine per port, timestamped reads
   ▼                                         ▼
free/filled block pool                  parser ──► event ring (notes, CC, transport)
   │  (mono ns, frame) pair ──► clock bridge    └──► pulse ring (clock device only) ──► BPM
   ▼                                                        │
ring writer goroutine ──► Ring (RING_SECONDS)               │
   │                          │                             │
   │ Levels (10ms bins)       │ Snapshot(seconds)           │
   ├──► Envelope (whole ring) │                             │
   ▼                          ▼                             ▼
/api/live   (WebSocket)   WAV ─┬──► _preview.mp3      .meta.json (bpm, flags, downbeat)
/api/envelope (ribbon)         ├──► .peaks.json/.bin  .mid + .manifest.json
                                └──► cue points, written into the WAV itself
```
