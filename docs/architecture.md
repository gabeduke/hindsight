# Architecture

One Go binary. It opens an audio device, keeps the last `RING_SECONDS` in RAM,
and serves a small vanilla-JS UI. No database, no message broker, no build
step for the frontend. How each part works is in `docs/architecture/`, one
file per area; read the one you are changing, and change it in the same pull
request. Why things are the way they are is in `docs/decisions/`.

- [code-map.md](architecture/code-map.md): every package and `web/static`
  directory in a line, and the data flow from the interface and MIDI to the
  files on disk.
- [capture.md](architecture/capture.md): the capture path: the callback
  that never blocks, PortAudio's one enumeration, input latency, the
  `Source` seam and the demo, the server-side envelope, the ffmpeg trap.
- [midi.md](architecture/midi.md): every MIDI port without cgo,
  controllers and their bindings, the clock bridge, the tempo map and why
  takes start on a downbeat.
- [keyboard.md](architecture/keyboard.md): the SMK-37 on Hindsight's own
  firmware: the client, its screen on protocol version 2, its lights, the
  unit as it is, and what was learnt on it.
- [takes.md](architecture/takes.md): takes on disk: their files, complete
  or invisible, one writer per take, any span of the ring, undo, the trash,
  the cached list, the peaks pyramid, phone recordings, the shares queue.
- [tape.md](architecture/tape.md): the tape engine and its timing: the
  model, store, renderer, transport, when a pad lands, catching, the
  output, alignment, recording, free loops, the crate and clipboard,
  editing, mixdown, export, the MIDI clock, the cue lane, the feed strip.
- [push.md](architecture/push.md): the tape's revision, the
  `/api/tapes/changes` socket and the keyboard's press on it.
- [shell.md](architecture/shell.md): the UI and the shell: views and
  `ctx`, the router, moving between rooms, one way to close things, menus,
  the bar's engine, the frame (the header), waking up.
- [bar.md](architecture/bar.md): the bar: its zones, what shows for each
  source, its widths, its display, its fold.
- [rooms.md](architecture/rooms.md): the rooms' words (the vocabulary,
  the verbs, a take's one name) and the Listening Room as a library.
- [css-and-motion.md](architecture/css-and-motion.md): the stylesheets
  (a file per place), icons, the scene contract, a frame's budget, motion.
- [take-page.md](architecture/take-page.md): Open (`wave.html`), its
  modules and the rules that hold it together.
