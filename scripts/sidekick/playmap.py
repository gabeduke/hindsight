#!/usr/bin/env python3
"""Play a quiet tone on one EP-136 USB playback channel at a time.
Channel N: N short beeps at a distinct pitch, so order AND pitch identify it."""
import subprocess, sys, time, wave, numpy as np
args = [a for a in sys.argv[1:] if not a.startswith("--")]
RATE, CH, DBFS = 48000, 4, float(args[0]) if args else -24
PITCH = {0: 330, 1: 440, 2: 550, 3: 660}
amp = 10 ** (DBFS / 20)
def clip(ch):
    beep = int(0.35 * RATE); gap = int(0.25 * RATE)
    t = np.arange(beep) / RATE
    env = np.minimum(1, np.minimum(t, t[::-1]) / 0.01)          # 10 ms fades, no clicks
    tone = amp * env * np.sin(2 * np.pi * PITCH[ch] * t)
    mono = np.concatenate([np.concatenate([tone, np.zeros(gap)]) for _ in range(ch + 1)] * 3)
    buf = np.zeros((len(mono), CH)); buf[:, ch] = mono
    path = f"/tmp/playmap_ch{ch+1}.wav"
    with wave.open(path, "wb") as w:
        w.setnchannels(CH); w.setsampwidth(4); w.setframerate(RATE)
        w.writeframes((buf * (2**31 - 1)).astype("<i4").tobytes())
    return path
dry = "--dry" in sys.argv
for ch in range(CH):
    p = clip(ch)
    print(f">>> USB playback channel {ch+1}: {ch+1} beep(s) x3 at {PITCH[ch]} Hz, {DBFS:.0f} dBFS", flush=True)
    if not dry:
        subprocess.run(["aplay", "-q", "-D", "hw:2,0", p], check=True); time.sleep(3)
print("done")
