// web/static/lib/components/transport/tape-keys.js
// The bar's keys for the tape in the Studio (docs/architecture/bar.md, *The
// Studio's keys*; docs/architecture/bar.md, *The Transport's extraction*, decision 4): ● (#np-rec)
// and its ▾ (#np-rec-more, opening #np-rec-menu), on which Catch is: the
// last pass and the last 1, 2 and 4 bars (the calm Studio's step 7a, Gabe's
// call: the capture verbs on the bar are GRAB, KEEP and ●). On a phone the
// menu holds this phone's rows too, after a line (phone-key.js): one ▾
// beside ●, never two. They are the bar's: drawn from the page's tape
// (lib/models/tape.js snapshot()) and the page's phone recorder
// (lib/phone/recorder.js snapshot()), and pressed on the tape's verbs
// (record, punchOut, catch). What is the Studio's own -- which tracks are
// armed and what they record from, the body a verb sends (replace or
// overdub, the jam-only sheet, "arm a track"), the words a verb's answer
// gets (with the Studio's Undo), Catch's outline on the lanes, and whether
// the tape plays on this phone -- the Studio lends the bar as its hands
// (lend), the one way it reaches these keys. It never looks them up. The
// click is the Studio's (lib/tape/page.js: the tempo's panel and M).

import { bindPress, ARM_PRESS } from '../../ui/press.js';
import { splitKey, menuItem, menuDivider } from '../../ui/menu.js';
import { catchState, CATCH_BARS } from '../../tape/catch.js';
import { onWords, tracksWords, recTracksOf, recSources } from '../../rig/arm.js';
import { fmtClock } from '../../phone/recorder.js';
import { partOf } from '../../bar/slots.js';

const busy = (phone) => phone.mode === 'recording' || phone.mode === 'saving';

/**
 * faces is what ● says, from the tape's snapshot (`snap`: {tape, live}),
 * the recorder's (`phone`: {mode, seconds}), the armed tracks as the Studio
 * shows them (`armed`) and what each records from (`inputOf`). Pure, for
 * the tests: answers {rec, says}, `says` being catchState's answer, which
 * C and ●'s menu read.
 */
export function faces({ snap, phone = { mode: 'closed', seconds: 0 }, armed = [], inputOf = () => '' }) {
  const t = snap.tape, live = snap.live || null;
  const rec = live && live.record;
  const counting = !!(live && live.count_in > 0);
  const phoneOut = !!(live && live.output_mode === 'phone');
  const md = live && live.mixdown && live.mixdown.tape === t.id ? live.mixdown : null;
  const mixing = !!(md && (md.state === 'playing' || md.state === 'tail'));
  const here = busy(phone);
  // ● is always red, and its key says, to a screen reader and a pointer,
  // what it records and from where (the lamp on the display and the armed
  // head say it to the eye).
  const recWhat = !rec ? 'Record' : rec.state === 'armed' ? `Ready to record ${tracksWords(recTracksOf(rec))}` : `Recording ${tracksWords(recTracksOf(rec))}`;
  const recSrc = rec ? recSources(rec) : armed.length ? armed.map(inputOf).join(' + ') : '';
  const recSaid = here ? `Stop recording from this phone, ${fmtClock(phone.seconds)}`
    : rec || armed.length ? `${recWhat} from ${recSrc}` : 'Record: arm a track first';
  // Catch waits for a whole pass of the loop, and says so: C and its row
  // in ●'s menu say why (lib/tape/catch.js).
  const says = catchState({ live, tape: t, phoneOut, armed: armed.length > 0 });
  return {
    rec: {
      pressed: here || !!(rec && rec.state === 'on' && !counting),
      armed: !here && !!(rec && rec.state === 'armed'),
      counting: !here && counting,
      said: recSaid,
      // In phone mode, or while this phone records, it stays pressable: the
      // jam-room sheet explains, or it stops.
      disabled: !rec && !phoneOut && !here && (!live || live.aligned === 'none' || !t.grid || mixing),
      dim: phoneOut,
    },
    says,
  };
}

/**
 * catchRows is Catch's part of ●'s menu, from catchState's answer (`says`)
 * and the armed tracks: its head, where a catch lands ("Catch onto track
 * 2") or that no track is armed, then The last pass and the last 1, 2 and
 * 4 bars, each {what, word, ok, why}: `what` is the catch it sends
 * ({pass: 1}, {bars: n}), and `why` what a row that can't go says, under
 * it and again when it is tapped. Pure, for the tests.
 */
export function catchRows({ says, armed = [] }) {
  return {
    head: armed.length ? `Catch onto ${onWords(armed)}` : 'Catch: no track is armed',
    rows: [
      { what: { pass: 1 }, word: 'The last pass', ok: !!says.ready, why: says.why },
      ...CATCH_BARS.map((n) => ({ what: { bars: n }, word: `The last ${n} bar${n === 1 ? '' : 's'}`, ok: !!says.bars, why: says.barsWhy })),
    ],
  };
}

const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

