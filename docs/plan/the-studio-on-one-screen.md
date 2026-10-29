# The Studio on one screen

Agreed with Gabe on 2026-10-22, from a usability review of every screen
against the flows: *"moving unnecessary buttons into drawers or menus and
focusing on the handful of main user flows."* Its open steps (3, 4 and 5)
are steps 8 and 11 of `the-studio-space.md`, which changed two decisions
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
*The frame*; J5.1), the feed as a strip (step 2; J1.1, J1.6), and on a phone
the ruler's keys as one ⌗ menu with bars numbered every 2nd, 4th or 8th
when zoomed out (`barEvery`).

## Decisions still to build

| | |
|---|---|
| Track heads on a touch screen | Name, ● and the input chip, with ● at 44 px. M, S and the level move to the track's inspector, which already has the level, pan and bus. With a mouse they stay in the head. |
| The ruler's keys on the tablet | ⌗ snap and the loop's lock move to the range's action bar and ⌗'s View menu, as on the phone. Tracks ▾ stays. |
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
3. **The track heads and the ruler on touch.** Updates J1.5, J1.9 and J1.11.
   Static.
4. **A budget in the layout checks** (`scripts/flows/layout.mjs`): on the
   tablet, at most N controls on screen in the Studio, and its jam keys at
   44 px or more. N is set from what step 3 leaves. This cuts no release.
5. **The buffer into the cue lane.** The Pi's half goes first (a cue clip
   keeps its lanes and handles, GRAB to the lane, and dropping or keeping a
   cue clip), then the drawer, then the buffer panel goes. Updates C1, J1.3,
   J1.6 and J3.1. Go, so it releases.
6. Open's pass: moved into `listening-back.md`.
