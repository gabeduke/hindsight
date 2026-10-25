# User flows

How Gabe uses Hindsight, written as stories, and the checks that prove each
one still works. This is the shared goal every change is validated against:
a change that passes its unit tests and breaks a flow is not done.

```sh
node scripts/flows.mjs              # all flows on their profiles, own demo
node scripts/flows.mjs J2 J1.6      # by id prefix
node scripts/flows.mjs --profile=phone   # only the phone runs
node scripts/flows.mjs --profile=tablet --storyboard=/tmp/sb   # and a page of every screen
```

Setup once: `npm install --no-save playwright@1.49.0 axe-core@4.11.4 && npx playwright install chromium`.
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
| J1.1 | keep the last 30s/2m of the jam from the Studio, so the thing I already played is saved; how much is on KEEP's ▾, whose lengths open under it (Escape or the tablet's Back shuts them, in the Studio), and stays chosen | `j1.1-keep` | core |
| J1.2 | flag a moment now; the flag rides into the next take | `j1.2-flag` | core |
| J1.3 | select a span of the feed ribbon, then KEEP or GRAB just that | `j1.3-span` | core |
| J1.4 | set BPM/bars, play, and CATCH the last pass onto the armed track; the tempo pill is the menu of the bar counts the loop could be, under it, and Escape shuts it in the Studio; Catch's ▾ is a key of its own beside Catch (a finger wide, as GRAB's and KEEP's), goes down under my finger as Catch does, and its menu over it catches the last 1, 2 or 4 bars | `j1.4-catch` | core |
| J1.5 | ● arms one track; holding ● adds another (or takes it off); Catch names the armed tracks; a track's input chip or inspector picks what it records from; the chip's menu opens by it, clear of the bar, and from a keyboard ↓ on the chip opens it on the input chosen (arming nothing) and Escape shuts it | `j1.5-arm` | core |
| J1.6 | GRAB the last bars into the buffer (how many on GRAB's ▾, whose bars open under it, by my finger, with the inputs after them; from the armed track's input) and DROP them on the armed track | `j1.6-grab-drop` | core |
| J1.9 | lay out a song: hold and drag a section on the strip, name it, resize it, tap it to loop it, Duplicate, Remove; hold the ruler for a range, Copy, Delete time; ↶/↷ throughout | `j1.9-song-layout` | core |
| J1.10 | fold the bar and the lanes away for room, and have them stay folded | `j1.10-fold` | core |
| J1.11 | tap a part to select it; Enter or a double tap opens its sheet, → nudges it a bar, a swipe pans, hold-and-drag slides it, ↶ undoes; Escape (the tablet's Back) closes the sheet first and then lets go of the part, and never leaves the Studio; with a track's inspector left open when I tap a part, Escape closes the inspector first, then lets go of the part; on an iPad (a browser without CloseWatcher), Rename opened over the selected part closes on Escape or Back and the part stays selected, and the next Back lets go of it | `j1.11-clip-gestures` | core |
| J1.12 | play the tape from the bar (or Space): reels, the tape's name, a moving counter, and \|◂ back to the loop's start; ▶ goes down the moment my finger is on it, and a quick tap still shows it down | `j1.12-bar-transport` | core |
| J2.2 | tap a take to play it, and keep it playing as I move between rooms | `j2.2-persist` | core |
| J2.3 | switch the bar between Feed (GRAB from the feed into the buffer), Tape and Shelf (with no take, it goes to the Listening Room) | `j2.3-bar-sources` | core |
| J2.4 | jot a note on what's playing without it stopping or leaving the room | `j2.4-note` | core |
| J2.5 | open a take from the bar and star it | `j2.5-open` | core |
| J2.6 | hold a spine to select, delete, and get it back with Undo | `j2.6-tidy` | core |
| J3.1 | GRAB 4 bars from an old take's page into the Studio, and DROP them | `j3.1-take-grab` | core |
| J3.2 | bounce the tape to a take on the shelf | `j3.2-bounce` | core |
| J3.3 | on a phone, with the tape playing on it (as with the interface off), share the mix to send my brother: ⋯ → Share the mix, then the toast's Share hands the share sheet an MP3 named after the tape and the day; Bounce, which needs the jam room, offers it too | `j3.3-share-mix` | core (phone) |
| J4.4 | on a phone, the bar is a mini player above the tabs, with \|◀ beside ▶ ("I looked for \|◀ and didn't find it"), back to the loop's start or the take's, and Catch with its ▾ beside it, the window keeping its bar number; a tap pulls the player up, where Catch's ▾ opens its menu under the pair and Back closes that first, then Back puts the player away and stays in the Studio (Android's Back is a close request, which the flow sends as Escape; in a browser without CloseWatcher, the history's Back); a tapped clip's bar floats above the player; Insert asks before it moves the tape; the ruler's keys are one key, ⌗, whose menu sets the snap ("smooshed into the phone UI") | `j4.4-phone-bar` | core (phone) |
| J5.1 | open Settings, Releases, help mode, the guide and the rig from the one menu (☰) in either room, on a tablet, a computer or a phone; it hangs under ☰, all of it on the screen; Escape (or the tablet's Back) shuts ☰ and leaves me in the room, and switching rooms shuts it too, never leaving it open over the other room; from a keyboard, ↓ on ☰ opens it on Settings, ↓ moves along it (in the Studio, without arming another track), and Tab shuts it | `j5.1-sheets` | core |
| C1 | **jam on the tablet**: GRAB, throw it to the cue lane, launch it on the next bar, drag it to tape | `c1-cue-jam` | core |

### Not written yet (add a flow before or with the change that touches them)

More to convert: the `[demo]` lines in `docs/checks.md` (the `[rig]` ones stay manual).

| Id | Story | Status |
|---|---|---|
| J1.8 | hold the instrument's pads (BREAK, REV, FX…) without touching undo | core (Play mode on) |
| J2.7 | find last month's take: search, filters, archive | core |
| J2.8 | play all, stopped by picking one by hand | core |
| J2.9 | write notes on a take as it plays: ✎, words, its pin on the waveform, a tap on its time goes there, ✕, and Undo brings it back (`listening-back.md`) | todo |
| J4.1 | record from the phone (HTTPS); the take appears after Stop | core |
| J4.3 | send the tape to the phone upstairs (output Jam room / Phone / Both) | core |
| J5.4 | wire an input to a track on the Rig, and see Catch name the tracks | core |
| U1 | the take page has the tape's edit controls (fades, gain, normalize, reverse) | todo |
| U2 | Live feed / Playback output switch with a real live stream | todo |
| U3 | the notes drawer replaces the Sketchbook, the same in both rooms and on Open (`listening-back.md`) | todo |
| R1 | MIDI first run, hub enrolment, install and update on a Pi | rig |

## What a run says

Each run prints as a scenario, Given (setup) / When (what Gabe does) /
Then (what should follow), every line marked:

```
Scenario: C1 Throw a grab to the cue lane and launch it [tablet]
      Given a fresh tape
        And 15s of the jam in the feed
       When tap GRAB
  ✓    Then the buffer opens with the grab
  ✗    Then it started on a bar line  -- started at 1203, bar 96000
```

**Layout checks** run on every screen a flow leaves (before each When, and
at the end), with no LLM (`scripts/flows/layout.mjs`):

- **covered:** a control whose middle is under something else, so a tap
  lands there instead. A sheet or menu open over the page, and content
  scrolled under the pinned bar, don't count.
- **offscreen:** a control cut off by the side of the screen.
- **menu-offscreen:** an open menu, or a key's ▾ panel, whose box the
  screen cuts at a side, the top or the foot (Open's ⋯ opens at x −144 on
  a phone: no flow opens it there yet, see `docs/plan/STATE.md`). Each
  screen's line keeps the menus open as it was checked (`menus` in
  `--json`), and a flow's `checksMenus` (ids) fails it unless the checks
  saw each one open: J5.1 has ☰, J3.3 ⋯, J4.4 ⌗'s menu, J1.4 the tempo's
  and Catch's, J1.5 the input chip's. A step that opens a menu, then a
  step that uses it, is what puts an open menu in front of the checks.
- **target-size:** axe-core's WCAG 2.2 rule, under 24 px with too little
  room around it.
- **Warnings only:** a label cut off; a control under 44 px on a touch
  profile; a toast over a control.

A layout fail fails the flow, except one in the baseline
(`scripts/flows/layout-known.json`): the findings that were there when the
checks came in, shown as "known". Fixing one and running
`node scripts/flows.mjs --update-layout-known` (the whole run) takes it out.
A run of some flows or one profile leaves the shelf and tapes in a
different state, so it can meet a finding the whole run doesn't (a shelf of
three takes spaces its buttons differently): if it's real, add it to the
baseline by hand. So can CI, whose fonts differ from a laptop's (a
different button is the one pushed off the side): CI's run is the one the
baseline has to pass. A meant overlap goes in `layout-allow.mjs`, with why. Neither file is for
quieting a finding nobody looked at.

