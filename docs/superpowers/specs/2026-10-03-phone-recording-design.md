# Phone recording — record straight into Hindsight from the phone

**Date:** 2026-10-03 · **Status:** approved by the owner 2026-10-03; built (step 2), not yet tried on the phone · **Repo:** `hindsight`

## Goal

Record from the phone, anywhere in the house, straight into Hindsight: the
Orchid at bedtime upstairs, a riff on the couch, an idea before it's gone. It
lands in the takes list like any other take, with the waveform, looping, saving
and sharing that come with it, and it can go onto tape from there. There's no
file to move and no second app.

It is independent of the [tape engine](2026-10-03-tape-design.md) and can ship
before it.

## How it works

1. **A *Phone* button on the main page**, beside Capture, opens a small
   recorder: an input picker, a live meter, elapsed time, and Stop.
2. **The input** is the phone's mic by default. Anything the phone accepts as
   an audio input shows up in the picker too, such as the Orchid's output
   through a USB-C audio adapter with an input. A cable beats the mic for
   anything you mean to keep.
3. **The page captures raw PCM** with an AudioWorklet and streams it to the Pi
   over a WebSocket, `/api/phone`, as it records. It doesn't use
   `MediaRecorder`: that hands back compressed AAC or Opus, in a different
   container on each browser. Because the audio goes up as it's recorded, a
   take never exists only on the phone.
4. **The Pi writes it as it arrives, under a temporary name** the takes list
   ignores, so a half-recorded take never shows up. On Stop it finalises:
   - resamples to 48 kHz if the phone ran at 44.1;
   - writes a 32-bit stereo WAV, with mono duplicated to both sides, so the
     preview, waveform, save-as-take and share paths work unchanged;
   - builds the peaks and mp3 preview through the existing save path;
   - writes a sidecar labelled *Phone*, with `created` set to when recording
     started;
   - renames the WAV into place last.

   It is named like any take, `jam_<ts>.wav`, with the same `_2` rule for a
   collision, so the takes list, pruning and starring treat it like everything
   else. `MIN_FREE_GB` is checked when recording starts, and pruning runs
   after it lands, as after a save.

## What the browser makes us do

1. **HTTPS.** Browsers open the mic only in a secure context. The Pi's
   plain-HTTP LAN address can't record; the `tailscale serve` name from the
   install guide can, from anywhere on the tailnet. On plain HTTP the button
   says why it's unavailable rather than failing.
2. **Turn off the voice processing.** Phone browsers apply echo cancellation,
   noise suppression and auto-gain to the mic by default. That pumps and gates
   music. The recorder asks for all three off. Whether iOS honours that is on
   the verify list; a plugged-in input sidesteps most of it either way.
3. **Keep the page in front.** A phone that locks, or a switch to another app,
   suspends the page and the recording with it. While recording, the page
   holds a screen wake lock even on battery — the one exception to
   `wakelock.js`'s charging-only rule — and says so if the lock is refused.

## When the Wi-Fi drops

Chunks are numbered and the Pi acknowledges each one. The page keeps
everything not yet acknowledged, which is normally a second or two, and resends
it on reconnect, so a dropout costs nothing as long as the page stays open. If
the page closes before the upload completes, what reached the Pi is kept as a
take marked partial. Streaming 48 kHz stereo float is 384 KB/s, which is
nothing on a home network or a tailnet.

## Timing, and the tape

A phone has its own clock, so a phone take arrives as free material, like a
take from the dashcam with no MIDI clock.

- **Onto tape.** Select the part on the take page and *Send to tape*.
  As the first loop of a tape, it sets the tempo, the same way a free catch
  does. This makes *Send to tape* the bedtime path, so it moves from phase 2 of
  the tape engine into phase 1.
- **In time with the tape, from another room.** That needs two things that
  come later: the tape's sound on the phone (the listen stream in the tape's
  phase 4), and the phone's own output-to-input round trip, measured by
  playing a click through its speaker into its mic. With both, a phone part
  can land on the bar it started on. Until then, phone parts are placed by ear,
  with the clip nudge.

## Building it

- **Server.** A `/api/phone` WebSocket handler in `internal/api`. A streaming
  WAV writer in `internal/audio` that patches the header on finish, then
  hands the file to the existing peaks and preview steps. A per-recording
  resequencer for chunks that arrive out of order after a resend.
- **Page.** A `lib/phone/` module holding the AudioWorklet processor, the
  uploader with acknowledgements and resends, and the input picker. Plus the
  button and recorder sheet in `index.html`, and the wake-lock exception.
- **Tests.**
  - A Go test streams a synthetic tone over the socket, with dropped and
    reordered chunks, and checks the take matches sample for sample.
  - A node test covers the uploader's resend logic.
  - Resampling is checked against a 44.1 kHz source.

## Decisions

Settled with the owner on 2026-10-03.

1. **The button lives on the main page.** The tape page can take a phone
   recording straight onto a track once it exists.
2. **Mono stays dual mono; a stereo input stays stereo.**

## As built

Choices made while building it, on 2026-10-04:

- **Chunks** are a tenth of a second of interleaved stereo float32, each
  prefixed with its number. The Pi acks with the next chunk it's waiting for,
  so an ack covers everything before it.
- **The page asks for a 48 kHz audio context** and the browser converts the
  mic to it. A browser that won't (Firefox, with a mic at another rate) gets
  a context at the mic's rate, and the Pi converts. Either way the take is
  48 kHz.
- **Writing as it arrives** is literal: the WAV grows in the `.part` file
  during the recording, with the peaks pyramid growing beside it, so Stop
  only patches the header and writes the sidecars. Nothing re-reads the
  audio.
- **The grace period** for a phone that drops off is ten minutes, long
  enough for a walk out of Wi-Fi range and back. The phone keeps unsent audio
  for as long as the page is open, and replaces a connection that has gone
  quiet for ten seconds with audio outstanding.
- **A Pi restart mid-recording** gives two partial takes: what the Pi had,
  recovered at startup, and the rest, which the phone sends into a new take
  starting at the oldest chunk it still holds.
- **Locking the phone or switching apps pauses** the recording rather than
  ending it; the take skips the stretch and the page says how much is
  missing. The sheet can be hidden while recording; the Phone button becomes
  a REC timer.
- **A restart mid-recording** keeps what reached the disk, as *Phone
  (partial)*, via a marker file beside the `.part`.
- **Limits:** three hours per recording, just under the 4.29 GB a WAV header
  can describe; eight recordings at once; free space checked at the start and
  every five seconds.
- **The Phone button** sits in the row under Capture, so it costs Capture no
  height on a phone held sideways. On plain HTTP it opens the sheet with the
  explanation rather than being greyed out, which explains nothing.

## Still to verify on the phone

1. Whether iOS Safari, and the Home Screen app, honour the request to turn off
   echo cancellation, noise suppression and auto-gain.
2. The rate the phone's audio actually runs at: 48 kHz on most iPhones, 44.1
   on some Androids.
3. That a USB-C audio adapter's input appears in the picker.
4. That the screen wake lock works on battery on this phone.
