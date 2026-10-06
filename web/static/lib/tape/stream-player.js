// The tape, played here: the stream's WebSocket into an AudioWorklet, with
// reconnects, the fill reported to the Pi, the screen held on and the lock
// screen's play and pause.
import { parsePacket, StampLog, heardIndex, nextBackoff } from './stream-buffer.js';
import { holdScreen } from '../wakelock.js';
import { rememberListener, rejoin } from './listener.js';

// A socket that has carried nothing for this long has stalled: close it, and
// the reconnect takes over. The Pi sends a packet every 20 ms.
const STALL_MS = 1500;

export class StreamPlayer {
  constructor({ onState = () => {}, onTransport = () => {}, onReconnect = () => {}, getLoop = () => null, getTitle = () => 'Tape' } = {}) {
    Object.assign(this, { onState, onTransport, onReconnect, getLoop, getTitle });
    this.wasLost = false; this.lostAt = 0; this.lastPacket = 0; this.flowing = false; this.rejoin = null;
    this.joining = false; this.rejoined = false; this.mode = null; this.quiet = false; this.kept = false;
    this.log = new StampLog();
    this.queued = 0; this.report = null; this.ws = null; this.ctx = null; this.node = null;
    this._state = 'off'; this.backoff = 0; this.wake = null; this.stopped = true;
    this.onVisible = () => { if (!document.hidden && !this.stopped && this.ctx) this.ctx.resume().catch(() => {}); };
    // A page the browser keeps for Back (bfcache): the stream goes with it,
    // the note stays, and the page joins again when it's shown -- as a page
    // opened fresh does.
    addEventListener('pagehide', (e) => { if (e.persisted && !this.stopped) { this.stop('off', { forget: false }); this.kept = true; } });
    addEventListener('pageshow', (e) => { if (e.persisted && this.kept) { this.kept = false; rejoin(this); } });
  }

  get active() { return !this.stopped; }
  get state() { return this._state; }
  /** waitingTap: joined again on a new page, and not heard here since. */
  get waitingTap() { return this.rejoined; }

  setState(s) {
    if (s === 'playing') {
      this.rejoined = false;
      // Heard here: keep the screen on (joined again, it waited for this).
      if (!this.wake && !this.stopped) this.wake = holdScreen({});
    }
    if (s !== this._state) { this._state = s; this.onState(s); }
  }

