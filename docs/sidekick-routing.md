# EP-136 K.O. Sidekick: USB audio routing

How the Sidekick's USB audio interface maps onto its mixer, measured on
the Pi on 2026-10-03. Nothing here changes how hindsight runs; it is the map
`SAVE_CHANNELS` and any future stem export are built on.

## The device

Card 2, `hw:2,0` (`2 [EP136]: USB-Audio - EP-136`), USB `2367:9420`,
`bcdDevice 1.01`, UAC2, high speed.

| | Playback | Capture |
|---|---|---|
| Format | **S32_LE only** (no S24_3LE, no S16) | **S32_LE only** |
| Rate | **48000 only** | **48000 only** |
| Channels | 4 | 8 |
| Endpoint | `0x02` OUT, async, feedback on `0x81` | `0x82` IN, async |
| ALSA channel map | FL FR FC LFE | FL FR FC LFE RL RR FLC FRC |

The ALSA channel map is meaningless surround labelling: the descriptors set
`bmChannelConfig 0`, so the driver makes positions up. The device exposes no
mixer controls to ALSA, only `Clock Source 16 Validity`. Every level is set on
the hardware.

Source: `/proc/asound/card2/stream0`, `aplay --dump-hw-params`, and
`lsusb -v`. Capture can't be opened for `--dump-hw-params` while hindsight
holds it, and `stream0` reports the same thing.

## Capture: USB channel → what it carries

**The device names its own channels.** The UAC2 descriptors point at string
descriptors (`iChannelNames` 4 and 12) that plain `lsusb -v` doesn't print
without root. Read directly, they are:

| USB in | Firmware name | Carries | Measured behaviour |
|---|---|---|---|
| 1 | `MAIN L` | main mix | exact digital sum: CH1 and CH2 after their faders, plus AUX at unity |
| 2 | `MAIN R` | main mix | 〃 |
| 3 | `CH1 L` | channel 1 strip (input jack 1) | before the fader: includes the USB 1 return and the strip's gain |
| 4 | `CH1 R` | channel 1 strip | 〃 |
| 5 | `CH2 L` | channel 2 strip (input jack 2) | before the fader: includes the USB 2 return and the strip's gain |
| 6 | `CH2 R` | channel 2 strip | 〃 |
| 7 | `AUX L` | aux input | **digital zero** when idle; live when a source plays; summed into MAIN at unity, no fader |
| 8 | `AUX R` | aux | 〃 |

This agrees with the fader measurement of 2026-09-08 (USB 1/2 moved 20.8 dB
with the CH1 fader; 3/4 did not move) and resolves what that run left open:
**5/6 is CH2, 7/8 is AUX.**

### MAIN is a bit-exact sum of the strip taps

A least-squares fit of MAIN against CH1 and CH2, on both an idle capture and a
loopback capture with signal on every strip:

```
MAIN L = 0.742 * CH1 L + 0.753 * CH2 L      residual -193.5 dBFS (idle), -175.6 dBFS (signal)
MAIN R = 0.742 * CH1 R + 0.753 * CH2 R      same
```

A residual of -190 dB is float rounding: there is no other content in MAIN, no
master limiter acting at these levels, and nothing from AUX. The two
coefficients (-2.59 dB, -2.46 dB) are simply where the CH1 and CH2 faders and
the master level sat during the test. They are different on any other day.

### With two real sources playing

A 15 s capture later the same day, with sources plugged into **input jacks 1
and 2** and nothing in aux (`inputs_2src.wav`):

| USB in | RMS | Peak | Notes |
|---|---|---|---|
| MAIN 1/2 | -30 dBFS | -13.2 dBFS | what hindsight records; plenty of headroom |
| CH1 3/4 | -32 dBFS | -17.1 dBFS | wide stereo (L/R correlation 0.32) |
| CH2 5/6 | -17 dBFS | **-0.1 dBFS** | near-mono (0.98); hot, not clipped in this take |
| AUX 7/8 | digital zero | — | still all zeros with both sources running |

The two sources were independent (CH1/CH2 correlation 0.001), and MAIN was
again an exact sum, now with different faders:

