#!/usr/bin/env python3
"""Measure how far a take's MIDI sits from its audio, to set MIDI_LATENCY_MS.

Hindsight places every MIDI event on the take's timeline by the moment it
arrived at the Pi. The sound of that note arrives later: the instrument
synthesises it, sends it down a cable, the interface converts it, and the
block holding it crosses USB. That delay is stable for a given rig, and
MIDI_LATENCY_MS is where it is written down. This script measures it.

Play something percussive from ONE instrument with nothing else running --
single hits, a second or so apart, twenty or thirty of them -- and save a
take. Then, on the Pi or anywhere the take and its .mid have been copied:

    python3 scripts/midi-calibrate.py ~/hindsight/jam_saves/jam_<ts>.wav

It finds every note-on in the .mid, looks for the nearest audio transient in
the take, and prints the median offset and its spread. Add the median to
whatever MIDI_LATENCY_MS already is (the manifest records what was applied),
restart, and the next take's notes land on their hits.

A spread of a few milliseconds is USB and the instrument being a little
uneven. A spread of tens of milliseconds means something else is going on --
a second instrument leaking into the take, hits too close together, or a
transient the detector cannot find -- and the number should not be trusted.

Standard library only. Reads 16-, 24- and 32-bit integer PCM.

Options:
    --channel N     only note-ons on MIDI channel N (1-16)
    --note N        only this note number (36 for a GM kick)
    --track NAME    only tracks whose name contains NAME
    --audio-channel C  which channel of the WAV to search (1-based; default: the loudest)
    --window MS     how far either side of a note-on to search for a hit (default 150)
    --verbose       print every note
"""

import argparse
import json
import math
import os
import struct
import sys

PPQ_DEFAULT = 960


# --- Standard MIDI File -------------------------------------------------------

def read_vlq(b, pos):
    v = 0
    while True:
        c = b[pos]
        pos += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, pos


def parse_smf(path):
    """Return (ppq, tempo_map, notes) where tempo_map is [(tick, us_per_quarter)]
    and notes is [(tick, channel, note, velocity, track_name)]."""
    with open(path, "rb") as f:
        b = f.read()
    if b[:4] != b"MThd":
        sys.exit(f"{path}: not a MIDI file")
    hlen, fmt, ntracks, division = struct.unpack(">IHHH", b[4:14])
    if division & 0x8000:
        sys.exit("SMPTE time division is not supported")
    pos = 8 + hlen
    tempo_map = []
    notes = []
    for _ in range(ntracks):
        if b[pos:pos + 4] != b"MTrk":
            sys.exit("bad track header")
        tlen = struct.unpack(">I", b[pos + 4:pos + 8])[0]
        body = b[pos + 8:pos + 8 + tlen]
        pos += 8 + tlen
        tick = 0
        p = 0
        running = None
        name = ""
        while p < len(body):
            delta, p = read_vlq(body, p)
            tick += delta
            status = body[p]
            if status == 0xFF:
                meta = body[p + 1]
                l, q = read_vlq(body, p + 2)
                data = body[q:q + l]
                p = q + l
                if meta == 0x51:
                    tempo_map.append((tick, (data[0] << 16) | (data[1] << 8) | data[2]))
                elif meta == 0x03:
                    name = data.decode("latin-1")
                elif meta == 0x2F:
                    break
            elif status in (0xF0, 0xF7):
                l, q = read_vlq(body, p + 1)
                p = q + l
            else:
                if status >= 0x80:
                    running = status
                    p += 1
                kind = running & 0xF0
                n = 1 if kind in (0xC0, 0xD0) else 2
                d = body[p:p + n]
                p += n
                if kind == 0x90 and d[1] > 0:
                    notes.append((tick, (running & 0x0F) + 1, d[0], d[1], name))
    tempo_map.sort()
    if not tempo_map:
        tempo_map = [(0, 500000)]
    return division, tempo_map, notes


def tick_to_seconds(ppq, tempo_map):
    """Return a function mapping a tick to seconds through the tempo map."""
    # Precompute the seconds at each tempo change.
    starts = []
    sec = 0.0
    last_tick, last_us = tempo_map[0][0], tempo_map[0][1]
    if last_tick > 0:
        # Ticks before the first tempo event: 120 BPM by the spec.
        sec = last_tick * 500000 / 1e6 / ppq
    starts.append((last_tick, sec, last_us))
    for tick, us in tempo_map[1:]:
        sec += (tick - last_tick) * last_us / 1e6 / ppq
        starts.append((tick, sec, us))
        last_tick, last_us = tick, us

    def f(tick):
        lo, hi = 0, len(starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if starts[mid][0] <= tick:
                lo = mid
            else:
                hi = mid - 1
        t0, s0, us = starts[lo]
        return s0 + (tick - t0) * us / 1e6 / ppq

    return f


# --- WAV ----------------------------------------------------------------------

def read_wav(path):
    """Return (sample_rate, channels, frames, samples) with samples as a list of
    per-channel lists of floats in [-1, 1]. Reads the whole file; a 15-minute
    8-channel take is a few hundred MB of floats, which a Pi 5 can hold."""
    with open(path, "rb") as f:
        riff = f.read(12)
        if riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            sys.exit(f"{path}: not a WAV")
        fmt = None
        while True:
            head = f.read(8)
            if len(head) < 8:
                sys.exit("no data chunk")
            cid, size = struct.unpack("<4sI", head)
            if cid == b"fmt ":
                fmt = f.read(size)
                if size % 2:
                    f.read(1)
            elif cid == b"data":
                data = f.read(size)
                break
            else:
                f.seek(size + (size % 2), 1)
    tag, channels, rate, _, _, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag != 1 or bits not in (16, 24, 32):
        sys.exit(f"unsupported WAV: format {tag}, {bits}-bit")
    width = bits // 8
    frames = len(data) // (width * channels)
    scale = float(1 << (bits - 1))
    out = [[0.0] * frames for _ in range(channels)]
    if bits == 16:
        vals = struct.unpack("<%dh" % (frames * channels), data[:frames * channels * 2])
        for i in range(frames):
            base = i * channels
            for c in range(channels):
                out[c][i] = vals[base + c] / scale
    elif bits == 32:
        vals = struct.unpack("<%di" % (frames * channels), data[:frames * channels * 4])
        for i in range(frames):
            base = i * channels
            for c in range(channels):
                out[c][i] = vals[base + c] / scale
    else:
        p = 0
        for i in range(frames):
            for c in range(channels):
                v = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)
                if v & 0x800000:
                    v -= 0x1000000
                out[c][i] = v / scale
                p += 3
    return rate, channels, frames, out


