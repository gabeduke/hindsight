# The instrument strip and the control bus (P3)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** the *Play & FX* page of
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Supersedes decisions 2 and 3 of [Play mode](2026-10-14-play-mode-design.md),
and fills in *MIDI* from [the sound spec](2026-10-14-play-mode-sound-design.md)

## Why

Play mode makes sound (#99–#101), but:

- it is a separate screen behind a floating button that Gabe didn't see on a
  phone, because it sat over the Tape tab;
- Gabe expects to play it *"often… by external midi devices or a keyboard"*,
  and nothing on the Pi listens to a controller yet. Incoming notes and CC go
  only to a take's `.mid` (`internal/midi`, `onEvent`).

Decision 2 of the rooms note puts the instrument on the Studio itself, and
this spec gives every hand one way in.

## What

### The strip

- **It's a drawer.** The Tape page already docks drawers above the
  now-playing bar (`.np-dock`: Record · Catch, Clipboard · Edit, Crate), and
  the lanes give them the room. The instrument is one more, **INSTRUMENT ▴**,
  so it needs no new layout.
- **Folded,** it is one row in the bar: the track keys and the six tricks as
  small pads with their legends, still live. Whatever plays them, they light.
- **Unfolded** (the canvas's *Studio · performing*):
  - the reel and loop ring;
  - the four track keys;
  - the tricks;
  - the punch-in FX and tape mods from P4, shown when that lands;
  - a *playing from* line.

  It saves as a per-device convenience in `localStorage`, like `tape.ask`. It
  isn't in `DEVICE_PREFS`.
- **On a phone**, an **EDIT | PLAY** toggle sits in the mini player. PLAY
  turns the bottom panel into the instrument (the canvas's *phone ·
  performing*), and EDIT gives the drawers back. The floating PLAY button goes.
- **The flag stays `hindsight.play`.** The strip replaces the overlay
  outright: one surface, not two. `mount.js` builds into the drawer instead of
  `#play-mode`, and `enterButton()` is removed.

### The reel is the ring

Handoff item 2 of 2026-10-15, built here:

- **The loop is a ring around the reel**, from `clock.js`'s `ringAt`:
  - bar ticks around the flange;
  - the playhead sweeping in orange;
  - bar and beat in the hub, on the LCD.
- **The reel answers the Pi's `at` message,** when the sound changes, through
  `motion.spin()` on the shared ticker:

  | Trick | The reel |
  |---|---|
  | REV | runs backwards |
  | STOP | winds down with inertia over the beat |
  | ½× · 2× | changes speed |
  | CHOP | rocks |
  | BREAK | keeps turning while the sound cuts |

  The pad's dim state answers the touch at once; the reel moves when the
  sound does.

### Whose keys are they?

With Play mode on the same page as the editor, keys collide. Today's tape
page binds R (record), K (click), J (back 5 s), S (split), 1–4 (arm),
⌫ (delete clips), ↵ (align) and Space (play).

**The rule: the strip has the keyboard while it is unfolded.** A **KEYS**
lamp on the strip says so. Folding it, or tapping the lanes, gives the keys
back to editing. MIDI and touch always play, in either state.

| Key | Edit keys (strip folded) | Play keys (strip unfolded) |
|---|---|---|
| 1 2 3 4 | arm a track (today) | drop that track out, held (built) |
| Q W E R | — · — · — · **record** (today) | BREAK, REV, CHOP, STOP, held (built) |
| Z X | — | ½×, 2× (built) |
| T Y U I | — | ROLL, FILTER, ECHO, CRUSH (P4) |
| C | **CATCH** (new) | CATCH |
| G | **GRAB** (new) | GRAB |
| K | **KEEP** (new; the click moves to **M**) | KEEP |
| ↵ | DROP while the buffer is open; otherwise as today | DROP |
| [ ] · ⇧[ ⇧] | move the buffer's IN · OUT | — |
| ⇧ held | — | latch: what's held stays held after the key lifts |
| 5 6 7 8 9 0 | — | crate pads, phase 2 (moved from A–L) |
| Space | play/stop | play/stop |
| Esc | closes things (today) | lets go of everything (`release_all`) |

Unchanged from `keymap.js`: keys are read by physical code, repeats are
ignored, a field being typed in never plays (`typingInto`), and a lost
window or hidden tab releases everything.

### One bus

```
touch    ─┐                       held    → Surface → press / release ─┐
keys     ─┤                       amount  → params  → set ─────────────┴→ /api/tapes/play
Web MIDI ─┼→ controls.js, by kind  latched → tape PATCH (P4)
Pi MIDI  ─┤                       command → catch · grab · drop · keep · transport
pedal    ─┘
```

- **`lib/play/controls.js`** (new) is the list of actions.
  - Each has an `id`, a `kind` (held, amount, latched, command), its
    `keys` and its default `midi`.
  - `keymap.js` derives `KEYMAP` and `COMMANDS` from it, so the table above
    is written once.
  - The canvas's *One bus, every hand* board is the full list with MIDI
    defaults: notes 36–53 for pads and verbs, CC1 for FILTER's amount, CC 21–24
    for the mods, CC64 to latch, pitch bend for the varispeed nudge.
- **The mirror is already there.** Every connection to `/api/tapes/play`
  reads the shared trick log (`TrickEventsSince`). So an `at` from any
  source lights its pad on every screen. Pads lit by another hand show only
  the bright state, because the dim one is the local touch's.
- **Holds are already shared.** `playHolds` counts holders per pad across
  connections. The first holder's quantum wins, and only the last release
  lets go. MIDI on the Pi joins as one more holder.

### MIDI on the Pi (the primary path)

Decision 10 of the sound spec: the controller plugs into the Pi. It is
steadier than Wi-Fi (about 230 ms against 230–260 ms jittery), and about
120 ms once the sound spec's immediate re-render lands.

- **`TAPE_CONTROLLER`** (new setting, in `/api/settings`): name substrings,
  matched as `MIDI_DEVICES` is. The watcher opens those devices even with
  `MIDI_CAPTURE` off. Their notes and CC go to the bus as well as to
  capture.
- **Bindings** live in `TAPE_DIR/controls.json`, keyed by controller name:
  `GET` and `PUT /api/tapes/controls` (new).
  - They are the Pi's, shared by everyone, like its settings.
  - A known controller ships a profile; anything else starts at note 36 and
    counts up.
- **A controller is a holder.** It joins `playHolds` as `midi:<port>`. When
  the watcher sees the port disappear, its holds are let go, as a dropped
  socket's are.
- **Commands from the Pi** run on the Pi:
  - CATCH (`Engine.Catch`) and the transport;
  - GRAB into the clipboard, which pages see on their next poll, so the buffer
    opens;
  - DROP on the armed track at the next free span;
  - KEEP of the feed.

  A page is never needed for a verb.

### MIDI in a browser (the fallback)

- A Web MIDI adapter in `lib/play/midi.js`, about a hundred lines, calling
  `press` and `release` as the keyboard adapter does.
- **Its bindings are this device's,** keyed by port name in `localStorage`.
- **Limits, said in the UI:**
  - Web MIDI needs a secure context: the hub's HTTPS name, or localhost.
  - Safari has no Web MIDI, so on an iPhone or iPad the controller goes into
    the Pi.

### MIDI learn

**MIDI LEARN** on the strip:

1. every pad shows its binding (a dash if none);
2. tap a pad or a knob, and it blinks;
3. move a control on the controller, and the binding is written on the pad.

Esc cancels.

- **For the Pi's controllers,** learn travels over the play socket:
  - page → Pi `{t:"learn", action}`;
  - Pi → page `{t:"learned", action, midi}`, or `{t:"refused"}` after 10 s.
- **For a browser controller,** learn is local.

### The socket, extended

Today:

- page → Pi: `press {pad, q}`, `release {pad}`, `release_all`;
- Pi → page: `hello`, `lead`, `at {pad, on, pos, in_ms}`, `refused`.

| New | Way | For |
|---|---|---|
| `press {pad, q, v}` | page → Pi | `v`, 0–1: velocity, for amounts read at the press (P4) |
| `set {pad, v}` | page → Pi | an amount moving while held: aftertouch, the mod wheel. At most 30 a second |
| `learn {action}` · `learned {action, midi}` | both | MIDI learn on the Pi |
| `at {…, v}` | Pi → page | the amount, so other screens draw it |

The read limit (1024 bytes) and the 16-slot `refused` channel are enough.

## Decisions (recommended picks)

1. **The strip is a drawer,** not a new region. The layout already makes
   room for drawers.
2. **The strip has the keyboard while unfolded,** with a lamp that says so.
   One page with two meanings for R and 1–4 needs a visible owner, and
   unfolding is the gesture that means *I'm playing now*.
3. **K is KEEP everywhere; the click moves from K to M** (metronome). KEEP is
   the dashcam's one action and deserves the plain key. The guide and `TIPS`
   change with it.
4. **The controller goes into the Pi first;** Web MIDI is the fallback. That
   is steadier, works for iPhones, and lets a verb run with no page open.
5. **Bindings are data, not settings:** `controls.json`, with its own route,
   because a map of notes isn't an environment variable.

## Not in this

- **The sounds of ROLL, FILTER, ECHO and CRUSH, and the tape mods.** That is
  P4. This spec only gives them pads, keys and a message.
- **Crate launch pads.** Phase 2 of Play mode; only their keys move here.
- **A pedal on GPIO** (`TAPE_PEDAL`, designed in the tape spec, not built).
  A MIDI footswitch is a CC, and learns like any other.
- **Remapping the computer keys.** The table above is fixed, as Play mode
  decided. MIDI is where remapping matters.

## Checks

- JS:
  - `controls.js` is the only list: `KEYMAP` and `COMMANDS` derive from it,
    and every action has a key or a MIDI default;
  - with the strip folded, R records and 1 arms track 1; unfolded, R is STOP
    and 1 drops track 1 out;
  - Web MIDI note on/off maps to press/release;
  - running status and note-on with velocity 0 count as off.
- Go:
  - a controller's note becomes a `Press` on the render head, quantised like a
    page's;
  - its holds count in `playHolds`, and are let go when its port goes;
  - `learn` binds the next note or CC from that controller and nothing else;
  - `controls.json` round-trips.
- **In a browser,** with the flag on and off, at phone and desktop size, in
  both schemes:
  - a key on a controller lights its pad on two screens;
  - the phone's EDIT | PLAY toggle is visible without scrolling;
  - the KEYS lamp is honest.
