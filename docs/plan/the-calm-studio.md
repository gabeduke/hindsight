# The calm Studio: what is on screen, and when

**Status: direction agreed 2026-11-09 from a wireframe, and the order of
what is left agreed 2026-11-10; decisions 1 to 4, 6, 7 and 9 are built
(*Build order*), and 5, 8 and 10 are not agreed line by line yet.** Gabe: the Studio is where he spends his
time, and it is "so damn cluttered": "it is hard to tell what buttons are
useful to me."

This is about **what is on screen**, not how it looks. `the-play-look.md` is
the look (a theme, per component) and still waits on Gabe's pick; nothing
here depends on it. `inputs.md` (proposed the same day) folds into this
spec's step 6.

## How Gabe uses the Studio

1. **A live 4-track.** He spins up a beat or a jam on a device, the ring
   holds it, and he loops the good moment and plays over it with other
   instruments.
2. **A light DAW on the tablet.** He cuts, copies and arranges clips of tape
   from different takes.

Everything on the default screen serves one of those two. Anything else is
one tap away, or gone.

## What a walk of the demo found (2026-11-09)

1280×800, mouse layout, one part on the tape, before anything was built.

- **52 things to press** at rest, 59 with a grabbed clip's drawer open. On
  the tablet the budget is `STUDIO_BUDGET.controls`, 44
  (`scripts/flows/layout.mjs`).
- **The lanes get about 44% of the height**, and about 12% while a cue
  clip's drawer is open: it docks above the bar and the four tracks shrink
  to slivers.
- **The feed's panel holds about 16% of the height** all the time, with two
  VU meters that show the main pair only.
- **One word, several meanings**: Loop is the bar's key, the drawer's key
  and Catch's caption; KEEP is the feed's "keep the last 30 s as a take" and
  the drawer's "KEEP 4 BARS"; Bar is two snap menus.
- **Four capture verbs** (GRAB, KEEP, ●, Catch), each with a key and a ▾.
- **What already works**: selecting a part brings up one row (Cut, Copy,
  Split, Duplicate, Move here, Remove, Done) that leaves when it is done.

### On the tablet profile (step 1, 2026-11-09, before anything was built)

`node scripts/flows.mjs J1.1 J1.3 J1.4 J1.6 J1.11 J3.1 --profile=tablet
--storyboard=dir`, 1024×768: 13 of 13 runs passed.

- **The ribbon gets about a third of its own row**: some 370 of 1024 px,
  between the VU pair (about 150 px) and GRAB, KEEP and Note (about 440).
  With a track's inspector open it falls to about 40 px and its labels
  clip. This is the waveform Gabe reads to find a moment.
- **The track head is already decision 3's** on touch (●, name, input, ›);
  decision 3 is the mouse layout coming into line.
- **Catch is set in three places**: its key and ▾ on the bar, and "Catch
  the last 1 / 2 / 4 bars", Layer or Replace and Passes in a track's
  inspector.
- **17 to 29 targets under 44 px** on these screens, by the flows' own
  layout check (a warning there): the feed's lamp, both ▾, the snap chip,
  Solo, a track's name, its input chip and its ›.
- **Presses today**: KEEP a span of the feed, 2 (hold-drag, Keep); GRAB and
  DROP, 2 (4 to change the length first); Catch a pass onto a track, 5
  from an empty tape (tempo, arm, ▶, Catch, ▶).
- **No flow is either of Gabe's journeys end to end.** The pieces are
  J1.3, J1.6, J1.4, J1.11 and J3.1; nothing keeps a jam from a mark, loops
  it and records over it, and nothing arranges parts from two takes. They
  are written with the two faces (step 5), as `todo` flows first, since the gestures they
  press are the ones this spec changes.

## Decisions

1. **Three tiers, and a control is in exactly one.**
   - *Always there*: the lanes and their parts, ▶, ●, Loop, back to the
     start, the feed's strip with GRAB and KEEP, the cue lane, undo, the
     tape's name, the room switch, ☰.
   - *There when you touch something*: a part's row; a cue clip's panel; a
     track's inspector.
   - *One tap away*: the tempo, where it plays, the metronome, the snap,
     the sections lane, Note, the feed's meters and readouts.
2. **The cue clip's drawer opens small, and the lanes stay lanes.** Built
   2026-11-09. Floating the drawer as it was would have covered all four
   lanes on the tablet (it is about 330 px tall, the lanes 312), so it
   opens as one row instead: the clip's window, DROP, KEEP, Toss, Trim, ✕.
   The lanes share the room over it, a finger tall each, a head its name
   and ●. Trim opens the bench as it was, the lanes folded for it. It is
   still docked above the bar: decision 0061 stands.
