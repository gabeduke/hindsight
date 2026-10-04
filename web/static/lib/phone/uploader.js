// Streams a phone recording to the Pi over /api/phone, so the take is on the
// Pi as it's played, not only on the phone.
//
// Audio goes up in numbered chunks and stays queued here until the Pi acks
// it. When the connection drops -- Wi-Fi blinking as you walk upstairs -- the
// uploader reconnects with the same recording id, the Pi says which chunk it
// is waiting for, and everything from there is sent again. Nothing is lost
// as long as the page stays open. Stop sends the chunk count; the Pi
// finishes the take once it holds them all and answers with its name.
//
// Pure apart from the WebSocket it's handed, so node can test it with a fake.

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5000;
// Above this many bytes waiting in the socket, new chunks stay queued until
// it drains: on a slow link the queue here is the buffer, not the socket's.
const MAX_BUFFERED = 2 * 1024 * 1024;

/** A recording id: random, url-safe, what the server's id pattern accepts. */
export function newRecordingId() {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** encodeChunk is one binary message: uint32 LE chunk number, then the samples. */
export function encodeChunk(seq, samples) {
  const buf = new ArrayBuffer(4 + samples.length * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, seq, true);
  for (let i = 0; i < samples.length; i++) dv.setFloat32(4 + 4 * i, samples[i], true);
  return buf;
}

export class Uploader {
  /**
   * @param {object} o
   * @param {string} o.url  the /api/phone WebSocket URL
   * @param {number} o.rate the phone's sample rate
   * @param {(state: string, info?: object) => void} [o.onState]
   *   'connecting' | 'recording' | 'reconnecting' | 'saving' | 'saved' | 'failed'
   * @param {(result: object) => void} [o.onEnd] the take, however it ended --
   *   including the Pi ending it (disk nearly full, the length limit)
   */
  constructor({ url, rate, id = newRecordingId(), WebSocketImpl = globalThis.WebSocket,
    schedule = (fn, ms) => setTimeout(fn, ms), onState, onEnd }) {
    this.url = url;
    this.rate = rate;
    this.id = id;
    this.WS = WebSocketImpl;
    this.schedule = schedule;
    this.onState = onState;
    this.onEnd = onEnd;
    this.queue = [];        // [{ seq, msg, frames, sentOn }] not yet acked
    this.seq = 0;           // the next chunk number
    this.ws = null;
    this.gen = 0;           // connection generation, so a stale socket's events are ignored
    this.ready = false;     // the Pi has answered this connection's start
    this.stopping = false;
    this.ended = false;
    this.retryMs = RETRY_MIN_MS;
    this.result = null;
    this.endWaiters = [];
    this.state = '';
  }

  /** Seconds of audio not yet acknowledged by the Pi. */
  get pendingSeconds() {
    let frames = 0;
    for (const q of this.queue) frames += q.frames;
    return frames / this.rate;
  }

  start() {
    this.connect();
  }

  /** push queues one chunk: interleaved stereo Float32Array at this.rate. */
  push(samples) {
    if (this.stopping || this.ended) return;
    this.queue.push({ seq: this.seq, msg: encodeChunk(this.seq, samples), frames: samples.length / 2, sentOn: 0 });
    this.seq++;
    this.pump();
  }

  /** stop sends the chunk count and resolves with the take once the Pi has it. */
  stop() {
    if (!this.stopping && !this.ended) {
      this.stopping = true;
      this.setState('saving');
      this.sendStop();
    }
    return this.whenEnded();
  }

  whenEnded() {
    if (this.ended) return Promise.resolve(this.result);
    return new Promise((resolve) => this.endWaiters.push(resolve));
  }

  /** abandon drops the connection without a Stop: the Pi keeps what it has. */
  abandon() {
    this.ended = true;
    this.gen++;
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  // --- internals ---------------------------------------------------------

  setState(s, info) {
    if (s === this.state && !info) return;
    this.state = s;
    this.onState?.(s, info);
  }

  connect() {
    if (this.ended) return;
    const gen = ++this.gen;
    this.ready = false;
    this.setState(this.queue.length || this.seq ? (this.stopping ? 'saving' : 'reconnecting') : 'connecting');
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch {
      this.retry(gen);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.gen) return;
      ws.send(JSON.stringify({ type: 'start', id: this.id, rate: this.rate }));
    };
    ws.onmessage = (ev) => {
      if (gen !== this.gen || typeof ev.data !== 'string') return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (gen !== this.gen || this.ended) return;
      this.ready = false;
      this.retry(gen);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  retry(gen) {
    if (this.ended || gen !== this.gen) return;
    this.setState(this.stopping ? 'saving' : 'reconnecting');
    const ms = this.retryMs;
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.schedule(() => { if (gen === this.gen) this.connect(); }, ms);
  }

  onMessage(m) {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.retryMs = RETRY_MIN_MS;
        this.ack(m.next);
        // Everything still queued goes (again) on this connection.
        for (const q of this.queue) q.sentOn = 0;
        if (!this.stopping) this.setState('recording');
        this.pump();
        if (this.stopping) this.sendStop();
        break;
      case 'ack':
        this.ack(m.next);
        this.pump();
        break;
      case 'saved':
        this.finish({ name: m.name || '', seconds: m.seconds || 0, partial: !!m.partial, reason: m.reason || 'stop' });
        break;
      case 'error':
        // Before "ready", the recording couldn't start: no point retrying.
        if (!this.ready) this.finish({ error: m.error || 'the Pi refused the recording' });
        else this.onState?.(this.state, { warning: m.error });
        break;
      default:
        break;
    }
  }

  ack(next) {
    while (this.queue.length && this.queue[0].seq < next) this.queue.shift();
  }

  pump() {
    const ws = this.ws;
    if (!ws || !this.ready || ws.readyState !== 1) return;
    for (const q of this.queue) {
      if (q.sentOn === this.gen) continue;
      if (ws.bufferedAmount > MAX_BUFFERED) return;
      ws.send(q.msg);
      q.sentOn = this.gen;
    }
  }

  sendStop() {
    const ws = this.ws;
    if (!ws || !this.ready || ws.readyState !== 1) return; // sent on the next "ready"
    this.pump();
    ws.send(JSON.stringify({ type: 'stop', chunks: this.seq }));
  }

  finish(result) {
    if (this.ended) return;
    this.ended = true;
    this.result = result;
    this.gen++;
    try { this.ws?.close(); } catch { /* fine */ }
    this.setState(result.error ? 'failed' : 'saved', result);
    this.onEnd?.(result);
    for (const w of this.endWaiters.splice(0)) w(result);
  }
}
