#!/usr/bin/env python3
"""EP-136 loopback map: play tones on USB playback channels, capture all 8 inputs at once,
and measure each test frequency on each capture channel. Run with hindsight stopped."""
import subprocess, time, wave, json, sys, numpy as np
RATE = 48000
CAP = ["MAIN L", "MAIN R", "CH1 L", "CH1 R", "CH2 L", "CH2 R", "AUX L", "AUX R"]
PB = ["1 L", "1 R", "2 L", "2 R"]
FREQ = [400, 520, 640, 760]                       # one pitch per playback channel
tag = sys.argv[1] if len(sys.argv) > 1 else "run"

def tone(f, sec, dbfs):
    t = np.arange(int(sec * RATE)) / RATE
    env = np.minimum(1, np.minimum(t, t[::-1]) / 0.02)
    return 10 ** (dbfs / 20) * env * np.sin(2 * np.pi * f * t)

# timeline of (label, start, dur, {pb_ch: dbfs})
segs, t, parts = [], 0.0, []
def add(label, dur, chans, gap=1.0):
    global t
    buf = np.zeros((int(dur * RATE), 4))
    for c, db in chans.items(): buf[:, c] = tone(FREQ[c], dur, db)
    parts.append(buf); segs.append((label, t, dur, chans)); t += dur
    parts.append(np.zeros((int(gap * RATE), 4))); t += gap
add("baseline", 2, {})
for c in range(4): add(f"pb {PB[c]} -24", 3, {c: -24})
add("all four -24", 3, {c: -24 for c in range(4)})
for db in (-36, -24, -12, -6): add(f"pb 1 L {db}", 2, {0: db})
for db in (-36, -24, -12, -6): add(f"pb 2 L {db}", 2, {2: db})
play = np.concatenate(parts)
with wave.open("/tmp/lb_play.wav", "wb") as w:
    w.setnchannels(4); w.setsampwidth(4); w.setframerate(RATE)
    w.writeframes((play * (2**31 - 1)).astype("<i4").tobytes())

cap_path = f"/tmp/lb_cap_{tag}.wav"
dur = int(len(play) / RATE) + 3
rec = subprocess.Popen(["arecord", "-q", "-D", "hw:2,0", "-f", "S32_LE", "-c", "8", "-r", str(RATE), "-d", str(dur), cap_path])
t_rec = time.monotonic(); time.sleep(1.0)
t_play = time.monotonic()
subprocess.run(["aplay", "-q", "-D", "hw:2,0", "/tmp/lb_play.wav"], check=True)
rec.wait()
off = t_play - t_rec

with wave.open(cap_path) as w:
    x = np.frombuffer(w.readframes(w.getnframes()), "<i4").reshape(-1, 8) / 2**31

def level_at(sig, f):
    win = np.hanning(len(sig)); spec = np.abs(np.fft.rfft(sig * win)) * 2 / win.sum()
    k = int(round(f * len(sig) / RATE)); return 20 * np.log10(spec[k - 2:k + 3].max() + 1e-12)

out = {"offset_s": off, "segments": []}
print(f"capture {cap_path}, playback started {off:.3f}s after capture")
for label, st, d, chans in segs:
    a, b = int((st + off + 0.4) * RATE), int((st + off + d - 0.3) * RATE)
    s = x[a:b]
    rms = 20 * np.log10(np.sqrt((s ** 2).mean(0)) + 1e-12)
    print(f"\n[{label}]  window {st+off+0.4:.1f}-{st+off+d-0.3:.1f}s")
    print("   capture   rms   " + "  ".join(f"{FREQ[c]}Hz({PB[c]})" for c in range(4)))
    seg = {"label": label, "played": {PB[c]: db for c, db in chans.items()}, "capture": {}}
    for i in range(8):
        lv = [level_at(s[:, i], FREQ[c]) for c in range(4)]
        seg["capture"][CAP[i]] = {"rms": rms[i], **{f"{FREQ[c]}": lv[c] for c in range(4)}}
        print(f"   {CAP[i]:7s} {rms[i]:6.1f}  " + "  ".join(f"{v:12.1f}" for v in lv))
    out["segments"].append(seg)
json.dump(out, open(f"/tmp/lb_{tag}.json", "w"), indent=1, default=float)
