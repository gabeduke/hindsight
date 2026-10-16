# Device profiles: what we know about the gear, and how it could be shared

**Date:** 2026-10-15 · **Status:** the profiles and notes are written; sharing
them is **not built**, only designed so it can be · **Repo:** `hindsight` ·
Builds on [the rig](2026-10-15-rig-design.md), where devices are profiles ·
Notes and images: [`docs/hardware/`](../../hardware/README.md)

## Why

The Pi already phones home for its certificate
([the hub](../../hub.md)). Gabe, 2026-10-15: it could phone home for *features*
too. The case that makes it concrete is a device Hindsight hasn't met: a MIDI
controller, or a new interface, plugged in. Hindsight could look it up, and if
nobody has described it, find out what it can and report that home, so the
next kit that meets it already knows.

Before any of that is worth building, the profiles have to hold what is known,
and say plainly what isn't. The rig had two (the Sidekick, measured; the Bento,
a placeholder). This adds the rest of the current stack: the Zoom R20, the
Akai MPC Sample, the M-VAVE SMK-37 Elite and the Focusrite Scarlett Solo 4th
Gen. They are the first test of whether the shape holds.

## Decided

1. **One profile, the rig's.** A device is `internal/rig/profiles/<id>.json`:
   ports, taps and returns, matched by USB id or MIDI name. No second schema.
2. **Notes ride in the same file, under `hardware`,** which the loader ignores:
   facts with a status, the unknowns with the check that settles each, the
   maker's pages, image ids. One file per device; nothing to keep in step.
3. **Nothing is guessed.** A fact is `sourced`, `owner`, `unconfirmed` or
   `to-capture`. A USB id is `captured` (read off a unit), `hinted` or
   `to-capture`, and **only a captured id may be matched on**; a test holds it.
   The Scarlett and the R20 match nothing yet. The MPC Sample and the SMK-37
   match a MIDI port by a *guessed* name; they are placeholders, so a wrong
   guess leaves the generic card the rig draws today, and a right one draws a
   named card with only the ports known to be there.
4. **A profile informs; it does not decide.** Nothing in a profile changes how
   Hindsight captures, routes or plays. It names jacks, explains them, and
   says what is not known. (This is why the sharing design below is safe to
   start small: a bad profile can mislabel a socket, never reroute audio.)
5. **Images are references.** The repo is public, so
   [`images.md`](../../hardware/images.md) lists maker URLs and ids, and no
   picture is committed. Photos of Gabe's own units can be.
6. **No client or server now.** Only the files, the notes and the test.

## The shape of the notes

```
hardware: {
  extending,          // how this file is meant to be filled in, in a sentence
  kinds, names,       // what it is; the names it goes by
  usb: [ {vid, pid, mode, status} ],
  connection,         // how it meets the Pi today
  audio, midi, storage, controls,   // facts, each with a status
  quirks: [ {text, status} ],
  unknowns: [ {question, how} ],    // the to-do, with the command
  hindsight: {role, notes},
  images: [ids], refs: {tag: {title, url}}
}
```

`internal/rig/hardware_test.go` checks the statuses, that every `ref` is an
https link, that an unknown has a question and a check, and that every image id
is in `images.md`.

## Extending later: sharing profiles between kits

Not built. This is what the files are shaped for.

### Lookup, in order

1. **The release's own profiles,** embedded in the binary. A kit works with no
   network, and always did.
2. **A newer copy from the hub,** if the kit can reach it: a profile for a
   device the release predates, or a corrected one. It is data only, never
   code.
3. **Unknown to both:** the generic profile the rig already makes from channel
   counts, and nothing assumed.

So the release bundle stays the floor, and a registry only ever adds. This is
why periodic updates matter little: a release already carries every profile
that existed when it was cut.

### Where it would live

The hub (`cmd/hindsight-hub`) already knows every enrolled kit by a token and
already hears a heartbeat. The registry is two more routes on it, not a new
service:

- **Read:** `GET` a profile by `vid:pid` or MIDI name, or the whole set with
  a version. Static JSON would do; nothing here is per-kit.
- **Report:** `POST` what a kit saw of a device nobody had described.

The kit's existing hub token is its identity for both. A kit with no hub
configured does neither, and loses nothing.

### What a report holds, and what never leaves

A report is only what `docs/hardware/README.md`'s capture list produces for a
device: `vid:pid`, the descriptor summary, the ALSA card name, the channel and
rate set, the MIDI port names, the Hindsight version. **Never** a serial number,
an address, a hostname or a tailnet name, or anything about the room. The repo
rule that no tracked file carries home network details applies to a report the
same way. It is off unless the owner turns it on, in the settings, and the
settings sheet says what will be sent.

### From a report to a profile

A report is a *lead*, not a profile. The path:

1. The hub keeps reports; nothing is served from them.
2. A draft profile can be made from a report: from public USB id lists, the
   maker's own pages, and the device's descriptors, as far as they go. A draft
   is `unconfirmed` throughout.
3. **A person reviews it** before it is served. An invented pad map or port
   label that is wrong would mislead every kit that pulls it, so there is no
   path from a draft straight to a kit.
4. Once served, it is a normal profile: the kit loads it like an embedded one.

### What the Go side would need

Small, and none of it is written:

- A loader that reads a second directory of profiles beside the embedded set,
  and lets a profile with the same `id` and a higher `rev` replace the
  embedded one. `loadProfiles` already refuses a profile that doesn't hang
  together (`check`), and would refuse a bad downloaded one the same way.
- A `rev` and an optional signature on a served profile, so a kit can ignore
  an unsigned one.
- Fetch on the heartbeat, with the last good copy cached on disk.

### Remote switches, separately

"Features" can also mean flags: this kit gets the new interface, that one
doesn't. That is a different payload from a device profile, with a different
risk (it changes what the app does), so it is its own spec. The same hub token
and the same offline-first rule would apply.

## Open

- **Which matches to trust?** `match.midi` is a substring of a port name. The
  new profiles' names are guesses until `amidi -l` has run with each device in.
  A registry would need a stricter match than a substring.
- **What does "captured" cost?** A kit's owner can run the capture list; a
  tester's can't. A tiny script that prints the report's fields, read-only, is
  the obvious next step, and was left out here to keep this docs-only.
- **Should an unmatched device show a hint?** The rig shows a generic card.
  Saying *"Hindsight has no profile for this; here's what it would need"* is
  small, and not in this.
- **The Sidekick's profile has no notes block.** It is the measured one the
  others are shaped against; give it one if it should be listed with the rest.

## Checks

- `go test ./internal/rig/`: every embedded profile still loads and hangs
  together, and the notes test above passes.
- The test fails when a matched USB id isn't `captured` and when an image id
  isn't in `images.md` (both tried by hand against the data).
- The app's behaviour changes in one case only: a MIDI port named like
  `MPC Sample` or `SMK-37` now gets a named placeholder card in the rig, where
  it got a generic one. Nothing else reads a profile.