3. **A track's head is its name, ● and ›, with a mouse as on a touch
   screen.** M, S, the level and the input are in the inspector everywhere.
   One layout, not two. Extends decision 0059. Built 2026-11-10: one head,
   M, S and the level out of it. The input chip is still in the head, until
   `inputs.md`'s strip gives an input another place to be seen.
4. **The feed is its ribbon, and a touch on it says "from here".** Gabe,
   2026-11-09: KEEP 30s is rare; he reads the waveform, sees where the jam
   began showing activity, and wants to keep back to that point ("the last
   1:24 or something random").
   - **A tap on the ribbon sets a mark**; KEEP then reads *Keep 1:24* and
     keeps from the mark to now. A drag of the mark moves it. Today this
     takes a hold-drag to select a span (J1.3); the tap is the main gesture
     and the span stays for a part in the middle.
   - **The ribbon shows the whole ring**, so the start of a jam is on it,
     and keeps its height: the waveform is how he finds the moment. What
     leaves the feed's panel is the VU pair and the readouts (they open
     from the lamp). Gabe, 2026-11-09: "vu meters dont add a lot". The
     ribbon's width comes from the keys on its right (the two faces, step 5).
   - **KEEP with no mark** keeps the last length chosen, as now; the fixed
     lengths (30 s, 2 m) stay on its ▾ and nowhere else.
   - GRAB keeps its bars; with a mark set it grabs from the mark. As
     built it is the mark's own frames, not snapped to the bar: the clip's
     IN and OUT in the drawer snap. Snapping the grab is open.
5. **The bar's display has one key for tempo and output**, opening one
   panel; the source key stays only where there is a choice to make.
   Amends decision 0047.
6. **A cue clip's panel is Drop, Trim and Toss.** IN/OUT, its inputs, gain,
   Normalize, Reverse, the fades, Audition and Loop are in Trim.
7. **A word has one meaning.** The drawer's KEEP gets another name; the
   drawer's Loop and its snap go into Trim or go away.
8. **The Studio's budget drops to what this leaves**, about 22 at rest, and
   stays a ratchet: a spec that adds a control names the one it removes.

9. **The Studio shows one face at a time: the feed or the tape.** Gabe,
   2026-11-09: he only needs the feed while taking something out of the
   ring, and only the four tracks while arranging or recording over tape;
   the feel he is after is the OP-1 field's, "where recordings are arranged
   to tape very fluidly almost like its own instrument".
   - **The feed's face** is the ring's waveform at the full height of the
     room, the mark, KEEP and GRAB.
   - **The tape's face** is the four lanes, the cue lane and the ruler.
   - **The other face is a thin strip** along the top: the feed's ribbon,
     live, over the tape; the tape's overview over the feed. A tap on the
     strip turns to it. The bar and the cue lane stay on both.
   - **The Studio turns by itself only when a clip lands**: a GRAB on the
     feed's face shows on the cue lane, which is on both, so nothing needs
     to turn. Recommended: it never turns under his hands; his to change.
   - These are the kit's Capture and Tape components (`components.md`),
     each mounted whole, which is what the migration was for.
10. **Lift and drop are the tape's two verbs** (proposed, not asked for).
   The OP-1's tape is played with lift and drop. Here GRAB lifts from the
   feed, Cut and Copy lift from the tape, and Drop puts down; today a GRAB
   lands on the cue lane and a Cut on a clipboard nothing shows (decision
   0061). One holding place, the cue lane, for everything lifted, and one
   Drop. Amends 0061.

### The two faces, as built (step 5)