```
MAIN = 0.443 * CH1 + 0.215 * CH2      (-7.1 dB / -13.4 dB)   residual -181 dBFS
```

So the model holds with real material, and the fit gives you the fader
positions.

### AUX with a source playing

A third capture with a stream added on the aux input (`inputs_aux.wav`):

| USB in | RMS | Peak | Notes |
|---|---|---|---|
| MAIN 1/2 | -30 dBFS | -13.1 dBFS | |
| CH1 3/4 | -32 dBFS | -17.1 dBFS | unchanged |
| CH2 5/6 | -17 dBFS | **0.0 dBFS** | **clipped**: 2–3 samples per side at exact full scale, runs of up to 3 |
| AUX 7/8 | -50 dBFS | -33 dBFS | live; nearly mono (L/R correlation 1.000, not bit-identical; difference peaks at -69 dBFS); most energy in 200–2000 Hz, dominant ~441 Hz |

AUX was independent of CH1/CH2 (correlation ~0.00). MAIN without AUX in the
fit left a -50 dBFS residual, which is the AUX signal itself. With it:

```
MAIN = 0.443 * CH1 + 0.215 * CH2 + 1.000 * AUX      residual -111 dBFS (L), -100 dBFS (R)
```

- **AUX joins MAIN at exactly unity**, without passing a fader: the aux level is
  whatever the aux source sends. The residual is not as perfect as CH1/CH2's
  (-100 to -111 dB instead of -180). Something small happens on the aux path
  (dither or a stereo/mono stage), but it is 70+ dB below the program.
- **USB 7/8 is the aux input**, not an aux send: it was zero until a source
  was plugged in, and the CH1/CH2 returns never appeared there.
- **The aux source arrived quiet** (-50 dBFS RMS). Turn up the aux source if it
  should sit level with the strips, since MAIN has no gain for it.
- **CH2 clips at its tap** (before the fader). MAIN is fine (-13 dBFS peak),
  so recording `SAVE_CHANNELS=1,2` is unaffected, but a CH2 stem would carry
  the flat tops. Turn down input 2's source or gain.

## Playback: USB channel → where it goes

Measured electrically by loopback: a tone at its own frequency on each USB
playback channel, all 8 inputs captured at the same time, and each test
frequency read out of each input with an FFT (`loopback.py` below). Tones were
played at -24 dBFS peak.

| USB out | Firmware name | Lands in | Level at the CH tap | Level in MAIN | Leaks elsewhere |
|---|---|---|---|---|---|
| 1 | `1 L` | **CH1 L** → MAIN L | +1.1 dB | -1.5 dB | none (below -120 dB) |
| 2 | `1 R` | **CH1 R** → MAIN R | +1.1 dB | -1.5 dB | none |
| 3 | `2 L` | **CH2 L** → MAIN L | +2.7 dB | +0.2 dB | none |
| 4 | `2 R` | **CH2 R** → MAIN R | +2.7 dB | +0.2 dB | none |

- **USB playback "1" is a stereo return into mixer channel 1, and "2" into
  channel 2.** They enter the strip before the CH capture tap. Left stays
  left; there is no L/R bleed and no bleed between strips.
- **None of the returns reach the AUX capture (7/8).**
- **The path is linear.** Sweeping `1 L` and `2 L` through -36, -24, -12 and
  -6 dBFS moved every receiving channel by exactly 12, 12 and 6 dB. The strip
  limiter the 2026-09-08 notes mention didn't engage at these levels (strip
  peak -3.3 dBFS at the hottest step).
- The non-zero gains at the CH tap (+1.1 dB, +2.7 dB) are each strip's
  gain/EQ setting at the time, not fixed properties of the device.

**Not yet established: where the returns come out acoustically** (main out,
cue/headphones only, or both). That needs someone listening; see the open
questions.

## Surprises

1. **The firmware labels every channel**, so the map doesn't have to be
   inferred from levels. Any re-check can start with the string descriptors
   (`usbstrings.py`).
