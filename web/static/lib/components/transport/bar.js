// web/static/lib/components/transport/bar.js
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
// keys in the Studio, ● and its ▾ (Catch), on the tape's (tape-keys.js),
// which the Studio lends its hands (tapeKeys.lend). Its shape is css/bar.css's: #np says what it holds (data-source) and
// the stylesheet shows each key for the sources it is for (slots.js). The
// display says where it is, then two keys (display.js): the tempo over
// where it plays, which opens the Studio's tempo panel in the Studio with
// the tape and the Output sheet anywhere else (the calm Studio's decision
// 5: tempoOpens), and the source, whose menu is source-menu.js. With a take, Open ›
// and ✎ are at its end (take-keys.js), and ⟲ is Repeat. Across its top,
// the output strip while the tape plays on this phone, and in the display
// the clock-out lamp, drawn from the tape's snapshot and the engine's stream
// in every room (tape-status.js). It draws from the engine's snapshot() and
// presses its verbs: it never holds the source itself.

import { ReelWindow } from '../../objects/reel-window.js';
import { tokenCache, SCHEME } from '../../theme.js';
import { setText } from '../../text.js';
import { takeKeys } from './take-keys.js';
import { setIcon } from '../../ui/icons.js';
import { playerKeys } from '../../bar/player.js';
import { initFold, REDUCED } from './fold.js';
import { hereWord, deviceOf, partOf, slotOf, PHONE, COARSE } from '../../bar/slots.js';
import { sourceMenu } from './source-menu.js';
import { phoneKey } from './phone-key.js';
import { tapeKeys } from './tape-keys.js';
import { barPressNote } from './press-note.js';
import { sizeCanvas } from '../../ui/canvas.js';
import { outStrip, clockLamp } from './tape-status.js';
import { syncState, tempoLabel } from '../../bar/display.js';

/**
 * NowPlaying draws the engine (createEngine's, lib/models/engine.js) on the
 * bar at `root` (#np), whose parts it finds inside it and nowhere else:
 * whatever the engine holds, from its bar's snapshot(), as it changes and
 * every frame while it plays. It makes no source and no audio, and holds
 * none: a press is one of the engine's verbs (▶, ⟲, |◂, ↺ 5 s, a seek, ⏏).
 *
 * `models` are the Transport's (index.js): `bar`, the engine's (its
 * snapshot(), its verbs, and the tape it has made and this device's stream
 * of it, tapeSource and stream); `transport`, the engine's (a press on the
 * keyboard); `tape`, the page's tape model (the Studio's keys, the
 * clock-out lamp and the output strip are drawn from it); `takes`, the
 * page's (the source menu's last few); `recorder`, the page's phone
 * recorder, made at boot.
 *
 * `cx` is a component's (lib/components/mount.js), handed in by its caller
 * (the shell's boot, from its shell scope), and the one way it reaches past
 * its root: `on(target, type, fn)` (the window's J, the document's
 * visibility, a screen query's change), `media(query)` (the screen: a
 * phone, a finger, less motion, the scheme), `layers` (the stack its
 * menus open on; covered(), for J), `floor` (where its menus stop above
 * the bar), `visible()` (shown and the document visible: it draws a frame
 * then), `toast`, and `props`, the surface's: `layout` (barLayout,
 * layout.js), `room()` (the room shown), `player` (the phone's player,
 * playerSheet in player.js: the surface's sheet, which the bar's ▣,
 * grabber and window open, put away and drag) and `output()`, which opens
 * the Output sheet, where the tape plays. Without a player there is none;
 * without output() the tempo's key opens nothing away from the Studio, nor
 * does the foot. It never names the document,
 * the window or globalThis.
 */
