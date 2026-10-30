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

- **Main device: an Android tablet, tap and stylus** (1024×768 profile; a
  Pixel Tablet's own 1280×800, `pixel`, and held upright at 800×1280,
  `upright`, where a flow says so). iPad second; the laptop (1440×900) for
  desk work; a phone for recording and the tape upstairs (390×844).
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
| J1.3 | select a span of the feed ribbon, then KEEP or GRAB just that (GRAB onto the cue lane, its drawer open) | `j1.3-span` | core |
| J1.4 | set BPM/bars, play, and CATCH the last pass onto the armed track; the tempo on the bar's display (not the header, which has none) is the menu of the bar counts the loop could be, beside it, and Escape shuts it in the Studio; Catch's ▾ is a key of its own beside Catch (a finger wide, as GRAB's and KEEP's), goes down under my finger as Catch does, and its menu over it catches the last 1, 2 or 4 bars | `j1.4-catch` | core |
| J1.5 | ● arms one track; holding ● adds another (or takes it off); Catch names the armed tracks; a track's input chip or inspector picks what it records from; the chip's menu opens by it, clear of the bar, and from a keyboard ↓ on the chip opens it on the input chosen (arming nothing) and Escape shuts it; another track's mute, with one armed: on a touch screen the head is the name, ● a finger wide, the input and ›, which opens that track's inspector in one tap (and stays on it, arming nothing), where Mute is, and › is lit while it's muted; with a mouse M, S and the level are in the head and there's no › | `j1.5-arm` | core |
| J1.6 | GRAB the last bars onto the cue lane (how many on GRAB's ▾, whose bars open under it, by my finger, with the inputs after them; from the armed track's input), its drawer open above the bar with every track still in sight above it (*"GRAB's buffer pushes the cue lane and the tracks under the bar, so DROP is pressed blind"*, the studio space's audit), and DROP them on the armed track | `j1.6-grab-drop` | core |
| J1.9 | lay out a song: hold and drag a section on the strip, name it, resize it, tap it to loop it, Duplicate, Remove; hold the ruler for a range, Copy, Delete time; ↶/↷ throughout. Beside the ruler, the one key is ⌗, the View menu, opening beside it: the snap (Bar, Beat, ⅛, Off), Lock the loop, Fold the tracks and, on a touch screen, Ask before Insert and Delete time, ticked; Escape shuts it in the Studio | `j1.9-song-layout` | core |
| J1.10 | fold the bar and the lanes away for room, and have them stay folded; the bar folds by the grabber on its top edge (a tap, or a drag down; a drag up unfolds it), not a ▾ beside Catch's ▾, and slides as it goes, ▶ staying put; the lanes fold from ⌗'s View menu (Fold the tracks, ticked while they're folded) | `j1.10-fold` | core |
| J1.11 | tap a part to select it; Enter or a double tap opens its sheet, → nudges it a bar, a swipe pans, hold-and-drag slides it, ↶ undoes; Escape (the tablet's Back) closes the sheet first and then lets go of the part, and never leaves the Studio; with a track's inspector left open when I tap a part, Escape closes the inspector first, then lets go of the part; on an iPad (a browser without CloseWatcher), Rename opened over the selected part closes on Escape or Back and the part stays selected, and the next Back lets go of it | `j1.11-clip-gestures` | core |
| J1.12 | play the tape from the bar (or Space): reels, the display saying it plays the tape (its name to a screen reader), a moving counter, and \|◂ back to the loop's start; ▶ goes down the moment my finger is on it, and a quick tap still shows it down; ● (Record) sits beside ▶, red, as in any DAW | `j1.12-bar-transport` | core |
| J1.13 | find ▶ where my hand left it: the bar keeps one shape for the tape, the live feed and a take, in the Studio and the Listening Room, on a tablet on its side, a Pixel Tablet's 1280×800 and one held upright at 800, with nothing past the screen's edge (▶ once stood at three places on one tablet, and the bar ran 336 px off it with a take in it) | `j1.13-bar-shape` | core (tablets) |
| J1.14 | see on the tablet what was pressed at the Pi (*"could we start pushing state to the UI"*): ▶ and ■ pressed at the Pi, as a controller presses them, and a rename show in the Studio within 100 ms, and ▶ in the bar in the Listening Room after the Studio, each the slowest of five (*The revision* in `docs/architecture/push.md`) | `j1.14-follow-the-pi` | core |
| J1.15 | see on the bar what I pressed on the keyboard (*"often when playing an instrument you develop an intuitive feel by watching something"*; the-instrument.md, step 7, *The tablet*): PLAY, STOP, a refused CATCH, GRAB and DROP pressed on the SMK-37 (a FIFO for its node in the demo, `api.keyboard()`) each show their words over the bar's display, after the keyboard's icon, within half a second, and go after about a second, in a live region a screen reader hears; PLAY green and STOP lighting ▶, DROP lighting the head of the track it went on (GRAB and DROP on the tablet and the desktop, as J1.6), a refusal an amber band lighting nothing; ▶ never moves; in the Studio and in the Listening Room, and there with a take in the bar too (the keyboard plays the tape whatever the bar holds) | `j1.15-keyboard-note` | core (tablet, desktop, phone) |
| J1.16 | have the Studio on one screen on the tablet (*"moving unnecessary buttons into drawers or menus and focusing on the handful of main user flows"*; `the-studio-on-one-screen.md`): at rest, at most 44 controls on the screen and 1 under 32 px (the sections' strip), every track's ● 44 px or more, and all four tracks above the bar, at 1024×768, 1280×800 and upright at 800; M, S and the level a tap away, in the inspector › opens (`STUDIO_BUDGET`, `scripts/flows/layout.mjs`; it only goes down) | `j1.16-on-one-screen` | core (tablets) |
| J2.2 | tap a take to play it, and keep it playing as I move between rooms; the switch turns the camera from one wall of the room to the other (the Studio on the left, the shelves on the right), while the header holds still and the bar is never turned with the room, and a tap on ▶ as it turns isn't lost, while a tap on the shelves as it turns does nothing (they aren't where they show yet) | `j2.2-persist` | core |
| J2.3 | choose what the bar plays from its display: the source on the window (TAPE, FEED or the take's name) opens the tape, the live feed (whose GRAB sends it onto the Studio's cue lane), the last few takes and Go to the shelf (the Listening Room), with ▶ in one place for each; the Feed \| Tape \| Shelf switch on the bar is gone | `j2.3-bar-sources` | core |
| J2.4 | jot a note on what's playing without it stopping or leaving the room: ✎ at the bar's right end, on the screen at 1024 and 1280, brings up the notes drawer at the moment I heard (*✎ at 0:09*), the words ready; Enter puts the note there, a line with its number and time, and a tap on its time goes back there, the take playing on | `j2.4-note` | core (and 1280×800) |
| J2.5 | open a take from the bar and star it: Open › at the bar's right end, on the screen with no sideways scroll, at 1024 and 1280 (*"getting from a take into its page was awkward"*), dollying in to it; and a double tap on its spine opens it too, playing on into its page; there the header is ‹ Takes, the take's name, its star and tag, then ↶ and ☰, with no ◂ ▸ or ⋯ of their own: the name is the take's menu (Rename…, the takes either side by name, the downloads, Delete last), and Rename… names it in place; beside the waveform the notes drawer is docked, and under it are GRAB, KEEP and More, then Fine tune ▸ and MIDI ▸, folded (*"the page's keys were awkward once there"*) | `j2.5-open` | core (and 1280×800) |
| J2.6 | hold a spine to select, delete, and get it back with Undo | `j2.6-tidy` | core |
| J2.7 | find last month's take ("the listening room has a lot of wasted space that could be dedicated to organization of the music library"): a word printed on its spine, typed in the search, finds it in the List, right under the field and above where the keyboard comes up, and a tap plays it under that name; Cancel empties the search; Sort ▾ → Oldest puts last month first and ★ leaves only the starred; on the shelf wall, last month's All › opens that month alone and ‹ The room goes back; Shelf \| List is remembered on this device, and a phone starts on the List; on a tablet, a long library's wall scrolls up and down under a finger that starts on a spine, and that spine doesn't play | `j2.7-find` | core (tablet, desktop, phone) |
| J2.9 | write notes on a take as it plays, on its page: ✎ in the bar, the words beside the waveform where the take was, Enter; its pin on the waveform is its note (a tap puts me in its words); a tap on its time goes there; ✕ takes it out, and Undo brings it back | `j2.9-open-notes` | core (and 1280×800) |
| J2.10 | turn from the Studio to the Listening Room and back with the desk in front of me holding still: the header and the bar keep their place and size before, through and after the turn (`the-studio-space.md`, *The studio is a place*); todo until the bar has one shape in both rooms (step 4): at 1000 px and wider the Listening Room draws it as a dock | `j2.10-desk` | todo |
| J2.11 | with the tape off (the Studio's tab is Capture), go from the Listening Room to Capture and find its meters moving on the first visit; while I'm in the Listening Room, Capture asks the Pi for nothing (no live socket, no ribbon), before its first visit and after it | `j2.11-tape-off` | core |
| J3.1 | GRAB 4 bars from an old take's page onto the Studio's cue lane, with handles of the take's own audio (GRAB 4 BARS the first key under the waveform, and the primary); the Studio opens on its drawer, and DROP them | `j3.1-take-grab` | core |
| J3.2 | bounce the tape to a take on the shelf, from the tape's name, which is its menu (no ⋯ beside it): the tapes, this one ticked, and New tape; Rename…, Duplicate; Share the mix, the bounces, Export stems and the last bounce; Record from this phone…; Delete this tape… last, red, after a line; then delete the tape from the same menu: a sheet asks, naming it and what's on it (never the browser's prompt), and the tape changed last opens in its place, the bounce staying on the shelf | `j3.2-bounce` | core |
| J3.3 | on a phone, with the tape playing on it (as with the interface off), share the mix to send my brother: the tape's name → Share the mix (its menu: there is no ⋯), then the toast's Share hands the share sheet an MP3 named after the tape and the day; Bounce, which needs the jam room, offers it too | `j3.3-share-mix` | core (phone) |
| J4.1 | record from this phone, from its mini player (*"recording from the phone is buried in a menu"*, the studio space's audit): away from the Studio the mini player's big red ● is this phone's, and a tap records at once (the flow's microphone is Chromium's fake one); ● is pressed and says the time while it records, a second tap stops it, and the take is on the shelf, labelled Phone; its ▾, over the mini player, says what ● does now, lists the inputs and opens the recorder with its meter; in the Studio ● is the tape's, with the same ▾ beside it, and a hold on it offers Record from this phone | `j4.1-phone-record` | core (phone) |
| J4.4 | on a phone, the bar is a mini player above the tabs, with \|◀ beside ▶ ("I looked for \|◀ and didn't find it"), back to the loop's start or the take's, a big red ● with the phone's ▾ (J4.1), and Catch with its ▾ beside it, the window keeping its bar number; a tap pulls the player up, a sheet that slides up and settles, the reels and display at its top, the strip under them, then the transport and Catch in the lower half, under the thumb, and where it plays at its foot; Catch's ▾ opens its menu over the pair and Back closes that first, then Back puts the player away and stays in the Studio (Android's Back is a close request, which the flow sends as Escape; in a browser without CloseWatcher, the history's Back); a drag up from the mini player pulls the player up under the finger, a swipe down on its reels puts it away, and a short drag settles back up; a tapped clip's bar floats above the player; Insert asks before it moves the tape; the ruler's keys are one key, ⌗, the View menu, which sets the snap and holds Lock the loop, Fold the tracks and Ask before Insert and Delete time, ticked ("smooshed into the phone UI"); in the Listening Room a take keeps the same mini player, its window and ▶ where the tape's were, ● this phone's, with Open › and ✎ in Catch's place; the header is one row, the tape's name a finger tall (its menu: no ⋯), ↶ and ☰, and the rooms are tabs along the bottom, the Listening Room's with its spines, not ☰'s lines | `j4.4-phone-bar` | core (phone) |
| J5.1 | open Settings, Releases, help mode, the guide and the rig from the one menu (☰) in either room and on a take's page, on a tablet, a computer or a phone; it hangs under ☰, all of it on the screen; Escape (or the tablet's Back) shuts ☰ and leaves me in the room, and switching rooms shuts it too, never leaving it open over the other room; from a keyboard, ↓ on ☰ opens it on Settings, ↓ moves along it (in the Studio, without arming another track), and Tab shuts it. Every page has one frame: what I'm working on at the left (the tape's name, the search, the feed, ‹ and the take's name), Studio \| Listening Room in the middle, at the same place on the Studio, the Listening Room, Capture and Open (it was top left in the rooms and top centre on Open, so a tap there landed on the brand), and ☰ last at the right; each tab its own picture, never ☰'s; the brand only from 1280 px; on a phone, one row, with the rooms as tabs along the bottom | `j5.1-sheets` | core |
| U3 | one notes drawer, the same in both rooms and on Open (it was the Sketchbook's dialog in the Listening Room alone): a note written in the Listening Room is there when I press ✎ in the Studio, and on the take's page by ✎, where I add another; in the rooms it has the take's name, ★ and tag (Open's header has them); Back puts it away and leaves me in the room, and Done does too | `u3-notes-drawer` | core (tablet, desktop, phone) |
| C1 | **jam on the tablet**: GRAB lands on the cue lane as a pad (a lane per input, handles either side, nothing small on it to miss), its drawer open above the bar; ✕ and Escape close the drawer and a hold on the pad opens it again, launching nothing; a tap launches it on the next bar, its dial counting to the line; a tap stops it; drag it to tape ([decision 0061](decisions/0061-grab-lands-on-the-cue-lane.md)) | `c1-cue-jam` | core |
| K1 | plug the keyboard in and see Hindsight take its screen (the-instrument.md, step 7, *The flows*): on Hindsight's firmware (the harness's stand-in) it answers HELLO and the Pi takes its screen, version 2 with local echo and the quiet clock, as `/api/status` says; what the screen shows (the counter, the transport, the knobs, the pad page and its map, the levels) waits for the virtual keyboard, which sees what was drawn | `k1-take-screen` | core for taking the screen (tablet); the widgets todo |
| K2 | press PLAY on the keyboard to play and stop the tape, and see the tablet's ▶ follow; the MIDI Stop and Start the keyboard sends of its own (a screen take sent several, which stopped the tape on the rig, 2026-10-29) move nothing | `k2-play` | core |
| K3 | press REC to punch in on the armed track and again to punch out (from a stop, REC starts the tape), then find what I played on the tape | `k3-rec-punch` | todo: REC KEEPs today |
| K4 | press HOME to give the keyboard its own screen (to pick one of the synth's voices there), then hold HOME a second and let go to hand it back: the Pi stays off it between, even as the keyboard answers again | `k4-home` | core (tablet) |
| K5 | on the FX page, hold pads for Play mode's effects (BREAK held, then let go), with nothing in undo, and turn the tape's FX on the encoders (DRIVE on encoder 3 lands on the tape); their values on the screen are the virtual keyboard's to see | `k5-fx-page` | core (tablet) for the pads and the mod knobs; the rest todo |
| K6 | hold SHIFT for the Mixer page: mute, select, solo and arm tracks 1–4 on the pads, each in its track's colour, and see the tablet follow; let go, and the pads are the FX page's again | `k6-mixer-page` | todo, after the map's spec |
| K7 | scrub the tape on the master knob, with the counter on the keyboard's screen; SHIFT and the master knob for the synth's volume | `k7-scrub` | todo |
| K8 | set the levels of tracks 1–4 on the faders, with no bank | `k8-faders` | todo |
| K9 | play the keyboard's synth over the tape and record it as an input | – | rig |
| K10 | read what every control does, in the guide and over the panel, and hide the overlay once I know it (the keyboard's help page is the virtual keyboard's to see) | `k10-map` | todo, after the map's spec |
| K11 | see on the tablet what the keyboard's 16 pads do now: a strip just above the bar, lit as the keyboard lights them, switching page with SHIFT, hidden by a switch on this device (the surface's build order, step 6) | `k11-pad-strip` | todo |
| P1 | A/B the pads' quantum by ear, a 16th against `now`, and pick their timing | – | rig |

### Not written yet (add a flow before or with the change that touches them)

More to convert: the `[demo]` lines in `docs/checks.md` (the `[rig]` ones stay manual).

| Id | Story | Status |
|---|---|---|
| J1.8 | hold the instrument's pads (BREAK, REV, FX…) without touching undo | core (Play mode on) |
| J2.8 | play all, stopped by picking one by hand | core |
| J4.3 | send the tape to the phone upstairs (output Jam room / Phone / Both) | core |
| J5.4 | wire an input to a track on the Rig, and see Catch name the tracks | core |
| U1 | the take page has the tape's edit controls (fades, gain, normalize, reverse) | todo |
| U2 | Live feed / Playback output switch with a real live stream | todo |
| R1 | MIDI first run, hub enrolment, install and update on a Pi | rig |

## What a run says

Each run prints as a scenario, Given (setup) / When (what Gabe does) /
Then (what should follow), every line marked:

```
Scenario: C1 GRAB onto the cue lane, launch it, open it, drag it to tape [tablet]
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
  screen cuts at a side, the top or the foot. Each
  screen's line keeps the menus open as it was checked (`menus` in
  `--json`), and a flow's `checksMenus` (ids) fails it unless the checks
  saw each one open: J5.1 has ☰, J3.2 and J3.3 the tape's, J1.9 and J4.4
  ⌗'s, J1.4 the tempo's
  and Catch's, J1.5 the input chip's, J2.3 the bar's source, J2.5 the
  take's, J4.1 the phone's ▾. A step that opens a menu, then a
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
  // checksMenus: ['#tape-menu'] (the layout checks must see it open)
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
  never `el.click()` inside the page. A drag of a finger sends its own touch
  events on `await t.cdp()`, the page's one CDP session, and never detaches
  it: a detached session that sent touches turns Chromium's touch emulation
  off, and the rest of the flow ran as a mouse. Outcomes are checked against the API
  (`t.api.takes()`, `t.api.tapeState()`) as well as the screen.
- **Say it as Gabe would.** `t.given` for setup, `t.step` for each thing
  he does, `t.expect` for what he'd see. The names are the report and the
  storyboard's captions, so write them as sentences, not code.
- **Seed what you need; assume nothing.** Flows share one demo per run, in
  file order. `t.api.keep(n)` waits until the take is playable (a tap on a
  take still encoding does nothing); `t.api.tape(name)` loads a fresh tape
  and empties the buffer; `t.api.age(name, date)` dates a take, as if kept
  then, by writing its sidecar in the run's own demo (so not with
  `HINDSIGHT_URL`). The profiles share one demo, in turn: a take one
  profile seeds is on the others' shelves too.
- `t.api.keyboard()` plugs the SMK-37 into the run's own demo: a FIFO for
  its rawmidi node, which the demo's MIDI watcher reads as the keyboard's
  (the demo boots with `TAPE_CONTROLLER=SMK` and an empty node directory,
  so there is no keyboard until a flow plugs one in). It answers
  `press(bytes)`, MIDI as the keyboard sends it, and `unplug()`: unplug it
  in a `finally`, as J1.15 does. `t.api.keyboard({ firmware: true })` also
  stands in for Hindsight's firmware as far as the Pi's client can tell:
  it acks every seq every 100 ms (HELLO's as version 2 with every
  feature), so the Pi takes the screen, and answers `home()` and
  `offer()`, the keyboard's own RELEASE and OFFER; `status()` is
  `/api/status`'s `keyboard`. It can't read what the Pi sent, so it checks
  nothing that was drawn: that is `internal/surface`'s tests' (and its
  link harness, `link_test.go`) and the virtual keyboard's.
- `FLOWS_CPU=4 node scripts/flows.mjs` runs the pages four times slower,
  as a CI runner can: a flow that passes only on a fast machine is racing
  the app (and the app may be racing a person on an old tablet).
- Any page error or `console.error` fails the flow. A failure saves a
  screenshot (its path is in the report): look at it.
- A new story goes in the table above first, with Gabe's words if he gave
  them.
