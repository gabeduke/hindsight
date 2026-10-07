// web/static/lib/bar/bar.js
// The now-playing bar on Takes and Capture (the tape page and the take page
// drive their own): one source at a time -- the tape (tape-source.js) or a
// take (take-source.js) -- in the reel window and its LCD, played from its
// keys, and scrubbed on its strip. A tap on the strip moves the playhead
// there; a drag scrubs it; with the strip focused, ← → step and Space plays.
// The page decides what the bar holds; ⏏ asks it for the tape back.

import { ReelWindow } from './reel-window.js';
import { tapeSource } from './tape-source.js';
import { takeSource } from './take-source.js';
import { initPlayer } from './player.js';
import { StreamPlayer } from '../tape/stream-player.js';
import { rejoin } from '../tape/listener.js';

const $ = (id) => document.getElementById(id);

export class NowPlaying {
  constructor({ onEject } = {}) {
    this.root = $('np');
    this.src = null;
    this.raf = 0;
    this.marqueeKey = null;
    this.reels = new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
    this.scrub = $('np-scrub');
    initPlayer();

    $('np-play').addEventListener('click', () => {
      const s = this.src;
      if (!s) return;
      // The source's own say first: the tape's sound waiting for a tap.
      if (!s.press?.()) { if (s.playing()) s.pause(); else s.play(); }
      this.kick();
    });
    $('np-loop').addEventListener('click', () => { if (this.src) this.src.setLoop(!this.src.loop); });
    $('np-start').addEventListener('click', () => { if (this.src) this.src.seek(this.src.start()); });
    // ↺ 5 s, or J: back five seconds, playing or not.
    const back5 = () => { const s = this.src; if (s) { s.seek(Math.max(0, s.pos() - 5 * s.sampleRate)); this.kick(); } };
    $('np-back5').addEventListener('click', back5);
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyJ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      if (this.root.hidden || !this.src) return;
      back5();
    });
    // ⏏ hides itself: the focus goes to ▶, not to the page.
    $('np-eject').addEventListener('click', () => { onEject?.(); $('np-play').focus(); });

    // The strip: a tap or a drag moves the playhead. The tape's Pi hears a
    // drag at most every 150 ms, and where it ends.
    const sc = this.scrub;
    sc.style.touchAction = 'none';
    let down = null, sent = 0;
    const at = (e) => { const r = sc.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const seekTo = (f, final) => {
      const s = this.src;
      if (!s) return;
      const now = performance.now();
      if (!final && s.kind === 'tape' && now - sent < 150) return;
      sent = now;
      s.seek(f * s.length);
      this.kick();
    };
    sc.addEventListener('pointerdown', (e) => {
      if (down || e.button > 0) return;
      down = e.pointerId;
      sc.setPointerCapture?.(e.pointerId);
      seekTo(at(e), false);
    });
    sc.addEventListener('pointermove', (e) => { if (down === e.pointerId) seekTo(at(e), false); });
    const up = (e) => { if (down !== e.pointerId) return; down = null; seekTo(at(e), true); };
    sc.addEventListener('pointerup', up);
    sc.addEventListener('pointercancel', () => { down = null; });
    sc.addEventListener('keydown', (e) => {
      const s = this.src;
      if (!s || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) $('np-play').click(); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); s.seek(e.key === 'Home' ? 0 : s.length - 1); this.kick(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      s.seek(s.pos() + (e.key === 'ArrowRight' ? s.step() : -s.step()));
      this.kick();
    });
    new ResizeObserver(() => this.render()).observe(sc);
    document.addEventListener('visibilitychange', () => this.kick());
  }

  /** load puts `src` in the bar; null empties and hides it. */
  load(src) {
    if (src === this.src) return;
    if (this.src && this.src.kind === 'tape') this.src.setActive?.(false);
    this.src = src;
    this.marqueeKey = null;
    this.root.hidden = !src;
    if (!src) return;
    if (src.kind === 'tape') src.setActive?.(true);
    // Once per source: the tape comes back into the bar again and again.
    if (!hooked.has(src)) { hooked.add(src); src.on(() => { if (this.src === src) this.kick(); }); }
    if (src.levels) this.reels.setLevels(src.levels.colors, src.levels.at);
    else this.reels.setLevels([], () => []);
    // The keys say what this source does.
    $('np-play').dataset.tip = src.kind === 'tape' ? 'tape-play' : 'play';
    $('np-start').dataset.tip = src.kind === 'tape' ? 'to-start' : 'take-to-start';
    this.kick();
  }

  // kick draws now, and every frame while the source plays.
  kick() {
    if (this.raf || document.hidden) return;
    const frame = () => {
      this.raf = 0;
      const s = this.src;
      if (!s) return;
      s.tick();
      this.render();
      if (s.playing() && !document.hidden) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  render() {
    const s = this.src;
    if (!s) return;
    const lcd = s.lcd();
    const playing = s.playing();
    // Playing on the Pi, but not yet heard here: ▶ is the tap it waits for.
    const waiting = !!s.waiting?.();
    setText($('position'), lcd.big);
    setText($('np-mini'), lcd.big);
    setText($('np-time'), lcd.small);
    setText($('np-unit'), lcd.unit);
    setAttr($('np-status'), 'data-state', lcd.status);
    const note = lcd.note || '';
    const mk = `${s.kind}|${note}|${note ? '' : s.marquee()}`;
    if (mk !== this.marqueeKey) {
      this.marqueeKey = mk;
      setText($('np-marquee'), note || s.marquee());
      $('np-marquee').parentElement.classList.toggle('still', !!note);
    }
    // ▶ and its pause: ■ for the tape, as on its page; ❚❚ for a take.
    const play = $('np-play');
    const shown = playing && !waiting;
    setText(play, shown ? (s.kind === 'tape' ? '■' : '❚❚') : '▶');
    setAttr(play, 'aria-label', waiting ? 'Play here' : shown ? (s.kind === 'tape' ? 'Stop' : 'Pause') : 'Play');
    play.classList.toggle('playing', shown);
    play.disabled = !playing && !waiting && !s.canPlay();
    setAttr($('np-loop'), 'aria-pressed', String(!!s.loop));
    $('np-loop').disabled = !s.canLoop();
    setAttr($('np-start'), 'aria-label', s.startLabel());
    // What's in the bar opens on its own page; ⏏ is for a take while there's a tape.
    const open = $('np-open');
    setAttr(open, 'href', s.href);
    setText(open, s.kind === 'tape' ? `Open ${s.title} ›` : 'Open the take ›');
    setText($('np-out'), s.out());
    // The strip, and what a screen reader hears of it.
    const r = this.scrub.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width > 0) {
      if (this.scrub.width !== Math.round(r.width * dpr) || this.scrub.height !== Math.round(r.height * dpr)) {
        this.scrub.width = Math.round(r.width * dpr);
        this.scrub.height = Math.round(r.height * dpr);
      }
      const ctx = this.scrub.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(this.scrub);
      s.paint(ctx, r.width, r.height, (n, d) => css.getPropertyValue(n).trim() || d, dpr);
    }
    const tenth = s.sampleRate / 10;
    const p = Math.round(s.pos() / tenth) * tenth;
    setAttr(this.scrub, 'aria-valuemax', String(Math.round(s.length)));
    setAttr(this.scrub, 'aria-valuenow', String(Math.round(p)));
    setAttr(this.scrub, 'aria-valuetext', `${lcd.unit === 'BAR' ? `bar ${lcd.big}, ` : ''}${secs(p / s.sampleRate)}`);
    this.reels.poll({ heard: s.pos(), playing, length: s.length, sampleRate: s.sampleRate });
  }
}