export class NowPlaying {
  constructor(root, { bar, transport, tape = null, takes, recorder = null } = {}, cx) {
    const { layout, room = () => null, player = null, output = null } = cx.props || {};
    const onToast = cx.toast;
    const $ = partOf(root);
    this.$ = $;
    this.bar = bar;
    this.transport = transport;
    this.root = root;
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
    this.reels = new ReelWindow({ left: $('reel-l'), right: $('reel-r'), levels: $('levels') });
    this.scrub = $('scrub');
    // The strip's size and colours, kept rather than read in render: render
    // runs every frame while something plays, after the LCD's text is
    // written, and a measure or a style read then is a forced layout a frame.
    this.scrubSize = null;
    this.colors = tokenCache(() => this.scrub);
    cx.on(cx.media(SCHEME), 'change', () => { this.colors.clear(); this.kick(); });
    // The screen, asked through cx: a phone (the mini player, THIS PHONE),
    // a finger (THIS TABLET).
    const phoneScreen = cx.media(PHONE);
    // The phone's player, the surface's sheet (player.js): ▣, the grabber
    // and the window (the deck's slot, .np-deck) are its keys. Null
    // where the page has none.
    this.player = player;
    if (player && $('expand')) {
      playerKeys(this.root, {
        player, layout, phone: phoneScreen, on: cx.on,
        btn: $('expand'), grabber: $('grabber'), handles: [$('grabber'), slotOf(root, 'deck')],
      });
    }
    initFold(root, { layout, phone: phoneScreen, reduced: cx.media(REDUCED) });
    // With a take, Open › and ✎; with the feed, GRAB; ⟲ is Repeat for a
    // take (take-keys.js).
    this.keys = takeKeys({ root, onNote: () => bar.note(), onGrabFeed: () => bar.grabFeed() });
    // The tempo's panel is the Studio's, and the tape's keys are a room's
    // (data-room, for the stylesheet's studio and away keys): the surface
    // says which room is shown (room()), and kicks the bar as it switches.
    this.room = room;
    // Where a take or the feed plays: this device, by its kind, read once
    // and again when the screen changes shape, not every frame.
    const kind = () => { this.here = hereWord(deviceOf(cx.media)); };
    kind();
    for (const q of [COARSE, PHONE]) cx.on(cx.media(q), 'change', () => { kind(); this.kick(); });

    // ▶ (the source's own say first: the tape's sound waiting for a tap; a
    // stop by ▶ gives the Studio the tape back), ⟲, |◂ and ↺ 5 s: the
    // engine's verbs, each a touch.
    $('play').addEventListener('click', () => { bar.playPause(); this.kick(); });
    $('loop').addEventListener('click', () => bar.setLoop(!bar.snapshot(this.here).loop));
    $('start').addEventListener('click', () => bar.toStart());
    // ↺ 5 s, or J: back five seconds of what this device hears, playing or
    // not.
    const back5 = () => { bar.back5(); this.kick(); };
    $('back5').addEventListener('click', back5);
    // By the character, as the take page reads its keys: on the window,
    // through cx.
    cx.on(window, 'keydown', (e) => {
      if ((e.key !== 'j' && e.key !== 'J') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
      // Quiet under a modal sheet (Settings, Rename, a confirm), asked of
      // the page's stack, not read off the page; an inspector is on the
      // stack and not modal, so J still steps under one.
      if (cx.layers.covered()) return;
      if (this.root.hidden || !bar.sourceKind) return;
      back5();
    });
    // ⏏ hides itself: the focus goes to ▶, not to the page.
    $('eject').addEventListener('click', () => { onTouch(); bar.eject(); $('play').focus(); });

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
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) $('play').click(); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (e.key === 'Home') bar.seekFraction(0); else bar.toEnd(); this.kick(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      bar.step(e.key === 'ArrowRight' ? 1 : -1);
      this.kick();
    });
    this.sized = new ResizeObserver(([e]) => {
      const b = e.borderBoxSize && e.borderBoxSize[0];
      this.scrubSize = b ? { width: b.inlineSize, height: b.blockSize } : { width: e.contentRect.width, height: e.contentRect.height };
      this.render();
    });
    this.sized.observe(sc);
    // A hidden page is drawn again as it comes back.
    cx.on(document, 'visibilitychange', () => this.kick());

