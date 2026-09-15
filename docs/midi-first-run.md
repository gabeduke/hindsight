# MIDI capture: first run on the Pi

What to check, in order, the first time this runs against the real rig. Each
step has a thing to look at and what it should say. Nothing here needs the
DAW until the last step.

## 1. Deploy and confirm nothing regressed

```bash
./deploy.sh
curl -s http://<pi-host>:5000/api/status | python3 -m json.tool | grep -E 'capture_healthy|midi_connected|midi_bpm|midi_devices' -A8
```

`capture_healthy` true, `midi_connected` true with the EP plugged in and
clock-send on, `midi_bpm` a number. `midi_devices` lists the EP with
`"clock": true`. Nothing about audio capture changed; if `capture_healthy` is
false, that is a deploy problem, not a MIDI one.

## 2. See what the Pi calls each device

Plug in everything — through the powered hub — then:

```bash
ssh "$HINDSIGHT_HOST" cat /proc/asound/cards
ssh "$HINDSIGHT_HOST" ls /dev/snd/
```

Every device that should send MIDI needs a `midiC<N>D0` node. The product
string after `USB-Audio - ` is the name its tracks will carry and the string
`MIDI_DEVICES`, `MIDI_IGNORE` and `MIDI_CLOCK_DEVICE` match against.

**Orchid:** power it on, let it finish booting, *then* connect USB. If it
enumerated as a power sink there will be a card with no `midi` node, or no
card at all; unplug, wait, replug. The watcher picks it up within two
seconds of the node appearing — no restart.

**Bento:** the plan's open question — does the device port send MIDI to a
host on current firmware? If a `midiC<N>D0` node exists for it, run step 3
and look for its events. If it exists but never sends, the KeyStep's own
USB port is the fallback for its notes.

## 3. Watch the events arrive

```bash
watch -n2 'curl -s http://<pi-host>:5000/api/status | python3 -c "import json,sys; [print(d[\"name\"], d[\"events\"], d[\"bytes\"], \"clock\" if d[\"clock\"] else \"\") for d in json.load(sys.stdin)[\"midi_devices\"]]"'
```

Play each instrument. Its `events` count should climb; `bytes` climbs on the
clock device even when idle (24 pulses a beat). A device whose `bytes` climb
but `events` do not is sending only clock or SysEx — both are expected from
the EP.

The **MPC's channel layout** shows up here too: save a take (step 4) and
read the manifest's `tracks` — one per channel it transmitted on.

## 4. Save a take and read the manifest

Press Capture (30s), then:

```bash
ssh "$HINDSIGHT_HOST" 'ls -t ~/hindsight/jam_saves/*.manifest.json | head -1 | xargs cat'
```

What to look at:

- `tempo_source`: `midi-clock` if the clock ran the whole time. `mixed` or
  `fallback` means it stopped, or the clock device is not the one you think
  (`clock_device` says which substring was used).
- `tempo_bpm`: should agree with the takes list's BPM tile, roughly.
- `downbeat`: `source: midi-start` with `aligned: bar` and `tick: 0` means
  the window was snapped to a downbeat and bar 1 is the file's first tick.
  `source: window-start` means no Start message has been seen since the
  service came up — the clock device has never sent one — so bar 1 is
  declared to be the take's first frame and the pulses fall where they fall
  within it. The EP never sends Start (it has no transport). Until the Bento
  is the clock, expect `window-start`; the grid is still true, it just is
  not the sequencer's idea of bar 1.
- `devices` and `tracks`: every instrument you played, with the channels it
  used. `dropped.ring_overflow` should be 0.

Then the file itself, without a DAW:

```bash
ssh "$HINDSIGHT_HOST" 'python3 ~/hindsight/scripts/midi-dump.py $(ls -t ~/hindsight/jam_saves/*.mid | head -1)'
```

One tempo event for a steady clock, a track per instrument and channel with
the right names, note ranges that look like what you played, and every
track ending at the take's length.

## 5. Calibrate

Play isolated hits from one instrument — a drum pad, single hits a second
apart, twenty or thirty of them — with nothing else running, and save.

```bash
scp "$HINDSIGHT_HOST:~/hindsight/jam_saves/jam_<ts>.{wav,mid,manifest.json}" /tmp/
python3 scripts/midi-calibrate.py /tmp/jam_<ts>.wav --verbose
```

It prints the median offset between note-ons and the hits, the spread, and
the `MIDI_LATENCY_MS` to set. Put that in `~/hindsight/hindsight.env` and
restart. A spread of a few milliseconds is normal. A spread of tens is the
one result that would argue for the ALSA sequencer's kernel timestamps over
the userspace ones this build uses — say so and that becomes the next piece.

## 6. Drop it in the DAW

New project. Import the take's WAV at the project start; import the `.mid`
at the project start with "import tempo map" (Reaper asks; Logic imports it;
Ableton takes the file's tempo at import). The kick you played should sit on
its own transient, the bar lines should sit on the downbeats, and each
instrument and channel should be its own named track.

If the notes are consistently early or late by the same amount, that is step
5's number. If they drift apart over the take, that is the clock bridge
failing to track something, and the manifest plus the `.mid` are enough to
diagnose it offline.
