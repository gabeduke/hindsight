# Tape on this phone: the tape as a backing track anywhere in the house

**Date:** 2026-10-05 · **Status:** design approved by the owner 2026-10-05
(the canvas); this spec awaits review · **Issues:** #29 (design), #28 (build) ·
**Repo:** `hindsight` · **Canvas:** https://claude.ai/artifact/VMQPEjAuaAWtCVykeKoy8J

## Why

The owner builds a tape in the jam room, then wants to take it around the house
as a **backing track**: hear it on a phone while using the normal tape controls
(play and stop, locate, loop In/Out and on/off, mute, solo, track levels). Once
a part is worked out, they go back down to the jam room, switch the output back
to the Sidekick, and record from the line in.

- It is the same mix the tape sends to the Sidekick: bus A and bus B, at track
  levels, with mutes and solos. No Sidekick EQ or FX.
- Lag is fine. It is a backing track, not monitoring.
- It replaces the idea of a one-shot rendered file, which can't follow mutes,
  solos, loop edits or the playhead.
- Later, the same stream plays on the owner's **Sonos** speakers (Living room,
  Craft room), so the phone is only the remote (phase 2, below).

## What the owner sees

The canvas has every screen; this section is the contract.

### The OUT menu

The tape page's header gets an **OUT** pill beside the tape name and tempo,
drawn like them as a menu: `OUT · Jam room ▾`, `OUT · Phone ▾`, `OUT · Both ▾`.
On a phone it sits in the top bar; on a laptop or the bench, in the header's
second row. Tapping it opens the **Output** sheet:

| Choice | What it means (the copy on the key) |
|---|---|
| **Jam room** | Through the Sidekick downstairs. Rec, Catch and mixdown work. |
| **This phone** | A backing track here, about 0.8 s behind. The jam room stays silent. |
| **Both** | The jam room plays and records as usual; this phone hears it 0.8 s late. |