- **The face is the Studio's state, per device**: `lib/rooms/face.js`
  (`createFace`: `get()`, `set(face)`, `onChange(fn)`), kept in this
  browser (`studio.face`, `lib/device-prefs.js`'s way), written on the
  Studio's root as `main#view-studio[data-face]`; no attribute is the
  tape, so the first paint is the tape's and `styles.css` hides the other
  face from it (frame zero).
- **The tape's face**: the feed is one thin row at the top: its lamp, the
  ribbon live and about 28 px tall, then GRAB and KEEP, small, since both
  are in decision 1's *always there* and J1.1 and J1.6 press them with the
  lanes in sight. The ribbon there takes no mark: the row's ribbon is one
  key, `#face-feed`, and a tap turns to the feed. Flag now and the two
  level bars are the feed's face's.
- **The feed's face**: the ribbon across the whole width and as tall as
  the room leaves, the mark on it, and GRAB, KEEP and Flag now in a row
  under it, at the thumb. The sections, the ruler and the lanes are out;
  the tape is one thin row at the top, `#face-tape`, the whole tape drawn
  as the bar's overview draws it (`paintTapeOverview`), and a tap turns
  back. The cue lane, and a cue clip's drawer, are on both.
- **It never turns under his hands**: a GRAB on the feed's face lands on
  the cue lane, which is there. Leaving the feed's face keeps the mark.
- **A phone has the same two faces**; its feed's face is what gives the
  ribbon a height to read.
- `STUDIO_BUDGET` is measured on the tape's face and lowered to what it
  finds; the feed's face gets a count of its own, lower. As built: the
  tape's face holds what the Studio held (43, and 44 at 1280×800): Flag now
  left it and the feed's row became a key, so `controls` stays 44. The
  feed's face holds 26 (27 at 1280×800): `feed: 27`.

### The cue clip's panel and the words, as built (step 6a)

Step 6 is two PRs: this one, which is the Studio's alone (built
2026-11-13), and 6b, `inputs.md` (names for inputs and the strip, with a
change on the Pi), which waits for Gabe to agree that spec.
`architecture/tape.md`, *The cue lane*, has how it is built.

- **The small panel is the clip's window, DROP, Trim, Toss and ✕**
  (decision 6), each a finger and a half tall. The drawer's KEEP left it.
- **Trim opens on what Gabe reaches for** (his call, 2026-11-13): its
  first row is Audition, the clip's repeat, Reverse and the fades, with the
  clip's name and length beside them; then IN and OUT, the gain and
  Normalize, the clip's inputs, and last the key that puts the clip on the
  shelf. It opens under the small panel's row, which stays as it was, so
  Trim shuts where it opened. Every key in it is a finger tall. A phone's
  sheet has no small state, and holds the same keys in the same order.
- **Unfold went**: shutting Trim is what gives the lanes their height back.
- **A word has one meaning** (decision 7):
  - KEEP is the feed's: the last of the jam, kept as a take. The drawer's
    key, which makes a take of the clip, is **To the shelf** (its K stays),
    and its toast says the clip is on the shelf.
  - Loop is the bar's: the tape's loop. The drawer's key, which says
    whether a launch plays the clip round until it is tapped again or
    once, is **Repeat**, the word the bar already uses for a take's ⟲.
    Audition always goes round.
  - Bar is the Studio's snap, on ⌗. The drawer's own snap key went, and IN
    and OUT step by the Studio's snap, which the page already said to the
    drawer in `hindsight:tape-state`.
- Catch's caption ("loop is off") is the bar's, and changes with step 7.

## Gabe's calls before the bar changes (answered 2026-11-13)

- **The capture verbs on the surface are GRAB, KEEP and ●.** Catch comes
  off the bar and goes on ●'s ▾, with its 1, 2 and 4 bars.
- **What he reaches for in the drawer.** He ticked Reverse, the fades and
  Loop / Audition, and "just Drop, Trim, Toss" with them. Read as: the
  small panel stays Drop, Trim and Toss (decision 6), and Reverse, the
  fades and Loop / Audition are the first things Trim shows, one tap in,
  not under a fold of their own. His to correct at step 6's look.
- **The metronome is in the tempo's panel**, not on the bar.

## The capture verbs and the click, to build (step 7a)

Step 7 is two PRs. 7a is Gabe's two calls; 7b is decision 5's one key for
tempo and output, which touches every room's bar and is pinned after 7a is
looked at.

