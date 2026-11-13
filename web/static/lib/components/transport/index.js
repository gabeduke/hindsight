// web/static/lib/components/transport/index.js
// The Transport (docs/architecture/bar.md; components.md, row 1): the bar,
// the same object in every room of the shell, as a component on the
// contract (lib/components/mount.js). The shell's boot mounts it on #np,
// in its dock (lib/shell/boot.js); NowPlaying (bar.js) is its mount, and
// the modules beside it are its keys: the fold (fold.js), the mini player's
// ● (phone-key.js), the source's menu (source-menu.js), the Studio's ●
// and its ▾, with Catch on it (tape-keys.js), a take's and the feed's keys
// (take-keys.js), the keyboard's press over the display (press-note.js)
// and the lamp's and the strip's words (tape-status.js). What it shares
// with Open stays where both import it (lib/bar/: slots.js, player.js,
// display.js, carry.js, press-light.js).
//
// Its template is the bar's markup, and a new key goes in it, in its slot
// (AGENTS.md; decision 0047): five zones in a row -- the deck (the reels
// and the display), the transport, the verb, the modes and the end -- and
// the strip under them, then the foot (where it plays, at the foot of the
// phone's player pulled up) and the bar's three menus, which open in the
// top layer (lib/ui/menu.js, popover). Each zone is a named slot
// (data-slot, slots.js); each key says in data-for which sources (and
// data-mini which of the phone's mini player) it shows for: tape, studio
// (the tape, in the Studio), away (the tape, anywhere else), take, feed.
// Nothing is placed by the order a script added it in.
//
// A part is named by data-part, and fill() gives it its id through cx.id
// (#np-play on the root #np): the template writes no id of its own.
//
//   the grabber        on its top edge (fold.js): a tap folds the bar or
//                      unfolds it, a drag folds it or unfolds it; on a
//                      phone, with the player up, it puts the player away
//   the output strip   across its top, while the tape plays on this phone
//   the deck           ▣ (the phone's player, player.js), the reels and the
//                      display: where it is (SYNC, how the tape lines up
//                      while it plays in the jam room; the clock-out lamp),
//                      then the tempo, the source and where it plays, each
//                      a key that opens its menu; the keyboard's press over
//                      it (press-note.js), a live region, shown by data-kb
//                      and never hidden
//   the transport      |◀ ▶ and ●, Record beside Play, with its ▾ in the
//                      Studio, Catch's (tape-keys.js, splitKey); the
//                      phone's own ● ▾ in the mini player everywhere else
//                      (phone-key.js); with a take or the feed, or the
//                      tape away from the Studio, ↺ 5 s in ●'s place
//   the verb           the feed's GRAB
//   the modes          ⟲ (Loop for the tape, Repeat for a take); the
//                      metronome is the Studio's, in the tempo's panel
//   the end            laid out first so nothing pushes it off: ⏏ back to
//                      the tape, Open › and ✎
//   the strip          the take or the feed, or the tape away from the
//                      Studio, to scrub; in the Studio its overview at the
//                      strip's start, the Studio's markup, put there
//                      through its slot (ctx.barSlot, place 'strip')
//   the foot           where it plays, under the thumb in the phone's
//                      player pulled up (the display's OUT, which the
//                      player hides)
//   the menus          ●'s (what to catch, and on a phone this phone's rows
//                      after them), the display's source (what plays) and
//                      the mini player's ▾ (record from this phone)

import { NowPlaying } from './bar.js';
import { icon } from '../../ui/icons.js';
import { dialogKey } from '../../ui/menu.js';

/**
 * TAPE_KEYS are what the Studio presses of the bar's ● and its ▾, Catch's
 * (tape-keys.js), through the relay the surface hands the Transport as
 * props.tapeKeys and the Studio as ctx.tapeKeys (lib/components/relay.js).
 */
export const TAPE_KEYS = Object.freeze(['lend', 'draw', 'press', 'catch', 'closeMenu', 'focusPlay', 'tempo']);

