// web/static/lib/bar/bar.js
// The bar, in every room (the take page drives its own): one source at a
// time -- the tape (tape-source.js), the feed (feed-source.js) or a take
// (take-source.js) -- in the reel window and its display, played from its
// keys, and scrubbed on its strip. A tap on the strip moves the playhead
// there; a drag scrubs it; with the strip focused, ← → step and Space plays.
// The engine (engine.js) decides what the bar holds; ⏏ asks it for the tape
// back. Its shape is css/bar.css's: #np says what it holds (data-source) and
// the stylesheet shows each key for the sources it is for (slots.js). The
// display says where it is, then the tempo, the source and where it plays
// (display.js), each a key: the tempo's menu is the Studio's, the source's
// is source-menu.js, where it plays is the output sheet. With a take, Open ›
// and ✎ are at its end (take-keys.js), and ⟲ is Repeat.

import { ReelWindow } from '../objects/reel-window.js';
import { Loop } from '../objects/motion.js';
import { tokenCache, onSchemeChange } from '../theme.js';
import { setText } from '../text.js';
import { takeKeys } from './take-keys.js';
import { setIcon } from '../ui/icons.js';
import { initPlayer } from './player.js';
import { initFold } from './fold.js';
import { measureBar, hereWord, deviceOf } from './slots.js';

const $ = (id) => document.getElementById(id);

export class NowPlaying {
  constructor({ onEject, onTouch, onNote, onGrabFeed, canOutput = () => false } = {}) {
    this.root = $('np');
    this.src = null;
    this.canOutput = canOutput;
    this.listeners = new Set();
    // Drawn every frame while the source plays, on the shared ticker; off it
    // the moment it stops.
    this.loop = new Loop(() => {
      const s = this.src;
      if (!s) return false;
      s.tick();
      this.render();
      return s.playing() && !document.hidden;
    });
    this.reels = new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
    this.scrub = $('np-scrub');
    // The strip's size and colours, kept rather than read in render: render
    // runs every frame while something plays, after the LCD's text is
    // written, and a measure or a style read then is a forced layout a frame.
    this.scrubSize = null;
    this.colors = tokenCache(() => this.scrub);
    onSchemeChange(() => { this.colors.clear(); this.kick(); });
    initPlayer();
    initFold();
    // Its height, for the pages that keep clear of it.
    measureBar(this.root);
    // With a take, Open › and ✎; with the feed, GRAB; ⟲ is Repeat for a
    // take (take-keys.js).
    this.keys = takeKeys({ doc: document, root: this.root, onNote, onGrabFeed });
    // The tempo's menu is the Studio's: a room switch changes whether the
    // key opens it.
    new MutationObserver(() => this.kick()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Where a take or the feed plays: this device, by its kind, read once
    // and again when the screen changes shape, not every frame.
    const kind = () => { this.here = hereWord(deviceOf(window)); };
    kind();
    window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', () => { kind(); this.kick(); });
    window.matchMedia?.('(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)')?.addEventListener?.('change', () => { kind(); this.kick(); });

    $('np-play').addEventListener('click', () => {
      const s = this.src;
      if (!s) return;
      onTouch?.();
      // The source's own say first: the tape's sound waiting for a tap.
      if (!s.press?.()) { if (s.playing()) s.pause(); else s.play(); }
      this.kick();
    });
    $('np-loop').addEventListener('click', () => { onTouch?.(); if (this.src) this.src.setLoop(!this.src.loop); });
    $('np-start').addEventListener('click', () => { onTouch?.(); if (this.src) this.src.seek(this.src.start()); });
    // ↺ 5 s, or J: back five seconds of what this device hears, playing or
    // not.
    const back5 = () => {
      const s = this.src;
      if (!s) return;
      onTouch?.();
      s.seek(Math.max(0, (s.heardHere ? s.heardHere() : s.pos()) - 5 * s.sampleRate));
      this.kick();
    };
    $('np-back5').addEventListener('click', back5);
    // By the character, as the take page reads its keys.
    addEventListener('keydown', (e) => {
      if ((e.key !== 'j' && e.key !== 'J') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
      if ([...document.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('inspector'))) return;
      if (this.root.hidden || !this.src) return;
      back5();
    });
    // ⏏ hides itself: the focus goes to ▶, not to the page.
    $('np-eject').addEventListener('click', () => { onTouch?.(); onEject?.(); $('np-play').focus(); });

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
      onTouch?.();
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
      if (e.key === ' ' || e.key === 'Home' || e.key === 'End' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') onTouch?.();
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) $('np-play').click(); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); s.seek(e.key === 'Home' ? 0 : s.length - 1); this.kick(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      s.seek(s.pos() + (e.key === 'ArrowRight' ? s.step() : -s.step()));
      this.kick();
    });
    new ResizeObserver(([e]) => {
      const b = e.borderBoxSize && e.borderBoxSize[0];
      this.scrubSize = b ? { width: b.inlineSize, height: b.blockSize } : { width: e.contentRect.width, height: e.contentRect.height };
      this.render();
    }).observe(sc);
    document.addEventListener('visibilitychange', () => this.kick());
  }

