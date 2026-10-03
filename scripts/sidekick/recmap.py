#!/usr/bin/env python3
"""Capture all 8 EP-136 inputs in timed windows and report RMS/peak per USB channel per window.
usage: recmap.py LABEL [LABEL...]   (one 10 s window per label, 5 s gap to switch sources)"""
import subprocess, sys, time, wave, numpy as np
labels = [a for a in sys.argv[1:] if not a.startswith("--")] or ["silence"]
for i, lab in enumerate(labels):
    print(f"\n>>> window {i+1}/{len(labels)}: '{lab}' — switch source now, recording starts in 5 s", flush=True)
    time.sleep(5)
    path = f"/tmp/recmap_{i+1}_{lab}.wav"
    print(f"    recording 10 s -> {path}", flush=True)
    subprocess.run(["arecord", "-q", "-D", "hw:2,0", "-f", "S32_LE", "-c", "8", "-r", "48000", "-d", "10", path], check=True)
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), "<i4").reshape(-1, 8) / 2**31
    rms = 20 * np.log10(np.sqrt((x ** 2).mean(0)) + 1e-12); pk = 20 * np.log10(np.abs(x).max(0) + 1e-12)
    for c in range(8):
        bar = "#" * max(0, int((rms[c] + 80) / 2))
        print(f"    USB {c+1}: rms {rms[c]:7.1f} dBFS  peak {pk[c]:7.1f}  {bar}")