/** TEMPLATE is the bar's markup: its parts by data-part, its icons the sprite's. */
export const TEMPLATE = `<button data-part="grabber" class="np-grabber" type="button" aria-expanded="true" aria-label="Fold the bar" data-tip="np-grabber"><span class="np-lip" aria-hidden="true"><span class="np-pill"></span></span></button>
<div data-part="out-strip" class="out-strip" role="status" hidden>
  <span data-part="out-strip-led" class="out-led"></span>
  <span data-part="out-strip-text">Ready on this phone</span>
  <span data-part="out-strip-right" class="mono"></span>
  <button data-part="out-strip-resume" class="chip" type="button" aria-label="Tap to play here on this phone" hidden>Tap to play here</button>
</div>
<div class="np-row np-row-1">
  <div class="np-zones">
    <div class="np-deck" data-slot="deck">
      <button data-part="expand" class="np-expand" type="button" aria-expanded="false" aria-label="Open the player" data-tip="np-expand" data-tip-pass></button>
      <svg data-part="reel-l" class="np-reel" viewBox="0 0 160 160" aria-hidden="true"></svg>
      <div class="np-lcd" role="group" aria-label="The display">
        <div class="np-lcd-pos">
          <div class="np-lcd-top">
            <span data-part="status" class="np-status" data-state="stop" aria-hidden="true"></span>
            <span data-part="unit" class="np-unit" aria-hidden="true">BAR</span>
            <span data-part="position" class="np-pos"></span>
            <span data-part="levels" class="np-levels" aria-hidden="true"></span>
          </div>
          <div class="np-lcd-sub">
            <span data-part="time" class="np-time"></span>
            <span data-part="sync" class="np-sync" data-for="studio" data-state="off" data-tip="np-sync" hidden>SYNC</span>
            <span data-part="clock-out" class="np-clock" hidden data-tip="tape-clock"></span>
          </div>
        </div>
        <button data-part="tempo" class="np-lcd-key np-tempo" type="button" aria-label="Tempo" data-tip="np-tempo"><span class="np-lcd-val"><span data-part="tempo-short" class="np-short">–</span><span data-part="tempo-long" class="np-long">–</span></span><span class="np-lcd-leg"><span class="np-short">BPM</span><span class="np-long">TEMPO</span>${icon('down', { size: 8, cls: 'np-lcd-chev' })}</span></button>
        <button data-part="source" class="np-lcd-key np-source" type="button" aria-label="Source" data-tip="np-source"><span class="np-lcd-val"><span data-part="source-short" class="np-short">TAPE</span><span data-part="source-long" class="np-long">TAPE</span></span><span class="np-lcd-leg">SOURCE${icon('down', { size: 8, cls: 'np-lcd-chev' })}</span></button>
        <button data-part="output" class="np-lcd-key np-output" type="button" aria-label="Where it plays" data-tip="np-output"><span class="np-lcd-val"><span data-part="output-val">JAM ROOM</span></span><span class="np-lcd-leg">OUT${icon('down', { size: 8, cls: 'np-lcd-chev' })}</span></button>
        <div data-part="press" class="np-press" role="status" aria-atomic="true">${icon('keyboard', { size: 18, cls: 'np-press-mark' })}<span class="sr-only">The keyboard: </span><span data-part="press-words" class="np-press-words"></span></div>
      </div>
      <svg data-part="reel-r" class="np-reel" viewBox="0 0 160 160" aria-hidden="true"></svg>
    </div>
    <div class="np-zone np-transport" data-slot="transport" role="group" aria-label="Transport">
      <button data-part="start" class="icon-btn np-start" type="button" aria-label="Back to the loop’s start" data-tip="to-start" data-for="tape take feed" data-mini="tape take feed">${icon('prev')}</button>
      <button data-part="play" class="icon-btn tb-play" type="button" aria-label="Play" aria-keyshortcuts="Space" data-gives-enter data-tip="tape-play" data-for="tape take feed" data-mini="tape take feed">${icon('play', { size: 22 })}</button>
      <button data-part="rec" class="icon-btn tb-rec" type="button" aria-pressed="false" aria-label="Record" aria-keyshortcuts="R" data-tip="tape-rec" data-for="studio" data-mini="studio">${icon('rec')}</button>
      <button data-part="rec-more" class="icon-btn key-more np-rec-more" type="button" aria-label="What to catch" data-tip="np-rec-more" data-for="studio" data-mini="studio">${icon('down', { size: 18 })}</button>
      <button data-part="phone-rec" class="icon-btn tb-rec np-phone-rec" type="button" aria-pressed="false" aria-label="Record from this phone" data-tip="np-phone-rec" data-mini="take feed away">${icon('rec')}</button>
      <button data-part="phone-more" class="icon-btn key-more np-phone-more" type="button" aria-label="Record from this phone: the input" data-tip="np-phone-more" data-mini="take feed away">${icon('down', { size: 16 })}</button>
      <button data-part="back5" class="icon-btn np-back5" type="button" aria-label="Back 5 seconds" aria-keyshortcuts="J" data-tip="back5" data-for="take feed away">${icon('back5')}</button>
    </div>
    <div class="np-zone np-verb" data-slot="verb">
      <button data-part="feed-grab" class="icon-btn np-feed-grab" type="button" aria-label="GRAB from the live feed onto the Studio’s cue lane" data-tip="np-feed-grab" data-for="feed" data-mini="feed"><span class="np-grab-word">GRAB</span><span class="np-grab-sub">from the feed</span></button>
    </div>
    <div class="np-zone np-modes" data-slot="modes" role="group" aria-label="Modes">
      <button data-part="loop" class="icon-btn tb-loop" type="button" aria-pressed="false" aria-keyshortcuts="L" data-tip="tape-loop" data-for="tape take feed"><span class="loop-face">${icon('repeat', { size: 16 })}<span class="loop-word">Loop</span></span></button>
    </div>
    <div class="np-zone np-end" data-slot="end">
      <button data-part="eject" class="icon-btn np-eject" type="button" aria-label="Back to the tape" data-tip="np-eject" data-for="take feed" hidden>${icon('eject')}</button>
      <a data-part="open" class="icon-btn np-open" href="/tape.html" data-tip="np-open" data-for="take away" data-mini="take"><span class="np-open-word">Open</span>${icon('right', { size: 16 })}</a>
      <button data-part="note" class="icon-btn np-note" type="button" aria-label="A note here" data-tip="np-note" data-for="take" data-mini="take">${icon('note')}</button>
    </div>
  </div>
</div>
<div class="np-row np-row-2" data-slot="strip">
  <canvas data-part="scrub" class="np-scrub" role="slider" tabindex="0" aria-label="Where it plays: tap or drag to move the playhead" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" data-tip="np-scrub" data-for="take feed away"></canvas>
</div>
<div class="np-row np-foot" data-slot="foot">
  <button data-part="out-foot" class="icon-btn np-out-foot" type="button" aria-label="Where it plays" data-tip="np-output" data-for="tape take feed"><span class="np-out-leg">OUT</span><span data-part="out-foot-val" class="np-out-val">JAM ROOM</span>${icon('down', { size: 16 })}</button>
</div>
<div data-part="rec-menu" class="menu np-rec-menu" role="menu" aria-label="What to catch" hidden></div>
<div data-part="source-menu" class="menu np-source-menu" role="menu" aria-label="What plays" hidden></div>
<div data-part="phone-menu" class="menu np-phone-menu" role="menu" aria-label="Record from this phone" hidden></div>`;