/**
 * tapeKeys wires ● and its ▾ of the bar at `root` (found inside it) on the
 * page's `tape` (the tape model) and its phone recorder (`whenRecorder(fn)`,
 * which hands it over once there is one: the shell makes it at boot).
 * `toast` is the page's; `phoneKeys` is the mini player's own ● and ▾
 * (phone-key.js's answer, or null): on a phone ●'s menu holds its rows
 * after Catch's (rows, and opened as it opens), and a hold on ● offers
 * them (offer);
 * `phoneScreen` is a MediaQueryList for one (a component's
 * cx.media(PHONE)). Null on a bar without the keys or a page without a tape.
 *
 * Answers:
 *   lend(hands) -> off   the Studio's hands, until off():
 *       layers           the stack scope ●'s menu opens on (the first
 *                        lend's: the menu is made once)
 *       armed()          the armed tracks, as the Studio shows them
 *       inputOf(n)       what track n records from
 *       playsHere()      the tape plays on this phone: ● records from it
 *       body(what)       a record's or a catch's body ({} for ●, {pass: 1}
 *                        or {bars: n} for Catch), or null when the Studio
 *                        refused it (and said why)
 *       said(verb, answer, {before, what, body})
 *                        the words for a verb's answer ('record',
 *                        'punchOut', 'catch'), with the Studio's Undo
 *       hover(on)        The last pass pointed at, or not: its outline on
 *                        the lanes
 *       ghost()          a locate the Studio sent that this phone has not
 *                        heard yet ({pos, until}), or null: the bar's
 *                        output strip says where it is moving to
 *   draw()               the keys again: the Studio's armed tracks or their
 *                        inputs changed
 *   press(name)          'rec' or 'catch', as a tap on ● (R), or C, which
 *                        catches the last pass, or says why it waits;
 *                        nothing while ● is disabled or with no hands
 *   catch(what)          Catch `what` ({pass}, {bars}, {out}), as ●'s menu
 *                        does
 *   closeMenu()          ●'s menu shut
 *   ghost()              the lent hands' ghost(), null with none lent
 *   focusPlay()          the keyboard's focus to ▶ (the Studio's, as it
 *                        puts away what had it: the clip editor)
 *   tempo(fn)            fn(key) with the display's tempo key, which the
 *                        Studio wires its tempo menu on; answers what fn
 *                        does, or null on a bar without one (the bar says
 *                        when the key opens it: lib/components/transport/bar.js)
 *
 * With no hands lent the keys are not drawn and do nothing: they show in
 * the Studio alone (data-for="studio").
 */
