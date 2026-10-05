// The tape, played here: the stream's WebSocket into an AudioWorklet, with
// reconnects, the fill reported to the Pi, the screen held on and the lock
// screen's play and pause.
import { parsePacket, StampLog, heardIndex, nextBackoff } from './stream-buffer.js';
import { holdScreen } from '../wakelock.js';

export class StreamPlayer {
  constructor({ onState = () => {}, onTransport = () => {}, onReconnect = () => {}, getLoop = () => null, title = 'Tape' } = {}) {
    Object.assign(this, { onState, onTransport, onReconnect, getLoop, title });
    this.wasLost = false;
    this.log = new StampLog();
    this.queued = 0; this.report = null; this.ws = null; this.ctx = null; this.node = null;
    this._state = 'off'; this.backoff = 0; this.wake = null; this.stopped = true;
  }

  get active() { return !this.stopped; }
  get state() { return this._state; }

  setState(s) { if (s !== this._state) { this._state = s; this.onState(s); } }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    let ctx = null;
    try {
      ctx = this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      ctx.onstatechange = () => {
        if (this.stopped || this.ctx !== ctx) return;
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') this.setState('locked');
        else if (ctx.state === 'running' && this._state === 'locked') this.setState('buffering');
      };
      await ctx.audioWorklet.addModule('/lib/tape/stream-worklet.js');
      // stop() (and maybe a new start()) may have run during the await.
      if (this.stopped || this.ctx !== ctx) { if (this.ctx !== ctx) ctx.close().catch(() => {}); return; }
      this.node = new AudioWorkletNode(ctx, 'hindsight-stream', { outputChannelCount: [2] });
      this.node.port.onmessage = (e) => {
        const d = e.data;
        if (d.underrun) { this.setState('buffering'); return; }
        this.report = d;
        if (d.started && this._state === 'buffering') this.setState('playing');
      };
      this.node.connect(ctx.destination);
      this.wake = holdScreen({});
      this.mediaSession();
      this.fillTimer = setInterval(() => this.sendFill(), 500);
      this.connect();
    } catch (err) {
      if (this.ctx === ctx) this.stop('off');
      else if (ctx) ctx.close().catch(() => {});
      throw err;
    }
  }

  // For a tap: a suspended context needs a gesture to run again.
  resume() { return this.ctx && this.ctx.resume(); }

  connect() {
    if (this.stopped) return;
    this.setState('buffering');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/tapes/stream`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data === 'string') {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello') {
          this.backoff = 0; this.reset();
          if (this.wasLost) { this.wasLost = false; this.onReconnect(); }
        }
        if (m.type === 'moved') { this.stop('moved'); }
        if (m.type === 'mode' && m.mode === 'jam') this.stop('off');
        return;
      }
      const p = parsePacket(e.data);
      if (!p) return;
      this.log.add(this.queued, p);
      this.queued += p.pcm.length / 2;
      this.node.port.postMessage({ pcm: p.pcm }, [p.pcm.buffer]);
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.setState('lost');
      this.wasLost = true;
      this.backoff = nextBackoff(this.backoff);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
    };
  }

  reset() {
    this.log.clear(); this.queued = 0; this.report = null;
    this.node.port.postMessage({ cmd: 'reset' });
  }

  sendFill() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'fill', ms: this.delayMs() }));
  }

  // What the speaker is playing now.
  heard() {
    if (!this.report || !this.ctx) return null;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.log.at(heardIndex(this.report, this.ctx.currentTime, this.ctx.sampleRate, lat), this.getLoop());
  }

  delayMs() {
    if (!this.report || !this.ctx) return 0;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.round((this.report.fill / this.ctx.sampleRate + lat) * 1000);
  }

  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.title, artist: 'Hindsight' });
    navigator.mediaSession.setActionHandler('play', () => this.onTransport('play'));
    navigator.mediaSession.setActionHandler('pause', () => this.onTransport('stop'));
  }

  stop(state = 'off') {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.fillTimer);
    clearTimeout(this.retryTimer);
    this.wasLost = false;
    const ws = this.ws; this.ws = null;
    if (ws) ws.close();
    if (this.ctx) this.ctx.close();
    this.ctx = this.node = null;
    if (this.wake) this.wake.release();
    this.wake = null;
    this.setState(state);
  }
}
