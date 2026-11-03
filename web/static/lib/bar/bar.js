// web/static/lib/bar/bar.js
// The bar, in every room (the take page drives its own): the engine's
// (lib/models/engine.js) source -- the tape, the feed or a take
// (lib/models/tape-source.js, feed-source.js, take-source.js) -- drawn in the
// reel window and its display, played from its keys, and scrubbed on its
// strip. A tap on the strip moves the playhead there; a drag scrubs it; with
// the strip focused, ← → step and Space plays. The engine decides what the
// bar holds and owns its audio; NowPlaying draws it and hands each press to
// it (⏏ is its eject). The source menu and ● on the phone's mini player are
// wired here too, on the engine's verbs (the output sheet, the phone's
// player and the recorder are the surface's, handed in), and the tape's
// keys in the Studio, ●, Catch and the click, on the tape's (tape-keys.js),
// which the Studio lends its hands (tapeKeys.lend). Its shape is css/bar.css's: #np says what it holds (data-source) and
// the stylesheet shows each key for the sources it is for (slots.js). The
// display says where it is, then the tempo, the source and where it plays
// (display.js), each a key: the tempo's menu is the Studio's, the source's
// is source-menu.js, where it plays is the output sheet. With a take, Open ›
// and ✎ are at its end (take-keys.js), and ⟲ is Repeat. Across its top,
// the output strip while the tape plays on this phone, and in the display
// the clock-out lamp, drawn from the tape's snapshot and the engine's stream
// in every room (tape-status.js). It draws from the engine's snapshot() and
// presses its verbs: it never holds the source itself.

import { ReelWindow } from '../objects/reel-window.js';
import { tokenCache, onSchemeChange } from '../theme.js';
import { setText } from '../text.js';
import { takeKeys } from './take-keys.js';
import { setIcon } from '../ui/icons.js';
import { playerKeys, PHONE } from './player.js';
import { initFold } from './fold.js';
import { hereWord, deviceOf } from './slots.js';
import { barLayout } from './layout.js';
import { sourceMenu } from './source-menu.js';
import { phoneKey } from './phone-key.js';
import { tapeKeys } from './tape-keys.js';
import { barPressNote } from './press-note.js';
import { layersOf } from '../ui/layers.js';
import { barTop } from '../ui/menu.js';
import { sizeCanvas } from '../ui/canvas.js';
import { outStrip, clockLamp } from './tape-status.js';
import { syncState } from './display.js';

const $ = (id) => document.getElementById(id);

/**
 * NowPlaying draws `engine` (createEngine's, lib/models/engine.js) on #np:
 * whatever it holds, from its bar's snapshot(), as it changes and every
 * frame while it plays. It makes no source and no audio, and holds none: a
 * press is one of the engine's verbs (▶, ⟲, |◂, ↺ 5 s, a seek, ⏏). `tape` is
 * the page's tape model: the Studio's keys, the clock-out lamp and the
 * output strip are drawn from it.
 *
 * What is the page's, the surface hands it (step 5c): `layout` (barLayout,
 * layout.js), `player` (the phone's player, playerSheet in player.js: the
 * surface's sheet, which the bar's ▣, grabber and window open, put away and
 * drag), `recorder` (the page's phone recorder, made at boot), and
 * `output()`, which opens the Output sheet, where the tape plays. Without a
 * player there is none; without output() where it plays is no key.
 */
