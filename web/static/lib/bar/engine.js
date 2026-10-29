// web/static/lib/bar/engine.js
// The bar's engine: what the now-playing bar (NowPlaying, bar.js) holds and
// plays -- the tape loaded on the Pi (tape-source.js) and its player on this
// device (StreamPlayer), the live studio feed (feed-source.js), a take
// (take-source.js) -- which of them is in the bar, ⏏, the header's output
// button, and the take carried across pages (carry.js, handoff.js). Made once
// per document: today by Takes and Capture through pageBar, later by the
// shell, which hands it to every room
// (docs/architecture/shell.md, The engine).

import { NowPlaying } from './bar.js';
import { tapeSource } from './tape-source.js';
import { takeSource, playheadOf } from './take-source.js';
import { feedSource } from './feed-source.js';
import { noteHere } from './take-keys.js';
import { sourceMenu } from './source-menu.js';
import { phoneKey } from './phone-key.js';
import { phoneRecorder } from '../phone/recorder.js';
import { barPressNote } from './press-note.js';
import { layersOf } from '../ui/layers.js';
import { barTop } from '../ui/menu.js';
import { pageCarry, isStudio } from './carry.js';
import { createHandoff, takesFinder } from './handoff.js';
import { named } from '../rooms/words.js';
import { StreamPlayer } from '../tape/stream-player.js';
import { rejoin } from '../tape/listener.js';
import { wireOutput, paintOutSheet, switchOutput, outDelay } from '../tape/out-switch.js';
import { adoptAudio, releaseAudio, ownsAudio } from '../wave/rowwave.js';

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
export function createEngine({ tapes, onToast, find: initFind = null, onNote: initOnNote = null, go: initGo = null }) {
  let find = initFind, onNote = initOnNote, go = initGo;
  let feed = null, tape = null, take = null; // take: { name, audio, src }
  let stream = null; // the tape on this phone, joined again from the page before
  let setMode = null;
  let openOutput = null; // the output sheet, once the tape is mounted
  let ejected = false; // the tape put back by hand: it stays until a take is picked by hand
  // How many times the person has used the bar's own keys, strip or ⏏: the Listening
  // Room's late arrivals (lib/room/tap.js) load nothing if it has changed.
  let touches = 0;
  const navigate = (u) => { if (go) go(u); else location.href = u; };
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
      noteHere({ frameNow, stash: stashFrame, go: navigate });
    },
    onGrabFeed: async () => {
      if (!feed) return;
      try {
        navigate(await feed.grabToStudio());
      } catch (e) {
        onToast?.(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad');
      }
    },
    // Where it plays opens the output sheet, once there's a tape to send.
    canOutput: () => !!openOutput,
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
    showTape: () => { if (!take && (!bar.src || bar.src.kind !== 'feed') && tape) bar.load(tape); eject(); },
    state: heldState,
    win: window, doc: document,
  });
  function mountTape(loadedId) {
    if (tape || !loadedId) return;
    tape = tapeSource(loadedId, { onError: (m) => onToast?.(`The tape: ${m}`, 'bad'), stream: () => stream });
    stream = tapeStream(tape, onToast);
    if (take || (bar.src && bar.src.kind === 'feed')) stream.setQuiet(true);
    else if (!handoff.holding()) bar.load(tape);
    eject();
    setMode = (mode) => {
      if (mode !== 'jam') backToTape({ byHand: true });
      return switchOutput(mode, { player: stream, poll: () => tape.refresh(), toast: (m, k) => onToast?.(m, k) });
    };
    // The header's output button (and the phone player's OUT pill): where the
    // tape plays, chosen from any room. Choosing to hear it here puts the tape
    // back in the bar, as ⏏ does: it stays there until a take is picked by
    // hand. The sheet asks the Pi as it opens, so it's never a few seconds
    // behind.
    openOutput = wireOutput({
      name: () => tape.title,
      onOpen: () => tape.refresh(),
      choose: setMode,
      keys: [$('np-output'), $('np-out-foot')].filter(Boolean),
    });
    bar.kick();
    // A press on the keyboard, over the display for its second (press-note.js).
    let note = null;
    tape.onPress((p) => { note ??= barPressNote(document); note.show(p); });
    const paintOut = () => {
      paintOutSheet(tape.mode() || 'jam', outDelay(stream.active ? stream.delayMs() : tape.streamDelayMs()));
    };
    tape.on(paintOut);
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
      if (bar.src !== take.src) bar.load(take.src);
      return;
    }
    const old = take;
    const src = takeSource(t, player, { onGone: () => { if (take && take.src === src) backToTape(); } });
    const audio = adoptAudio(player.audio);
    audio.addEventListener('play', takePlays);
    take = { name: t.name, audio, src, off: () => audio.removeEventListener('play', takePlays) };
    bar.load(take.src);
    if (old && old.audio !== audio) releaseAudio(old.audio);
    old?.off();
    if (old && old.audio !== audio) old.src.destroy();
    // The lock screen and a headset are the take's while it's in the bar.
    stream?.setQuiet(true);
    if (!audio.paused) takePlays();
    eject();
  }
  /**
   * findTakeByName resolves take `name` from /api/jams and /api/peaks with the
   * engine's own Audio, for a room or a reload where no TakesList holds it.
   */
  async function findTakeByName(name) {
    if (!name) return null;
    try {
      const [jamsRes, peaksRes] = await Promise.all([
        fetch('/api/jams', { cache: 'no-store' }),
        fetch(`/api/peaks?file=${encodeURIComponent(name)}`),
      ]);
      if (!jamsRes.ok) return null;
      const jams = await jamsRes.json();
      const t = Array.isArray(jams) ? jams.find((x) => x.name === name) : null;
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
   * loadTakeByName loads take `name` from /api/jams and /api/peaks with the
   * engine's own Audio, for a room or a reload where no TakesList holds it.
   */
  async function loadTakeByName(name) {
    const found = await findTakeByName(name);
    if (!found || found === 'missing') return null;
    loadTake(found.t, found.player);
    return take ? take.src : null;
  }
  const audioApi = {
    adopt: adoptAudio,
    owns: ownsAudio,
    release: releaseAudio,
    audioFor,
  };
  // The display's source: the tape, the live feed, the last few takes, the
  // shelf (source-menu.js).
  const sourceKey = $('np-source');
  if (sourceKey && $('np-source-menu')) {
    sourceMenu({
      doc: document, button: sourceKey, panel: $('np-source-menu'), layers: layersOf(document),
      now: () => ({ kind: bar.src ? bar.src.kind : null, takeName: take ? take.name : null, tape: tape && tape.ready ? tape.title : (tape ? 'the tape' : null) }),
      list: async () => { const r = await fetch('/api/jams', { cache: 'no-store' }); return r.ok ? r.json() : []; },
      pick: (id) => pickSource(id),
    });
  }
  // The mini player's ● and its ▾: recording from this phone
  // (phone-key.js), on the page's one recorder.
  phoneKey({ doc: document, layers: layersOf(document), floor: barTop(document), recorder: () => phoneRecorder(document, { toast: (m, k, ms) => onToast?.(m, k, ms) }) });
  /** pickSource is a pick from the source menu: the tape, the feed, or a take, which plays. */
  async function pickSource(id) {
    touches++;
    handoff.touch();
    if (id === 'tape' || id === 'feed') { setSource(id, { byHand: true }); return; }
    const name = id.startsWith('take:') ? id.slice(5) : null;
    if (!name) return;
    if (feed && feed.playing()) feed.pause();
    if (take && take.name === name) {
      bar.load(take.src);
      eject();
    } else if (!(await loadTakeByName(name))) {
      onToast?.('That take can’t play yet: it is still being saved', 'warn');
      return;
    }
    if (take && !take.src.playing()) take.src.play();
    bar.kick();
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
    loadTakeByName,
    audioFor,
    setFind: (fn) => { find = fn; if (fn) findWait?.(); },
    setOnNote: (fn) => { onNote = fn; },
    backToTape,
    setSource,
    onChange: (fn) => bar.onChange(fn),
    snapshot: () => bar.snapshot(),
  };
  const outputApi = {
    get player() { return stream; },
    setMode: (mode) => setMode?.(mode),
  };
  return {
    bar: api,
    audio: audioApi,
    output: outputApi,
    np: bar,
    setFind: api.setFind,
    setOnNote: api.setOnNote,
    setGo: (fn) => { go = fn; },
    // A tape made after the engine was (the first one a Pi gets, from the
    // Studio): the engine holds it from here on.
    setTapes: (list) => { if (list && list.loaded) mountTape(list.loaded); },
    get tape() { return tape; },
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