**The storyboard** (`--storyboard=dir`) writes `dir/index.html`:
- a card per run: the story, each step with a picture of the screen it
  left, and its findings;
- the **coverage map**: controls with an id that no flow's input reached,
  by panel or sheet, and the stories with no flow.

CI keeps it as the `flow-storyboard` artifact on every run.

**Claude's review** (`--review`, with `--storyboard`) is opt-in. It reads
each card (story, steps, screens, and the layout findings as facts) and
writes notes on whether the flow makes sense to a person, on the storyboard.
- **It never passes or fails anything.**
- **Cost:** a review is cached (`.cache/flows-review`) by the flow's
  source, the UI's files, the steps and the findings, so a card is paid for
  again only when one of those changed. The run prints what it spent.
- **Setup:** it needs `ANTHROPIC_API_KEY`; `FLOWS_REVIEW_MODEL` picks the
  model.
- **In CI:** `ux-review.yml` runs it on the tablet profile for a PR labelled
  `ux-review`, or by hand (Actions → UX review → Run workflow).

## Writing a flow

One file per story in `scripts/flows/<id>-<slug>.flow.mjs`:

```js
export default {
  id: 'J2.4', title: 'Jot a note while a take plays',
  // status: 'todo', profiles: ['phone'] (default tablet + desktop), allowHttpErrors: true,
  // checksMenus: ['#tape-actions'] (the layout checks must see it open)
  async run(t) {
    const take = await t.given('a take on the shelf', () => t.api.keep(20)); // seed through the API
    await t.given('the Listening Room is open', () => t.page.goto(`${t.base}/takes.html`));
    await t.step('tap ✎', () => t.tap(t.page.locator('#np-note')));      // When
    t.expect('the take is still playing', await t.poll(() => /* in page */ true)); // Then
  },
};
```

- **Act like the user, check like the Pi.** Gestures go through `t.tap`,
  `t.hold` (a real touch hold on tablet, ⇧-click on desktop) and real clicks,
  never `el.click()` inside the page. Outcomes are checked against the API
  (`t.api.takes()`, `t.api.tapeState()`) as well as the screen.
- **Say it as Gabe would.** `t.given` for setup, `t.step` for each thing
  he does, `t.expect` for what he'd see. The names are the report and the
  storyboard's captions, so write them as sentences, not code.
- **Seed what you need; assume nothing.** Flows share one demo per run, in
  file order. `t.api.keep(n)` waits until the take is playable (a tap on a
  take still encoding does nothing); `t.api.tape(name)` loads a fresh tape
  and empties the buffer.
- `FLOWS_CPU=4 node scripts/flows.mjs` runs the pages four times slower,
  as a CI runner can: a flow that passes only on a fast machine is racing
  the app (and the app may be racing a person on an old tablet).
- Any page error or `console.error` fails the flow. A failure saves a
  screenshot (its path is in the report): look at it.
- A new story goes in the table above first, with Gabe's words if he gave
  them.