def envelope(samples, rate, bin_ms=1.0):
    """Peak absolute amplitude per bin."""
    n = max(1, int(rate * bin_ms / 1000))
    return [max(abs(x) for x in samples[i:i + n]) for i in range(0, len(samples), n)], n


def onset_near(env, bin_frames, rate, sec, window_sec):
    """Find the transient nearest to sec: the EARLIEST bin inside the window
    whose rise over the previous few milliseconds is at least half the
    largest rise in the window. Earliest, not largest: a kick's decaying
    fundamental beats against whatever else is playing and produces bigger
    bumps tens of milliseconds after the hit than the hit itself made.
    Returns seconds, or None when nothing in the window rises."""
    centre = int(sec * rate / bin_frames)
    half = int(window_sec * rate / bin_frames)
    lo = max(3, centre - half)
    hi = min(len(env) - 1, centre + half)
    rises = []
    for i in range(lo, hi + 1):
        before = max(env[i - 3:i])
        rises.append((i, env[i] - before))
    if not rises:
        return None
    biggest = max(r for _, r in rises)
    if biggest < 0.02:
        return None
    for i, r in rises:
        if r >= 0.5 * biggest:
            return i * bin_frames / rate
    return None


# --- Main ---------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("wav")
    ap.add_argument("--channel", type=int)
    ap.add_argument("--note", type=int)
    ap.add_argument("--track")
    ap.add_argument("--audio-channel", type=int)
    ap.add_argument("--window", type=float, default=150.0)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    base = args.wav[:-4] if args.wav.endswith(".wav") else args.wav
    mid = base + ".mid"
    manifest = base + ".manifest.json"
    if not os.path.exists(mid):
        sys.exit(f"{mid}: not found -- this take has no MIDI")

    applied = 0.0
    if os.path.exists(manifest):
        with open(manifest) as f:
            applied = json.load(f).get("latency_correction_ms", 0.0)

    ppq, tempo_map, notes = parse_smf(mid)
    to_sec = tick_to_seconds(ppq, tempo_map)
    picked = [n for n in notes
              if (args.channel is None or n[1] == args.channel)
              and (args.note is None or n[2] == args.note)
              and (args.track is None or args.track in n[4])]
    if not picked:
        sys.exit("no note-ons match; try without filters, or check the track names with --verbose")

    rate, channels, frames, samples = read_wav(args.wav)
    if args.audio_channel:
        ch = args.audio_channel - 1
    else:
        ch = max(range(channels), key=lambda c: max(abs(x) for x in samples[c][:: max(1, frames // 200000)]))
    env, bin_frames = envelope(samples[ch], rate)

    offsets = []
    for tick, mch, note, vel, name in picked:
        t = to_sec(tick)
        hit = onset_near(env, bin_frames, rate, t, args.window / 1000)
        if hit is None:
            if args.verbose:
                print(f"  {name:24s} ch{mch:<2d} note {note:3d} at {t:9.3f}s  no transient within ±{args.window:.0f} ms")
            continue
        off = (hit - t) * 1000
        offsets.append(off)
        if args.verbose:
            print(f"  {name:24s} ch{mch:<2d} note {note:3d} at {t:9.3f}s  hit {off:+7.1f} ms")

    if not offsets:
        sys.exit("no transients found near any note-on")
    offsets.sort()
    n = len(offsets)
    median = offsets[n // 2] if n % 2 else (offsets[n // 2 - 1] + offsets[n // 2]) / 2
    q1, q3 = offsets[n // 4], offsets[(3 * n) // 4]
    print(f"{n} of {len(picked)} note-ons matched a transient on audio channel {ch + 1}")
    print(f"median offset  {median:+.1f} ms  (audio after MIDI is positive)")
    print(f"middle half    {q1:+.1f} .. {q3:+.1f} ms   spread {q3 - q1:.1f} ms")
    print(f"applied        {applied:+.1f} ms  (latency_correction_ms in the manifest)")
    print()
    print(f"set MIDI_LATENCY_MS={applied + median:.1f}")
    if q3 - q1 > 20:
        print("the spread is wide; check the notes above with --verbose before trusting this")


if __name__ == "__main__":
    main()
