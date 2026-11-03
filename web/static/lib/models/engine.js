// web/static/lib/models/engine.js
// The bar's engine: what the now-playing bar holds and plays -- the tape
// loaded on the Pi (tape-source.js) and its player on this device
// (StreamPlayer), the live studio feed (feed-source.js), a take
// (take-source.js) and its Audio -- which of them is in the bar, ⏏, where the
// tape plays, and the take carried across pages (lib/bar/carry.js,
// handoff.js). It owns the bar's audio: no view constructs it. Made once per
// document, by the shell, which hands it to every room; the bar
// (lib/bar/bar.js NowPlaying) draws it, and nothing else of the page's is in
// it (docs/architecture/bar.md, *The engine*).

import { tapeSource } from './tape-source.js';
import { takeSource, playheadOf, takeHref } from './take-source.js';
import { feedSource } from './feed-source.js';
import { createTakes } from './takes.js';
import { createTransport } from './transport.js';
import { createProtocol } from './protocol.js';
import { pageCarry, isStudio } from '../bar/carry.js';
import { createHandoff } from '../bar/handoff.js';
import { named } from '../rooms/words.js';
import { Loop } from '../objects/motion.js';
import { StreamPlayer } from '../tape/stream-player.js';
import { rejoin } from '../tape/listener.js';
import { switchOutput } from '../tape/out-switch.js';
import { adoptAudio, releaseAudio, ownsAudio } from '../wave/rowwave.js';

/**
 * createEngine makes the bar's engine: the tape, when the Pi has one loaded
 * (`tapes` is initNav's answer); a take, when the page hands it one
 * (loadTake); the live studio feed (setSource('feed')); and ⏏ back to the
 * tape (eject). `ready` settles once the tape's first state is in -- or
 * there is no tape -- so a page can ask whether the tape was already playing
 * when it opened.
 *
 * The bar also carries its take across pages (lib/bar/carry.js, handoff.js):
 * the record the last page left is read here, before anything draws, and the
 * take -- `find(name)` is takesFinder's -- is put back where it was when the
 * page's list has it.
 *
 * It answers `bar`, what a page drives the bar with: its verbs, `snapshot()`
 * (what NowPlaying draws, frozen), `paintStrip(…)` (the strip's picture),
 * `src` (the source in the bar itself) and `onChange(fn)` (fn() as what the
 * bar holds changes, and every frame while it plays, on the shared ticker);
 * `audio`, the take's Audio; `output`, where the tape plays;
 * `transport`, the page's (lib/models/transport.js), loaded once the Pi has a
 * tape; and `tape`, `stream` and `feed`, the sources it has made so far (null
 * until then).
 */
