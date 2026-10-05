// Plays the tape's stream: stereo PCM16 fed over the port into a ring, held
// at about 0.8 s, trimmed a frame at a time to follow the Pi's clock. It
// reports its read index so the page knows what is being heard.
const TARGET_S = 0.8, BAND_S = 0.05, EVERY = 2048, SIZE = 1 << 17, MASK = SIZE - 1;

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
      if (this.w - this.rd > SIZE - 4096) this.rd = this.w - Math.round(TARGET_S * sampleRate); // overrun: keep the newest
    };
  }

  process(_in, outputs) {
    const [L, R] = outputs[0];
    const n = L.length, target = TARGET_S * sampleRate, band = BAND_S * sampleRate;
    let fill = this.w - this.rd;
    if (!this.started && fill >= target) this.started = true;
    if (!this.started || fill < n) {
      L.fill(0); if (R) R.fill(0);
      if (this.started) { this.started = false; this.port.postMessage({ underrun: true }); }
    } else {
      this.since += n;
      if (this.since >= EVERY) {
        this.since = 0;
        if (fill > target + band) this.rd++;          // the Pi runs fast: skip a frame
        else if (fill < target - band) this.rd--;     // slow: play one twice
      }
      for (let i = 0; i < n; i++) {
        L[i] = this.l[this.rd & MASK];
        if (R) R[i] = this.r[this.rd & MASK];
        this.rd++;
      }
      fill = this.w - this.rd;
    }
    if (currentTime - this.lastReport >= 0.05) {
      this.lastReport = currentTime;
      this.port.postMessage({ rd: this.rd, at: currentTime, fill, started: this.started });
    }
    return true;
  }
}

registerProcessor('hindsight-stream', HindsightStream);