    // The display's source: the tape, the live feed, the last few takes, the
    // shelf (source-menu.js), each a pick of the engine's.
    const sourceKey = $('source');
    if (sourceKey && $('source-menu')) {
      sourceMenu({
        button: sourceKey, panel: $('source-menu'), layers: cx.layers,
        now: () => ({ kind: bar.sourceKind, takeName: bar.takeName, tape: bar.tapeSource && bar.tapeSource.ready ? bar.tapeSource.title : (bar.tapeSource ? 'the tape' : null) }),
        list: () => takes.get(),
        pick: (id) => bar.pickSource(id),
      });
    }
    // The mini player's ● and its ▾: recording from this phone
    // (phone-key.js), on the page's one recorder.
    // The recorder is the page's, made at boot (lib/phone/recorder.js).
    const whenRecorder = (fn) => { if (recorder) fn(recorder); };
    const phone = phoneKey({ root, layers: cx.layers, floor: cx.floor, playerUp: () => !!this.player?.isOpen, recorder: () => recorder, whenRecorder });
    // The tape's keys in the Studio, ● and its ▾, with Catch on it
    // (tape-keys.js), on the page's tape (`tape`, the tape model): the
    // Studio lends them its hands through its ctx (ctx.tapeKeys). On a
    // phone ●'s ▾ holds this phone's rows too, and a hold on ● offers them.
    this.tapeKeys = tapeKeys({ root, tape, toast: (m, k, o) => onToast?.(m, k, o), phoneKeys: phone, whenRecorder, phoneScreen });
    // The display's tempo key is the tempo and where it plays: a press on
    // it, a finger's or the keyboard's (a click; ↓ or ↑), opens what
    // tempoOpens says now. Its one listener is the bar's, so the Studio's
    // panel hears no press in another room.
    const pressTempo = (e) => {
      const opens = this.tempoOpens(bar.sourceKind);
      if (opens?.panel) { opens.panel.press(e); return; }
      if (!opens) return;
      if (e.type === 'keydown') {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
      }
      opens.output();
    };
    $('tempo').addEventListener('click', pressTempo);
    $('tempo').addEventListener('keydown', pressTempo);
    // Where it plays at the foot of the phone's player opens the surface's
    // Output sheet.
    $('out-foot')?.addEventListener('click', () => this.output?.());
    // The output strip's tap, for this phone's sound held back.
    $('out-strip-resume')?.addEventListener('click', () => bar.stream?.resume());
    // The lamp and the strip, from the tape's answers and the transport's
    // changes, in every room and whatever the bar holds. The engine makes
    // its transport with itself, before any tape is loaded, so this always
    // subscribes; the stream's state reaches it as the engine's tape source
    // says it changed (tapeStream's onState: tape.changed()).
    // Each subscription to a model is kept, and taken off by destroy().
    this.offs = [tape?.onChange(() => this.paintTape()), transport.onChange(() => this.paintTape())];

