// web/static/lib/bar/bar.js
// The now-playing bar on Takes and Capture (the tape page and the take page
// drive their own): one source at a time -- the tape (tape-source.js) or a
// take (take-source.js) -- in the reel window and its LCD, played from its
// keys, and scrubbed on its strip. A tap on the strip moves the playhead
// there; a drag scrubs it; with the strip focused, ← → step and Space plays.
// The page decides what the bar holds; ⏏ asks it for the tape back. With the
// rooms on, a take in it also shows its name (a link to its page) and ✎
// (take-keys.js), and ⟲ is Repeat.

import { ReelWindow } from '../objects/reel-window.js';
import { Loop } from '../objects/motion.js';
import { tapeSource } from './tape-source.js';
import { takeSource, playheadOf } from './take-source.js';
import { feedSource } from './feed-source.js';
import { takeKeys, noteHere } from './take-keys.js';
import { initPlayer } from './player.js';
import { pageCarry, isStudio } from './carry.js';
import { createHandoff, takesFinder } from './handoff.js';
import { on as roomsOn } from '../rooms/flag.js';
import { named } from '../rooms/words.js';
import { StreamPlayer } from '../tape/stream-player.js';
import { rejoin } from '../tape/listener.js';
import { wireOutput, paintOutButtons, paintOutSheet, switchOutput, outDelay } from '../tape/out-switch.js';

const $ = (id) => document.getElementById(id);

