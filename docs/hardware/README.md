# Hardware profiles

What Hindsight knows about each piece of gear in and around the rig, and what
it doesn't yet. The profiles themselves are
`internal/rig/profiles/*.json`: the rig page draws a device from one. This
folder is the notes beside them.

| Profile | Device | On the Pi? | Matched by | Missing before it can be matched |
|---|---|---|---|---|
| `ep-136` | Teenage Engineering EP-136 K.O. Sidekick | USB, audio and MIDI | USB id `2367:9420`, MIDI name | nothing: measured on the Pi |
| `bento` | 1010music Bento | No: audio into the Sidekick | MIDI name `Bento` | audio and USB ports, from its manual |
| `mpc-sample` | Akai MPC Sample | No: plays through the Sidekick | MIDI name `MPC Sample` (a guess) | the real MIDI port name, the USB id, the pad note map |
| `smk-37-elite` | M-VAVE SMK-37 Elite | Planned | MIDI name `SMK-37` (a guess) | the real MIDI port name, its ports, what each control sends |
| `scarlett-solo-4g` | Focusrite Scarlett Solo 4th Gen | Planned: the self-contained kit | nothing yet | the USB id, which capture channel is which |
| `zoom-r20` | Zoom R20 | No: a reference, and a tester's recorder | nothing yet | the USB ids, if its USB audio is ever used |

A profile that matches nothing is inert: the rig never reaches for it. The
Scarlett and the R20 are inert for now. The MPC Sample and the SMK-37 match a
MIDI port by a guessed name: right, the rig draws a named card; wrong, it
draws the generic one it always did. **No USB id is matched until it has been
read off a unit.** The four new ones are `placeholder: true`, the flag the rig
already uses for a device waiting on its manual: it names what is known and
draws no tap.

## Reading a profile

The top-level fields are the rig's own (`id`, `name`, `match`, `ports`, `taps`,
`returns`; see `internal/rig/profile.go`). **Everything under `hardware` is
ignored by the program.** It is notes for people, and the shape a later
registry would serve. Each fact carries a status:

| Status | Means |
|---|---|
| `sourced` | From the maker's own page or manual, listed under `refs` |
| `owner` | What the owner said about their own unit |
| `unconfirmed` | Reported by users or reviews, conflicting, or about a sibling model |
| `to-capture` | Needs a check on real hardware |

Each USB id is `captured` (read off a unit with `lsusb`), `hinted`
(remembered, never read off hardware) or `to-capture`. **Only a captured id may
be copied into `match.usb`**; `hardware_test.go` fails otherwise. Each
`unknowns` entry says what isn't known and the exact command that would settle
it: that list is the to-do for filling a profile from a real unit.

Pictures are listed by id under `hardware.images`, and the ids are defined in
[images.md](images.md).

## Capturing an unknown device

Plug it into the Pi, then run these on the Pi. None of them changes anything.

```sh
lsusb                              # run before and after plugging in; the new line is the device
lsusb -v -d <vid>:<pid> | less     # its descriptors: classes, endpoints, power draw
cat /proc/asound/cards             # the ALSA card and its name
cat /proc/asound/card*/usbid       # "vid:pid" per card: what ForUSB matches on
arecord -l ; aplay -l              # audio devices
arecord -D hw:<card> --dump-hw-params   # channels, rates, formats (stop with ^C)
amidi -l ; aconnect -l             # MIDI ports and their names: what ForMIDI matches on
aseqdump -p <client:port>          # what it sends; move each control, hit each pad
dmesg | tail -30                   # enumeration, and power trouble
```

`scripts/midi-probe.py` answers the clock questions for a MIDI device. The
power draw matters on a bus-powered kit: `dmesg | grep -i under-voltage`.

## Filling in a profile

1. Capture the ids and port names above.
2. In `internal/rig/profiles/<id>.json`, set `match.usb` to `vid:pid` (lower
   case, as ALSA's `usbid` prints it) and/or `match.midi` to the port-name
   substring. Update `hardware.usb` to `captured` and the facts you checked
   to `owner`; delete the `unknowns` you settled.
3. When the ports are read off the unit, correct their labels (until then they
   describe a jack; they are not its panel markings). When you know which
   capture channels are which, add `taps`, and drop `placeholder`.
4. `go test ./internal/rig/`.

To add a device, copy the nearest profile, give it an id, and list its images
in [images.md](images.md) first.

## What a release does

`internal/rig/profiles/` is under `internal/`, so a change to a profile cuts a
release like any code change. A change to this folder alone does not.

## Later: sharing profiles

Not built; this is what the files are shaped for. Nothing here talks to a
server yet.

- **Lookup, in order:** the release's own profiles (embedded, so a kit works
  offline); then a newer copy from the hub, data only, never code; then the
  generic profile the rig makes from channel counts. The release is the floor
  and a registry only ever adds.
- **Where:** two more routes on the hub (`cmd/hindsight-hub`), which already
  knows every kit by its token: `GET` a profile by `vid:pid` or MIDI name, and
  `POST` a report of a device nobody has described. No hub configured, no
  traffic, nothing lost.
- **A report** holds only what the capture list above produces: `vid:pid`,
  the descriptor summary, the ALSA card name, channels and rates, MIDI port
  names, the Hindsight version. **Never** a serial number, an address, a
  hostname or a tailnet name. Off unless the owner turns it on, and the
  settings sheet says what is sent.
- **A report is a lead, not a profile.** A draft made from it is
  `unconfirmed` throughout, and **a person reviews it** before the hub serves
  it: a wrong pad map would mislead every kit that pulls it.
- **The Go side:** a loader for a second directory of profiles beside the
  embedded set, where the same `id` with a higher `rev` wins (`check` already
  refuses a profile that doesn't hang together); a `rev` and an optional
  signature; fetch on the heartbeat, with the last good copy on disk.
- Remote per-kit feature switches are a different payload with a different
  risk, so they would be their own spec.
