# The Studio on one screen

Agreed with Gabe on 2026-10-22, from a usability review of every screen
against the flows. He asked for *"moving unnecessary buttons into drawers or
menus and focusing on the handful of main user flows."*

What the review measured, on the tablet (1024×768, the main device):

- **The Studio has 65 controls on screen, 30 of them under 32 px.** The
  Listening Room has 25 (5 small), Open 48 (3), the Rig 39 (5).
- **Only 1½ of the 4 tracks show above the bar.** The header takes 110 px
  in two rows, the feed 240 px, and the sections, ruler and cue lane 130 px.
- **The jam's own targets are 26×30 px:** each track's ●, M, S and input
  chip, and the ruler's chips.
- **The guide has four ways in** (Guide, ?, ⋯ → The guide, and the Settings
  line), and Releases has two.

The flows come down to four jobs: **catch it** (KEEP, GRAB), **build it**
(arm, CATCH, DROP), **jam it** (the cue lane) and **listen back** (tap, note,
Open). What serves one of those stays on screen. The rest goes one tap
further away: into a menu, a drawer or an inspector, and never out of reach.

## Decisions

| | |
|---|---|
| One menu for the app's tools | Releases (the version), the Guide, ? (help mode), Settings and the Rig go into one menu at the header's right, on every page. The Settings sheet keeps its about line. This reverses "Settings, Releases and the guide live in the header's `.appbar-end`" (AGENTS.md, *Where things live in the UI*), which changes with it. On a tablet the Studio's header becomes one row: the rooms, the tape and its tempo, ↶ ↷, ⋯ and the menu. |
| The feed is a strip | The ribbon, with GRAB, KEEP and Flag in one row. **How much goes on the key:** a tap takes the last length, and its ▾ picks another (1, 2, 4 or 8 bars for GRAB; 30 s, 2 m or the whole feed for KEEP), as Catch's ▾ already holds its bars. **The input follows the armed track's**, with an override in GRAB's ▾. **The readouts leave:** free disk, dropped buffers, the MIDI tempo and the *Input channels* disclosure go to the Rig, behind a lamp that lights when something is wrong. **● Phone moves into ⋯.** |
| Track heads on a touch screen | Name, ● and the input chip, with ● at 44 px. M, S and the level move to the track's inspector, which already has the level, pan and bus. With a mouse they stay in the head. |
| The ruler's keys | ⌗ snap and the loop's lock move to the range's action bar and ⋯. Tracks ▾ stays. |
| The buffer merges into the cue lane | The buffer stops being a panel of its own. GRAB lands on the cue lane, and selecting a cue clip opens its edit drawer: IN and OUT, gain, Normalize, Reverse, the fades, Audition, then DROP on the armed track (↵), KEEP (K) and Toss (⌫). A tap still launches a clip. The roadmap already wanted the clip editor for the cue lane's trims. |

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

1. **The header's menu.** Updates J5.1. It also fixes the phone's
   Listening Room header, where *Search the shelves* runs under the output
   button. Static.
2. **The feed strip.** Updates J1.1, J1.2, J1.3, J1.6 and C1. Static.
3. **The track heads and the ruler on touch.** Updates J1.5, J1.9 and J1.11.
   Static.
4. **A budget in the layout checks** (`scripts/flows/layout.mjs`): on the
   tablet, at most N controls on screen in the Studio, and its jam keys at
   44 px or more. N is set from what step 3 leaves. This cuts no release.
5. **The buffer into the cue lane.** The Pi's half goes first (a cue clip
   keeps its lanes and handles, GRAB to the lane, and dropping or keeping a
   cue clip), then the drawer, then the buffer panel goes. Updates C1, J1.3,
   J1.6 and J3.1. Go, so it releases.
6. **Open's pass.** GRAB becomes the primary key and Download moves into
   More; *Three things worth knowing* moves into help mode; the downbeat
   row, the note jumps, the snap, the speed and the level go into one
   *Fine tune* drawer; the phone's header gets one row. Updates J2.5 and
   J3.1.

Then the roadmap's next steps (`shell-roadmap.md`): the output switch, then
the bookmark drawer.