/**
 * fill draws the bar's template into `root` and names each part by
 * `id(part)` (a component's cx.id; by default the root's id and the part,
 * as cx.id names it), and says what is the root's own: the grabber controls
 * the root, and where it plays (OUT, and the foot's) opens a dialog, the
 * Output sheet (dialogKey). Answers `root`. The mount's, and the tests'
 * way to a bar.
 */
export function fill(root, id = (part) => `${root.id}-${part}`) {
  root.innerHTML = TEMPLATE;
  for (const el of root.querySelectorAll('[data-part]')) el.id = id(el.getAttribute('data-part'));
  const part = (name) => root.querySelector(`[data-part="${name}"]`);
  part('grabber').setAttribute('aria-controls', root.id);
  dialogKey(part('output'));
  dialogKey(part('out-foot'));
  return root;
}

/**
 * The Transport. Its models: `bar`, the engine's (what plays, its verbs,
 * its snapshot()); `transport`, the engine's (a press on the keyboard);
 * `tape`, the page's (the Studio's keys, the lamp, the strip); `takes`,
 * the page's (the source menu's last few); `recorder`, the page's phone
 * recorder. Its props, the surface's: `layout` (barLayout,
 * lib/bar/layout.js), `player` (the phone's player, playerSheet),
 * `output()` (the Output sheet), `room()` (the room shown) and
 * `onRoom(fn)` (fn as the room shown changes), `titles(root)` (help's
 * titles, put on the filled template before the bar draws), and `tapeKeys`, a relay
 * (lib/components/relay.js) the Transport provides its ● and ▾ (Catch's)
 * to, which the surface hands the Studio (ctx.tapeKeys; decision D4).
 */
export default {
  id: 'transport',
  root: 'np',
  needs: ['bar', 'transport', 'tape', 'takes', 'recorder'],
  css: 'css/bar.css',
  mount(root, models, cx) {
    fill(root, cx.id);
    // Help's titles (props.titles, the shell's applyTitles) go on the
    // template's keys as they are, before NowPlaying moves any key's tip
    // to what it holds: a title is the key's as the page drew it.
    cx.props.titles?.(root);
    const np = new NowPlaying(root, models, cx);
    const offs = [cx.props.tapeKeys?.provide(np.tapeKeys), cx.props.onRoom?.(() => np.kick())];
    return {
      unmount() {
        for (const off of offs) off?.();
        np.destroy();
      },
    };
  },
};
