# The calm Studio: what is on screen, and when

**Status: direction agreed 2026-11-09 from a wireframe, and the order of
what is left agreed 2026-11-10. Decisions 1 to 7 and 9 are built (their
numbers are cited from the code, so they stay below); 8 and 10 are not
agreed line by line yet, and steps 6b and 8 are left.** Gabe: the Studio
is where he spends his time, and it is "so damn cluttered": "it is hard to
tell what buttons are useful to me."

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
   Drop. Amends 0061. Its spec is `lift-and-drop.md`.

## What comes out

- The Studio's own mouse layout of the track head (M, S, level, input in
  the head).
- The feed's VU pair and readouts as always-on parts.
- The second snap menu (gone, step 6a), and the input chips repeated in
  the drawer (step 6b).
- Catch's key and ▾ on the bar (it goes on ●'s ▾), and the click's key
  there (it goes in the tempo's panel).
- The dead buffer routes on the Pi (issue 317), with this pass.

## Build order

Each step is one PR, looked at on the tablet before the next, and ends with
`STUDIO_BUDGET` lowered to what it measured.

Landed (what lasts is in `docs/architecture/tape.md` and `bar.md`; the
steps' own write-ups are in git, `git log -- docs/plan/the-calm-studio.md`):
1, the walk on the tablet profile; 2, the drawer opens small (#278); 3, the
feed's mark (#279–#281); 4, the track heads (#282); 5, the two faces, with
E1 and E2 as core flows; 6a, the cue clip's panel and the words; 7a, the
capture verbs and the click (Catch on ●'s ▾, the click in the tempo's
panel); 7b, the bar's display (one key for the tempo and where it plays).

Not done from the landed steps: snapping a GRAB from the feed's mark to the
bar, which needs the Pi (#308); and the room 7a left at the bar's right end
is still empty.

Left, in order:

6. **6b, the inputs** (what is left of step 6): `inputs.md`'s names for
   inputs and its strip, which is where the head's input chip and the
   drawer's input chips go. It waits for Gabe to agree that spec (#307).
8. **Rip out** what the steps left unused, and lower the budget.

## How it stays calm

- `STUDIO_BUDGET.controls` only goes down (it exists; this spec halves it).
- Each journey's flow records its presses, and that number only goes down.
- A change to the Studio is reviewed from its filmstrip, by an agent that
  has not read the spec, and by Gabe: thirty seconds of pictures, not a PR
  description.
