# The Studio on one screen

Agreed with Gabe on 2026-10-22, from a usability review of every screen
against the flows: *"moving unnecessary buttons into drawers or menus and
focusing on the handful of main user flows."* Its open step (5) is
step 11 of `the-studio-space.md` (3 and 4 were its step 8), which changed two decisions
here: ⋯ went (its items into the tape's name menu and ⌗'s View menu), and
● on a phone records from the phone.

The review, on the tablet (1024×768): the Studio had 65 controls on
screen, 30 of them under 32 px, and only 1½ of its 4 tracks above the bar;
the jam's own targets (each track's ●, M, S and input chip) were 26×30 px.
The flows come down to four jobs: **catch it** (KEEP, GRAB), **build it**
(arm, CATCH, DROP), **jam it** (the cue lane) and **listen back** (tap,
note, Open). What serves one of those stays on screen; the rest goes one
tap further away, never out of reach.

Landed: the header's one menu (step 1; `docs/architecture/shell.md`,
*The frame*; J5.1), the feed as a strip (step 2; J1.1, J1.6), on a phone
the ruler's keys as one ⌗ menu with bars numbered every 2nd, 4th or 8th
when zoomed out (`barEvery`), and the track heads and the ruler on touch
with the Studio's budget on a tablet (steps 3 and 4;
`docs/architecture/tape.md`, *The track heads*; J1.5, J1.16): 43 controls
on the tablet's screen (44 at 1280, with the brand), 1 under 32 px, ● at 44 px and all four tracks above
the bar. The ruler's keys are ⌗ alone (and Fit while the view is moved) on
every screen, the snap and the loop's lock in its View menu; the lock is
not on the range's action bar, where it would come after the range it
decides about.

## Decisions still to build

| | |
|---|---|
| The buffer merges into the cue lane | The buffer stops being a panel of its own. GRAB lands on the cue lane, and selecting a cue clip opens its edit drawer: IN and OUT, gain, Normalize, Reverse, the fades, Audition, then DROP on the armed track (↵), KEEP (K) and Toss (⌫). A tap still launches a clip. The clip editor does the cue lane's trims. |

### To settle when the merge is built

My recommendation comes first in each.

- **A GRAB replaces the newest clip while that one is untouched** (never
  launched, dropped, kept, edited or renamed), with Undo. Otherwise it is
  added. This keeps today's one-slot behaviour (one replaced grab + Undo),
  so a run of G presses doesn't fill the lane. The alternative is that every
  GRAB is a new clip and Toss clears it.
- **A cue clip keeps its GRAB's inputs and its handles.** Today a GRAB is
  summed into one file on the way to the lane (`CueFromClipboard`). The
  drawer's MAIN/CH1/CH2/AUX chips need each input's lane, and IN/OUT need
  audio either side. `CueClip.Src` and `Frames` already address a span of
  a bigger file, so the handles are nearly there; the lanes are new. This is
  a Go change, so it cuts a release.
- **A range's Cut, Copy and Paste keep a clipboard of their own,** unseen,
  as a DAW's is. A range spans tracks, and a cue clip is one lane. The
  action bar's Paste is already its only way out.

## Build order

Each step is its own PR, with its flows updated in `docs/flows.md` and
`scripts/flows/`, looked at in a browser at phone, tablet and desktop size
in both schemes, and with the layout baseline shrinking, never growing.

1. ~~The header's menu.~~ Landed.
2. ~~The feed strip.~~ Landed.
3. ~~The track heads and the ruler on touch.~~ Landed.
4. ~~A budget in the layout checks.~~ Landed (`STUDIO_BUDGET`, J1.16).
5. **The buffer into the cue lane.** The Pi's half goes first (a cue clip
   keeps its lanes and handles, GRAB to the lane, and dropping or keeping a
   cue clip), then the drawer, then the buffer panel goes. Updates C1, J1.3,
   J1.6 and J3.1. Go, so it releases.
6. Open's pass: moved into `listening-back.md`.
