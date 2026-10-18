# User flows

How Gabe uses Hindsight, written as stories, and the checks that prove each
one still works. This is the shared goal every change is validated against:
a change that passes its unit tests and breaks a flow is not done.

```sh
node scripts/flows.mjs              # all flows, tablet + desktop, own demo
node scripts/flows.mjs J2 J1.6      # by id prefix
node scripts/flows.mjs --profile=phone
```

Setup once: `npm install --no-save playwright@1.49.0 && npx playwright install chromium`.
It needs Go (it runs `go run ./cmd/hindsight --demo` on a free port, data in
a temp dir) and Node 22. A run prints a table; paste it into your report.

## Who and where

- **Main device: an Android tablet, tap and stylus** (1024×768 profile). iPad
  second; the laptop (1440×900) for desk work; a phone for recording and the
  tape upstairs (390×844).
- The rig: a Pi on the TE EP-136 (Sidekick) in the jam room; MIDI clock from
  the Bento; the brothers' kits update from the same releases.
- Two nouns: **takes** (on the shelf, in the Listening Room) and **tapes**
  (in the Studio). One bar (`#np`) plays either, and keeps playing when you
  change rooms.
- "We should just be able to listen to a file, and if need be dive in to
  make notes."

## Status

`core`: built; a failure is a regression. `todo`: agreed but not built; it
reports TODO and never fails the run, and when it starts passing, make it
core. `rig`: needs the hardware; checked by hand, not here.

## The flows

| Id | Story — as Gabe I want to… | Flow | Status |
|---|---|---|---|
| J1.1 | keep the last 30s/2m of the jam from the Studio, so the thing I already played is saved | `j1.1-keep` | core |
| J1.6 | GRAB the last bars into the buffer and DROP them on the armed track | `j1.6-grab-drop` | core |
| J1.10 | fold the bar and the lanes away for room, and have them stay folded | `j1.10-fold` | core |
| J2.2 | tap a take to play it, and keep it playing as I move between rooms | `j2.2-persist` | core |
| J2.4 | jot a note on what's playing without it stopping or leaving the room | `j2.4-note` | core |
| J2.5 | open a take from the bar and star it | `j2.5-open` | core |
| J2.6 | hold a spine to select, delete, and get it back with Undo | `j2.6-tidy` | core |
| J3.2 | bounce the tape to a take on the shelf | `j3.2-bounce` | core |
| J5.1 | open Settings and Releases from either room | `j5.1-sheets` | core |
| C1 | **the jam on the tablet**: GRAB, throw it to the cue lane, launch it on the next bar, drag it to tape | `c1-cue-jam` | todo |

### Not written yet (add a flow before or with the change that touches them)

More to convert: the `[demo]` lines in `docs/guide.md`'s **Checks** blocks (the `[rig]` ones stay manual).

| Id | Story | Status |
|---|---|---|
| J1.2 | flag a moment now; the flag rides into the next take | core |
| J1.3 | select a span of the feed ribbon, then KEEP or GRAB just that | core |
| J1.4 | set BPM/bars, play, and CATCH the last pass onto the armed track | core |
| J1.5 | ● arms one track; holding adds another | core |
| J1.8 | hold the instrument's pads (BREAK, REV, FX…) without touching undo | core (Play mode on) |
| J1.9 | lay out a song: ranges, sections, part gestures, undo/redo | core |
| J2.3 | switch the bar between Feed, Tape and Shelf | core |
| J2.7 | find last month's take: search, filters, archive | core |
| J2.8 | play all, stopped by picking one by hand | core |
| J3.1 | GRAB 4 bars from an old take's page into the Studio, and DROP them | core |
| J4.1 | record from the phone (HTTPS); the take appears after Stop | core |
| J4.3 | send the tape to the phone upstairs (output Jam room / Phone / Both) | core |
| J5.4 | wire an input to a track on the Rig, and see Catch name the tracks | core |
| U1 | the take page has the tape's edit controls (fades, gain, normalize, reverse) | todo |
| U2 | Live feed / Playback output switch with a real live stream | todo |
| U3 | a bookmark drawer replaces the Sketchbook | todo |
| R1 | MIDI first run, hub enrolment, install and update on a Pi | rig |

## Writing a flow

One file per story in `scripts/flows/<id>-<slug>.flow.mjs`:

```js
export default {
  id: 'J2.4', title: 'Jot a note while a take plays',
  // status: 'todo', profiles: ['tablet'], allowHttpErrors: true
  async run(t) {
    const take = await t.api.keep(20);                // seed through the API
    await t.page.goto(`${t.base}/takes.html`);
    await t.step('tap ✎', () => t.tap(t.page.locator('#np-note')));
    t.expect('the take is still playing', await t.poll(() => /* in page */ true));
  },
};
```

- **Act like the user, check like the Pi.** Gestures go through `t.tap`,
  `t.hold` (a real touch hold on tablet, ⇧-click on desktop) and real clicks,
  never `el.click()` inside the page. Outcomes are checked against the API
  (`t.api.takes()`, `t.api.tapeState()`) as well as the screen.
- **Seed what you need; assume nothing.** Flows share one demo per run, in
  file order. `t.api.keep(n)` waits until the take is playable (a tap on a
  take still encoding does nothing); `t.api.tape(name)` loads a fresh tape
  and empties the buffer.
- Any page error or `console.error` fails the flow. A failure saves a
  screenshot (its path is in the report): look at it.
- A new story goes in the table above first, with Gabe's words if he gave
  them.
