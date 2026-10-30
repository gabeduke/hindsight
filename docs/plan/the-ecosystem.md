# The ecosystem

> A spec, not yet agreed. Gabe, 2026-10-29: the UX *"is kind of chaotic and
> all over the place"*, *"I can't set the tempo anywhere"*, and *"I'm
> picturing this being more of an ecosystem of components than a single
> app"*, reached from the tablet and laptop (the DAW and post-processing),
> the Pi with its MIDI controls (the real-time audio handler), and the
> SMK-37 (a hardware surface for the tape). Nothing here is built. The
> walkthrough (*To settle*, below) comes before any code.

The review page this was written from, with the diagrams and the
mockups: [The Hindsight ecosystem](https://claude.ai/artifact/XTWpyKFHcn14cCzBE2cdCo).
The mockups' canvas: [Hindsight · The kit](https://claude.ai/artifact/4fJSP7iBAvLS2uMuBJ4xhg)
(`docs/development.md`, *Design canvases*). Both are private until Gabe shares them.

## The idea, to test in the walkthrough

**Limits for the hands, freedom for the screens.** The OP-1 field feels good
because its limits decide for you: a few tracks, a tape you can't endlessly
edit, so you commit. Hindsight wants that while you play, and it also wants
nothing you played lost and everything reworkable later. So, two layers on
one engine:

- **The instrument layer** (the SMK-37, other controllers, perhaps the
  tablet's Jam screen) has a fixed shape: a loop, four tracks, the pads, a
  few verbs, no menus. The ring is always recording, so committing costs
  nothing.
- **The workspace layer** (the Studio, the Listening Room, the laptop, the
  phone) works on the same tape and takes with the limits off. Gabe,
  2026-10-30: the screens are *"more purpose driven workspace, which it
  already kind of is"*; *"the instrument idea is something i'm still
  grappling with"*.

This is a reading of what Gabe said, not a decision.

## What is there today

All of it from reading the code at v2026.10.30.1; nothing was run, so the
counts are close, not exact.

- **The Pi is already the one brain** ([0017](../decisions/0017-our-own-controller-firmware.md)):
  the ring, takes, tape, transport, cue lane, clock and bindings live there;
  every other device is a view or a pair of hands on it, and nothing syncs
  between devices. Every direction below keeps this.
- **The verbs reach the engine two ways.** A controller's run `piVerbs.Verb`
  (`internal/api/controls.go`); the tablet calls REST routes. They refuse
  differently and say different words.
- **One fat read, one fat write.** `GET /api/tapes/state` is the only read
  of the tape, and every client re-reads all of it on each nudge;
  `PATCH /api/tapes` takes about fifteen optional fields and infers the kind
  of undo from which are set. Takes and capture have no push: `/api/jams` is
  fetched by about seven modules, `/api/status` polled by eight.
- **A few files own whole pages**: `lib/tape/page.js` (5,160 lines, about
  140 page-wide ids), `lib/wave/page.js` (2,013, with a bar of its own),
  `TakesList` (1,171). Pieces talk through about fifteen `document` events
  (`hindsight:tape-state`, `play-transport`, `verb`, …) instead of
  interfaces. About a hundred modules already have no DOM, and the notes
  drawer (`createNotesDrawer`, given a `source`) and `mountCueLane` already
  have a component's shape.
- **Too many ways to do one thing**: KEEP has about seven entry points,
  Record about six, there are five kinds of selection each with its own
  action bar, and downloads appear in about five places.
- **Tempo has no home.** A tape's tempo is one `tape.Grid{Frames, Bars}` in
  4/4; a BPM can be typed only on an empty tape, and after that the tempo
  key only halves or doubles the bars. The MIDI clock in stamps takes but
  the tape never reads it, and `TAPE_CLOCK=follow` isn't built. Clips play
  at the speed they were recorded: changing the tempo with audio down means
  moving the bar lines, varispeed, or stretching. Six places show a tempo,
  from three sources.

## The shape

Five layers, the same for every surface:

1. **Engine**, the Pi: capture and the ring, takes, the tape, the clock,
   MIDI and the control bus, the keyboard's screen.
2. **Protocol**: one verb set every surface calls, the same refusals and
   words; state and events, versioned; the audio streams (the phone,
   Sonos later).
3. **Models**, a client library with no DOM: `tape`, `takes`, `take`,
   `feed`, `transport` and tempo, `rig`; each its state, its commands and
   `onChange`, its polling and push its own.
4. **Components**, each mounted as `mount(root, model, {layers, toast})`,
   its ids scoped to its root, no page-wide events.
5. **Surfaces**: arrangements of components. The tablet's workspaces, the
   laptop, the phone, and the SMK-37's screen (the same components reduced,
   drawn by the Pi as now).

### Directions

| | What | For | Against |
|---|---|---|---|
| A | Tidy the one app: a model per noun, components out of the big files | Least churn; every step ships | The keyboard and controllers stay a world of their own |
| **B** (recommended) | **A kit on a protocol**: one verb set, a client library, eight components; surfaces are arrangements | Moving a piece or adding a surface is a layout change | The protocol needs care and a version before anything new is drawn |
| C | Separate apps (instrument, studio, library) on one client library | Each small and opinionated | The most work; take → tape becomes a hand-off between apps |

B is reached through A: tidy one area at a time, and land each on the
protocol.

### The components (proposed)

Transport (▶, where, the tempo), Tempo (type, nudge, tap, follow a clock;
½ and ×2 for the loop), Capture (the always-on ring: GRAB or KEEP what just
happened), Pads (the cue lane's clips), Tape (tracks, parts, sections, the
loop), Library (every take, by day: search, sort, star, open), Take (one
take: hear it, select, notes), Rig (what comes in, where it goes out, whose
clock, the Pi's state).

### The verbs (proposed)

Six for fourteen: **GRAB** to your hand (for Catch, Cut, the buffer's CUE);
**KEEP** to the shelf (for Capture, Bounce, the buffer's KEEP); **DROP**
from your hand onto a track or a pad; **NOTE**, a mark in time with or
without words (for Flag and ✎); **×**, let go of what is in your hand (for
Toss); **Export**, out of Hindsight from a name's menu (for Download, Share,
Bounce to a file).

### The tablet

Purpose-driven workspaces, as Gabe put it: Jam, Build, Listen, each a few
components arranged for one activity. The canvas also shows a fixed
instrument screen and freely rearranged panels, for contrast.

## To settle

The walkthrough. My recommendation first where there is one.

**How Gabe plays**
- His last real jam, minute by minute: what his hands touched, where his
  eyes were.
- When something good goes by, is the first move the keyboard, the tablet,
  or nothing (sort it later)?
- Could a whole session be played without touching the tablet? Should it?
- Which actions must feel instant (pads, PLAY, knobs), which are fine at
  50 ms, or a second?

**The instrument**
- What should it refuse to do? Which limits would he accept?
- Is the tablet's Jam screen part of the instrument, or a view of it?
- The keyboard's REC: punch-in on the armed track (the plan), or KEEP as
  now? Should GRAB from the keyboard take the tape's output, not the room
  (`the-map.md`)?
- Which controller gets a map next (FM-1, MPC Sample, POs, AKS Mini)?

**Time**
- One tempo per tape, shown the same everywhere (recommended). Where does
  he look for it while playing?
- Changing it with audio down: move the bar lines (recommended first: the
  cheapest, and the audio is untouched), varispeed like tape, or stretch.
- The clock master: the tape (today), the MPC Sample or the Bento? Is
  following a clock wanted?

**Pruning**
- Do the six verbs cover everything? What is missing?
- Capture as its own tab, Open as its own page, the Rig's cables: keep,
  merge or cut?
- Is the laptop a real surface, or desk work the tablet could do?
- Should the tablet mirror the keyboard (a pad strip, the Mixer page), and
  hide it once learned?

**Away, sharing, other people**
- What does "away" mean: upstairs on the Wi-Fi, a friend's house with the
  box, or offline with a phone or pocket gear?
- Would a phone that records while the Pi is unreachable, and syncs later,
  be used?
- Should takes, tapes or controller maps ever move between two Pis?
- What may the hub do beyond names and certificates: installs, feature
  switches, shared maps, share links?
- Sharing: an MP3 through the share sheet, or a link the brother can open
  and comment on?
- Who else uses a kit, and do they see a different face, fewer features, or
  the same app?
- Should the Pi's API have any access control, with kits on other people's
  networks?

## Build order

Each step its own PR (or a few), with its flows; the walkthrough decides
what is on the list.

1. **The walkthrough.** Each feature marked keep, merge or cut; the
   instrument's shape settled; this spec's decisions written in.
2. **One verb set** on the Pi: the tablet and the controllers call the same
   code, with the same refusals and words. Retire the buffer's routes
   (STATE.md, *Next*).
3. **Tempo gets a home**: a tempo component and a Pi call that sets it at
   any time (moving the bar lines first), then following a clock. Its own
   spec.
4. **Models per noun**: the client library (`tape`, `takes`, `take`,
   `feed`, `transport`, `rig`) owning polling and push; takes and capture
   get push.
5. **Components out of the big files**: Transport and the take browser
   first, the tape editor last. Steps 4 and 5, the component contract and
   the protocol under them: `components.md`.
6. **Workspaces**: Jam, Build and Listen on the tablet; the laptop and the
   phone as other arrangements.
7. **The look** (the play look, PR #218, unmerged) on components, not
   pages.

Steps 2 and 4 change no behaviour and can run before the walkthrough ends;
nothing user-visible merges before it. Open's rebuild (#220) and the play
look (#218) wait for it too.
