# The map: what each control does, written once

A spec for Gabe to agree before anything is built (AGENTS.md, *Specs
before code*). It is step 7's *The map* in `the-instrument.md`: the
SMK-37's controls, what each sends and what it does on each page, written
once per device, read by everything that shows it, so none of them can
drift from what the bindings do. The first thing it describes is the
Mixer page (K6), so it comes before K6.

Gabe's words (2026-10-28): *"we should be able to hide the map/overlay as
well once we have learned it"*; *"the midi functions should be mapable to
other types of midi devices as well so the overlay could be an object that
is swapped out for other supported devices"*.

## What there is today

- The SMK-37's bindings are Go: `smk37Bindings` in
  `internal/api/controls.go` (the defaults with the pads on channel 10,
  PLAY note 16 and REC note 17 on channel 16).
- What the pads show is Go too: `fxPadIndex` in
  `internal/api/keyboard_screen.go` and `FXPads` in `internal/surface`
  (names and families, for the screen's map and the lights).
- The device's facts are JSON: `internal/rig/profiles/smk-37-elite.json`,
  embedded, read by the rig page; its `hardware` block is for people.
- Nothing writes what a control does in words, and the guide doesn't
  mention the keyboard.

So today three places (the bindings, the screen's map, the lights)
each say part of it, and only a test can keep them in step.

## Decisions to agree, my recommendation first

1. **Where the map lives.** `internal/rig/profiles/<id>.map.json`, beside
   the device's profile and embedded with it: one file per controller
   with a map. (Or: a `map` block inside the profile. The profile is
   mostly notes for people, and the map is code's, so a file of its own
   reads better and diffs cleanly.)
2. **What a row says.** One row per control:

   | Field | For the SMK-37's pad 5 |
   |---|---|
   | `control`: the panel's name | `PAD 5` |
   | `sends`: the MIDI, as bindings write it | `{"note": 40, "ch": 10}` |
   | `pages`: what it does on each page, an action id from `controlActions` or a surface verb | `{"fx": "break", "mixer": "mute.1"}` |
   | `label`: the words on the screen, the strip and the guide, per page | `{"fx": "BREAK", "mixer": "MUTE 1"}` |
   | `family` / `track`: its colour | `{"fx": "break-family", "mixer": 1}` |
   | `flow`: the K story that checks it | `K5`, `K6` |

   Pages are the device's own (`fx`, and `mixer` while SHIFT is held, for
   the SMK-37). A control on no page (HOME, FADER BANK, the keys) is a
   row saying whose it is (`"keyboard"`), so the guide can say so too.
3. **Who writes it.** People, by hand, in the pull request that changes
   what a control does. **Who reads it**, so none can drift:
   - *The bindings.* A controller with a map gets its starting bindings
     from it (its `sends` for each page's action), and `smk37Bindings`
     goes. A test fails on a map row whose action doesn't exist, and on a
     binding the profile starts with that no row names. MIDI LEARN still
     rebinds on top, per Pi, as now (`controls.json`).
   - *The keyboard's screen and lights.* `FXPads` and `fxPadIndex` are
     read from the map's `fx` page; the Mixer page's from `mixer`.
   - *The guide.* A section of `docs/guide.md` (which the binary embeds),
     the panel drawn as a table per page, written by a script from the
     map and checked by a test that fails when they differ, as
     `scripts/motion-tokens.mjs` keeps its tokens. Generated, so a map
     change shows up in the guide in the same pull request.
   - *The overlay* on the tablet: `GET /api/controllers/map` answers the
     connected controller's map (by its profile), or none. The pad strip
     (K11) draws its 16 cells from it, and the virtual keyboard's labels
     over its panel come from it. A per-device switch hides it
     (`lib/device-prefs.js`: *Show the controller's map*), on by default,
     since it is this browser's, not the Pi's.
   - *The keyboard's help page.* Laid out by the Pi from the map, like
     every other screen (`surface.Layout`, a help `State`), so it costs the
     firmware no room: the firmware draws what it is sent. It needs a way
     to ask for it, which is question 5.
4. **Another controller.** The overlay is an object the connected
   controller's map picks: the strip and the help page read rows, not the
   SMK-37's layout. A controller with no map shows no strip and keeps
   today's MIDI LEARN; a second device's map is a file and a guide
   section, no new code, unless its pages differ from FX and Mixer.
5. **How the help page is opened on the keyboard.** My recommendation:
   SHIFT held with HOME opens it while the Pi has the screen, and any
   press closes it; HOME alone keeps giving the screen back. SHIFT alone
   is the Mixer page, and the free buttons (SAVE, OCT, ARP, …) are MIDI
   LEARN's, so a combination keeps them free. **Gabe's call.**
6. **The map shown on the keyboard's screen** (its 2×8 pad map, today
   `FXPads`) stays where it is, read from the map: no change on the unit.

## Build order, once agreed

Each its own pull request:

1. The map file for the SMK-37, its loader in `internal/rig`, and the
   test that its actions exist; `smk37Bindings`, `FXPads` and
   `fxPadIndex` read from it, with no change to what anything does.
2. `GET /api/controllers/map`, in `docs/architecture/`.
3. The guide's section, its generator and its check.
4. The pad strip (K11), on the map, and its device switch.
5. The Mixer page (K6) as the map's `mixer` page.
6. The help page on the keyboard, once question 5 is answered (K10).

When it lands, what lasts goes into `docs/architecture/keyboard.md`, the
stories into `docs/flows.md` (K6, K10, K11 turn core), and this file goes.
