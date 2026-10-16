# A Zoom R20 theme: brief

**Status:** a brief, not a design. Decisions are marked **Decide**. Per
`AGENTS.md`, the spec comes before any code.

## What this is

Hindsight is dressed as a 4-track cassette deck in Solarized (see the
[Solarized plan](../superpowers/plans/2026-10-04-solarized-4track.md)). A
**theme** here would be a second dress: the same pages and objects, drawn as
the Zoom R20, the touchscreen multitrack recorder whose region editing the tape's editing borrows from. It is a look, not a feature: no page changes behaviour.

*Assumption to check:* "the Zoom recorder" is read as the **R20**, the one the
[DAW editing plan](../superpowers/specs/2026-10-07-daw-editing-plan.md) and the
[clips design](../superpowers/specs/2026-10-07-clips-design.md) borrow from, and
the one in the [profile](../../internal/rig/profiles/zoom-r20.json). If another
Zoom is meant (an H-series handheld, say), the vocabulary below changes.

## What the R20 offers to borrow

From its manual (the `controls` facts in the profile), as a vocabulary and not
as a layout to copy:

- **A row of faders** with a master fader, one per track, in a bank.
- **Per-track REC buttons** with a PEAK lamp over each gain knob.
- **A transport row:** Click, Rew, FF, Stop, Play, Rec.
- **A touchscreen of regions** under a bars-and-beats ruler, with markers.
- **Gain knobs** and a Hi-Z switch.

Hindsight already has most of these as objects: the transport keys, the tape
page's lanes and ruler, the VU meter. The theme re-skins them; it invents no
control.

## What is not known, and must be looked at

- **The actual colours.** No hex value in this brief comes from the unit.
  Take them from photographs of the real recorder (see
  [images.md](images.md); the touchscreen close-up and the top view first),
  sampled with an eyedropper, and write the sampled values down with the
  photo they came from.
- **The screen's size and proportions.** The manual doesn't give them.
- **The typeface on the panel and on the screen.** Look at the photographs.
  Fonts are vendored (`web/static/fonts`, no network fonts on a Pi), so any
  font has to be one with a licence that allows it.

## How it would be built, within the rules already here

- **Tokens, not hex literals.** Every colour is a CSS custom property on
  `:root`, redefined for a scheme, and canvas code reads them through
  `lib/theme.js`. A theme is a token set.
- **Materials stay in `objects.css`.** What an object is made of (plastic,
  metal, the lamp's glass) is the same in both schemes; a theme would add a
  second material set, selected by an attribute on the root.
- **Scope every rule to the theme's attribute.** `AGENTS.md`: a bare rule
  reaches every page of every kit the day it merges. And *a per-device flag
  hides markup, not CSS*: the theme's rules ship to everyone, so they must be
  inert unless the attribute is set.
- **Behind a per-device switch** (`web/static/lib/device-prefs.js`, one
  line), until it is agreed otherwise.
- **Looked at before it merges:** phone and desktop, both schemes, the switch
  on and off, in a browser against the demo.
- **Contrast:** body text at least 4.5:1 in every theme and scheme.

## Decide

1. **Light, dark, or both?** The R20's screen is dark; the body is a recorder's
   grey. A single dark theme is the smaller job.
2. **Skin or restyle?** A skin changes colour and material only. A restyle also
   changes layout (faders, per-track REC buttons). Start with a skin.
3. **Does it follow the scheme?** The device-wide light/dark switch is how the
   current dress works; a theme could ignore it.
4. **Does the rig page get an R20 card?** The rig draws devices from profiles
   (`zoom-r20` exists, and is inert). That is the better first place to show
   the R20, and it needs only the panel drawing in `images.md`'s *Extending
   these into drawings*, not a whole theme.

## Order of work

1. Photograph the unit, or sample the maker's pictures; record colours with
   their source.
2. Write the spec in `docs/superpowers/specs/`: tokens, the second material
   set, the switch, the decisions above.
3. Build it on the object bench (`/objects.html`) before any page.
4. Then the pages, one at a time, behind the switch.