export function createEngine({ tapes, takes: pageTakes = null, tape: pageTape = null, protocol = createProtocol(), onToast, find: initFind = null, onNote: initOnNote = null, go: initGo = null }) {
  // The page's takes (lib/models/takes.js): the shell's, handed in, which the
  // tape's changes socket feeds; a page with none gets its own, unfed.
  const takes = pageTakes || createTakes({ protocol });
  // The page's transport (lib/models/transport.js): the tape's ▶ ■, where it
  // is, where it plays and its tempo, read from the page's tape (lib/models/
  // tape.js, the shell's, handed in; a page with none gets its own) and
  // pushed, over the page's protocol client; the bar's tape source draws it,
  // and the Studio borrows it while shown.
  const transport = createTransport({ protocol, tape: pageTape || undefined });
  // A press of the bar's the Pi refused: why, in its words.
  const refused = (e) => onToast?.(`The tape: ${e.recording ? `${e.message}. ${e.detail}` : e.message}`, 'bad');
  let find = initFind, onNote = initOnNote, go = initGo;
  let feed = null, tape = null, take = null; // take: { name, audio, src }
  let stream = null; // the tape on this phone, joined again from the page before
  let current = null; // the source in the bar
  let ejected = false; // the tape put back by hand: it stays until a take is picked by hand
  // How many times the person has used the bar's own keys, strip or ⏏: the Listening
  // Room's late arrivals (lib/room/tap.js) load nothing if it has changed.
  let touches = 0;
  const listeners = new Set();
  const navigate = (u) => { if (go) go(u); else location.href = u; };
  // snapshot()'s: v moves with whatever may have moved it (the listeners
  // told, a kick); held counts the sources the bar has held, so a drawing
  // knows when it holds another.
  let v = 0, held = 0, snap = null;
  const emit = () => { v++; snap = null; for (const fn of listeners) fn(); };
  // Every frame while the source plays, on the shared ticker: its playhead
  // steps, and the bar hears it; off it the moment it stops.
  const loop = new Loop(() => {
    const s = current;
    if (!s) return false;
    s.tick();
    emit();
    return s.playing() && !document.hidden;
  });
  // kick says it on the next frame, and every frame while the source plays.
  // Something moved, so a snapshot asked for before then is made afresh.
  const kick = () => { v++; snap = null; if (!document.hidden) loop.start(); };
  // changed says it now (what the bar holds, ⏏), and on the frames after.
  const changed = () => { emit(); kick(); };
  // Once per source: the tape comes back into the bar again and again.
  const hooked = new WeakSet();
  /** show puts `src` in the bar; null empties it. */
  function show(src) {
    if (src === current) return;
    if (current && current.kind === 'tape') current.setActive?.(false);
    current = src;
    held++;
    if (src && src.kind === 'tape') src.setActive?.(true);
    if (src && !hooked.has(src)) { hooked.add(src); src.on(() => { if (current === src) kick(); }); }
    changed();
  }
  const heldState = () => (take ? { take: take.name, frame: take.src.pos(), sr: take.src.sampleRate, playing: take.src.playing(), loop: take.src.loop, length: take.src.length } : null);
  const carry = pageCarry();
  const frameNow = () => carry.frameNow(heldState);
  const stashFrame = (f = heldState()) => carry.stashFrame(f);
  const listP = Promise.resolve(tapes).catch(() => null);
  // The take the last page left (carry.js, handoff.js): read now, before the
  // bar draws anything; put in the bar once the page's list has it, however
  // late; the tape waits in the wings for a few seconds of that.
  let findWait = null;
  const findReady = new Promise((r) => { findWait = r; });
  if (find) findWait();
  const handoff = createHandoff({
    carry,
    find: async (name) => {
      if (!find) await Promise.race([findReady, new Promise((r) => setTimeout(r, 50))]);
      return find ? find(name) : findTakeByName(name);
    },
    tapes: listP,
    studio: () => isStudio(location.pathname),
    takeInBar: () => !!take,
    loadTake: ({ t, player }) => { loadTake(t, player); return take.src; },
    showTape: () => { if (!take && (!current || current.kind !== 'feed') && tape) show(tape); changed(); },
    state: heldState,
    win: window, doc: document,
  });
  function mountTape(loadedId) {
    if (tape || !loadedId) return;
    transport.load(loadedId);
    tape = tapeSource(transport, { stream: () => stream, onError: refused });
    stream = tapeStream(tape, onToast);
    if (take || (current && current.kind === 'feed')) stream.setQuiet(true);
    else if (!handoff.holding()) show(tape);
    // The take list's revision, from whichever changes socket is open.
    transport.onTakes((m) => takes.heard(m));
    changed();
  }
  if (tapes && typeof tapes.then !== 'function' && tapes.loaded) mountTape(tapes.loaded);
  const ready = Promise.resolve(tapes).then((list) => {
    if (!list || !list.loaded) return;
    mountTape(list.loaded);
    if (tape.ready) return;
    return new Promise((done) => { tape.on(done); setTimeout(done, 1500); });
  });
  function backToTape({ byHand = false } = {}) {
    if (byHand) { ejected = true; handoff.touch(); } // the tape put back by hand is a decision
    if (feed && feed.playing()) feed.pause();
    if (take) {
      const old = take;
      take = null;
      releaseAudio(old.audio);
      old.src.pause();
      old.off();
      show(tape);
      old.src.destroy();
      stream?.setQuiet(false);
    } else if (tape) {
      show(tape);
      stream?.setQuiet(false);
    } else {
      show(null);
    }
    changed();
  }
  // In the Studio the bar is the tape's when nothing else in it plays
  // (docs/architecture/bar.md, *In the Studio, the tape*): a take or the live
  // feed left in it stopped -- played in the Listening Room and stopped
  // there, carried from the last page, or stopped by ▶ here -- gives way to
  // the tape, so ▶ there plays the tape. One still playing stays and plays
  // on (J2.2). The Studio asks as it is shown; the hand-off, as it settles;
  // the bar, as ▶ stops what it holds. A take that stops by itself (its end,
  // its selection's Out, Play all moving on) is left be until the next.
  function tapeUnlessPlaying() {
    if (!tape || !isStudio(location.pathname)) return;
    if (!current || current === tape || current.playing()) return;
    backToTape();
  }
  function setSource(kind, { byHand = false } = {}) {
    if (byHand) { touches++; handoff.touch(); }
    if (kind === 'feed') {
      if (take && take.src.playing()) take.src.pause();
      if (stream?.active && stream.mode === 'phone') tape?.pause();
      stream?.setQuiet(true);
      feed ??= feedSource();
      show(feed);
      if (!feed.playing()) feed.play();
      changed();
      return;
    }
    if (kind === 'tape') {
      backToTape({ byHand });
      return;
    }
    if (kind === 'take') {
      if (feed && feed.playing()) feed.pause();
      if (take) {
        show(take.src);
        changed();
      } else if (location.pathname !== '/takes.html') {
        navigate('/takes.html');
      }
    }
  }
  // A take played here while the tape plays on this phone: stop the tape,
  // or the phone plays both (as the tape page does). Only in This phone
  // mode: in Both the jam room is the clock and may be recording.
  const takePlays = () => { if (stream?.active && stream.mode === 'phone') tape.pause(); };
  function makeTakeAudio(t) {
    const a = new Audio();
    a.preload = 'none';
    a.src = `/api/download?file=${encodeURIComponent(t.preview_name || t.name)}`;
    return a;
  }
  function audioFor(t) {
    if (take && take.name === t.name && take.audio) return take.audio;
    return makeTakeAudio(t);
  }
  /**
   * loadTake puts take `t` in the bar, played by its list row's `player`.
   * The same take with a new player (its row rebuilt) replaces the old one.
   */
  function loadTake(t, player) {
    ejected = false;
    if (feed && feed.playing()) feed.pause();
    if (take && take.name === t.name && take.audio === player.audio) {
      if (current !== take.src) show(take.src);
      return;
    }
    const old = take;
    const src = takeSource(t, player, { onGone: () => { if (take && take.src === src) backToTape(); } });
    const audio = adoptAudio(player.audio);
    audio.addEventListener('play', takePlays);
    take = { name: t.name, audio, src, off: () => audio.removeEventListener('play', takePlays) };
    show(take.src);
    if (old && old.audio !== audio) releaseAudio(old.audio);
    old?.off();
    if (old && old.audio !== audio) old.src.destroy();
    // The lock screen and a headset are the take's while it's in the bar.
    stream?.setQuiet(true);
    if (!audio.paused) takePlays();
    changed();
  }
  /**
   * findTakeByName resolves take `name` from the page's takes and /api/peaks
   * with the engine's own Audio, for a room or a reload where no TakesList
   * holds it.
   */
  async function findTakeByName(name) {
    if (!name) return null;
    try {
      const [t, peaksRes] = await Promise.all([
        takes.find(name),
        fetch(`/api/peaks?file=${encodeURIComponent(name)}`),
      ]);
      if (!t) return 'missing';
      if (!t.has_preview || !peaksRes.ok) return null;
      const peaks = await peaksRes.json();
      if (!peaks?.data?.length) return null;
      const audio = audioFor(t);
      const toggle = async () => {
        if (!audio.paused && !audio.ended) { audio.pause(); return; }
        await audio.play();
      };
      return { t, player: { audio, peaks, toggle } };
    } catch {
      return null;
    }
  }
  /**
   * loadTakeByName loads take `name` from the page's takes and /api/peaks with the
   * engine's own Audio, for a room or a reload where no TakesList holds it.
   */
  async function loadTakeByName(name) {
    const found = await findTakeByName(name);
    if (!found || found === 'missing') return null;
    loadTake(found.t, found.player);
    return take ? take.src : null;
  }
  const touch = () => { touches++; handoff.touch(); };
  /** pickSource is a pick from the source menu: the tape, the feed, or a take, which plays. */
  async function pickSource(id) {
    touch();
    if (id === 'tape' || id === 'feed') { setSource(id, { byHand: true }); return; }
    const name = id.startsWith('take:') ? id.slice(5) : null;
    if (!name) return;
    if (feed && feed.playing()) feed.pause();
    if (take && take.name === name) {
      show(take.src);
      changed();
    } else if (!(await loadTakeByName(name))) {
      onToast?.('That take can’t play yet: it is still being saved', 'warn');
      return;
    }
    if (take && !take.src.playing()) take.src.play();
    kick();
  }
  /**
   * setMode is where the tape plays, chosen from any room (the output
   * sheet). Choosing to hear it here puts the tape back in the bar, as ⏏
   * does: it stays there until a take is picked by hand.
   */
  function setMode(mode) {
    if (!tape) return undefined;
    if (mode !== 'jam') backToTape({ byHand: true });
    return switchOutput(mode, { player: stream, transport, toast: (m, k) => onToast?.(m, k) });
  }
  // A take carried from the last page that isn't playing here (it was
  // paused, or the browser held its sound back) leaves a Studio the tape's.
  handoff.start().then(() => tapeUnlessPlaying());
  // snapshotOf is snapshot()'s answer for source `s`, made afresh.
  function snapshotOf(s, here) {
    const canEject = !!(tape && (take || (current && current.kind === 'feed')));
    if (!s) {
      return Object.freeze({
        v, id: held, kind: null, title: '', href: '', playing: false, waiting: false,
        pos: '', frame: 0, frac: 0, length: 1, sampleRate: 48000, lcd: null, display: null,
        loop: false, canPlay: false, canLoop: false, canStart: false, canEject, startLabel: '', levels: null,
      });
    }
    const lcd = Object.freeze({ ...s.lcd() });
    const frame = s.pos();
    const length = Math.max(1, s.length || 1);
    return Object.freeze({
      v,
      id: held,
      kind: s.kind,
      title: s.title || '',
      href: s.href,
      playing: !!s.playing(),
      waiting: !!s.waiting?.(),
      pos: lcd.big || '',
      frame,
      frac: Math.max(0, Math.min(1, frame / length)),
      length,
      sampleRate: s.sampleRate || 48000,
      lcd,
      display: here == null ? null : Object.freeze(s.display(here)),
      loop: !!s.loop,
      canPlay: !!s.canPlay(),
      canLoop: !!s.canLoop(),
      canStart: s.canStart ? !!s.canStart() : true,
      canEject,
      startLabel: s.startLabel(),
      levels: s.levels || null,
    });
  }
  const api = {
    ready,
    /** src: the source in the bar (the tape's, the feed's or a take's), or null; NowPlaying draws it. */
    get src() { return current; },
    /** frameNow: the take in the bar and its frame at this moment ({take, frame, sr, playing, at}), or null. ✎ takes it before the page changes. */
    frameNow,
    /** stashFrame keeps a frame -- frameNow's, else the take's now -- for the next page (carry.takeStashedFrame reads it there), and answers it. */
    stashFrame,
    get takeName() { return take ? take.name : null; },
    get sourceKind() { return current ? current.kind : null; },
    /** touches: how many times the bar's keys, strip or ⏏ have been used on this page. */
    get touches() { return touches; },
    /** touch counts a use of the bar's keys, strip or ⏏: a decision the hand-off keeps to. */
    touch,
    /** playing: whatever the bar holds -- the take, the feed, or the tape -- is playing now. */
    playing: () => !!(current ? current.playing() : (take ? take.src.playing() : tape && tape.ready && tape.playing())),
    /** takeTime: where the take in the bar is, in seconds; null with none. */
    get takeTime() { return playheadOf(take); },
    /** ejected: ⏏ put the tape back; automatic picks leave it there. */
    get ejected() { return ejected; },
    /** canEject: ⏏ has a tape to give back, in place of a take or the feed. */
    get canEject() { return !!(tape && (take || (current && current.kind === 'feed'))); },
    /** looping: a take in the bar is on Loop, so its end isn't the end. */
    get looping() { return !!(take && take.src.loop); },
    tapePlaying: () => !!(tape && tape.ready && tape.playing()),
    loadTake,
    loadTakeByName,
    /**
     * seekTake puts take `name` at `frame` in the bar, and plays it if
     * `play` (a note's time, its ▶): loaded first if the bar holds another,
     * and back in the bar if the feed or the tape took its place. Answers
     * false when it can't be.
     */
    async seekTake(name, frame, { play = false } = {}) {
      if (!take || take.name !== name) {
        if (!(await loadTakeByName(name))) return false;
      }
      if (feed && feed.playing()) feed.pause();
      if (current !== take.src) { show(take.src); changed(); }
      take.src.seek(frame);
      if (play && !take.src.playing()) take.src.play();
      kick();
      return true;
    },
    audioFor,
    setFind: (fn) => { find = fn; if (fn) findWait?.(); },
    setOnNote: (fn) => { onNote = fn; },
    backToTape,
    /** eject is ⏏: the tape back in the bar, by hand, so it stays until a take is picked by hand. */
    eject: () => backToTape({ byHand: true }),
    /**
     * tapeUnlessPlaying puts the tape back in the bar, in the Studio, when
     * what the bar holds instead (a take, the feed) isn't playing: the
     * Studio's view says so each time it is shown. The engine asks too, as
     * the hand-off settles and as ▶ stops what the bar holds (the bar's onPause).
     */
    tapeUnlessPlaying,
    setSource,
    pickSource,
    /** note is ✎: the page's notes drawer (setOnNote, the shell's boot.js), else stash the frame and open the take. */
    note() {
      if (typeof onNote === 'function') {
        const f = frameNow();
        if (f) onNote(f);
        return;
      }
      noteHere({ frameNow, stash: stashFrame, go: navigate });
    },
    /** grabFeed is the feed's GRAB: its last seconds onto the tape's cue lane, then the Studio. */
    async grabFeed() {
      if (!feed) return;
      try {
        navigate(await feed.grabToStudio());
      } catch (e) {
        onToast?.(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad');
      }
    },
    /** kick says it again on the next frame, and every frame while the source plays. */
    kick,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /**
     * snapshot(here) is what the bar holds, as the bar draws it, frozen,
     * cached on v: v is a cache key, bumped on every emit (each change the
     * listeners hear, every frame while it plays) and every kick, whether or
     * not anything it carries changed, so a new v need not mean a new value. `here` is this device's word for where a
     * take or the feed plays (lib/bar/slots.js hereWord), for the display.
     *   id           which source: a new number each time the bar holds another
     *   kind, title  'tape', 'feed' or 'take' (null with nothing), and its name
     *   href         its own page (Open ›)
     *   playing      it plays; waiting: on the Pi, not yet heard here (▶ is
     *                the tap it waits for)
     *   frame, length, sampleRate, frac
     *                where it is, of how long, in frames
     *   pos, lcd     the display's big line, and the whole LCD
     *                ({big, small, note, status, unit})
     *   display      the display's keys for `here` ({tempo, source, out, said},
     *                display.js); null asked with no `here`
     *   loop         on Loop (Repeat, for a take)
     *   canPlay, canLoop, canStart, canEject
     *                ▶, ⟲, |◂ and ⏏ have something to do
     *   startLabel   what |◂ goes back to, in words
     *   levels       the reels' levels ({colors, at(frame)}), or null
     */
    snapshot(here = null) {
      if (snap && snap.v === v && snap.here === here) return snap.it;
      snap = { v, here, it: snapshotOf(current, here) };
      return snap.it;
    },
    /**
     * paintStrip draws what the bar holds on the strip's 2D context, `w` × `h`
     * CSS pixels at density `dpr`, in `colors(name, fallback)`: the tape's
     * overview, a take's trace, the feed's ring. False with nothing in the bar.
     */
    paintStrip(ctx, w, h, colors, dpr = 1) {
      if (!current) return false;
      current.paint(ctx, w, h, colors, dpr);
      return true;
    },
    /**
     * playPause is ▶: the source's own say first (the tape's sound waiting
     * for a tap), else it plays, or stops. A stop by ▶ is the person's: in
     * the Studio the tape comes back into the bar (tapeUnlessPlaying).
     */
    playPause() {
      const s = current;
      if (!s) return;
      touch();
      if (!s.press?.()) {
        if (s.playing()) { s.pause(); tapeUnlessPlaying(); } else s.play();
      }
      kick();
    },
    /** seekFraction moves the playhead to fraction `f` (0–1) of what the bar holds: the strip's tap and drag, and Home. */
    seekFraction(f) {
      const s = current;
      if (!s) return;
      s.seek(f * s.length);
      kick();
    },
    /** toEnd moves the playhead to the last frame (End on the strip). */
    toEnd() {
      const s = current;
      if (!s) return;
      s.seek(s.length - 1);
      kick();
    },
    /** step moves the playhead `n` of the source's steps (← → on the strip). */
    step(n) {
      const s = current;
      if (!s) return;
      s.seek(s.pos() + n * s.step());
      kick();
    },
    /** toStart is |◂: back to the source's start (the loop's, In, the live head). */
    toStart() {
      touch();
      const s = current;
      if (!s) return;
      s.seek(s.start());
      kick();
    },
    /** back5 is ↺ 5 s, or J: back five seconds of what this device hears, playing or not. */
    back5() {
      const s = current;
      if (!s) return;
      touch();
      s.seek(Math.max(0, (s.heardHere ? s.heardHere() : s.pos()) - 5 * s.sampleRate));
      kick();
    },
    /** setLoop is ⟲: Loop (Repeat, for a take) on or off. */
    setLoop(on) {
      touch();
      const s = current;
      if (!s) return;
      s.setLoop(!!on);
      kick();
    },
  };
  const audioApi = {
    adopt: adoptAudio,
    owns: ownsAudio,
    release: releaseAudio,
    audioFor,
  };
  const outputApi = {
    get player() { return stream; },
    setMode,
  };
  return {
    bar: api,
    audio: audioApi,
    output: outputApi,
    takes,
    setFind: api.setFind,
    setOnNote: api.setOnNote,
    setGo: (fn) => { go = fn; },
    // A tape made after the engine was (the first one a Pi gets, from the
    // Studio): the engine holds it from here on.
    setTapes: (list) => { if (list && list.loaded) mountTape(list.loaded); },
    get tape() { return tape; },
    transport,
    get stream() { return stream; },
    get feed() { return feed; },
  };
}

/**
 * tapeStream is the tape's stream player on this device: started by joining
 * again, or by the header's output button, and heard once ▶ is tapped if the
 * browser held its sound back. A loss that stopped the tape (6 s) plays on
 * when the stream is back soon.
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
    getLoop: () => tape.loopSpec?.(),
    getTitle: () => tape.title,
  });
  tape.on(() => { if (player.state === 'playing') wasPlaying = tape.playing(); });
  rejoin(player);
  return player;
}

/**
 * noteHere is ✎ on a page with no notes drawer: the take in the bar and its
 * frame at this moment are taken first -- before the page changes, and
 * before anything else runs, so the gap does not move it -- and kept for the
 * next page; then the take opens. Null, and nothing happens, when the bar
 * holds no take. The take page does not read the kept frame until F6 (nor
 * does it pick up where the bar is), so until then ✎ simply opens the take.
 */
export function noteHere({ frameNow, stash, go }) {
  const f = frameNow();
  if (!f) return null;
  stash(f);
  go(takeHref(f.take));
  return f;
}
