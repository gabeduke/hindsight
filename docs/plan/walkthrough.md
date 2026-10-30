# The walkthrough: how Gabe uses Hindsight

Notes from the walkthrough of 2026-10-30, talked through rather than
marked up. These are the stories in Gabe's words, condensed, each with
the component it lands on (`docs/plan/the-ecosystem.md`). Nothing here
is decided yet; the decisions go at the end as they are agreed.

## Where the idea came from

Jamming on the Orchid, he hit the limits of its looper. He wanted to play
guitar and a drum machine over the loop he'd made, but the Orchid went to
sleep after five minutes, and there was no way to keep any of the jams he
was coming up with. Hindsight started there.

## Reaching back (Catch and Keep)

- **Catch makes sense; how it's shown doesn't.** Two ways he uses it:
  - a whole jam he's been noodling on for the last 5 or 10 minutes,
    kept as a backing track for something else, or chopped up in post;
  - a loop set over a few bars, catching the last pass with an
    overdub.
- **Keep should be a slider, not a fixed length.** He always needs more
  tape than he has audio, so pruning is his first step every time. Save
  the clip he wants instead. (The ecosystem review's worksheet, row
  `keep-last`; `the-ecosystem.md` links the review.)
- Both reach back into the memory and take a piece: one move with two
  ends to drag and a choice of where it goes, the tape or the shelf.
  *Capture.*

## On the phone

- **Mostly listening, light edits and sharing.** After a fun jam the
  night before: get it into shape quickly and send it, as a sketch that
  isn't permanent. Today that's SoundCloud, or an MP3 in a chat.
  *Library, Take.*
- **Projects.** What was shared should lead back to what made it: from an
  export, find its project and every clip that went into it. *A new
  model; is it the tape?*
- **A share link that's already hosted** (a cheap object store), so
  sending is one step. *The hub.*
- **Overdub from the phone.** A beat from the MPC Sample put on tape the
  night before; sit down with the Orchid and play chords over it onto
  another track. And the reverse: an Orchid jam that hits the wall,
  recorded to a track, with another instrument over it. He's unsure about
  latency when the web app records.
- **Ideally the phone records itself.** A native app as a Hindsight
  client that records and renders locally, for low latency. Away from
  the Pi it doesn't need the Pi's ring buffer: it keeps its own, and a
  copy of the tape kept in sync, with the same live edits as the tablet.
  A bigger project, but the one the idea started from (above). *A second
  engine: the phone runs the same models and protocol as the Pi.*

## The pocket app: Android first, iOS later

- Android's personal apps (Google Play, October 2026) might be an easy way
  in. They are built with Google AI Studio, need no developer account,
  stay private on your own device, and come to friends and family "in the
  coming months". The announcement says nothing about permissions,
  background running or recording audio.
- Gabe has no iPhone, but if Hindsight becomes a product it builds for iOS
  too. Plan for it now so it isn't a re-architecture later. *The tape's
  format and the sync protocol should be the contract every engine meets, with
  shared conformance tests; no one codebase is the contract.*

## Playing with other people

- Send a jam to a friend or his brother; they overdub on their own phone,
  and the piece becomes a collaboration. A tape is an edit list over audio
  files, so sending one is sending the list and the files, and a reply is
  only the new audio and the new edits. *The same storage as hosted share
  links (the hub, or an object store), plus whose part is whose.*

## Song templates

- His jams are free-form, 5 or 10 minutes: great moments, but not the song
  shapes most ears expect. Templates per style (pop, blues, jazz, ambient,
  jam band) give a structure of sections to fill in with light edits. He
  doesn't know the structures himself, which is part of the point.
- Each section's length in bars can be changed to make it his own.
- Fill a section by muting pads of the MPC beat to suit it, or by layering
  guitar or vocals where it needs something. "A songwriting machine."
- *Sections are named ranges on the tape's bars. Changing a length is
  Insert or Delete time. Filling one is the loop-and-catch move: loop the
  section, play over it, catch the pass. It leans on the tempo work. Pads
  inside one stereo recording of the MPC can't be muted afterwards, so the
  template either cues the change live (or over MIDI), or the MPC's parts
  go to separate tracks.*

## In the jam space

- Speakers and the EP-136 on; pick up something with a loop (Stylophone
  Beat, MPC Sample) and play. He doesn't know it's good until it has
  been going for a few minutes, then realises the last five were magic.
  Catching after the fact and layering synths or guitar over it is the
  heart of it.
- The tablet is tight as a touch DAW, but the incoming feed and the
  tape's layers are easy to see. Wanted:
  - **arming a track**: easy to see and to choose, by touch; *Tape*
  - **loops, aligning clips, setting their downbeat**; *Tape, Tempo*
  - **fades in and out** by touch; *Tape*
  - **Mute and Solo** big enough for a finger; *Tape*
  - **where the sound goes**: once it's all digital through the
    interface, routing is opaque. The kit drawings are a start but hard
    to find, and it's hard to tell which way audio flows and where it's
    mixed. Example: noodling on a synth, listen to CH2 alone into the
    EP-136 without re-recording the main track. Maybe a guitar through a
    Zoom AMS-24 straight into the Pi as a second interface. *Rig,
    Engine.*

## Along the way

- **The phone's transport keys are stacked** on v2026.10.30.1. Every
  component should be easy to check at each size, so building out the app
  can't break a surface this obviously. The flows run on the tablet and
  the desktop unless a flow names the phone.
  - Found: with Play mode on, the Studio's mini player squeezes its keys on
    top of each other. A rule in `styles.css` was written for the bar as a
    row, and cead7f93 made the bar a column. No flow turns Play mode on,
    and J1.8 isn't written yet. With Play mode off, nothing stacks. The
    opened sheet stacking its zones under 600 px is by design.
  - J5.1 also fails on the phone on main: the Help mode banner covers a
    take's Open link.

## Decided

- **Play mode's per-device flag is to be retired** (not done yet: it is
  still in `device-prefs.js`). Gabe didn't remember what it was. Its strip is either merged into the app or deleted; the Pi's
  momentary tricks, which the keyboard's FX page plays, aren't part of
  that call.
- **The phone is a surface the checks cover**, like the tablet and the
  desktop, so building out the app can't break it unseen.

## Still to talk through

The instrument's shape. Which actions must feel instant. Who leads the
clock. Whether the laptop is a surface of its own. The six verbs. Who else
uses a kit. Access control on the Pi's API. (`the-ecosystem.md`, *To
settle*.)