2. **The idle "noise floor" is 60 Hz mains hum, not noise.** About 93% of
   idle energy sits in 20–200 Hz: peaks at 60 Hz (-61 dB), 120, 240, 300…
   The same hum is on CH1 and CH2 (correlation 0.993) at -69 and -64 dBFS RMS,
   and therefore in MAIN at -63. Something common to both strips is
   picking up mains hum: a ground loop through the sources, the USB power from
   the Pi, or the hub. It's quiet, but it's the floor every take sits on.
   Lifting the Pi's ground (a USB isolator), or trying a different power
   supply, would show whether the Pi is the cause.
3. **AUX is exact digital zero when nothing is plugged in**, not a quiet analog
   floor: every sample is 0x00000000. The firmware gates it (probably jack
   detection). It comes alive as soon as a source plays, and then skips the
   faders entirely, joining MAIN at unity. CH1 and CH2 always carry live
   samples, hum included, even when idle.
4. **The USB returns are summed into MAIN, and MAIN is what hindsight
   records** (`SAVE_CHANNELS=1,2`). Anything played into the Sidekick over USB
   ends up in the take. hindsight opens input only today
   (`internal/audio/source_portaudio.go`), so this is a caution for future
   features, not a bug.
5. **Stems can rebuild MAIN.** Because MAIN is an exact sum of the CH1 and CH2
   taps, a `SAVE_ALL_CHANNELS=true` take could have its fader positions solved
   for after the fact (the same least-squares fit as above), or be remixed
   without loss.

## Open questions (need someone at the rig)

- **Acoustic destination of playback 1 and 2.** Run
  `scripts/sidekick/playmap.py` (4 channels in order; channel N is N beeps at 330, 440,
  550 and 660 Hz, -24 dBFS) and note whether each comes out of the main out,
  the headphone/cue out, or both.
- **Does anything on the panel control the aux level into MAIN?** Measured at
  unity with no fader. Moving any aux-related control during a capture would
  confirm whether that's fixed.
- **Is the aux gate jack detection or a signal threshold?** Plug in a cable
  with the source silent and see whether 7/8 leaves digital zero.
- **Is the CH1/CH2 tap before or after the strip's EQ/filter and limiter?**
  Before the fader is established. Turning a strip's filter knob during a
  loopback run would place the tap.
- **Hum source.** Repeat an idle capture with the sources unplugged, and
  again with the Pi on a different supply.

## Reproducing

The probe scripts are in `scripts/sidekick/`. They are standalone tools, run on
the Pi, and nothing in hindsight imports them. Copy them over first:

```bash
scp scripts/sidekick/*.py "$HINDSIGHT_HOST":/tmp/
```

| Script | Needs hindsight stopped? | What it does |
|---|---|---|
| `usbstrings.py` | no (needs `sudo`) | prints the firmware's channel names, reading string descriptors via usbfs (no pyusb on the Pi); device path is hardcoded to `/dev/bus/usb/001/019`, so check `lsusb` first |
| `loopback.py TAG` | yes | tones on each USB playback channel while capturing all 8 inputs; per-frequency level table plus `/tmp/lb_TAG.json` |
| `playmap.py [dBFS]` | no | channel N plays N beeps (330/440/550/660 Hz) for listening tests; `--dry` only writes the wavs |
| `recmap.py LABEL...` | yes | one 10 s labelled capture per label, RMS/peak per USB channel |

Capture opens `hw:2,0` exclusively, so for the scripts marked yes:

```bash
ssh "$HINDSIGHT_HOST" 'systemctl --user stop hindsight; python3 /tmp/loopback.py a; systemctl --user start hindsight'
```

Stopping the service clears the 15-minute ring. While hindsight is running,
`/api/status` `channel_rms` already meters all 8 USB inputs, so it's the
cheap way to see whether a channel is live before stopping anything.

**Raw data from 2026-10-03** is on the Pi in `~/sidekick-probe/` (250 MB,
deliberately not in git): `recmap_long.wav` (90 s idle), `lb_cap_a.wav` +
`lb_a.json` (loopback), `inputs_2src.wav` (jacks 1 and 2), `inputs_aux.wav`
(plus aux), and `ep136_lsusb_root.txt` (full descriptors with strings). All
are 8 ch, S32_LE, 48 kHz.
