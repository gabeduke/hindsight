// AudioWorklet processor for phone recording: copies the input, as stereo,
// into chunks of a tenth of a second and posts each to the page, with its
// peak level for the meter. Raw float PCM straight from the audio thread --
// not MediaRecorder, which hands back AAC or Opus in a container that differs
// by browser.
//
// The node is created with two input channels in explicit mode, so a mono
// mic arrives already as dual mono, which is what a phone take stores.
//
// Messages in: {cmd: 'record'} starts sending chunks, {cmd: 'stop'} sends the
// partial last chunk and then {done: true}. Before 'record' it only meters.
// When recording starts it posts {started: frame}: the context frame of the
// first sample recorded, for a recording that has to line up with what the
// context played (the tape page's overdub).

class HindsightTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = (options.processorOptions && options.processorOptions.chunkFrames) || Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.frames * 2);
    this.n = 0;
    this.recording = false;
    this.peakL = 0;
    this.peakR = 0;
    this.meterFrames = 0;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'record') {
        this.recording = true;
        this.started = false;
        this.n = 0;
      } else if (e.data.cmd === 'stop') {
        if (this.recording && this.n > 0) this.flush();
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  flush() {
    const pcm = this.buf.slice(0, this.n * 2);
    this.port.postMessage({ pcm }, [pcm.buffer]);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const l = input[0];
    const r = input[1] || input[0];
    if (this.recording && !this.started) {
      this.started = true;
      this.port.postMessage({ started: currentFrame });
    }
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      const b = r[i];
      const pa = a < 0 ? -a : a;
      const pb = b < 0 ? -b : b;
      if (pa > this.peakL) this.peakL = pa;
      if (pb > this.peakR) this.peakR = pb;
      if (this.recording) {
        this.buf[2 * this.n] = a;
        this.buf[2 * this.n + 1] = b;
        this.n++;
        if (this.n === this.frames) this.flush();
      }
    }
    // The meter runs at about 20 Hz whether or not we're recording.
    this.meterFrames += l.length;
    if (this.meterFrames >= sampleRate / 20) {
      this.port.postMessage({ peak: [this.peakL, this.peakR] });
      this.peakL = 0;
      this.peakR = 0;
      this.meterFrames = 0;
    }
    return true;
  }
}

registerProcessor('hindsight-tap', HindsightTap);
