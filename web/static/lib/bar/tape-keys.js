// web/static/lib/bar/tape-keys.js
// The bar's keys for the tape in the Studio (docs/architecture/bar.md, *The
// Studio's keys*; docs/plan/transport-extraction.md, decision 4): ● (#rec),
// Catch and its ▾ (#catch-pass, #catch-more, #catch-menu) and the click
// (#click). They are the bar's: drawn from the page's tape
// (lib/models/tape.js snapshot()) and the page's phone recorder
// (lib/phone/recorder.js snapshot()), and pressed on the tape's verbs
// (record, punchOut, catch, setClick). What is the Studio's own -- which
// tracks are armed and what they record from, the body a verb sends (replace
// or overdub, the jam-only sheet, "arm a track"), the words a verb's answer
// gets (with the Studio's Undo), Catch's outline on the lanes, and whether
// the tape plays on this phone -- the Studio lends the bar as its hands
// (lend), the one way it reaches these keys. It never looks them up.

import { bindPress, ARM_PRESS } from '../ui/press.js';
import { splitKey, menuItem } from '../ui/menu.js';
import { catchState, catchSub, catchMini, CATCH_BARS } from '../tape/catch.js';
import { onWords, tracksWords, recTracksOf, recSources } from '../rig/arm.js';
import { editTape } from '../tape/refusal.js';
import { fmtClock, onPhoneRecorder } from '../phone/recorder.js';
import { tipFor } from '../help/tips.js';
import { PHONE } from './player.js';

const busy = (phone) => phone.mode === 'recording' || phone.mode === 'saving';

/**
 * faces is what the keys say, from the tape's snapshot (`snap`: {tape,
 * live}), the recorder's (`phone`: {mode, seconds}), the armed tracks as
 * the Studio shows them (`armed`) and what each records from (`inputOf`).
 * Pure, for the tests: answers {rec, click, catch, says}, `says` being
 * catchState's answer, which a press on Catch and its menu read.
 */
export function faces({ snap, phone = { mode: 'closed', seconds: 0 }, armed = [], inputOf = () => '', catchTip = '' }) {
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
  // Catch waits for a whole pass of the loop, and says so: it stays
  // pressable (never `disabled`, which a phone's tap passes over) and a press
  // says why; its tip does too (lib/tape/catch.js).
  const says = catchState({ live, tape: t, phoneOut, armed: armed.length > 0 });
  const sub = catchSub(says, { armed, phoneOut });
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
    click: { pressed: !!t.click, disabled: !t.grid },
    catch: {
      waits: !says.ready,
      jamOnly: phoneOut,
      title: says.ready ? catchTip : says.why,
      sub,
      mini: catchMini(sub),
      said: phoneOut ? 'Catch: needs the jam room' : !says.ready ? `Catch: ${says.why}` : armed.length ? `Catch the last pass onto ${onWords(armed)}` : 'Catch: arm a track first',
    },
    says,
  };
}

const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

/**
 * tapeKeys wires ●, Catch and its ▾, and the click in `doc` on the page's
 * `tape` (the tape model) and its phone recorder (`whenRecorder(fn)`, which
 * hands it over once a room has made it). `toast` is the page's; `offer()`
 * opens the mini player's ▾ of this phone's inputs (phone-key.js), which a
 * hold on ● asks for on a phone. Null on a page without the keys or a tape.
 *
 * Answers:
 *   lend(hands) -> off   the Studio's hands, until off():
 *       layers           the stack scope Catch's ▾ opens on (the first
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
 *       hover(on)        Catch pointed at, or not: its outline on the lanes
 *   draw()               the keys again: the Studio's armed tracks or their
 *                        inputs changed
 *   press(name)          'rec', 'catch' or 'click', as a tap on it (R, C,
 *                        M); nothing while it is disabled or with no hands
 *   catch(what)          Catch `what` ({pass}, {bars}, {out}), as its ▾ does
 *   closeMenu()          Catch's ▾ shut
 *
 * With no hands lent the keys are not drawn and do nothing: they show in
 * the Studio alone (data-for="studio").
 */