  /** load puts `src` in the bar; null empties and hides it. */
  load(src) {
    if (src === this.src) return;
    if (this.src && this.src.kind === 'tape') this.src.setActive?.(false);
    this.src = src;
    this.colors.clear();
    this.root.hidden = !src;
    // What it holds -- feed, tape or take -- for the CSS and the checks that look.
    if (src) this.root.setAttribute('data-source', src.kind);
    else this.root.removeAttribute('data-source');
    if (!src) { this.keys?.paint(null); return; }
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

  // kick draws on the next frame, and every frame while the source plays.
  kick() {
    if (document.hidden) return;
    this.loop.start();
  }

  render() {
    const s = this.src;
    if (!s) return;
    const lcd = s.lcd();
    const playing = s.playing();
    // Playing on the Pi, but not yet heard here: ▶ is the tap it waits for.
    const waiting = !!s.waiting?.();
    setText($('position'), lcd.big);
    // A note (tap ▶ to play here, a mixdown's progress) in the time's place.
    const time = $('np-time');
    setText(time, lcd.note || lcd.small);
    time.classList.toggle('note', !!lcd.note);
    setText($('np-unit'), lcd.unit);
    setAttr($('np-status'), 'data-state', lcd.status);
    this.paintDisplay(s);
    // ▶ and its pause: ■ for the tape, as on its page; ❚❚ for a take. The
    // key's .playing says it to the stylesheet and the checks, whatever it draws.
    const play = $('np-play');
    const shown = playing && !waiting;
    setIcon(play, shown ? (s.kind === 'tape' ? 'stop' : 'pause') : 'play');
    setAttr(play, 'aria-label', waiting ? 'Play here' : shown ? (s.kind === 'tape' ? 'Stop' : 'Pause') : 'Play');
    play.classList.toggle('playing', shown);
    play.disabled = !playing && !waiting && !s.canPlay();
    this.keys?.paint(s);
    setAttr($('np-loop'), 'aria-pressed', String(!!s.loop));
    $('np-loop').disabled = !s.canLoop();
    $('np-start').disabled = s.canStart ? !s.canStart() : false;
    setAttr($('np-start'), 'aria-label', s.startLabel());
    // What's in the bar opens on its own page: a take's, or the tape's Studio.
    const open = $('np-open');
    setAttr(open, 'href', s.href);
    setAttr(open, 'aria-label', s.kind === 'tape' ? `Open ${s.title} in the Studio` : `Open ${s.title}`);
    // The strip, and what a screen reader hears of it.
    // Measured once, before its observer has said (a bar just made).
    const r = this.scrubSize ||= (({ width, height }) => ({ width, height }))(this.scrub.getBoundingClientRect());
    const dpr = window.devicePixelRatio || 1;
    if (r.width > 0) {
      if (this.scrub.width !== Math.round(r.width * dpr) || this.scrub.height !== Math.round(r.height * dpr)) {
        this.scrub.width = Math.round(r.width * dpr);
        this.scrub.height = Math.round(r.height * dpr);
      }
      const ctx = this.scrub.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.paint(ctx, r.width, r.height, (n, d) => this.colors.get(n, d), dpr);
    }
    const tenth = s.sampleRate / 10;
    const p = Math.round(s.pos() / tenth) * tenth;
    setAttr(this.scrub, 'aria-valuemax', String(Math.round(s.length)));
    setAttr(this.scrub, 'aria-valuenow', String(Math.round(p)));
    setAttr(this.scrub, 'aria-valuetext', `${lcd.unit === 'BAR' ? `bar ${lcd.big}, ` : ''}${secs(p / s.sampleRate)}`);
    if (s.levels) this.reels.setLevels(s.levels.colors, s.levels.at);
    else this.reels.setLevels([], () => []);
    this.reels.poll({ heard: s.pos(), playing, length: s.length, sampleRate: s.sampleRate });
    for (const fn of this.listeners) fn(this.snapshot());
  }

  /**
   * paintDisplay writes the display's three keys for source `s`: its tempo
   * (a key in the Studio, with the tape, where the tempo's menu is), the
   * source, and where it plays (a key once there is a tape to send).
   */
  paintDisplay(s) {
    const d = s.display(this.here);
    setText($('np-tempo-short'), d.tempo.short);
    setText($('np-tempo-long'), d.tempo.long);
    setText($('np-source-short'), d.source.short);
    setText($('np-source-long'), d.source.long);
    setText($('np-output-val'), d.out);
    const foot = $('np-out-foot');
    if (foot) setText($('np-out-foot-val'), d.out);
    const tempo = $('np-tempo');
    const tempoMenu = s.kind === 'tape' && document.body.classList.contains('tape-page');
    if (tempo.disabled !== !tempoMenu) tempo.disabled = !tempoMenu;
    setAttr(tempo, 'aria-label', tempoMenu ? `${d.said.tempo}: change the bars` : d.said.tempo);
    setAttr($('np-source'), 'aria-label', d.said.source);
    const out = $('np-output');
    const sends = !!this.canOutput();
    if (out.disabled !== !sends) out.disabled = !sends;
    setAttr(out, 'aria-label', d.said.out);
    if (foot) {
      if (foot.disabled !== !sends) foot.disabled = !sends;
      setAttr(foot, 'aria-label', d.said.out);
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    const s = this.src;
    if (!s) return { kind: null, title: '', playing: false, pos: '', frame: 0, frac: 0, length: 1, sampleRate: 48000, lcd: null };
    const lcd = s.lcd();
    const frame = s.pos();
    const length = Math.max(1, s.length || 1);
    const frac = Math.max(0, Math.min(1, frame / length));
    return {
      kind: s.kind,
      title: s.title || '',
      playing: !!s.playing(),
      pos: lcd?.big || '',
      frame,
      frac,
      length,
      sampleRate: s.sampleRate || 48000,
      lcd,
    };
  }
}

const hooked = new WeakSet();

function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
function secs(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