    // What the engine holds, drawn as it changes and every frame it plays;
    // a hidden page is drawn again as it comes back (visibilitychange).
    this.offs.push(bar.onChange(() => {
      const s = bar.snapshot(this.here);
      if (s.id !== this.held) this.load(s);
      if (bar.tapeSource && !this.tapeMounted) this.mountTape();
      const ej = $('eject');
      if (ej.hidden !== !s.canEject) ej.hidden = !s.canEject;
      if (cx.visible()) { this.render(); this.paintTape(); }
    }));
    this.load(bar.snapshot(this.here));
    if (bar.tapeSource) this.mountTape();
    $('eject').hidden = !bar.snapshot(this.here).canEject;
    this.paintTape();
  }

  /**
   * mountTape wires what the tape brings, once the engine has one: a press
   * on the keyboard, over the display for its second (press-note.js); and
   * the tempo's key opens where it plays away from the Studio
   * (tempoOpens, paintDisplay).
   */
  mountTape() {
    this.tapeMounted = true;
    this.offs.push(this.transport.onPress((p) => { this.note ??= barPressNote(this.root); this.note.show(p); }));
    this.kick();
  }

  /**
   * destroy takes off what the bar hears of its models, its strip's size
   * and the keyboard's note's timer: the Transport unmounted (lib/components/transport/index.js). What
   * it hears through cx is cx's to take off; its keys go with its root.
   */
  destroy() {
    for (const off of this.offs.splice(0)) off?.();
    this.sized.disconnect();
    // A press still showing: its hide timer goes too.
    this.note?.clear();
  }

  /**
   * load draws the source in snapshot `s`, the engine's now, as the bar
   * comes to hold it; nothing in it empties and hides the bar.
   */
  load(s) {
    const $ = this.$;
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
    $('play').dataset.tip = s.kind === 'tape' ? 'tape-play' : 'play';
    $('start').dataset.tip = s.kind === 'tape' ? 'to-start' : 'take-to-start';
  }

  /**
   * paintTape draws the clock-out lamp, SYNC and the output strip from the
   * models, the same in every room: the tape's snapshot() (who follows its
   * clock, how it lines up, where it plays, whether it plays), the engine's
   * stream (this phone's sound), and a locate the Studio sent and this
   * phone has not heard yet (its hands, through tapeKeys).
   */
  paintTape() {
    const $ = this.$;
    const { tape: t = null, live = null } = this.tape?.snapshot?.() || {};
    // SYNC: how playback and recording line up, while the tape plays in
    // the jam room (a key for the Studio: data-for). Playing on a phone
    // there is nothing to line up, nor while the tape is stopped: it goes
    // out, rather than show an alarm in a quiet room.
    const sync = $('sync');
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
    const lamp = $('clock-out');
    if (lamp) {
      const c = clockLamp(live && live.clock, t);
      if (lamp.hidden !== c.hidden) lamp.hidden = c.hidden;
      if (!c.hidden) {
        setText(lamp, c.text);
        lamp.classList.toggle('none', c.none);
      }
    }
    const strip = $('out-strip');
    if (!strip) return;
    const o = outStrip({ stream: this.bar.stream, live, tape: t, ghost: this.tapeKeys?.ghost?.() || null, now: performance.now() });
    if (strip.hidden !== o.hidden) strip.hidden = o.hidden;
    const resume = $('out-strip-resume');
    const noResume = o.hidden || !o.resume;
    if (resume && resume.hidden !== noResume) resume.hidden = noResume;
    if (o.hidden) return;
    setAttr($('out-strip-led'), 'class', `out-led ${o.led}`);
    setText($('out-strip-text'), o.text);
    setText($('out-strip-right'), o.right);
  }

  // kick draws on the next frame, and every frame while the source plays.
  // The room is said at once: the shell kicks the bar in the same step as
  // it gives the room its body classes, and the keys switch with them.
  kick() {
    this.paintRoom();
    this.bar.kick();
  }

  // paintRoom says on the root which room the bar is in (data-room), for
  // the stylesheet's studio and away keys.
  paintRoom() {
    const room = this.room();
    if (room) setAttr(this.root, 'data-room', room);
    else this.root.removeAttribute('data-room');
  }

  render() {
    const $ = this.$;
    const { bar } = this;
    const s = bar.snapshot(this.here);
    if (!s.kind) return;
    this.paintRoom();
    const { lcd, playing } = s;
    // Playing on the Pi, but not yet heard here: ▶ is the tap it waits for.
    const waiting = s.waiting;
    setText($('position'), lcd.big);
    // A note (tap ▶ to play here, a mixdown's progress) in the time's place.
    const time = $('time');
    setText(time, lcd.note || lcd.small);
    time.classList.toggle('note', !!lcd.note);
    setText($('unit'), lcd.unit);
    setAttr($('status'), 'data-state', lcd.status);
    this.paintDisplay(s);
    // ▶ and its pause: ■ for the tape, as on its page; ❚❚ for a take. The
    // key's .playing says it to the stylesheet and the checks, whatever it draws.
    const play = $('play');
    const shown = playing && !waiting;
    setIcon(play, shown ? (s.kind === 'tape' ? 'stop' : 'pause') : 'play');
    setAttr(play, 'aria-label', waiting ? 'Play here' : shown ? (s.kind === 'tape' ? 'Stop' : 'Pause') : 'Play');
    play.classList.toggle('playing', shown);
    play.disabled = !playing && !waiting && !s.canPlay;
    this.keys?.paint(s);
    setAttr($('loop'), 'aria-pressed', String(s.loop));
    $('loop').disabled = !s.canLoop;
    $('start').disabled = !s.canStart;
    setAttr($('start'), 'aria-label', s.startLabel);
    // What's in the bar opens on its own page: a take's, or the tape's Studio.
    const open = $('open');
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
   * tempoOpens is what a press on the display's tempo key opens now, with
   * the bar holding `kind` (the calm Studio's decision 5): in the Studio
   * with the tape, the Studio's tempo panel, lent with its hands ({panel}:
   * tapeKeys.panel()); anywhere else, or with no panel lent, the Output
   * sheet ({output}), once the engine has a tape to send (the same test the
   * shell's openOutput makes: lib/tape/out-switch.js outputSheet); else
   * null, and the key is off.
   */
  tempoOpens(kind) {
    const panel = kind === 'tape' && this.room() === 'studio' ? this.tapeKeys?.panel() : null;
    if (panel) return { panel };
    return this.bar.tapeSource && this.output ? { output: this.output } : null;
  }

  /**
   * paintDisplay writes the display's two keys for snapshot `s`: the
   * tempo's, its tempo over where it plays (the tempo alone, and its foot
   * where it plays, in the phone's player pulled up), on while a press on
   * it opens something (tempoOpens), and the source; and the foot.
   */
  paintDisplay(s) {
    const $ = this.$;
    const d = s.display;
    setText($('tempo-short'), d.tempo.short);
    setText($('tempo-long'), d.tempo.long);
    setText($('tempo-alone'), d.tempo.alone);
    setText($('tempo-leg'), d.tempo.leg);
    setText($('source-short'), d.source.short);
    setText($('source-long'), d.source.long);
    const tempo = $('tempo');
    const opens = this.tempoOpens(s.kind);
    if (tempo.disabled !== !opens) tempo.disabled = !opens;
    setAttr(tempo, 'aria-label', tempoLabel(d, opens ? (opens.panel ? 'tempo' : 'output') : null));
    setAttr($('source'), 'aria-label', d.said.source);
    const foot = $('out-foot');
    if (!foot) return;
    setText($('out-foot-val'), d.out);
    const sends = !!this.bar.tapeSource && !!this.output;
    if (foot.disabled !== !sends) foot.disabled = !sends;
    setAttr(foot, 'aria-label', d.said.out);
  }
}

function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
function secs(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
