# Song sections: templates you fill in

Not agreed yet: the decisions and the questions, for Gabe.

From the walkthrough of 2026-10-30 (`walkthrough.md`, *Song templates*,
PR #226):

- He jams for 5 or 10 minutes and gets great moments, but not the shapes
  most ears expect.
- He wants templates for pop, blues, jazz, ambient and a jam band, each a
  structure of sections to fill in with light edits. He doesn't know the
  structures himself, *"which is part of the point."*
- He wants to change a section's bars to make it his own.
- He wants to mute pads of the MPC beat to suit each section, or to layer
  guitar or vocals where it needs something. *"A songwriting machine."*

## The mockups

The demo's real Studio, at 2×. The tapes, clips and sections were made
through the API, and the new parts were drawn into the page with its own
classes and tokens. The tablet is 1280×800, light; the phone is 390 wide,
dark.

- [`tablet-templates.png`](song-sections/tablet-templates.png): *Lay out a
  song*, from the tape's name: the five templates, each with its line, its
  shape and its length at 96 BPM.
- [`tablet-section.png`](song-sections/tablet-section.png): Pop laid out,
  the Verse tapped. Its inspector shows the length, *Heard in it* (every
  Verse), the cue, the MPC's sequence and *Fill it*. The name, the colour,
  Duplicate and Remove are below them, as the inspector scrolls. The
  Guitar is hatched where it sits out.
- [`tablet-cue.png`](song-sections/tablet-cue.png): playing in the
  Pre-chorus, with the Chorus's cue up two bars ahead.
- [`tablet-picker.png`](song-sections/tablet-picker.png): a jam made into a
  song (Jam band). The Intro and Theme are picked, and the window is on the
  Verse's pass in the 10-minute take.
- [`phone-templates.png`](song-sections/phone-templates.png) and
  [`phone-section.png`](song-sections/phone-section.png): the same menu,
  and the inspector as the phone's sheet.

## What is there already

Most of the tape a song needs exists. Sections are its *Tape* component's
"tracks, parts, sections, the loop" (`the-ecosystem.md`).

- **Sections** (`internal/tape/sections.go`, `lib/tape/sections.js`; the
  guide's §8.5):
  - `State.Sections`: `{ID, Name, At, End, Color}`, on bar lines, never
    overlapping; each change is one step of undo.
  - The strip over the ruler (the SECTIONS row): hold and drag makes one; a
    tap selects its bars on every track, and the loop follows; a second
    tap opens its inspector (the name, the colour, Duplicate section,
    Remove).
  - Each section is a marker in the stems' `.mid`.
- **Time edits** (`internal/tape/timeedit.go`): Insert, Delete time and
  Duplicate section act on every track and move the sections with the
  music.
- **Catch** takes the loop's last whole pass (`transport.go`'s cycle log),
  so *loop the section, play over it, catch the pass* already works.

What is missing:

- **Templates.**
- **A section's length.** Dragging an edge relabels bars and stops at the
  next section. Insert needs a clipboard. So nothing adds empty bars to a
  section and moves the rest along.
- **Anything per section**: mutes, a cue, a message to the MPC.
- **A take as the source** of a section's audio.

## In the ecosystem's terms

These are the models and components of `components.md`. That spec is not
yet agreed, and is on the `claude/components-spec` branch.

- **The `tape` model owns sections.** Its snapshot already holds them, and
  this spec adds `muted`, `cue` and `program` to each. Its `edit(op)`
  carries the section ops:
  - `section-add`, `section-set` and `section-remove`;
  - `duplicate-section`;
  - the new `section-template` and `section-bars`.

  The templates are read once (`GET /api/tapes/templates`). There is no
  `sections` model.
- **The Tape component** ("tracks, parts, sections, the loop") draws:
  - the strip;
  - the section inspector, with *Heard in it*;
  - the hatching;
  - the cue's flag. The flag's countdown reads the `transport` model's
    position on `cx.loop`.
- **Transport** plays *Play it* once the tape model's `setLoop` has set the
  loop.
- **Rig** says which device hears a Program Change.
- **Tempo** sets the tempo a template needs.
- **The picker is the Take component** ("one take: hear it, select") in a
  mode of its own: a selection a section long that steps by passes. It is
  mounted in the dock slot, or a `createSheet` on the phone. It reads the
  `take` model (the peaks, the notes) and the `tape` model (the sections).
- ***Use for Verse* is the tape model's `paste`** (`/api/tapes/drop`), with
  `at` the section's start. It doesn't use `send`, which places a take by
  its own tempo and downbeat. The take is at the tape's tempo (a new tape
  made from it, or the *From a take…* menu's filter), and the window is
  already on its bars, so a span and a place are all it needs.
- **The workspaces:**
  - **Build:** laying out a song, a section's settings, the picker;
  - **Jam:** *Play it*, and the cues.
- **The engine:**
  - the renderer applies the mutes;
  - the clock's scheduler sends the Program Change;
  - later, the SMK-37's screen shows the section and its cue.

## Decisions

1. **A section** stays a named span of bars on the tape. It gains three
   optional fields:
   - `muted`: the tracks that sit out;
   - `cue`: up to 60 characters of what to play there;
   - `program`: an MPC sequence, 1–16.

   **Recommended: the mutes and the program follow the name.** Changing
   the Chorus's mutes changes every section called Chorus, in one edit.
   - A section renamed *Last chorus* has settings of its own.
   - The inspector says *every Chorus* while more than one section has the
     name.
   - The cue is each section's own, so a template can say *the last time,
     biggest* on one Chorus and not the others.
2. **Templates are data on the Pi**: `internal/tape/templates.go`, listed
   by `GET /api/tapes/templates`, so the keyboard and the laptop get the
   same ones.
   - Each template is its sections: a name, the bars, a colour and a cue.
     The cue pre-filled from the template is the guidance for someone who
     isn't a theorist.
   - **Choosing one** starts from the tape's name menu (0045: what acts on
     the tape is in its name's menu). Its row *Lay out a song…* opens the
     templates' menu in its place.
     - The menu lists the five templates, each with its line, its shape
       and its length at the tape's tempo.
     - Each row is a `menuItem` (0056) with one more part: a figure under
       its line, which is the shape. `lib/ui/menu.js` gains that part.
     - Then comes *Clear the sections*. It isn't red: it is undone like any
       edit, and it leaves the audio.
     - This adds no key to the Studio at rest, which holds `STUDIO_BUDGET`
       (J1.16). Making the strip's *Sections* label a key would add a
       second control under 32 px.
   - **Applying one** is a new op, `section-template {template}`: one step
     of undo.
     - Its sections go from bar 1 and replace all the tape's sections,
       including any past the template's end.
     - The audio doesn't move.
     - There is no confirm: a toast with Undo.
     - Refused on a tape with no tempo (*Set the tempo first*: the tempo
       key, `tempo.md`), and past the tape's end.
   - Every template is in 4/4, the tape's only metre. A shuffle or a 12/8
     blues is counted in 4.
3. **A section's length** is a new op, `section-bars {section, bars}`, where
   `bars` is its new length. The inspector has − and + for it.
   - **+** puts an empty bar at its end, on every track (`cutAt` and
     `shiftFrom`, as Insert does with no clipboard). The op moves the
     section's end too: `shiftFrom` leaves alone a section that ends where
     the push begins.
   - **−** deletes its last bar (Delete time). It stops at one bar: a
     section is at least a bar long.
   - What follows moves either way.
   - **+** is refused when the push would run past the tape's end
     (`roomToPush`).
   - A run of taps on one section is one undo step: an edit of kind
     `section-bars:<id>`, which the model's 2 s rule coalesces. Taps on
     two sections stay two steps.

   Dragging an edge stays what it is: a relabel that moves nothing.
4. **Filling a section, by playing.** Use the moves that already exist: tap
   the section (the loop follows), arm a track, play over it, and Catch the
   best pass. The inspector's *Fill it* row has two keys:
   - **Play it** loops the section and plays it after a bar of count-in.
   - **From a take…** opens a menu of the ten newest takes at the tape's
     tempo: within 0.1%, by `SameTempo`, as `send` checks it (the `takes`
     model). A take at another tempo wouldn't fill the section's bars, so
     it isn't offered. The take chosen opens in the picker (decision 7),
     on this section.
5. **Per-section mutes on Hindsight's tracks.**
   - **Where they apply:** the renderer silences a section's `muted`
     tracks inside its span, with the 3 ms declick a cut's edge gets.
     `mixTrack`'s `silent` becomes per span. Every reader of it changes
     with it: the mix, and Play mode's paths in `trick.go`. In the mix, a
     track's own M and S still apply on top.
   - **The mix and a bounce honour them.**
   - **So do the stems: a change to them.** `export.go` builds each stem
     with its M and S cleared and no sections. Section mutes are an
     arrangement, like a Cut, so a stem gets them: silence there. That way
     the DAW opens the song as it plays here. The track's own M and S stay
     cleared, as now.
   - **The inspector's *Heard in it*** is a row of the four tracks,
     on or off.
   - **On the lanes**, a muted track is hatched across the section.
   - **They're an arrangement, so they're undone.** This is unlike Play
     mode's held mutes, which are performance and stay off the stack
     (0006).
   - **A catch onto a muted track** turns that track on there, in the same
     edit: you just played into it.
6. **The MPC Sample.** What its manual (User Guide v1.0) says:
   - **MUTE works on the device only.** Muting is pad by pad, in any mode,
     and the recorded notes stay. No MIDI message mutes a pad. *MIDI Config*
     has Pad MIDI In and Out, the channels, sync and Thru, and nothing for
     mutes.
   - **Receive Program Change** (*Off, Sequence*) triggers sequences.
   - **A sequence picked while another plays starts when the current one
     ends.** That holds for a pad press. A Program Change is to be checked.
   - **It has one stereo out**, plus audio over USB. Its parts can't come
     out on separate outputs.
   - **Song Position Pointer** isn't mentioned.

   | Option | How | Cost | For |
   | --- | --- | --- | --- |
   | Cue on screen | The section's cue, shown two bars ahead: *Chorus in 2 · hats in*. You press MUTE on the MPC. | Small | Any gear, MIDI or none. Your hands still do it every pass. |
   | **Program Change** | Each section's beat is its own MPC sequence: copy the sequence, erase the pads that sit out. Hindsight sends that sequence's Program Change before the section. | Medium; needs a check on the unit | A song you play through or loop while you layer: the MPC is right every pass, with no hands. |
   | Separate tracks | Loop the beat, mute all but the drums on the MPC, catch to track 1; then the bass alone onto track 2. The passes line up because the MPC follows the tape's clock. Then per-section mutes do the arranging. | No code; costs tracks (four) and passes | Rearranging a beat after it is down. |

   **Recommended: Program Change, with the cue as well.** The cue covers
   whatever MIDI can't do, and gear without MIDI. The separate-tracks
   method goes in the guide as a technique, with no code. A guide change
   releases, so it goes in with step 4's PR.
   - **What is sent:** Program Change `program − 1`.
   - **How it is sent: a new interface.** `midi.Out.Send` writes to every
     port it opened, and `ClockOut` (`clock.go`) has no send for one
     device. So:
     - `midi.Out` gains `SendTo(name, at, msg)`;
     - its match list takes the device named for sequences, beside the
       clock's followers. That device's port is for programs only:
       `Send`, `SendNow` and `Devices()` skip it. So it hears no clock,
       Start or Stop, isn't listed as a follower, and its coming and going
       doesn't move `gen`;
     - `ClockOut` gains an optional part for it, as `ClockFollower` is
       one.
   - **Only with `TAPE_CLOCK=lead`:** a program lands on a section's bar
     line only while the MPC follows the tape's clock. Without `lead` there
     is no `Out`, and a section's program isn't sent; its inspector says
     so.
   - **Who hears it:** the one device the Rig names for sequences, never
     every follower of the clock (the Bento and the Sidekick don't want it).
     Until the rig roles exist, that is a setting, `TAPE_PROGRAM_OUT`: a
     name to match, as `TAPE_CLOCK_OUT` takes.
   - **On which channel:** a setting of Hindsight's own,
     `TAPE_PROGRAM_CHANNEL`, default 1. The MPC's MIDI In Channel is *All*
     by default, so it hears any.
   - **When:** on the last beat before a section that has a program, so a
     queued change lands on the bar line.
   - **After a locate:** the program of the section it lands in goes first,
     then the Song Position and the Continue, as now.
   - **At the loop's wrap:** the program goes before the Song Position the
     wrap already sends. That way a looped section gets its own sequence
     every pass.
   - **What that asks of the MPC's sequences:** each one's length divides
     its sections' (1, 2, 4 or 8 bars).
   - This is the *program change at a section's start* that the sections
     spec of 2026-10-07 left for the rig roles.
7. **A jam into a song, after the fact.**
   - **Where it starts:** *Make it a song…* in the take's name menu, on
     Open (0045). Pick a template. (Or *From a take…* in a section's
     inspector, decision 4, on a tape you already have.) Hindsight makes a new
     tape at the take's tempo with the template's sections. The Studio
     opens on it with the **picker** docked above the bar (the cue
     drawer's place, `ctx.dockSlot`; on the phone, a sheet).
   - **The picker** shows the whole take, with the notes and flags left
     while playing marked on it. Over it is a window as long as the
     section, on the take's bar lines.
     - Drag the window a bar at a time. **‹ ›** step it a section's length:
       the previous or next pass.
     - The window plays looped while it is held, or with ▶.
   - **Use for Verse** drops the window onto the section's bars, on
     track 1 or the armed track. It goes over what is there (Paste), as one
     undo step. The picker then moves to the next empty section and keeps
     its place in the take: a jam's next good bit is usually later.
   - **Skip** leaves a section empty, to play into (decision 4).
   - **Picking again** replaces what is there.
   - **A take with no tempo, or no downbeat,** is refused with *Set its
     tempo on its page first*. The take's page already has both: its BPM,
     and its *Downbeat* row. A jam played to a clock that sent a MIDI
     Start has them already, with `MIDI_SNAP_BARS` on (`midi.md`, *why
     takes start on a downbeat*).
   - **Recommended over the alternative,** which puts the 10-minute jam
     on track 1 and rearranges it in place. With the picker the tape stays
     the song's length, the take is untouched, and any section can be
     picked again. The MPC in a jam is already baked into the stereo, so
     only the picker's choice of pass, and per-section mutes on the other
     tracks, shape it.

## The templates

The length is at 96 BPM, the demo's tempo. The menu works it out at the
tape's tempo. *Usually* is the tempo the style is usually played at. It is
here as a guide, and a template never sets it. Each section's cue is
pre-filled from its row.

**Pop**: *Verses tell the story, the chorus is the bit people sing back,
and the bridge is the one surprise before the last chorus.* 64 bars, 2:40;
usually 90–120.

| Section | Bars | Cue |
| --- | --- | --- |
| Intro | 4 | the hook or the beat alone |
| Verse | 8 | sparse: drop the hats, leave room for the voice |
| Pre-chorus | 4 | lift: build toward the chorus |
| Chorus | 8 | everything in: the catchiest bit |
| Verse, Pre-chorus, Chorus | 8, 4, 8 | again |
| Bridge | 8 | something new: change a chord, or drop the beat |
| Chorus | 8 | the last time, biggest |
| Outro | 4 | the chorus fading, or the intro again |

**Blues**: *One 12-bar pattern, round and round. Each time round is a verse
or a solo. The chords move at bar 5, come home at 7, and move every bar
from 9; the last two bars turn it back to the top.* 68 bars, 2:50; usually 70–120.

| Section | Bars | Cue |
| --- | --- | --- |
| Intro | 4 | the last four bars of the pattern |
| Verse ×2 | 12 each | the line, answered by the guitar |
| Solo ×2 | 12 each | lead over the same twelve bars |
| Verse | 12 | the line once more |
| Ending | 4 | the turnaround: stop on the last chord |

**Jazz**: *Play the tune, take turns making things up over its chords, play
the tune again. The tune is 32 bars: a phrase, the phrase again, something
different (the bridge), the phrase once more.* 136 bars, 5:40; usually
120–200.

| Section | Bars | Cue |
| --- | --- | --- |
| Intro | 4 | piano or bass alone |
| A, A, Bridge, A | 8 each | the tune (the head) |
| Solo ×2 | 32 each | make it up over the whole tune, once round each |
| A, A, Bridge, A | 8 each | the tune again |
| Tag | 4 | the last phrase again, to end |

**Ambient**: *No verses or choruses. One sound comes in at a time, it
swells, and they leave one at a time. Change one thing every 16 bars,
slowly.* 96 bars, 4:00; usually 60–90.

| Section | Bars | Cue |
| --- | --- | --- |
| Emerge | 16 | one sound alone, quiet |
| Layer | 16 | add one layer |
| Bloom | 32 | everything in, slow changes |
| Thin | 16 | take layers out, one at a time |
| Fade | 16 | the first sound alone again, fading |

**Jam band**: *A song with a long open middle. Play the tune, wander off,
build to a peak, and find your way back to the tune.* 128 bars, 5:20;
usually 100–130.

| Section | Bars | Cue |
| --- | --- | --- |
| Intro | 8 | the groove alone |
| Theme | 16 | the tune |
| Verse | 16 | the words, or the tune's second part |
| Chorus | 8 | the hook |
| Jam | 32 | wander: same groove, anyone leads |
| Build | 16 | everyone climbs together |
| Peak | 8 | the loudest, densest bars |
| Theme | 16 | back to the tune |
| Outro | 8 | the groove winding down |

**Colours** follow the role:

- cyan: an intro or an ending;
- blue: a verse, an A or a theme;
- violet: a build;
- amber: a chorus or a peak;
- green: a bridge or a change;
- red: a solo or a jam.

## Questions for Gabe

1. **The structures.** Are these the five shapes, at these lengths? The MPC
   suggests a sixth, **hip-hop** (Intro 4, Verse 16, Hook 8, Verse 16,
   Hook 8, Outro 4): wanted?
2. **Settings by name** (every Chorus shares its mutes and its sequence,
   while each keeps its own cue), or each section all its own?
3. **The MPC.** Would you build a section's beat as its own MPC sequence,
   so Hindsight can switch it? Or do you prefer to mute by hand, with the
   cue on screen?
4. **+ on a section** adds an empty bar (recommended), or repeats its last
   bar so the beat carries on?
5. **A jam into a song.** Should it start from the take (a new tape,
   recommended), or over a tape that already holds the jam?
6. **Your own templates.** Should you be able to save a tape's sections as
   a template? Not in this spec's build.

## Build order

Each step is its own PR with its flow. The flows don't exist yet: each PR
writes its own.

Two things come first:

- **The walkthrough.** Nothing user-visible merges before it ends
  (`STATE.md`, *the-ecosystem.md comes first*). Step 1 can go ahead now.
  The rest waits for it.
- **The `tape` model** (`lib/models/tape.js`, the ecosystem's step 4). The
  new keys call it rather than adding to `lib/tape/page.js`, so it is
  built first, as its own PR (0020).

1. **Hardware check on the MPC Sample** (no code). Does a Program Change
   switch at once, or at the sequence's end? On which channel? Does it
   follow Song Position, or only Start? Decision 6's timing waits on this.
2. **Templates.** `templates.go`, `GET /api/tapes/templates` and
   `section-template`, with Go tests (laid from bar 1, replacing, refused
   with no tempo or past the end, one undo). *Lay out a song…* in the
   tape's menu, and the templates' menu, with `menuItem`'s figure. Flow
   J1.18, *lay out a song from a template*.
3. **A section's length.** `section-bars` and − / + in the inspector.
   J1.18 extended.
4. **Per-section mutes.**
   - On the Pi: `Section.Muted` and the per-span `silent` (the mix,
     `trick.go`, mixdown and the stems).
   - On the page: *Heard in it* and the hatching.
   - Go tests: the audio inside the section is silent, the audio outside
     it isn't, a stem has the silence, and undo puts it back.
   - The guide's separate-tracks technique.
   - Flow J1.19, *mute a track in the verses*.
5. **Cues.** `Section.Cue`; the flag over the strip two bars ahead while
   the tape plays. Later, the SMK-37's screen.
6. **Program Change.** `Section.Program`; `midi.Out.SendTo` and
   `ClockOut`'s part for it; the send in `clock.go`, after a locate and at
   the wrap; `TAPE_PROGRAM_OUT` and `TAPE_PROGRAM_CHANNEL`. Go tests with
   the clock's fake out: only the named device hears it, on its channel,
   on the beat before; that device hears no clock; and without `lead`
   nothing is sent.
7. **A jam into a song.** *Make it a song…*, *From a take…* and the
   picker. Flow J2.12, *make last night's jam a song*.

Steps 2–4 are the songwriting machine on their own. Steps 5–7 can wait on
the walkthrough's answers about the instrument and who leads the clock.
