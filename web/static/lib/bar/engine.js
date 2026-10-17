// web/static/lib/bar/engine.js
// The bar's engine: what the now-playing bar (NowPlaying, bar.js) holds and
// plays -- the tape loaded on the Pi (tape-source.js) and its player on this
// device (StreamPlayer), the live studio feed (feed-source.js), a take
// (take-source.js) -- which of them is in the bar, ⏏, the header's output
// button, and the take carried across pages (carry.js, handoff.js). Made once
// per document: today by Takes and Capture through pageBar, later by the
// shell, which hands it to every room
// (docs/superpowers/plans/2026-10-17-phase1-shell.md §2.4).

import { NowPlaying } from './bar.js';
import { tapeSource } from './tape-source.js';
import { takeSource, playheadOf } from './take-source.js';
import { feedSource } from './feed-source.js';
import { noteHere } from './take-keys.js';
import { pageCarry, isStudio } from './carry.js';
import { createHandoff, takesFinder } from './handoff.js';
import { named } from '../rooms/words.js';
import { StreamPlayer } from '../tape/stream-player.js';
import { rejoin } from '../tape/listener.js';
import { wireOutput, paintOutButtons, paintOutSheet, switchOutput, outDelay } from '../tape/out-switch.js';

const $ = (id) => document.getElementById(id);

export { takesFinder };

/**
 * pageBar is the bar as Takes and Capture use it: the engine's `bar`.
 */
export function pageBar(opts) {
  return createEngine(opts).bar;
}

/**
 * createEngine makes the bar's engine: the tape, when the Pi has one loaded
 * (`tapes` is initNav's answer); a take, when the page hands it one
 * (loadTake); the live studio feed (feedSource); and ⏏ back to the tape.
 * `ready` settles once the tape's first state is in -- or there is no tape --
 * so a page can ask whether the tape was already playing when it opened.
 *
 * The bar also carries its take across pages (lib/bar/carry.js, handoff.js):
 * the record the last page left is read here, before anything draws, and the
 * take -- `find(name)` is takesFinder's -- is put back where it was when the
 * page's list has it.
 *
 * It answers `bar`, what a page drives the bar with; `np`, the NowPlaying on
 * #np; and `tape`, `stream` and `feed`, the sources it has made so far (null
 * until then).
 */
export function createEngine({ tapes, onToast, find = null, onNote = null }) {
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
    studio: () => isStudio(location.pathname),
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
  const api = {
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
  return {
    bar: api,
    np: bar,
    get tape() { return tape; },
    get stream() { return stream; },
    get feed() { return feed; },
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