export class NowPlaying {
  constructor({ engine, onToast, layout = barLayout(document), room = () => null, tape = null, player = null, recorder = null, output = null } = {}) {
    this.engine = engine;
    const bar = engine.bar;
    this.root = $('np');
    // The source drawn: the snapshot's id, which moves as the bar holds another.
    this.held = null;
    this.tape = tape;
    this.layout = layout;
    // Where it plays opens the output sheet (the surface's), once there's a
    // tape to send.
    this.output = output;
    // What the tape brings, wired once the engine has one (mountTape).
    this.tapeMounted = false;
    const onTouch = () => bar.touch();
    this.reels = new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
    this.scrub = $('np-scrub');
    // The strip's size and colours, kept rather than read in render: render
    // runs every frame while something plays, after the LCD's text is
    // written, and a measure or a style read then is a forced layout a frame.
    this.scrubSize = null;
    this.colors = tokenCache(() => this.scrub);
    onSchemeChange(() => { this.colors.clear(); this.kick(); });
    // The phone's player, the surface's sheet (player.js): ▣, the grabber
    // and the window are its keys. Null where the page has none.
    this.player = player;
    if (player && $('np-expand')) {
      playerKeys(this.root, {
        player, layout, phone: window.matchMedia(PHONE),
        btn: $('np-expand'), grabber: $('np-grabber'), handles: [$('np-grabber'), this.root.querySelector('.np-window')],
      });
    }
    initFold(document, { layout });
    // With a take, Open › and ✎; with the feed, GRAB; ⟲ is Repeat for a
    // take (take-keys.js).
    this.keys = takeKeys({ doc: document, root: this.root, onNote: () => bar.note(), onGrabFeed: () => bar.grabFeed() });
    // The tempo's menu is the Studio's, and the tape's keys are a room's
    // (data-room, for the stylesheet's studio and away keys): the surface
    // says which room is shown (room()), and kicks the bar as it switches.
    this.room = room;
    // Where a take or the feed plays: this device, by its kind, read once
    // and again when the screen changes shape, not every frame.
    const kind = () => { this.here = hereWord(deviceOf(window)); };
    kind();
    window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', () => { kind(); this.kick(); });
    window.matchMedia?.('(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)')?.addEventListener?.('change', () => { kind(); this.kick(); });

    // ▶ (the source's own say first: the tape's sound waiting for a tap; a
    // stop by ▶ gives the Studio the tape back), ⟲, |◂ and ↺ 5 s: the
    // engine's verbs, each a touch.
    $('np-play').addEventListener('click', () => { bar.playPause(); this.kick(); });
    $('np-loop').addEventListener('click', () => bar.setLoop(!bar.snapshot(this.here).loop));
    $('np-start').addEventListener('click', () => bar.toStart());
    // ↺ 5 s, or J: back five seconds of what this device hears, playing or
    // not.
    const back5 = () => { bar.back5(); this.kick(); };
    $('np-back5').addEventListener('click', back5);
    // By the character, as the take page reads its keys.
    addEventListener('keydown', (e) => {
      if ((e.key !== 'j' && e.key !== 'J') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
      // Quiet under a modal sheet (Settings, Rename, a confirm), asked of
      // the page's stack, not read off the page; an inspector is on the
      // stack and not modal, so J still steps under one.
      if (layersOf(document).covered()) return;
      if (this.root.hidden || !bar.sourceKind) return;
      back5();
    });
    // ⏏ hides itself: the focus goes to ▶, not to the page.
    $('np-eject').addEventListener('click', () => { onTouch(); bar.eject(); $('np-play').focus(); });

    // The strip: a tap or a drag moves the playhead. The tape's Pi hears a
    // drag at most every 150 ms, and where it ends.
    const sc = this.scrub;
    sc.style.touchAction = 'none';
    let down = null, sent = 0;
    const at = (e) => { const r = sc.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const seekTo = (f, final) => {
      const kind = bar.sourceKind;
      if (!kind) return;
      const now = performance.now();
      if (!final && kind === 'tape' && now - sent < 150) return;
      sent = now;
      bar.seekFraction(f);
      this.kick();
    };
    sc.addEventListener('pointerdown', (e) => {
      if (down || e.button > 0) return;
      onTouch();
      down = e.pointerId;
      sc.setPointerCapture?.(e.pointerId);
      seekTo(at(e), false);
    });
    sc.addEventListener('pointermove', (e) => { if (down === e.pointerId) seekTo(at(e), false); });
    const up = (e) => { if (down !== e.pointerId) return; down = null; seekTo(at(e), true); };
    sc.addEventListener('pointerup', up);
    sc.addEventListener('pointercancel', () => { down = null; });
    sc.addEventListener('keydown', (e) => {
      if (!bar.sourceKind || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Home' || e.key === 'End' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') onTouch();
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) $('np-play').click(); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (e.key === 'Home') bar.seekFraction(0); else bar.toEnd(); this.kick(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      bar.step(e.key === 'ArrowRight' ? 1 : -1);
      this.kick();
    });
    new ResizeObserver(([e]) => {
      const b = e.borderBoxSize && e.borderBoxSize[0];
      this.scrubSize = b ? { width: b.inlineSize, height: b.blockSize } : { width: e.contentRect.width, height: e.contentRect.height };
      this.render();
    }).observe(sc);
    document.addEventListener('visibilitychange', () => this.kick());

    // The display's source: the tape, the live feed, the last few takes, the
    // shelf (source-menu.js), each a pick of the engine's.
    const sourceKey = $('np-source');
    if (sourceKey && $('np-source-menu')) {
      sourceMenu({
        doc: document, button: sourceKey, panel: $('np-source-menu'), layers: layersOf(document),
        now: () => ({ kind: bar.sourceKind, takeName: bar.takeName, tape: engine.tape && engine.tape.ready ? engine.tape.title : (engine.tape ? 'the tape' : null) }),
        list: () => engine.takes.get(),
        pick: (id) => bar.pickSource(id),
      });
    }
    // The mini player's ● and its ▾: recording from this phone
    // (phone-key.js), on the page's one recorder.
    // The recorder is the page's, made at boot (lib/phone/recorder.js).
    const whenRecorder = recorder ? (fn) => fn(recorder) : undefined;
    const phone = phoneKey({ doc: document, layers: layersOf(document), floor: barTop(document), playerUp: () => !!this.player?.isOpen, recorder: () => recorder, whenRecorder });
    // The tape's keys in the Studio, ●, Catch and its ▾ and the click
    // (tape-keys.js), on the page's tape (`tape`, the tape model): the
    // Studio lends them its hands through its ctx (ctx.tapeKeys). A hold
    // on ● on a phone offers this phone's ▾.
    this.tapeKeys = tapeKeys({ doc: document, tape, toast: (m, k, o) => onToast?.(m, k, o), offer: () => phone?.offer(), whenRecorder });
    // Where it plays (OUT on the display, and the player's foot) opens the
    // surface's Output sheet.
    for (const k of [$('np-output'), $('np-out-foot')]) k?.addEventListener('click', () => this.output?.());
    // The output strip's tap, for this phone's sound held back.
    $('np-out-strip-resume')?.addEventListener('click', () => engine.stream?.resume());
    // The lamp and the strip, from the tape's answers and the transport's
    // changes, in every room and whatever the bar holds. The engine makes
    // its transport with itself, before any tape is loaded, so this always
    // subscribes; the stream's state reaches it as the engine's tape source
    // says it changed (tapeStream's onState: tape.changed()).
    tape?.onChange(() => this.paintTape());
    engine.transport.onChange(() => this.paintTape());

    // What the engine holds, drawn as it changes and every frame it plays;
    // a hidden page is drawn again as it comes back (visibilitychange).
    engine.bar.onChange(() => {
      const s = bar.snapshot(this.here);
      if (s.id !== this.held) this.load(s);
      if (engine.tape && !this.tapeMounted) this.mountTape();
      const ej = $('np-eject');
      if (ej.hidden !== !s.canEject) ej.hidden = !s.canEject;
      if (!document.hidden) { this.render(); this.paintTape(); }
    });
    this.load(bar.snapshot(this.here));
    if (engine.tape) this.mountTape();
    $('np-eject').hidden = !bar.snapshot(this.here).canEject;
    this.paintTape();
  }

  /**
   * mountTape wires what the tape brings, once the engine has one: a press
   * on the keyboard, over the display for its second (press-note.js); and
   * where it plays becomes a key (paintDisplay).
   */
  mountTape() {
    this.tapeMounted = true;
    let note = null;
    this.engine.transport.onPress((p) => { note ??= barPressNote(document); note.show(p); });
    this.kick();
  }

  /**
   * load draws the source in snapshot `s`, the engine's now, as the bar
   * comes to hold it; nothing in it empties and hides the bar.
   */
  load(s) {
    if (s.id === this.held) return;
    this.held = s.id;
    this.colors.clear();
    this.root.hidden = !s.kind;
    // What it holds -- feed, tape or take -- for the CSS and the checks that look.
    if (s.kind) this.root.setAttribute('data-source', s.kind);
    else this.root.removeAttribute('data-source');
    if (!s.kind) { this.keys?.paint(null); return; }
    if (s.levels) this.reels.setLevels(s.levels.colors, s.levels.at);
    else this.reels.setLevels([], () => []);
    // The keys say what this source does.
    $('np-play').dataset.tip = s.kind === 'tape' ? 'tape-play' : 'play';
    $('np-start').dataset.tip = s.kind === 'tape' ? 'to-start' : 'take-to-start';
  }

  /**
   * paintTape draws the clock-out lamp, SYNC and the output strip from the
   * models, the same in every room: the tape's snapshot() (who follows its
   * clock, how it lines up, where it plays, whether it plays), the engine's
   * stream (this phone's sound), and a locate the Studio sent and this
   * phone has not heard yet (its hands, through tapeKeys).
   */
  paintTape() {
    const { tape: t = null, live = null } = this.tape?.snapshot?.() || {};
    // SYNC: how playback and recording line up, while the tape plays in
    // the jam room (a key for the Studio: data-for). Playing on a phone
    // there is nothing to line up, nor while the tape is stopped: it goes
    // out, rather than show an alarm in a quiet room.
    const sync = $('np-sync');
    if (sync) {
      const lock = live ? live.aligned : 'none';
      const idle = lock === 'none' && !(live && (live.playing || live.count_in > 0));
      const said = syncState(lock, { phoneOut: !!(live && live.output_mode === 'phone'), idle });
      const off = said.state === 'off';
      if (sync.hidden !== off) sync.hidden = off;
      setAttr(sync, 'data-state', said.state);
      setAttr(sync, 'title', said.words);
      setAttr(sync, 'aria-label', `Sync: ${said.words}`);
    }
    const lamp = $('np-clock-out');
    if (lamp) {
      const c = clockLamp(live && live.clock, t);
      if (lamp.hidden !== c.hidden) lamp.hidden = c.hidden;
      if (!c.hidden) {
        setText(lamp, c.text);
        lamp.classList.toggle('none', c.none);
      }
    }
    const strip = $('np-out-strip');
    if (!strip) return;
    const o = outStrip({ stream: this.engine.stream, live, tape: t, ghost: this.tapeKeys?.ghost?.() || null, now: performance.now() });
    if (strip.hidden !== o.hidden) strip.hidden = o.hidden;
    const resume = $('np-out-strip-resume');
    const noResume = o.hidden || !o.resume;
    if (resume && resume.hidden !== noResume) resume.hidden = noResume;
    if (o.hidden) return;
    setAttr($('np-out-strip-led'), 'class', `out-led ${o.led}`);
    setText($('np-out-strip-text'), o.text);
    setText($('np-out-strip-right'), o.right);
  }

  // kick draws on the next frame, and every frame while the source plays.
  // The room is said at once: the shell kicks the bar in the same step as
  // it gives the room its body classes, and the keys switch with them.
  kick() {
    this.paintRoom();
    this.engine.bar.kick();
  }

  // paintRoom says on the root which room the bar is in (data-room), for
  // the stylesheet's studio and away keys.
  paintRoom() {
    const room = this.room();
    if (room) setAttr(this.root, 'data-room', room);
    else this.root.removeAttribute('data-room');
  }

  render() {
    const bar = this.engine.bar;
    const s = bar.snapshot(this.here);
    if (!s.kind) return;
    this.paintRoom();
    const { lcd, playing } = s;
    // Playing on the Pi, but not yet heard here: ▶ is the tap it waits for.
    const waiting = s.waiting;
    setText($('np-position'), lcd.big);
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
    play.disabled = !playing && !waiting && !s.canPlay;
    this.keys?.paint(s);
    setAttr($('np-loop'), 'aria-pressed', String(s.loop));
    $('np-loop').disabled = !s.canLoop;
    $('np-start').disabled = !s.canStart;
    setAttr($('np-start'), 'aria-label', s.startLabel);
    // What's in the bar opens on its own page: a take's, or the tape's Studio.
    const open = $('np-open');
    setAttr(open, 'href', s.href);
    setAttr(open, 'aria-label', s.kind === 'tape' ? `Open ${s.title} in the Studio` : `Open ${s.title}`);
    // The strip, and what a screen reader hears of it.
    // Measured once, before its observer has said (a bar just made).
    const r = this.scrubSize ||= (({ width, height }) => ({ width, height }))(this.scrub.getBoundingClientRect());
    const drawn = sizeCanvas(this.scrub, r.width, r.height);
    if (drawn) bar.paintStrip(drawn.ctx, r.width, r.height, (n, d) => this.colors.get(n, d), drawn.dpr);
    const tenth = s.sampleRate / 10;
    const p = Math.round(s.frame / tenth) * tenth;
    setAttr(this.scrub, 'aria-valuemax', String(Math.round(s.length)));
    setAttr(this.scrub, 'aria-valuenow', String(Math.round(p)));
    setAttr(this.scrub, 'aria-valuetext', `${lcd.unit === 'BAR' ? `bar ${lcd.big}, ` : ''}${secs(p / s.sampleRate)}`);
    if (s.levels) this.reels.setLevels(s.levels.colors, s.levels.at);
    else this.reels.setLevels([], () => []);
    this.reels.poll({ heard: s.frame, playing, length: s.length, sampleRate: s.sampleRate });
  }

  /**
   * paintDisplay writes the display's three keys for snapshot `s`: its
   * tempo (a key in the Studio, with the tape, where the tempo's menu is),
   * the source, and where it plays (a key once there is a tape to send).
   */
  paintDisplay(s) {
    const d = s.display;
    setText($('np-tempo-short'), d.tempo.short);
    setText($('np-tempo-long'), d.tempo.long);
    setText($('np-source-short'), d.source.short);
    setText($('np-source-long'), d.source.long);
    setText($('np-output-val'), d.out);
    const foot = $('np-out-foot');
    if (foot) setText($('np-out-foot-val'), d.out);
    const tempo = $('np-tempo');
    const tempoMenu = s.kind === 'tape' && this.room() === 'studio';
    if (tempo.disabled !== !tempoMenu) tempo.disabled = !tempoMenu;
    setAttr(tempo, 'aria-label', tempoMenu ? `${d.said.tempo}: change it` : d.said.tempo);
    setAttr($('np-source'), 'aria-label', d.said.source);
    const out = $('np-output');
    // Once the engine has a tape to send: the same test the shell's
    // openOutput makes (lib/tape/out-switch.js outputSheet).
    const sends = !!this.engine.tape && !!this.output;
    if (out.disabled !== !sends) out.disabled = !sends;
    setAttr(out, 'aria-label', d.said.out);
    if (foot) {
      if (foot.disabled !== !sends) foot.disabled = !sends;
      setAttr(foot, 'aria-label', d.said.out);
    }
  }
}

function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
function secs(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