  /**
   * start plays the stream here. From a tap, it plays at once; `rejoin` is
   * a new page joining again without one (listener.js), which waits as
   * 'locked' for a tap if the browser holds the sound back.
   */
  async start({ rejoin = false } = {}) {
    if (!this.stopped) return;
    this.stopped = false;
    this.joining = this.rejoined = rejoin;
    let ctx = null;
    try {
      // iOS: Web Audio follows the ring/silent switch unless the session
      // says it's playback.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers */ }
      ctx = this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      ctx.onstatechange = () => {
        if (this.stopped || this.ctx !== ctx) return;
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') this.setState('locked');
        else if (ctx.state === 'running' && this._state === 'locked') this.setState(this.wasLost ? 'lost' : 'buffering');
      };
      await ctx.audioWorklet.addModule('/lib/tape/stream-worklet.js');
      // stop() (and maybe a new start()) may have run during the await.
      if (this.stopped || this.ctx !== ctx) { if (this.ctx !== ctx) ctx.close().catch(() => {}); return; }
      this.node = new AudioWorkletNode(ctx, 'hindsight-stream', { outputChannelCount: [2] });
      this.node.port.onmessage = (e) => {
        const d = e.data;
        if (d.underrun) {
          // Lost or locked says more than buffering does.
          if (this._state !== 'lost' && this._state !== 'locked') this.setState('buffering');
          return;
        }
        this.report = d;
        if (d.started && this._state === 'buffering') this.setState('playing');
      };
      this.node.connect(ctx.destination);
      // From a tap the screen stays on at once; joined again, only once it's
      // heard (setState): a phone held back for a tap mustn't stay awake.
      if (!rejoin) this.wake = holdScreen({});
      this.mediaSession();
      document.addEventListener('visibilitychange', this.onVisible);
      this.fillTimer = setInterval(() => { this.sendFill(); this.checkStall(); }, 500);
      this.connect();
      // Started without a tap, the browser may hold the sound back.
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {});
        if (ctx.state !== 'running') this.setState('locked');
      }
    } catch (err) {
      if (this.ctx === ctx) this.stop('off');
      else if (ctx) ctx.close().catch(() => {});
      throw err;
    }
  }

  // For a tap: a suspended context needs a gesture to run again.
  resume() { return this.ctx ? this.ctx.resume().catch(() => {}) : Promise.resolve(); }

  connect() {
    if (this.stopped) return;
    // A retry stays "lost" until the Pi answers.
    if (!this.wasLost) this.setState('buffering');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/tapes/stream`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.lastPacket = Date.now(); this.flowing = false;
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (typeof e.data === 'string') {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello' || m.type === 'mode') this.mode = m.mode;
        if (m.type === 'hello') {
          // Back after a loss, or on a new page, to find the tape in the
          // jam room (switched there, or the Pi restarted): this phone has
          // given it up.
          if ((this.wasLost || this.joining) && m.mode === 'jam') { this.stop('off'); return; }
          this.joining = false;
          this.backoff = 0; this.reset();
          if (this.wasLost) {
            this.wasLost = false; this.rejoin = { lostMs: Date.now() - this.lostAt };
            // A context still suspended needs its tap before it plays.
            this.setState(this.ctx.state === 'running' ? 'buffering' : 'locked');
          }
        }
        if (m.type === 'moved') { this.stop('moved'); }
        if (m.type === 'mode' && m.mode === 'jam') this.stop('off');
        return;
      }
      const p = parsePacket(e.data);
      if (!p) return;
      this.lastPacket = Date.now(); this.flowing = true;
      // The first packet back says whether the tape plays now.
      if (this.rejoin) { const r = this.rejoin; this.rejoin = null; this.onReconnect({ lostMs: r.lostMs, playing: p.playing }); }
      this.log.add(this.queued, p);
      this.queued += p.pcm.length / 2;
      this.node.port.postMessage({ pcm: p.pcm }, [p.pcm.buffer]);
    };
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.setState('lost');
      // The loss began with the last packet heard, even if this page was
      // frozen (a locked phone) until now.
      if (!this.wasLost) { this.wasLost = true; this.lostAt = this.lastPacket || Date.now(); }
      this.rejoin = null;
      this.backoff = nextBackoff(this.backoff);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
    };
  }

  // checkStall closes a socket that has gone quiet (a Wi-Fi blip) so the
  // reconnect starts, rather than waiting for the browser to notice. Only
  // once it has carried audio: a first connect may beat the switch to This
  // phone, and the Pi sends nothing until then.
  checkStall() {
    const ws = this.ws;
    if (this.stopped || this._state === 'locked' || !this.flowing || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastPacket > STALL_MS) ws.close();
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

  /**
   * setQuiet hands the lock screen and a headset to something else playing
   * on the page (a take in the bar), and takes them back.
   */
  setQuiet(on) {
    this.quiet = on;
    if (on) {
      this.setActions(null, null);
      try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch { /* not supported */ }
    } else if (!this.stopped) this.mediaSession();
  }

  mediaSession() {
    if (!('mediaSession' in navigator) || this.quiet) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: this.getTitle() || 'Tape', artist: 'Hindsight' });
    // ▶ on the lock screen or a headset is a gesture: wake the context too.
    this.setActions(() => { this.resume(); this.onTransport('play'); }, () => this.onTransport('stop'));
  }

  setActions(play, pause) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
    } catch { /* not supported */ }
  }

  /** stop lets the stream go; `forget`: this device is no longer the listener. */
  stop(state = 'off', { forget = true } = {}) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.fillTimer);
    clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    // A headset or the lock screen mustn't drive the Pi once this phone has
    // given up the tape.
    this.setActions(null, null);
    this.wasLost = false; this.rejoin = null; this.joining = this.rejoined = false;
    if (forget) rememberListener(false);
    const ws = this.ws; this.ws = null;
    if (ws) ws.close();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = this.node = null;
    if (this.wake) this.wake.release();
    this.wake = null;
    this.setState(state);
  }
}
