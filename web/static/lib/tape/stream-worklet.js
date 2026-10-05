// Plays the tape's stream: stereo PCM16 fed over the port into a ring, held
// at about 0.8 s, trimmed a frame at a time to follow the Pi's clock. It
// reports its read index so the page knows what is being heard.
const SIZE = 1 << 17, MASK = SIZE - 1; // step's size

// step is a copy of stream-buffer.js's, which has the tests: keep them the same.
function step({ w, rd, started, since, n, rate }) {
  const target = Math.round(0.8 * rate), band = Math.round(0.05 * rate), size = 1 << 17;
  if (w - rd > size - 4096) rd = w - target; // overrun: keep the newest
  if (!started) {
    if (w - rd < target) return { rd, started, since, underrun: false };
    return { rd: w - target, started: true, since: 0, underrun: false };
  }
  const fill = w - rd;
  if (fill < n) return { rd, started: false, since, underrun: true };
  since += n;
  if (since >= 2048) {
    since = 0;
    if (fill > target + band) rd++;       // the Pi runs fast: skip a frame
    else if (fill < target - band) rd--;  // slow: play one twice
  }
  return { rd, started, since, underrun: false };
}

class HindsightStream extends AudioWorkletProcessor {
  constructor() {
    super();
    this.l = new Float32Array(SIZE);
    this.r = new Float32Array(SIZE);
    this.w = 0; this.rd = 0; this.since = 0; this.started = false; this.lastReport = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.cmd === 'reset') { this.w = this.rd = 0; this.started = false; return; }
      const pcm = d.pcm;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        this.l[this.w & MASK] = pcm[i] / 32768;
        this.r[this.w & MASK] = pcm[i + 1] / 32768;
        this.w++;
      }
    };
  }

  process(_in, outputs) {
    const [L, R] = outputs[0];
    const n = L.length;
    const s = step({ w: this.w, rd: this.rd, started: this.started, since: this.since, n, rate: sampleRate });
    this.rd = s.rd; this.started = s.started; this.since = s.since;
    if (s.underrun) this.port.postMessage({ underrun: true });
    if (!this.started) {
      L.fill(0); if (R) R.fill(0);
    } else {
      for (let i = 0; i < n; i++) {
        L[i] = this.l[this.rd & MASK];
        if (R) R[i] = this.r[this.rd & MASK];
        this.rd++;
      }
    }
    if (currentTime - this.lastReport >= 0.05) {
      this.lastReport = currentTime;
      this.port.postMessage({ rd: this.rd, at: currentTime, fill: this.w - this.rd, started: this.started });
    }
    return true;
  }
}

registerProcessor('hindsight-stream', HindsightStream);