export function tapeKeys({ doc = document, tape, whenRecorder = (fn) => onPhoneRecorder(doc, fn), toast = () => {}, offer = () => {}, matchMedia = (q) => doc.defaultView?.matchMedia?.(q) } = {}) {
  const $ = (id) => doc.getElementById(id);
  const rec = $('rec'), click = $('click'), pass = $('catch-pass'), more = $('catch-more'), panel = $('catch-menu');
  if (!tape || !rec || !click || !pass || !more || !panel) return null;
  let hands = null;
  let recorder = null;
  let says = null; // catchState's, as Catch was drawn last
  let menu = null;
  const snap = () => tape.snapshot();
  const phone = () => (recorder ? recorder.snapshot() : { mode: 'closed', seconds: 0 });

  function draw() {
    const s = snap();
    if (!hands || !s.tape) return;
    const armed = hands.armed();
    const f = faces({ snap: s, phone: phone(), armed, inputOf: hands.inputOf, catchTip: tipFor('catch') });
    says = f.says;
    setAttr(rec, 'aria-pressed', String(f.rec.pressed));
    rec.classList.toggle('armed', f.rec.armed);
    rec.classList.toggle('counting', f.rec.counting);
    setAttr(rec, 'aria-label', f.rec.said);
    setAttr(rec, 'title', f.rec.said);
    rec.disabled = f.rec.disabled;
    setAttr(rec, 'aria-disabled', String(f.rec.dim));
    rec.classList.toggle('dim', f.rec.dim);
    setAttr(click, 'aria-pressed', String(f.click.pressed));
    click.disabled = f.click.disabled;
    pass.disabled = false;
    setAttr(pass, 'aria-disabled', String(f.catch.waits));
    // Its ▾ is the other half of the key: lit, waiting or plain with it.
    for (const k of [pass, more]) {
      k.classList.toggle('waits', f.catch.waits);
      k.classList.toggle('jam-only', f.catch.jamOnly);
    }
    setAttr(pass, 'title', f.catch.title);
    setText(pass.querySelector('.np-catch-sub'), f.catch.sub);
    // A shorter second line for the phone's mini bar, where the full one is
    // hidden (css/bar.css, .np-catch-mini).
    setText(pass.querySelector('.np-catch-mini'), f.catch.mini);
    setAttr(pass, 'aria-label', f.catch.said);
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

  // Catch: waiting for a pass it says why instead of doing nothing, with the
  // last 4 bars on offer when those don't wait. Its ▾ opens the menu of what
  // to catch.
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

  const toggleClick = () => {
    if (!hands || !snap().tape) return;
    editTape(() => tape.setClick(!snap().tape.click), { toast, resync: () => tape.refresh(true) });
  };

  // Catch's ▾ lists what it can take now: the last pass, or the last 1, 2
  // or 4 bars. Each item says what it is and, when it can't go, why: a tap
  // on one that can't says it again, and leaves the menu open.
  function renderMenu(m) {
    const s = snap();
    const cs = says || catchState({ live: s.live, tape: s.tape });
    const armed = hands ? hands.armed() : [];
    const head = doc.createElement('div');
    head.className = 'menu-sub catch-menu-head';
    head.textContent = armed.length ? `Catch onto ${onWords(armed)}` : 'Catch: no track is armed';
    const item = (word, ok, why, run) => {
      const b = menuItem(doc, { word, sub: !ok && why ? why : undefined, attrs: { 'aria-disabled': String(!ok) } });
      b.addEventListener('click', () => {
        if (!ok) { toast(why, 'warn', 6000); return; }
        run();
      });
      return b;
    };
    m.replaceChildren(head,
      item('The last pass', cs.ready, cs.why, () => doCatch({ pass: 1 })),
      ...CATCH_BARS.map((n) => item(`The last ${n} bar${n === 1 ? '' : 's'}`, cs.bars, cs.barsWhy, () => doCatch({ bars: n }))));
  }

  // ●: a tap records; on a phone a hold offers to record from this phone
  // instead, on the mini player's ▾.
  bindPress(rec, {
    ...ARM_PRESS,
    onTap: record,
    onHold: () => {
      if (matchMedia(PHONE)?.matches) offer();
      else record();
    },
  });
  click.addEventListener('click', toggleClick);
  pass.addEventListener('click', onCatch);
  // Pointing at Catch outlines, on the record track's lane, the pass it takes.
  const hover = (on) => hands?.hover(on);
  pass.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover(true); });
  pass.addEventListener('pointerleave', () => hover(false));
  pass.addEventListener('focus', () => { if (pass.matches(':focus-visible')) hover(true); });
  pass.addEventListener('blur', () => hover(false));
  // The recorder, once a room has made it: ● shows a recording from this
  // phone, wherever it was started.
  whenRecorder((r) => { recorder = r; r.onChange(draw); draw(); });
  tape.onChange(draw);

  const keys = { rec: () => !rec.disabled && record(), catch: onCatch, click: () => !click.disabled && toggleClick() };
  return {
    lend(h) {
      hands = h;
      // Catch and its ▾ are a split key (lib/ui/menu.js), as GRAB's and
      // KEEP's: the menu opens over the pair in the bar (under it in the
      // phone's pulled-up player), its right edge on the pair's, and Catch,
      // a pick, a press elsewhere, Escape or Back shuts it.
      menu ??= splitKey(pass, more, panel, { layers: h.layers || undefined, doc, role: 'menu', render: renderMenu });
      draw();
      return () => { if (hands === h) { menu?.close(); hands = null; } };
    },
    draw,
    press(name) { if (hands) keys[name]?.(); },
    catch: doCatch,
    closeMenu() { menu?.close(); },
  };
}