- **● has a ▾ beside it** (`rec-more`, opening `rec-menu`; in the Studio
  with the tape, in the bar and the phone's mini player), the pair a
  `splitKey` as GRAB's and KEEP's are. Its menu is Catch's as it was: a
  head saying where it lands ("Catch onto track 2", or that no track is
  armed), then The last pass and The last 1, 2 and 4 bars, each saying why
  when it can't go, and staying open on a tap that can't.
- **One ▾ beside ●, never two.** A phone's mini player already has one
  (`phone-more`: this phone's inputs). In the Studio with the tape it is
  ●'s ▾ there, and its menu is Catch's rows, a line, then the phone's rows
  as `phoneRows` gives them. Everywhere else the phone's ▾ is as it was.
- **Catch's key, its ▾ and its menu leave the bar** (`catch-pass`,
  `catch-more`, `catch-menu`, `.np-catch-split`, their rules, the mini
  caption). C still catches the last pass, and says why when it waits, with
  the last 4 bars on offer, as a tap on the key did. The outline on the
  lanes shows while The last pass is pointed at or has the keyboard.
- **The click's key leaves the bar.** The tempo's panel has a Click switch
  (`tempo-click`, `aria-pressed`) under the tempo's row, off without a
  grid. M still turns it. The click is the Studio's now: the page sets it
  on the tape model, and `tapeKeys` has no click (its `press('click')` and
  `faces().click` go).
- **What it costs.** Catch from the screen is two presses (▾, the row)
  where it was one, so E1 on the tablet is 11, not 10. That number is meant
  only to go down; it rises here because of Gabe's call, and the report
  says so.
- **What it saves.** Three keys off the bar for one on it:
  `STUDIO_BUDGET.controls` goes to what the tablet measures after.
- J1.4 has the story; E1, J1.5 and J4.4 press the new keys.

## What comes out

- The Studio's own mouse layout of the track head (M, S, level, input in
  the head).
- The feed's VU pair and readouts as always-on parts.
- The second snap menu (gone, step 6a), and the input chips repeated in
  the drawer (step 6b).
- Catch's key and ▾ on the bar (it goes on ●'s ▾), and the click's key
  there (it goes in the tempo's panel).
- The dead buffer routes on the Pi (`STATE.md`), with this pass.

## Build order

Each step is one PR, looked at on the tablet before the next, and ends with
`STUDIO_BUDGET` lowered to what it measured.

Done:

1. **The walk on the tablet profile** (2026-11-09): its findings are above.
   The two journeys' own flows were not written; they are step 5.
2. **The drawer opens small** (decisions 2 and 6; #278): one row of the
   clip's window, DROP, KEEP, Toss, Trim and ✕, and J1.6 holds every track
   to a finger's height beside it.
3. **The feed's mark** (decision 4; #279, #280, #281): a tap on the ribbon,
   KEEP and GRAB from it, the mark's own key on the ribbon, one KEEP on the
   screen, the VU needles out and the level two narrow bars. J1.3 has the
   story. Not done: a drag of the mark, and snapping a GRAB from the mark
   to the bar.
4. **The track heads** (decision 3; #282): one head with a mouse and on
   touch. The input chip is still in it.
5. **The two faces** (decision 9; 2026-11-13), as *The two faces, as
   built* says (`architecture/tape.md`, *The two faces*), with the two
   journeys as flows: E2 (arrange parts from two takes) landed first, and
   E1 (a live 4-track: mark, GRAB, DROP, loop, play, Catch over it) is core
   with them, 10 presses on the tablet and 14 on a phone. Step 3's drag of
   the mark came with it (J1.3 drags it). Not done: snapping a GRAB from the
   mark to the bar, which needs the Pi (only it knows where the ring's bar
   lines fall, `grabRing`'s `downbeatAt`): a `snap` on the ring's grab
   request, in Go, and the key saying so. And the budget did not drop: the
   tape's face holds what the Studio held, so the cut is step 8's.
6. **6a, the cue clip's panel and the words** (decisions 6 and 7;
   2026-11-13), as *as built (step 6a)* says: the small panel is the
   window, DROP, Trim, Toss and ✕; Trim opens on Audition, Repeat, Reverse
   and the fades; To the shelf and Repeat for the drawer's KEEP and Loop;
   its snap key and Unfold out. J1.6 has the story. The tape's face at rest
   is as it was (the drawer is shut there), so `STUDIO_BUDGET` did not move.

Left, in order:

6. **6b, the inputs** (what is left of step 6): `inputs.md`'s names for
   inputs and its strip, which is where the head's input chip and the
   drawer's input chips go. It waits for Gabe to agree that spec.
7. **7a, the capture verbs and the click**, as *to build (step 7a)* says:
   Catch on ●'s ▾, the click in the tempo's panel. **7b, the bar's
   display** (decision 5): one key for tempo and output.
8. **Rip out** what the steps left unused, and lower the budget.

## How it stays calm

- `STUDIO_BUDGET.controls` only goes down (it exists; this spec halves it).
- Each journey's flow records its presses, and that number only goes down.
- A change to the Studio is reviewed from its filmstrip, by an agent that
  has not read the spec, and by Gabe: thirty seconds of pictures, not a PR
  description.