const hooked = new WeakSet();

/**
 * pageBar is the bar as Takes and Capture use it: the tape, when the Pi has
 * one loaded (`tapes` is initNav's answer); a take, when the page hands it
 * one (loadTake); and ⏏ back to the tape. `ready` settles once the tape's
 * first state is in -- or there is no tape -- so a page can ask whether the
 * tape was already playing when it opened.
 */
export function pageBar({ tapes, onToast }) {
  let tape = null, take = null; // take: { name, audio, src }
  let stream = null; // the tape on this phone, joined again from the page before
  let ejected = false; // the tape put back by hand: it stays until a take is picked by hand
  const bar = new NowPlaying({ onEject: () => backToTape({ byHand: true }) });
  const eject = () => { $('np-eject').hidden = !(tape && take); };
  const ready = Promise.resolve(tapes).then((list) => {
    if (!list || !list.loaded) return;
    tape = tapeSource(list.loaded, { onError: (m) => onToast?.(`The tape: ${m}`, 'bad'), stream: () => stream });
    stream = tapeStream(tape, onToast);
    if (take) stream.setQuiet(true); // picked before the tape's state was in
    else bar.load(tape);
    eject();
    return new Promise((done) => { tape.on(done); setTimeout(done, 1500); });
  });
  function backToTape({ byHand = false } = {}) {
    if (byHand) ejected = true;
    if (take) {
      const old = take;
      take = null;
      old.src.pause();
      old.off();
      bar.load(tape);
      old.src.destroy();
      stream?.setQuiet(false);
    }
    eject();
  }
  // A take played here while the tape plays on this phone: stop the tape,
  // or the phone plays both (as the tape page does). Only in This phone
  // mode: in Both the jam room is the clock and may be recording.
  const takePlays = () => { if (stream?.active && stream.mode === 'phone') tape.pause(); };
  return {
    ready,
    get takeName() { return take ? take.name : null; },
    /** ejected: ⏏ put the tape back; automatic picks leave it there. */
    get ejected() { return ejected; },
    /** looping: a take in the bar is on Loop, so its end isn't the end. */
    get looping() { return !!(take && take.src.loop); },
    tapePlaying: () => !!(tape && tape.ready && tape.playing()),
    /**
     * loadTake puts take `t` in the bar, played by its list row's `player`.
     * The same take with a new player (its row rebuilt) replaces the old one.
     */
    loadTake(t, player) {
      ejected = false;
      if (take && take.name === t.name && take.audio === player.audio) return;
      const old = take;
      const src = takeSource(t, player, { onGone: () => { if (take && take.src === src) backToTape(); } });
      const audio = player.audio;
      audio.addEventListener('play', takePlays);
      take = { name: t.name, audio, src, off: () => audio.removeEventListener('play', takePlays) };
      bar.load(take.src);
      old?.off();
      old?.src.destroy();
      // The lock screen and a headset are the take's while it's in the bar.
      stream?.setQuiet(true);
      if (!audio.paused) takePlays();
      eject();
    },
    backToTape,
  };
}

/**
 * tapeStream is the tape's stream player on Takes and Capture: started only
 * by joining again (OUT is chosen on the tape page), and heard once ▶ is
 * tapped if the browser held its sound back. As on the tape page, a loss
 * that stopped the tape (6 s) plays on when the stream is back soon.
 */
function tapeStream(tape, onToast) {
  let wasPlaying = false;
  const player = new StreamPlayer({
    onState: (s) => {
      if (s === 'moved') onToast?.(`${tape.title} moved to another device`, 'warn');
      tape.changed();
    },
    onTransport: (kind) => (kind === 'play' ? tape.play() : tape.pause()),
    onReconnect: ({ lostMs, playing }) => { if (wasPlaying && !playing && lostMs < 30000) tape.play(); },
    getTitle: () => tape.title,
  });
  tape.on(() => { if (player.state === 'playing') wasPlaying = tape.playing(); });
  rejoin(player);
  return player;
}

function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
function secs(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