Under the choices: the measured delay in an amber LCD ("0.8 s late, measured.
The playhead and meters here move back by this much, so what you see is what
you hear.") and one line: "One phone at a time: choosing This phone on another
device moves the tape there."

"This phone" is the device the sheet was opened on, whatever kind it is (a
laptop upstairs too). The pill reads **Phone** for any browser listener.

### Playing on this phone

- A **status strip** under the deck, an amber-on-black well: a status LED, the
  output, and the delay on the right. "Playing on this phone · 0.8 s behind";
  "Ready on this phone" when stopped.
- The **playhead, the counter and the VU meters** show what is being heard,
  not what the Pi is rendering.
- **Controls answer at once.** A mute or solo key lights the moment it's
  tapped, and its track shows `in 0.8 s` until the change is heard; the lane
  dims then. A locate draws a hollow marker on the ruler and a dashed line
  through the lanes at the target; the playhead jumps there when the sound
  does. The strip reads "Moving to bar 3… · in 0.8 s".
- **Rec and Catch wait for the jam room.** The Rec key is dimmed
  (`aria-disabled`, still tappable), the Catch key becomes a plain
  "Catch · jam room only", and the panel's INPUT row, catch length and mode
  and the pass keys give way to one line: "Rec, Catch and the passes wait for
  the jam room: this phone hears the tape late, so a pass would land off the
  beat. *Change the output*". Tapping Rec or Catch opens a small sheet,
  **REC AND CATCH NEED THE JAM ROOM**, with **Switch to the jam room**
  (orange) and **Not now**; its text points to *Overdub on this device* for
  trying an idea upstairs.
- Edits (clipboard, Lift, Copy, Split, ×2, snap) and Overdub on this device
  keep working.

### States

| State | Strip | Deck lamp |
|---|---|---|
| Starting (filling the buffer) | amber LED blinking · "Starting on this phone…" · `buffering` | WAIT |
| Playing | green LED · "Playing on this phone" · `0.8 s behind` | PLAY |
| Locate pending | green · "Moving to bar 3…" · `in 0.8 s` | PLAY |
| Stream lost | amber blinking · "Stream lost · paused at 3.2" · `reconnecting` | PAUSE |

### Downstairs, on the laptop or bench

While the output is This phone, a dark strip under the header reads: "**Tape 1
is playing on a phone**, 0.8 s behind. The jam room is silent, so Rec and
Catch are off." with an orange **Play in the jam room** that switches the output to
the jam room from the same spot. (The canvas says *Play it here*; the page
can't tell the jam-room laptop from one upstairs, so the key names the room.) The alignment status reads **no lock** (grey)
instead of *aligned*; Rec is dimmed, and Catch shows a one-line explanation.

## Decisions (the eight questions in #29)

1. **Clock.** Whenever the Sidekick output is open, **its callback stays the
   clock in every mode**: in *This phone* mode the device still pulls every
   block, the block goes to the stream, and the device plays silence. So the
   tape's output frame stays the device's frame, Δ and the aligner are left
   alone, and the Pi is silent. Only when the device isn't pulling at all
   (the Sidekick is off or unplugged) does a **pacer** driven by the Pi's
   monotonic clock take over, in 20 ms steps. A change of driver counts as a
   slip for the aligner. Drift between the Pi's clock and the phone's
   (±100 ppm, about 0.4 s an hour) is the phone's job: its player holds about
   0.8 s and drops or repeats a single frame now and then to keep it there.
2. **Transport and UI sync.** Every stream packet is stamped with its output
   frame and the tape position at its first frame. The page knows which frame
   it is playing now (what it has handed to the speaker, less the audio
   context's output latency), so the playhead, counter and meters show the
   heard position by interpolating from the stamps. Controls go to the server
   at once, so the page shows them at once; their sound follows.
3. **Wire.** Uncompressed PCM16, stereo, 48 kHz, in 20 ms packets over a
   WebSocket: 192 KB/s, no codec, fine on home Wi-Fi and over Tailscale
   (relayed or direct; the buffer absorbs either). Opus is not worth a
   dependency.
4. **Switching.** The transport keeps playing from the same spot when the
   output changes. Switching to This phone is refused while Rec is armed or
   recording, or a mixdown is running ("Finish the recording first"). Switching
   back to the jam room needs nothing: the device has been the clock all along.
   The output starts as Jam room when Hindsight starts.
5. **What browser mode disables.** In *This phone* mode the server refuses
   Rec/punch, catches, free-loop taps and mixdown with **409** and the message
   "That needs the jam room: the tape is playing on a phone." *Both* refuses
   nothing: the jam room is the clock and the monitor. No estimated mode.
6. **Listeners.** One at a time. A new listener takes the stream; the old one
   gets a "moved" message and shows "Tape 1 moved to another device", with
   *Play it here* to take it back. Pi cost: one 4-to-2 channel sum and a copy
   per block.
7. **Phone behaviour.** The page holds a screen wake lock (the existing
   `lib/wakelock.js`) while the tape plays on it, and sets Media Session
   metadata (the tape's name, artist "Hindsight") with play and pause
   handlers. Lock-screen playback on iOS is best effort and gets a rig test; if
   Safari suspends the audio when the screen locks, the strip shows "Paused
   when the screen locked" and play resumes from there. **A dropped stream**
   (Wi-Fi blip): if there is no listener for 2 s while playing in This phone
   mode, the server stops the transport where it is. The page reconnects with
   backoff (0.5 s doubling to 5 s) and, if it was playing, plays from where it
   stopped.
8. **Overdub on this device** (`away-sheet.js`) keeps its file and its own
   listen endpoint for now. It can move to the stream later; it doesn't need
   to for this.

## How it works

### Server

- **`tape.Output`**, a new `audio.Sink` the engine is given instead of the
  device sink. It wraps the device sink (or the demo's) and owns the mode:
  `jam`, `phone`, `both`.
  - The device's callback calls the engine's `pull`, then, in `phone` or
    `both`, copies the block to the stream; in `phone` it then zeroes the
    device's buffer.
  - The pacer runs only while the mode isn't `jam`, a listener is connected,
    and the device hasn't called back for 200 ms. It pulls whole 20 ms steps
    (960 frames) by elapsed monotonic time. The two never pull at once: the
    device callback takes the driver lock with `TryLock` and plays silence for
    that period if the pacer holds it.
  - Frames the pacer pulled shift where the device's own count begins: the
    engine's `sinkBase` grows by them, through a small hook the engine offers
    sinks that ask for it. A change of driver counts as a restart, at the
    frame it happened, for the aligner.
  - It forwards the device's optional capabilities (`Name`, `OutputBridge`,
    `Restarts`, `LastSlip`, `Delta`), so the aligner, the MIDI clock and the
    demo's exact Δ behave as before.
- **`tape.Stream`**, the stream hub. The device thread only copies the summed
  stereo block into a lock-free ring; a hub goroutine cuts it into 20 ms
  packets, stamps each with its output frame and the engine's position at that
  frame (`PosAt`), and hands them to the listener. A listener whose queue is
  full loses its oldest packets, never the device thread's time. Listeners
  are an interface, so Sonos can be one later.
- **Mix to stereo.** The stream's two channels are bus A left + bus B left,
  and bus A right + bus B right, as the Sidekick would sum them with its
  faders at unity, clipped to PCM16.
- **Packets.** A binary WebSocket message: a 24-byte header (`HSTR`, version
  1, flags bit 0 = playing; output frame `uint64`; tape position `int64`,
  −1 when stopped), then 960 stereo frames of little-endian `int16`.
- **API.**
  - `GET /api/tapes/stream`: WebSocket. Server to page: packets, and JSON text
    messages `{"type":"moved"}` and `{"type":"mode","mode":"jam"}`. Page to
    server: `{"type":"fill","ms":812}` every 500 ms (its buffer), which the
    server reports as the measured delay.
  - `PUT /api/tapes/output` with `{"mode":"jam"|"phone"|"both"}`: 409 with the
    reason when refused.
  - The tape's live state gains `output_mode`, `stream` (`listeners`,
    `delay_ms`, `state`: `idle`, `playing`, `lost`) for every page to draw
    the pill, the strip and the downstairs banner.

### Page

- **`lib/tape/stream-buffer.js`**: the pure part. Packets in, frames out,
  drift trim, the heard frame and position, the fill. Unit-tested with
  `node --test`.
- **`lib/tape/stream-worklet.js`**: the AudioWorklet that plays from it, at
  48 kHz (`new AudioContext({ sampleRate: 48000 })`).
- **`lib/tape/stream-player.js`**: the WebSocket, reconnects, the fill reports,
  wake lock and Media Session.
- The tape page draws the OUT pill, the sheet, the strip, the guard rails and
  the pending marks, and takes the playhead, counter and meters from the
  player while the output is this phone.
- New tips in `tips.js` for every new `data-tip`; the guide's tape section
  gains "Taking the tape upstairs".

## Phase 2: Sonos (later, its own spec)

A Sonos speaker fetches its own audio from a URL, so it is the other kind of
listener: Hindsight serves the same mix as an endless HTTP stream (WAV, or FLAC
if a Sonos won't play an endless WAV; tested on the owner's speakers first) and
tells a room to play it over Sonos's local network control (SSDP to find rooms;
`SetAVTransportURI`, `Play`, `SetVolume`). In the canvas the Output sheet gains
an **ON SONOS** row of rooms, and while a room plays, the phone is the remote
with a **Volume** slider. The delay is longer (about 2 s, estimated from where
the speaker reports it is), and Rec and Catch still wait for the jam room.

Phase 1 keeps the door open by making the hub's listeners an interface; it
builds nothing for Sonos.

## Not in scope

- Sidekick EQ/FX in the stream.
- More than one listener at once.
- Recording on the phone in time with the stream (Overdub on this device covers
  ideas).
- MIDI clock follows the jam room output only; with no device it stands still,
  as today.

## Done when

- `[demo]` With the demo source, the tape plays in a browser at 1×; mute,
  solo, loop and locate are heard within the delay; switching back to Jam room
  resumes on the demo sink without a restart.
- Go tests cover the mix to stereo, the packet format, the hub (drop-oldest,
  one listener), the output's modes, the pacer handover and its `sinkBase`
  shift, the server guards, the drop-pause, and the stream endpoint. JS tests
  cover the buffer's drift trim and heard position. The guide and tips are
  updated and the `tips.js` test passes.
- `[rig]` On a phone over Tailscale: five minutes without a dropout or drift;
  a Wi-Fi blip pauses and recovers at the same spot.