export function tapeKeys({ root, tape, whenRecorder = () => {}, toast = () => {}, phoneKeys = null, phoneScreen = { matches: false } } = {}) {
  const $ = partOf(root);
  const rec = $('rec'), more = $('rec-more'), panel = $('rec-menu');
  const play = $('play'), tempoKey = $('tempo');
  if (!tape || !rec || !more || !panel) return null;
  let hands = null;
  let recorder = null;
  let says = null; // catchState's, as ● was drawn last
  let menu = null;
  const snap = () => tape.snapshot();
  const phone = () => (recorder ? recorder.snapshot() : { mode: 'closed', seconds: 0 });
  // On a phone ●'s menu holds this phone's rows too.
  const withPhone = () => !!phoneKeys && !!phoneScreen.matches;
  // Catch's rows as they are now, and as ●'s menu drew them last: the open
  // menu is filled again (menu()'s refresh, which keeps the keyboard on its
  // row) when they change, as the phone's rows' changes fill it again.
  const catchNow = () => {
    const s = snap();
    return catchRows({ says: says || catchState({ live: s.live, tape: s.tape }), armed: hands ? hands.armed() : [] });
  };
  let drawn = '';

  function draw() {
    const s = snap();
    if (!hands || !s.tape) return;
    const armed = hands.armed();
    const f = faces({ snap: s, phone: phone(), armed, inputOf: hands.inputOf });
    says = f.says;
    setAttr(rec, 'aria-pressed', String(f.rec.pressed));
    rec.classList.toggle('armed', f.rec.armed);
    rec.classList.toggle('counting', f.rec.counting);
    setAttr(rec, 'aria-label', f.rec.said);
    setAttr(rec, 'title', f.rec.said);
    rec.disabled = f.rec.disabled;
    setAttr(rec, 'aria-disabled', String(f.rec.dim));
    rec.classList.toggle('dim', f.rec.dim);
    setAttr(more, 'aria-label', withPhone() ? 'What to catch, or record from this phone' : 'What to catch');
    // Open, ●'s menu follows the tape and the armed tracks: a pass going
    // round lets The last pass go, another track armed renames the head.
    if (menu?.isOpen() && JSON.stringify(catchNow()) !== drawn) menu.refresh();
  }

  // ●: arms or punches in onto the armed tracks, or ends the punch and keeps
  // it. On a phone, with the tape playing on this phone, it records here,
  // from this phone, not the jam room, which it can't; and while this phone
  // records, it stops it.
  async function record() {
    if (!hands) return;
    const r = snap().live?.record;
    if (!r && (busy(phone()) || hands.playsHere())) { recorder?.quick(); return; }
    const body = r ? null : hands.body({});
    if (!r && !body) return; // keeping a take already running stays possible
    try {
      if (!r) hands.said('record', await tape.record(body), { body });
      else hands.said('punchOut', await tape.punchOut(), { before: r });
      tape.refresh();
    } catch (e) {
      toast(`Could not record: ${e.message}`, 'bad');
      tape.refresh();
    }
  }

  async function doCatch(what) {
    if (!hands) return;
    const body = hands.body(what);
    if (!body) return;
    try {
      hands.said('catch', await tape.catch(body), { what, body });
      tape.refresh();
    } catch (e) {
      toast(`Could not catch: ${e.message}`, 'bad');
    }
  }

  // C: the last pass; waiting for one, it says why instead of doing
  // nothing, with the last 4 bars on offer when those don't wait (as a tap
  // on Catch's own key did, before Catch went on ●'s ▾).
  function onCatch() {
    if (!hands) return;
    if (says && !says.ready) {
      toast(says.why, 'warn', {
        ms: 7000,
        actions: says.bars ? [{ label: 'Last 4 bars', run: () => doCatch({ bars: 4 }) }] : [],
      })?.classList.add('toast-passive');
      return;
    }
    doCatch({ pass: 1 });
  }

  // Pointing at The last pass outlines, on the record track's lane, the
  // pass it takes; the outline goes as the menu shuts.
  const hover = (on) => hands?.hover(on);

  // ●'s menu: Catch's rows (catchRows), each saying what it is and, when it
  // can't go, why (a tap on one that can't says it again, and leaves the
  // menu open); on a phone a line, then this phone's rows (phone-key.js).
  function renderMenu(m) {
    const now = catchNow();
    drawn = JSON.stringify(now);
    const { head, rows } = now;
    // Its head is drawn in the panel, from markup: the bar names no document.
    m.innerHTML = '<div class="menu-sub catch-menu-head"></div>';
    m.children[0].textContent = head;
    for (const row of rows) {
      const b = menuItem(m, { word: row.word, sub: !row.ok && row.why ? row.why : undefined, attrs: { 'aria-disabled': String(!row.ok) } });
      b.addEventListener('click', () => {
        if (!row.ok) { toast(row.why, 'warn', 6000); return; }
        doCatch(row.what);
      });
      // A mouse pointing at The last pass, or the keyboard on it (not a
      // finger's tap, which focuses it as it picks it).
      if (row.what.pass) {
        b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover(true); });
        b.addEventListener('pointerleave', () => hover(false));
        b.addEventListener('focus', () => { if (b.matches(':focus-visible')) hover(true); });
        b.addEventListener('blur', () => hover(false));
      }
      m.append(b);
    }
    if (withPhone()) {
      m.append(menuDivider(m));
      phoneKeys.rows(m);
    }
  }

  // ●: a tap records; on a phone a hold offers to record from this phone
  // instead, in ●'s menu. Bound before ●'s menu (splitKey, as the Studio
  // lends its hands), which then leaves the click a hold's lift sends.
  bindPress(rec, {
    ...ARM_PRESS,
    onTap: record,
    onHold: () => {
      if (!phoneScreen.matches) record();
      else if (menu && phoneKeys) phoneKeys.offer(menu);
    },
  });
  // The recorder, once there is one: ● shows a recording from this
  // phone, wherever it was started.
  whenRecorder((r) => { recorder = r; r.onChange(draw); draw(); });
  tape.onChange(draw);

  // C shuts ●'s menu as a pick does.
  const pressCatch = () => { onCatch(); if (menu?.isOpen()) menu.close('pick'); };
  const keys = { rec: () => !rec.disabled && record(), catch: pressCatch };
  return {
    lend(h) {
      hands = h;
      if (!menu) {
        // ● and its ▾ are a split key (lib/ui/menu.js), as GRAB's and
        // KEEP's: the menu opens over the ▾ in the bar (under it in the
        // phone's pulled-up player), its right edge on the ▾'s, and ●, a
        // pick, a press elsewhere, Escape or Back shuts it.
        // On a phone, this phone's inputs are asked for each time it opens
        // with its rows, by the ▾, the keyboard or a hold on ●.
        menu = splitKey(rec, more, panel, {
          layers: h.layers || undefined, role: 'menu', anchor: more, render: renderMenu, popover: true,
          onOpen: () => { if (withPhone()) phoneKeys.opened(menu); },
          onClose: () => hover(false),
        });
      }
      draw();
      return () => { if (hands === h) { menu?.close(); hands = null; } };
    },
    draw,
    press(name) { if (hands) keys[name]?.(); },
    catch: doCatch,
    closeMenu() { menu?.close(); },
    ghost: () => hands?.ghost?.() || null,
    focusPlay() { play?.focus({ preventScroll: true }); },
    tempo: (fn) => (tempoKey ? fn(tempoKey) : null),
  };
}
