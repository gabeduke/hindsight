# The calm Studio: what is on screen, and when

**Status: direction agreed 2026-11-09 from a wireframe; the decisions below
are not agreed line by line yet.** Gabe: the Studio is where he spends his
time, and it is "so damn cluttered": "it is hard to tell what buttons are
useful to me."

This is about **what is on screen**, not how it looks. `the-play-look.md` is
the look (a theme, per component) and still waits on Gabe's pick; nothing
here depends on it. `inputs.md` (proposed the same day) folds into this
spec's step 4.

## How Gabe uses the Studio

1. **A live 4-track.** He spins up a beat or a jam on a device, the ring
   holds it, and he loops the good moment and plays over it with other
   instruments.
2. **A light DAW on the tablet.** He cuts, copies and arranges clips of tape
   from different takes.

Everything on the default screen serves one of those two. Anything else is
one tap away, or gone.

## What a walk of the demo found (2026-11-09)

1280×800, mouse layout, one part on the tape; the tablet's touch layout was
not walked and is step 1.

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

### On the tablet profile (step 1, 2026-11-09)

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
  are written with step 3, as `todo` flows first, since the gestures they
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
   One layout, not two. Extends decision 0059.
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
     ribbon's width comes from the keys on its right (step 3).
   - **KEEP with no mark** keeps the last length chosen, as now; the fixed
     lengths (30 s, 2 m) stay on its ▾ and nowhere else.
   - GRAB keeps its bars; with a mark set it grabs from the mark, snapped
     to the bar.
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

## Gabe's calls before step 2

- **Which capture verbs stay on the surface.** The wireframe kept GRAB,
  KEEP and ● and took Catch off the bar. If Catch is the one he uses, it
  stays and another goes behind a ▾.
- **What he reaches for in the drawer.** If Reverse or the fades are every
  session, they stay out of Trim.
- **The metronome**: on the bar, or in the tempo's panel.

## What comes out

- The Studio's own mouse layout of the track head (M, S, level, input in
  the head).
- The feed's VU pair and readouts as always-on parts.
- The second snap menu, and the input chips repeated in the drawer.
- Catch's key and ▾ on the bar, if Gabe's call is to drop it.
- The dead buffer routes on the Pi (`STATE.md`), with this pass.

## Build order

Each step is one PR, looked at on the tablet before the next, and ends with
`STUDIO_BUDGET` lowered to what it measured.

1. **Walk the two journeys on the tablet profile** and save a filmstrip of
   each: `node scripts/flows.mjs --storyboard` already draws one; add the
   two journeys as flows if they are not there (catch a moment, loop it,
   play over it; cut and arrange parts from two takes), each recording its
   count of presses. No change to the app.
2. **The drawer opens small** (decision 2): done 2026-11-09, with decision
   6's Drop, Trim and Toss; J1.6 holds every track to a finger's height
   beside it. Not done here: the ribbon's width. The ribbon starts where
   the lanes do, so the VU pair's column is the track heads' and gives it
   nothing; its width is taken by GRAB, KEEP and Note on its right, which
   is step 3's and the two faces'.
3. **The feed's mark** (decision 4): tap to set it, KEEP to it, the whole
   ring on the ribbon; J1.1 and J1.3 extended, with the story in
   `docs/flows.md`. Then **the track heads** (decision 3), a PR of their
   own.
   Then **the two faces** (decision 9), once the feed's face and the
   tape's each stand alone.
4. **The cue clip's panel and the words** (decisions 6, 7), with
   `inputs.md`'s names for inputs.
5. **The bar's display** (decision 5) and the capture verbs, after Gabe's
   calls.
6. **Rip out** what the steps left unused, and lower the budget.

## How it stays calm

- `STUDIO_BUDGET.controls` only goes down (it exists; this spec halves it).
- Each journey's flow records its presses, and that number only goes down.
- A change to the Studio is reviewed from its filmstrip, by an agent that
  has not read the spec, and by Gabe: thirty seconds of pictures, not a PR
  description.