export class NowPlaying {
  constructor({ onEject, onTouch, onNote, onSelectSource, onGrabFeed } = {}) {
    this.root = $('np');
    this.src = null;
    this.marqueeKey = null;
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
    initPlayer();
    // With the rooms on, a take in the bar shows its name (which opens it) and
    // ✎, and ⟲ is Repeat (take-keys.js). Off, the bar has none of it.
    this.keys = roomsOn() ? takeKeys({ doc: document, root: this.root, onNote, onSelectSource, onGrabFeed }) : null;

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
      if (document.querySelector('dialog[open]')) return;
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
    this.keys?.paint(s);
    setAttr($('np-loop'), 'aria-pressed', String(!!s.loop));
    $('np-loop').disabled = !s.canLoop();
    setAttr($('np-start'), 'aria-label', s.startLabel());
    // What's in the bar opens on its own page; ⏏ is for a take while there's a tape.
    const open = $('np-open');
    setAttr(open, 'href', s.href);
    setText(open, s.kind === 'tape' ? `Open ${s.title} ›` : 'Open the take ›');
    setText($('np-out'), s.out());
    // Where the tape plays is the header's output button; a take plays
    // here, and the bar says so.
    $('np-out').parentElement.classList.toggle('np-out-tape', s.kind === 'tape');
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
    for (const fn of this.listeners) fn(this.snapshot());
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

export { takesFinder };

const hooked = new WeakSet();

/**
 * pageBar is the bar as Takes and Capture use it: the tape, when the Pi has
 * one loaded (`tapes` is initNav's answer); a take, when the page hands it
 * one (loadTake); the live studio feed (feedSource); and ⏏ back to the tape.
 * `ready` settles once the tape's first state is in -- or there is no tape --
 * so a page can ask whether the tape was already playing when it opened.
 *
 * With the rooms on, the bar also carries its take across pages
 * (lib/bar/carry.js, handoff.js): the record the last page left is read here,
 * before anything draws, and the take -- `find(name)` is takesFinder's --
 * is put back where it was when the page's list has it. Off, none of it runs.
 */
export function pageBar({ tapes, onToast, find = null, onNote = null }) {
  let feed = null, tape = null, take = null; // take: { name, audio, src }
  let stream = null; // the tape on this phone, joined again from the page before
  let ejected = false; // the tape put back by hand: it stays until a take is picked by hand
  // How many times the person has used the bar's own keys, strip or ⏏: the Listening
  // Room's late arrivals (lib/room/tap.js) load nothing if it has changed.
  let touches = 0;
  const bar = new NowPlaying({
    onEject: () => backToTape({ byHand: true }),
    onTouch: () => { touches++; handoff.touch(); },
    // ✎: open inline sketchbook if provided by the room, else stash frame and navigate.
    onNote: () => {
      if (typeof onNote === 'function') {
        const f = frameNow();
        if (f) onNote(f);
        return;
      }
      noteHere({ frameNow, stash: stashFrame, go: (u) => { location.href = u; } });
    },
    onSelectSource: (kind) => setSource(kind, { byHand: true }),
    onGrabFeed: async () => {
      if (!feed) return;
      try {
        location.href = await feed.grabToStudio();
      } catch (e) {
        onToast?.(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad');
      }
    },
  });
  const eject = () => { $('np-eject').hidden = !(tape && (take || (bar.src && bar.src.kind === 'feed'))); };
  const heldState = () => (take ? { take: take.name, frame: take.src.pos(), sr: take.src.sampleRate, playing: take.src.playing(), loop: take.src.loop, length: take.src.length } : null);
  const carry = pageCarry();
  const frameNow = () => carry.frameNow(heldState);
  const stashFrame = (f = heldState()) => carry.stashFrame(f);
  const listP = Promise.resolve(tapes).catch(() => null);
  // The take the last page left (carry.js, handoff.js): read now, before the
  // bar draws anything; put in the bar once the page's list has it, however
  // late; the tape waits in the wings for a few seconds of that.
  const handoff = createHandoff({
    carry, find, tapes: listP,
    studio: () => roomsOn() && isStudio(location.pathname),
    takeInBar: () => !!take,
    loadTake: ({ t, player }) => { loadTake(t, player); return take.src; },
    showTape: () => { if (!take && (!bar.src || bar.src.kind !== 'feed') && tape) bar.load(tape); eject(); },
    state: heldState,
    win: window, doc: document,
  });
  const ready = Promise.resolve(tapes).then((list) => {
    if (!list || !list.loaded) return;
    tape = tapeSource(list.loaded, { onError: (m) => onToast?.(`The tape: ${m}`, 'bad'), stream: () => stream });
    stream = tapeStream(tape, onToast);
    if (take || (bar.src && bar.src.kind === 'feed')) stream.setQuiet(true);
    else if (!handoff.holding()) bar.load(tape);
    eject();
    // The header's output button: where the tape plays, chosen from here as
    // on the tape page. Choosing to hear it here puts the tape back in the
    // bar, as ⏏ does: it stays there until a take is picked by hand. The
    // sheet asks the Pi as it opens, so it's never a few seconds behind.
    wireOutput({
      name: () => tape.title,
      onOpen: () => tape.refresh(),
      choose: (mode) => {
        if (mode !== 'jam') backToTape({ byHand: true });
        return switchOutput(mode, { player: stream, poll: tape.refresh, toast: (m, k) => onToast?.(m, k) });
      },
    });
    const paintOut = () => {
      const mode = tape.mode();
      paintOutButtons(mode);
      paintOutSheet(mode || 'jam', outDelay(stream.active ? stream.delayMs() : tape.streamDelayMs()));
    };
    tape.on(paintOut);
    return new Promise((done) => { tape.on(done); setTimeout(done, 1500); });
  });
  function backToTape({ byHand = false } = {}) {
    if (byHand) { ejected = true; handoff.touch(); } // the tape put back by hand is a decision
    if (feed && feed.playing()) feed.pause();
    if (take) {
      const old = take;
      take = null;
      old.src.pause();
      old.off();
      bar.load(tape);
      old.src.destroy();
      stream?.setQuiet(false);
    } else if (tape) {
      bar.load(tape);
      stream?.setQuiet(false);
    } else {
      bar.load(null);
    }
    eject();
  }
  function setSource(kind, { byHand = false } = {}) {
    if (byHand) { touches++; handoff.touch(); }
    if (kind === 'feed') {
      if (take && take.src.playing()) take.src.pause();
      if (stream?.active && stream.mode === 'phone') tape?.pause();
      stream?.setQuiet(true);
      feed ??= feedSource();
      bar.load(feed);
      if (!feed.playing()) feed.play();
      bar.kick();
      eject();
      return;
    }
    if (kind === 'tape') {
      backToTape({ byHand });
      return;
    }
    if (kind === 'take') {
      if (feed && feed.playing()) feed.pause();
      if (take) {
        bar.load(take.src);
        eject();
      } else if (location.pathname !== '/takes.html') {
        location.href = '/takes.html';
      }
    }
  }
  // A take played here while the tape plays on this phone: stop the tape,
  // or the phone plays both (as the tape page does). Only in This phone
  // mode: in Both the jam room is the clock and may be recording.
  const takePlays = () => { if (stream?.active && stream.mode === 'phone') tape.pause(); };
  /**
   * loadTake puts take `t` in the bar, played by its list row's `player`.
   * The same take with a new player (its row rebuilt) replaces the old one.
   */
  function loadTake(t, player) {
    ejected = false;
    if (feed && feed.playing()) feed.pause();
    if (take && take.name === t.name && take.audio === player.audio) {
      if (bar.src !== take.src) bar.load(take.src);
      return;
    }
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
  }
  handoff.start();
  return {
    ready,
    /** frameNow: the take in the bar and its frame at this moment ({take, frame, sr, playing, at}), or null. ✎ takes it before the page changes. */
    frameNow,
    /** stashFrame keeps a frame -- frameNow's, else the take's now -- for the next page (carry.takeStashedFrame reads it there), and answers it. */
    stashFrame,
    get takeName() { return take ? take.name : null; },
    get sourceKind() { return bar.src ? bar.src.kind : null; },
    /** touches: how many times the bar's keys, strip or ⏏ have been used on this page. */
    get touches() { return touches; },
    /** playing: whatever the bar holds -- the take, the feed, or the tape -- is playing now. */
    playing: () => !!(bar.src ? bar.src.playing() : (take ? take.src.playing() : tape && tape.ready && tape.playing())),
    /** takeTime: where the take in the bar is, in seconds; null with none. */
    get takeTime() { return playheadOf(take); },
    /** ejected: ⏏ put the tape back; automatic picks leave it there. */
    get ejected() { return ejected; },
    /** looping: a take in the bar is on Loop, so its end isn't the end. */
    get looping() { return !!(take && take.src.loop); },
    tapePlaying: () => !!(tape && tape.ready && tape.playing()),
    loadTake,
    backToTape,
    setSource,
    onChange: (fn) => bar.onChange(fn),
    snapshot: () => bar.snapshot(),
  };
}

/**
 * tapeStream is the tape's stream player on Takes and Capture: started by
 * joining again, or by the header's output button, and heard once ▶ is
 * tapped if the browser held its sound back. As on the tape page, a loss
 * that stopped the tape (6 s) plays on when the stream is back soon.
 */
function tapeStream(tape, onToast) {
  let wasPlaying = false;
  const player = new StreamPlayer({
    onState: (s) => {
      if (s === 'moved') onToast?.(`${named(tape.title)} moved to another device`, 'warn');
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
