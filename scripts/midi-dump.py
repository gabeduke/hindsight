#!/usr/bin/env python3
"""Print what is in a take's .mid, so it can be checked on the Pi without a DAW.

    python3 scripts/midi-dump.py ~/hindsight/jam_saves/jam_<ts>.mid [--events 20]

Shows the header, the tempo lane (every tempo event as tick, seconds and
BPM), the markers, and each track: its name, how many of each kind of message
it holds, the note range, and the first few events with their time in
seconds worked out through the tempo map -- which is the number a DAW will
place them at.

Standard library only. Reads any Format 0/1 file with a PPQ division; SMPTE
divisions are not supported, and Hindsight never writes one.

Options:
    --events N   how many events to print per track (default 12; 0 for none)
"""

import argparse
import struct
import sys

KINDS = {
    0x80: "note-off", 0x90: "note-on", 0xA0: "poly-aftertouch", 0xB0: "control-change",
    0xC0: "program-change", 0xD0: "channel-pressure", 0xE0: "pitch-bend",
}
META = {0x01: "text", 0x03: "name", 0x06: "marker", 0x2F: "end", 0x51: "tempo", 0x58: "time-sig"}
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(n):
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}"


def read_vlq(b, pos):
    v = 0
    while True:
        c = b[pos]
        pos += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, pos


def parse(path):
    with open(path, "rb") as f:
        b = f.read()
    if b[:4] != b"MThd":
        sys.exit(f"{path}: not a MIDI file")
    hlen, fmt, ntracks, division = struct.unpack(">IHHH", b[4:14])
    if division & 0x8000:
        sys.exit("SMPTE time division is not supported")
    pos = 8 + hlen
    tracks = []
    for _ in range(ntracks):
        if b[pos:pos + 4] != b"MTrk":
            sys.exit(f"bad track header at {pos}")
        tlen = struct.unpack(">I", b[pos + 4:pos + 8])[0]
        body = b[pos + 8:pos + 8 + tlen]
        pos += 8 + tlen
        events = []
        tick = 0
        p = 0
        running = None
        while p < len(body):
            delta, p = read_vlq(body, p)
            tick += delta
            status = body[p]
            if status == 0xFF:
                meta = body[p + 1]
                l, q = read_vlq(body, p + 2)
                data = body[q:q + l]
                p = q + l
                events.append((tick, "meta", meta, data))
                if meta == 0x2F:
                    break
            elif status in (0xF0, 0xF7):
                l, q = read_vlq(body, p + 1)
                events.append((tick, "sysex", status, body[q:q + l]))
                p = q + l
            else:
                if status >= 0x80:
                    running = status
                    p += 1
                kind = running & 0xF0
                n = 1 if kind in (0xC0, 0xD0) else 2
                d = body[p:p + n]
                p += n
                events.append((tick, "chan", running, bytes(d)))
        tracks.append(events)
    return fmt, division, tracks


def tempo_map(tracks):
    tm = []
    for events in tracks:
        for tick, kind, x, data in events:
            if kind == "meta" and x == 0x51:
                tm.append((tick, (data[0] << 16) | (data[1] << 8) | data[2]))
    tm.sort()
    return tm or [(0, 500000)]


def seconds_fn(ppq, tm):
    starts = []
    sec = 0.0
    last_tick, last_us = tm[0]
    if last_tick > 0:
        sec = last_tick * 500000 / 1e6 / ppq
    starts.append((last_tick, sec, last_us))
    for tick, us in tm[1:]:
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


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("mid")
    ap.add_argument("--events", type=int, default=12)
    args = ap.parse_args()

    fmt, ppq, tracks = parse(args.mid)
    tm = tempo_map(tracks)
    sec = seconds_fn(ppq, tm)

    print(f"{args.mid}: format {fmt}, {len(tracks)} track(s), {ppq} ticks per quarter")
    print()
    print(f"tempo lane: {len(tm)} event(s)")
    shown = tm if len(tm) <= 16 else tm[:8] + [None] + tm[-8:]
    for e in shown:
        if e is None:
            print("    ...")
            continue
        tick, us = e
        bar = tick / (ppq * 4)
        print(f"    tick {tick:>10d}  {sec(tick):9.3f}s  bar {bar + 1:8.3f}  {60e6 / us:8.3f} BPM")
    bpms = [60e6 / us for _, us in tm]
    if len(tm) > 1:
        print(f"    range {min(bpms):.3f} .. {max(bpms):.3f} BPM")
    print()

    for i, events in enumerate(tracks):
        name = ""
        counts = {}
        notes = []
        markers = []
        for tick, kind, x, data in events:
            if kind == "meta":
                label = META.get(x, f"meta {x:#04x}")
                if x == 0x58 and len(data) >= 2:
                    label = f"time-sig {data[0]}/{1 << data[1]}"
                counts[label] = counts.get(label, 0) + 1
                if x == 0x03 and not name:
                    name = data.decode("latin-1")
                elif x == 0x06:
                    markers.append((tick, data.decode("latin-1")))
            elif kind == "chan":
                k = x & 0xF0
                label = KINDS.get(k, f"{k:#04x}")
                if k == 0x90 and len(data) > 1 and data[1] == 0:
                    label = "note-off"
                counts[label] = counts.get(label, 0) + 1
                if label == "note-on":
                    notes.append(data[0])
            else:
                counts["sysex"] = counts.get("sysex", 0) + 1
        end = max((tick for tick, *_ in events), default=0)
        print(f"track {i}: {name or '(unnamed)'}  --  {len(events)} events, ends at tick {end} ({sec(end):.3f}s)")
        print("    " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
        if notes:
            print(f"    notes {note_name(min(notes))} ({min(notes)}) .. {note_name(max(notes))} ({max(notes)}), {len(set(notes))} distinct")
        for tick, text in markers:
            print(f"    marker at tick {tick} ({sec(tick):.3f}s): {text}")
        if args.events:
            shown = 0
            for tick, kind, x, data in events:
                if kind == "meta" and x in (0x03, 0x2F, 0x51, 0x58, 0x06):
                    continue
                if shown >= args.events:
                    print(f"    ... {len(events) - shown} more")
                    break
                if kind == "chan":
                    k = x & 0xF0
                    ch = (x & 0x0F) + 1
                    if k in (0x80, 0x90):
                        what = "on " if k == 0x90 and data[1] else "off"
                        desc = f"{what} {note_name(data[0]):4s} vel {data[1]:3d}"
                    elif k == 0xB0:
                        desc = f"cc {data[0]:3d} = {data[1]:3d}"
                    elif k == 0xE0:
                        desc = f"bend {((data[1] << 7) | data[0]) - 8192:+6d}"
                    elif k == 0xC0:
                        desc = f"program {data[0]}"
                    else:
                        desc = f"{KINDS.get(k, hex(k))} {list(data)}"
                    print(f"    {sec(tick):9.3f}s  tick {tick:>9d}  ch{ch:<2d} {desc}")
                else:
                    print(f"    {sec(tick):9.3f}s  tick {tick:>9d}  {kind} {x:#04x} {len(data)} bytes")
                shown += 1
        print()


if __name__ == "__main__":
    main()
