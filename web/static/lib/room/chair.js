// web/static/lib/room/chair.js
// The Listening Room's chair: a take's page under the rooms flag
// (docs/superpowers/specs/2026-10-15-listening-room-design.md, "The chair:
// the sketchbook"). One take or tape on the deck, close up, with the
// sketchbook in your lap.
//
// For a take, the page (lib/wave/page.js) runs exactly as it does without
// the room, and hands this module a handle on its take, its flags and its
// clock. The chair rearranges the page's own controls rather than copying
// them: the reel window, its LCD and the transport keys go into the deck;
// the name and the star into the sketchbook; In, Out, Loop, the tempo and
// the whole of the page -- the waveform, the selection, Send to, More, the
// MIDI lanes -- fold under TOOLS. Nothing the take page does is lost; it's
// just not what comes first.
//
// For a tape (wave.html?tape=ID), there is no take page: the chair draws the
// tape on the deck itself, played on the Pi through OUT, with its sections
// as read-only notes.

import { notesOf, noteSpan, sendToStudio, fmtAt, fieldEnter } from './notes.js';
import { keepLabel, selectionKeepLength } from '../rooms/keeplabel.js';
import { takeGrabSpan, takeGrabLabel, takeStartN, loadedLoopBars, readPick } from '../rooms/grab.js';
import { cutTakeRecord, cutTapeRecord } from './record.js';
import { loadTape, readyToCut } from './swap.js';
import { tagStore } from '../tags.js';
import { openTagManager } from '../tags-dialog.js';
import { levelsFor, takeGain } from '../wave/draw.js';
import { drawTrace, paintOxide, oxideColors } from '../wave/tape-strip.js';
import { ReelWindow } from '../objects/reel-window.js';
import { tapeSource } from '../bar/tape-source.js';

const TOOLS_KEY = 'hindsight.chair.tools';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function el(tag, cls, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}
const $ = (id) => document.getElementById(id);
const dateOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function mount(h) {
  return h.tape ? mountTape(h) : mountTake(h);
}

// --- the frame both share: the header's keys, the deck, the tape, the book ----

function frame({ kind, title }) {
  // The body's mark, apart from the .chair-tape strip's own class.
  document.body.classList.add('chair-on', `chair-of-${kind}`);
  // STAND UP: back to the doorway, where the shelves are.
  const back = document.querySelector('.appbar .back');
  if (back) {
    back.href = '/takes.html';
    back.setAttribute('aria-label', 'Stand up: back to the shelves');
    back.dataset.tip = 'room-stand';
    const words = back.querySelector('.back-text');
    if (words) words.textContent = 'Stand up';
  }
  // Short words on a phone, where the header is one row of keys.
  // A tape is loaded in the Studio; a take is GRABbed (its words are the
  // take's own, set in mountTake once the loop's length is known).
  const studio = el('button', 'icon-btn chair-studio', { type: 'button', 'data-tip': 'room-studio', 'aria-label': kind === 'tape' ? 'Load it in the Studio' : 'GRAB' },
    el('span', 'wide-only', { text: kind === 'tape' ? 'Load it in the Studio' : 'GRAB' }), el('span', 'narrow-only', { text: kind === 'tape' ? 'Studio ›' : 'GRAB' }));
  const cutKey = el('button', 'chair-cut', { type: 'button', 'data-tip': 'room-cut' }, 'CUT A RECORD');
  const acts = el('span', 'chair-acts', {}, studio, cutKey);
  document.querySelector('.appbar-page')?.append(acts);

  const label = el('span', 'chair-label', { 'aria-hidden': 'true', text: title });
  const windowSlot = el('div', 'chair-window');
  const keys = el('div', 'chair-keys', { role: 'group', 'aria-label': 'Deck keys' });
  const deck = el('section', 'chair-deck', { 'aria-label': 'The deck, close up' }, label, windowSlot, keys);

  const strip = el('canvas', 'chair-strip', { role: 'slider', tabindex: '0', 'aria-label': `The ${kind} on tape: tap to play from there`, 'aria-valuemin': '0', 'data-tip': 'room-strip' });
  const pins = el('ol', 'chair-pins', { 'aria-label': kind === 'tape' ? 'Sections' : 'Notes on the tape' });
  const ends = el('div', 'chair-ends', { 'aria-hidden': 'true' }, el('span', 'chair-end-0', { text: '0:00' }), el('span', 'chair-end-1'));
  const tape = el('section', 'chair-tape', { 'aria-label': `The ${kind} on tape` }, strip, pins, ends);

  const cutBar = el('progress', 'chair-cut-bar', { max: '1' });
  const cutWords = el('span', 'chair-cut-words', { role: 'status' });
  const cutting = el('div', 'chair-cutting', { hidden: true }, cutBar, cutWords);

  const left = el('div', 'book-page book-left');
  const right = el('div', 'book-page book-right');
  const book = el('section', 'chair-book', { 'aria-label': 'The sketchbook' }, left,
    el('div', 'book-rings', { 'aria-hidden': 'true' }, ...Array.from({ length: 6 }, () => el('span'))), right);

  const chair = el('section', 'chair', { 'aria-label': 'In the chair' }, deck, cutting, tape, book);
  document.querySelector('header.appbar')?.after(chair);
  const setCut = (c) => {
    cutting.hidden = !c;
    cutKey.disabled = !!c;
    if (!c) return;
    if (c.frac == null) cutBar.removeAttribute('value'); else cutBar.value = c.frac;
    cutWords.textContent = `${c.what}: ${c.words}`;
  };
  return { chair, deck, windowSlot, keys, strip, pins, ends, tape, book, left, right, studio, cutKey, setCut, label };
}

function key(cls, label, text, tip) {
  return el('button', `chair-key ${cls}`, { type: 'button', 'aria-label': label, 'data-tip': tip }, text);
}

// paintStrip draws the take on tape: the trace on oxide, the part played
// lit, the notes as grease marks, and the playhead.
function paintStrip(canvas, cache, { peaks, frac, marks }) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = r.width, H = r.height;
  if (W <= 0 || H <= 0) return cache;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const css = getComputedStyle(canvas);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  const key = `${W}x${H}@${dpr}`;
  if (!cache || cache.key !== key) {
    const mk = (line) => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      const cc = c.getContext('2d');
      cc.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [c, cc, line];
    };
    const lv = levelsFor(peaks, Math.max(1, Math.round(W)));
    const gain = takeGain(peaks);
    const [base, bc] = mk();
    paintOxide(bc, W, H, oxideColors(col));
    bc.globalAlpha = 0.6;
    drawTrace(bc, lv, lv, { cy: H / 2, half: H / 2 - 4, gain, line: col('--trace', '#f6e7c4') });
    const [lit, lc] = mk();
    drawTrace(lc, lv, lv, { cy: H / 2, half: H / 2 - 4, gain, line: col('--trace-hot', '#fff8e8') });
    cache = { key, base, lit };
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cache.base, 0, 0);
  const px = Math.round(frac * canvas.width);
  if (px > 0) ctx.drawImage(cache.lit, 0, 0, px, canvas.height, 0, 0, px, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = col('--grease-mark', '#f0c419');
  for (const m of marks) ctx.fillRect(Math.round(m * W) - 1, 0, 2.5, H);
  ctx.fillStyle = col('--room-led', '#7dbb3c');
  ctx.fillRect(Math.round(frac * W) - 1, 0, 3, H);
  return cache;
}

// stripSeek makes the strip a slider: a tap or a drag plays from there, and
// with it focused ← → move five seconds.
function stripSeek(strip, { length, seek, pos, sampleRate }) {
  strip.style.touchAction = 'none';
  let down = null;
  const at = (e) => { const r = strip.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  strip.addEventListener('pointerdown', (e) => { if (e.button > 0) return; down = e.pointerId; strip.setPointerCapture?.(e.pointerId); seek(at(e) * length()); });
  strip.addEventListener('pointermove', (e) => { if (down === e.pointerId) seek(at(e) * length()); });
  for (const ev of ['pointerup', 'pointercancel']) strip.addEventListener(ev, () => { down = null; });
  strip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const sr = sampleRate();
    if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(length() - 1);
    else seek(pos() + (e.key === 'ArrowRight' ? 5 : -5) * sr);
  });
}

// pinsFor lays numbered grease marks over the strip, one button each. Two
// closer than a mark's width take turns above and below the tape.
const PIN_PX = 28;
function pinsFor(list, items, { onPick, label, width = 0 }) {
  let prev = null, lane = 0;
  list.replaceChildren(...items.map((n) => {
    lane = prev && width > 0 && (n.frac - prev.frac) * width < PIN_PX ? 1 - lane : 0;
    prev = n;
    const b = el('button', `chair-pin${lane ? ' below' : ''}`, { type: 'button', style: `left: ${(n.frac * 100).toFixed(3)}%`, 'aria-label': label(n) }, String(n.n));
    b.addEventListener('click', () => onPick(n));
    return el('li', '', {}, b);
  }));
}

// --- a take in the chair ----------------------------------------------------

function mountTake(h) {
  const take = h.take;
  const sr = h.sampleRate;
  const f = frame({ kind: 'take', title: take.label || take.name.replace(/^jam_|\.wav$/g, '') });

  // The deck: the page's own reel window and its LCD, and its keys.
  const win = document.querySelector('#np .np-window');
  if (win) f.windowSlot.append(win);
  const toStart = $('to-start'), back5 = $('back5'), play = $('play');
  back5.textContent = '◂◂';
  const fwd = key('chair-fwd', 'On 5 seconds', '▸▸', 'room-fwd');
  const eject = key('chair-eject', 'Eject: back on the shelf', '⏏', 'room-eject');
  const noteHere = key('chair-note', 'Note here: a note at what you hear now', 'NOTE HERE', 'room-note-here');
  for (const k of [toStart, back5, play]) k.classList.add('chair-key');
  f.keys.append(toStart, back5, play, fwd, eject, noteHere);
  fwd.addEventListener('click', () => h.seek(Math.min(h.total - 1, h.state().cursor + 5 * sr)));
  eject.addEventListener('click', () => { if (h.playing()) h.togglePlay(); location.href = '/takes.html'; });

  // The take on tape.
  f.ends.lastChild.textContent = fmtAt(h.total, sr);
  f.strip.setAttribute('aria-valuemax', String(h.total));
  stripSeek(f.strip, { length: () => h.total, seek: (fr) => h.seek(Math.round(fr)), pos: () => h.state().cursor, sampleRate: () => sr });
  let stripCache = null;

  // The sketchbook. Left: the title (the page's own rename), the date, the
  // notes. Right: the sticker and the star, and the note field.
  const titleSlot = el('div', 'book-title');
  const name = $('take-name'), nameInput = $('take-name-input'), star = $('take-star');
  titleSlot.append(name, nameInput);
  const date = el('span', 'book-date', { text: dateOf(take.created) });
  const list = el('ol', 'book-notes', { 'aria-label': 'Notes' });
  const none = el('p', 'book-none', { text: 'No notes yet. NOTE HERE puts one at what you hear.' });
  f.left.append(el('div', 'book-head', {}, titleSlot, date), list, none);

  const sticker = el('button', 'book-sticker', { type: 'button', 'aria-haspopup': 'dialog', 'data-tip': 'room-sticker' });
  star.classList.add('book-star');
  const fieldLabel = el('label', 'book-field-label', { for: 'book-field' });
  const field = el('input', 'book-field', { id: 'book-field', type: 'text', maxlength: '120', placeholder: 'what you heard…', autocomplete: 'off', enterkeyhint: 'done' });
  f.right.append(
    el('div', 'book-stickers', {}, el('span', 'book-word', { text: 'STICKERS' }), sticker, star),
    el('div', 'book-new', {}, fieldLabel, field),
    el('p', 'book-hint', { text: 'Notes are flags with words. Each pins a moment on the tape, and any of them can go to the Studio’s buffer.' }));

  // TOOLS: everything else the take page does, folded.
  const tools = el('details', 'chair-tools');
  const toolKeys = el('div', 'chair-tool-keys', { role: 'group', 'aria-label': 'Selection and tempo' });
  for (const id of ['set-in', 'set-out', 'loop']) { const k = $(id); if (k) toolKeys.append(k); }
  const sub = document.querySelector('.take-sub');
  if (sub) toolKeys.append(sub);
  const ov = $('overview-canvas');
  const ovBox = el('div', 'chair-overview');
  if (ov) ovBox.append(ov);
  tools.append(el('summary', 'chair-tools-head', { 'data-tip': 'room-tools' }, 'TOOLS'), toolKeys, ovBox);
  const waveMain = document.querySelector('main.wave-main');
  if (waveMain) tools.append(waveMain);
  f.chair.append(tools);
  tools.open = readPref(TOOLS_KEY) === 'open';
  tools.addEventListener('toggle', () => writePref(TOOLS_KEY, tools.open ? 'open' : 'closed'));

  // --- the notes -------------------------------------------------------------
  let current = null; // the note the field is writing: {id, frame}, or null
  let notesSig = '';
  const notes = () => notesOf(h.state().flags, sr);
  const spanOpts = () => ({ sampleRate: sr, bpm: h.state().grid.bpm, total: h.total });

  function renderNotes() {
    const ns = notes();
    const sig = JSON.stringify(ns.map((n) => [n.id, n.frame, n.label]));
    if (sig === notesSig) return;
    notesSig = sig;
    const focused = document.activeElement?.closest?.('.book-notes li')?.dataset.id;
    const focusCls = document.activeElement?.className;
    list.replaceChildren(...ns.map((n) => {
      const at = el('button', 'book-at', { type: 'button', 'aria-label': `Note ${n.n}, at ${n.at}: play from there` },
        el('span', 'book-n', { 'aria-hidden': 'true', text: String(n.n) }), el('span', 'book-time', { 'aria-hidden': 'true', text: n.at }));
      at.addEventListener('click', () => h.seek(n.frame));
      const words = el('input', 'book-words', { type: 'text', maxlength: '120', value: n.label, placeholder: 'what you heard…', 'aria-label': `Note ${n.n}, at ${n.at}: its words` });
      words.value = n.label;
      const save = () => h.editNote(n.id, words.value.trim());
      words.addEventListener('change', save);
      words.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); words.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); words.value = n.label; words.blur(); }
      });
      const span = noteSpan(ns, n.id, spanOpts());
      const go = el('button', 'book-go', { type: 'button', 'aria-label': `GRAB from note ${n.n} into the Studio’s buffer`, 'data-tip': 'room-to-studio', disabled: !span }, 'GRAB');
      go.addEventListener('click', () => noteToStudio(n.id));
      const out = el('button', 'book-out', { type: 'button', 'aria-label': `Take note ${n.n} out` }, '×');
      out.addEventListener('click', () => h.removeNote(n.id));
      return el('li', '', { 'data-id': n.id }, at, words, go, out);
    }));
    none.hidden = ns.length > 0;
    if (focused) list.querySelector(`li[data-id="${CSS.escape(focused)}"] .${(focusCls || 'book-words').split(' ')[0]}`)?.focus();
    pinsFor(f.pins, ns.map((n) => ({ ...n, frac: n.frame / h.total })), {
      onPick: (n) => { h.seek(n.frame); list.querySelector(`li[data-id="${CSS.escape(n.id)}"] .book-words`)?.focus(); },
      label: (n) => `Note ${n.n} at ${n.at}${n.label ? `: ${n.label}` : ''}`,
      width: f.strip.getBoundingClientRect().width,
    });
  }

  async function noteToStudio(id) {
    const span = noteSpan(notes(), id, spanOpts());
    if (!span) return;
    try {
      location.href = await sendToStudio(h.file, span);
    } catch (e) {
      h.toast(`Couldn’t send it to the Studio: ${e.message}`, 'bad');
    }
  }

  // NOTE HERE: a note at the playhead, and the field writing its words.
  function writeAt(frameAt) {
    const id = h.addNote(frameAt);
    if (!id) return;
    const n = notes().find((x) => x.id === id);
    current = { id, frame: n ? n.frame : frameAt };
    field.value = n ? n.label : '';
    renderField();
    field.focus();
  }
  noteHere.addEventListener('click', () => writeAt(h.state().cursor));
  function renderField() {
    const at = fmtAt(current ? current.frame : h.state().cursor, sr);
    const words = current ? `A NOTE AT ${at}` : `NOTE HERE · ${at}`;
    if (fieldLabel.textContent !== words) fieldLabel.textContent = words;
  }
  // Words in the field with no note yet: Enter makes one, there.
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); current = null; field.value = ''; field.blur(); renderField(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const act = fieldEnter({ current, words: field.value, cursor: h.state().cursor, notes: notes(), total: h.total });
    if (act.kind === 'none' && !current) return;
    if (act.kind === 'edit') h.editNote(act.id, act.words);
    if (act.kind === 'new') {
      const id = h.addNote(act.frame);
      if (id) h.editNote(id, act.words);
    }
    current = null;
    field.value = '';
    renderField();
  });
  field.addEventListener('blur', () => {
    if (current && field.value.trim() !== (notes().find((x) => x.id === current.id)?.label || '')) h.editNote(current.id, field.value.trim());
  });

  // --- the sticker: the take's one tag, and the gold star beside it -----------
  function renderSticker() {
    const g = tagStore.list.find((x) => x.id === take.tag);
    sticker.className = `book-sticker${g ? ` stripe-${g.color} on` : ''}`;
    sticker.textContent = g ? g.name : '+ sticker';
    sticker.setAttribute('aria-label', g ? `Sticker: ${g.name}. Change it` : 'Add a sticker');
  }
  const pickDlg = el('dialog', 'sheet book-pick', { 'aria-labelledby': 'book-pick-h' });
  document.body.append(pickDlg);
  sticker.addEventListener('click', () => {
    const btn = (label, cls, run) => { const b = el('button', cls, { type: 'button' }, label); b.addEventListener('click', () => { pickDlg.close(); run(); }); return b; };
    const own = take.tag || '';
    pickDlg.replaceChildren(el('div', 'sheet-inner', {},
      el('h3', '', { id: 'book-pick-h', text: 'One sticker' }),
      el('div', 'book-pick-list', {},
        ...tagStore.list.map((g) => {
          const b = btn(g.name, `book-sticker stripe-${g.color} on`, () => setTag(g.id === own ? '' : g.id));
          b.setAttribute('aria-pressed', String(g.id === own));
          return b;
        }),
        own ? btn('No sticker', 'icon-btn', () => setTag('')) : null),
      el('div', 'sheet-actions', {},
        btn(tagStore.list.length ? 'Edit stickers' : 'Make a sticker', 'icon-btn', () => openTagManager({ onToast: h.toast, onCreated: (g) => setTag(g.id) })),
        btn('Done', 'icon-btn', () => {}))));
    pickDlg.showModal();
  });
  async function setTag(id) {
    try {
      const b = await h.patch({ tag: id });
      take.tag = b.tag ?? id;
      renderSticker();
    } catch (e) { h.toast(`Couldn’t stick it on: ${e.message}`, 'bad'); }
  }
  tagStore.subscribe(renderSticker);
  tagStore.load();

  // --- CUT A RECORD, and To the Studio for the whole take or its selection ----
  const renderCutKey = () => {
    f.cutKey.hidden = !!take.record;
    // The selection, when there is one: what's cut is said, not shown.
    const words = h.state().region ? 'Cut a record of the selection' : 'Cut a record';
    if (f.cutKey.getAttribute('aria-label') !== words) f.cutKey.setAttribute('aria-label', words);
  };
  f.cutKey.addEventListener('click', async () => {
    const st = h.state();
    const t = { ...take, trim: st.region ? { start_frame: st.region.start, end_frame: st.region.end } : null };
    const what = take.label || 'the take';
    f.setCut({ what, frac: null, words: 'cutting' });
    try {
      const r = await cutTakeRecord(t, { tags: tagStore.list });
      if (!r.cut) take.record = { side: 'A' };
      h.toast(`${what} is on the Records shelf`, 'ok', { action: { label: 'Stand up', run: () => { location.href = '/takes.html'; } } });
    } catch (e) {
      h.toast(`The record wasn’t cut: ${e.message}`, 'bad');
    } finally {
      f.setCut(null);
      renderCutKey();
    }
  });

  // --- GRAB: the take's selection, else the N bars before the playhead -------------
  // N starts at the tape's loop in bars, as the feed's GRAB does. The take's
  // own tempo says how long a bar is; with none, N is twice as many seconds.
  let grabN = takeStartN({ stored: readPick() });
  const grabSpan = () => {
    const st = h.state();
    return takeGrabSpan({ region: st.region, playhead: st.cursor, total: h.total, sampleRate: sr, bpm: st.grid.bpm, n: grabN });
  };
  async function grabNow() {
    const span = grabSpan();
    if (!span) return;
    try { location.href = await sendToStudio(h.file, span); } catch (e) { h.toast(`Couldn’t GRAB it into the Studio: ${e.message}`, 'bad'); }
  }
  f.studio.addEventListener('click', grabNow);
  let grabSig = '';
  function renderGrab() {
    const st = h.state();
    // And the take's other verb, KEEP (the page's Save as take): it says how
    // much of the take it makes a take of.
    const keepKey = $('save-take');
    if (keepKey) {
      const k = keepLabel(st.region ? selectionKeepLength((st.region.end - st.region.start) / sr) : '');
      if (keepKey.textContent !== k) keepKey.textContent = k;
    }
    const words = takeGrabLabel({ n: grabN, bpm: st.grid.bpm, selection: !!st.region });
    if (words === grabSig) return;
    grabSig = words;
    for (const sp of f.studio.children) sp.textContent = words;
    f.studio.setAttribute('aria-label', `${words}: ${st.region ? 'the selection' : st.grid.bpm > 0 ? `the ${grabN} bar${grabN === 1 ? '' : 's'} before the playhead` : `the ${2 * grabN} seconds before the playhead`}, into the Studio’s buffer`);
    if (sendGrab) {
      sendGrab.firstChild.textContent = words;
      sendGrabSub.textContent = st.region ? 'The selection, into the Studio’s buffer' : 'Before the playhead, into the Studio’s buffer';
    }
  }
  loadedLoopBars().then((bars) => { grabN = takeStartN({ loopBars: bars, stored: readPick() }); renderGrab(); });

  // The take page's Send to ▾: Tape and Clipboard are GRAB now -- one request,
  // the Studio's buffer, which Drops where the clipboard Pasted. Crate waits
  // for the crate to go.
  const sendMenu = $('send-menu');
  let sendGrab = null, sendGrabSub = null;
  if (sendMenu) {
    for (const id of ['send-to-tape', 'copy-take']) { const b = $(id); if (b) b.hidden = true; }
    sendGrabSub = el('span', 'menu-sub');
    sendGrab = el('button', '', { id: 'send-grab', type: 'button', role: 'menuitem', 'data-tip': 'send-grab' }, el('b'), sendGrabSub);
    sendGrab.addEventListener('click', grabNow); // the menu closes itself on a choice
    sendMenu.prepend(sendGrab);
  }

  // --- each redraw ---------------------------------------------------------------
  let lastLabel = null;
  function onRedraw() {
    const st = h.state();
    stripCache = paintStrip(f.strip, stripCache, { peaks: h.peaks, frac: st.cursor / h.total, marks: st.flags.map((x) => x.frame / h.total) });
    f.strip.setAttribute('aria-valuenow', String(Math.round(st.cursor)));
    f.strip.setAttribute('aria-valuetext', fmtAt(st.cursor, sr));
    renderNotes();
    renderField();
    renderCutKey();
    renderGrab();
    if (take.label !== lastLabel) { lastLabel = take.label; f.label.textContent = take.label || take.name.replace(/^jam_|\.wav$/g, ''); }
  }
  h.onRedraw(onRedraw);
  // A rename redraws nothing on the page: the deck's label hears of it here.
  new MutationObserver(() => onRedraw()).observe(name, { childList: true, characterData: true, subtree: true });
  new ResizeObserver(() => { stripCache = null; notesSig = ''; onRedraw(); }).observe(f.strip);
  renderSticker();
  onRedraw();
  return { chair: f.chair };
}

// --- a tape in the chair ---------------------------------------------------------

async function mountTape(h) {
  const id = h.tape;
  // A tape has no take page: its parts aren't wanted here.
  const res = await fetch(`/api/tapes/state?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'That tape is gone.' : 'Could not load the tape.');
  let s = await res.json();
  const t0 = s.tape;
  document.title = `${t0.name} — Hindsight`;
  const f = frame({ kind: 'tape', title: t0.name });
  const titleEl = document.querySelector('.take-title');
  if (titleEl) titleEl.hidden = true;

  // The deck: the bar's reel window, driven by the tape on the Pi.
  const win = document.querySelector('#np .np-window');
  if (win) f.windowSlot.append(win);
  const reels = new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
  reels.setLevels([], () => []);
  const toStart = key('chair-start', 'Back to the start', '|◂', 'to-start');
  const rew = key('chair-rew', 'Back 5 seconds', '◂◂', 'back5');
  const play = key('chair-play', 'Play', '▶', 'tape-play');
  const fwd = key('chair-fwd', 'On 5 seconds', '▸▸', 'room-fwd');
  const eject = key('chair-eject', 'Eject: back on the shelf', '⏏', 'room-eject');
  const putOn = el('button', 'chair-key chair-note', { type: 'button', hidden: true, 'data-tip': 'room-put' }, 'PUT IT ON');
  f.keys.append(toStart, rew, play, fwd, eject, putOn);
  eject.addEventListener('click', () => { location.href = '/takes.html'; });

  // The sketchbook: the name, and the sections as read-only notes.
  const list = el('ol', 'book-notes book-sections', { 'aria-label': 'Sections' });
  const none = el('p', 'book-none', { text: 'No sections on this tape. They’re made in the Studio.' });
  f.left.append(el('div', 'book-head', {}, el('h2', 'book-title-ro', { text: t0.name }), el('span', 'book-date', { text: dateOf(t0.created) })), list, none);
  f.right.append(
    el('p', 'book-hint', { text: 'A tape’s sections read as notes here. Notes of your own go on takes: cut a record of it, and write on that.' }));

  let src = null;
  let cache = '';
  const sr = () => (s.tape && s.tape.sample_rate) || 48000;
  const len = () => (s.tape && s.tape.length) || 1;
  function renderSections() {
    const secs = [...(s.tape.sections || [])].sort((a, b) => a.at - b.at).map((x, i) => ({ n: i + 1, id: x.id, frame: x.at, label: x.name || '', at: fmtAt(x.at, sr()), frac: x.at / len() }));
    const sig = JSON.stringify(secs.map((x) => [x.id, x.frame, x.label]));
    if (sig === cache) return;
    cache = sig;
    list.replaceChildren(...secs.map((n) => {
      const at = el('button', 'book-at', { type: 'button', 'aria-label': `Section ${n.n}, ${n.label || 'unnamed'}, at ${n.at}: play from there`, disabled: !src },
        el('span', 'book-n', { 'aria-hidden': 'true', text: String(n.n) }), el('span', 'book-time', { 'aria-hidden': 'true', text: n.at }));
      at.addEventListener('click', () => src?.seek(n.frame));
      return el('li', '', {}, at, el('span', 'book-words book-ro', { text: n.label || 'unnamed' }));
    }));
    none.hidden = secs.length > 0;
    pinsFor(f.pins, secs, { onPick: (n) => src?.seek(n.frame), label: (n) => `Section ${n.n} at ${n.at}: ${n.label || 'unnamed'}`, width: f.strip.getBoundingClientRect().width });
    f.ends.lastChild.textContent = fmtAt(len(), sr());
    f.strip.setAttribute('aria-valuemax', String(len()));
  }

  // On the deck, or not: a tape plays on the Pi, so it has to be loaded
  // there -- and the Studio asked first, if its tape is busy.
  function render() {
    const loaded = !!src;
    for (const k of [toStart, rew, play, fwd]) k.disabled = !loaded;
    putOn.hidden = loaded;
    if (src) {
      const lcd = src.lcd();
      $('position').textContent = lcd.big;
      $('np-time').textContent = lcd.small;
      $('np-unit').textContent = lcd.unit;
      $('np-status').dataset.state = lcd.status;
      $('np-marquee').textContent = lcd.note || src.marquee();
      const playing = src.playing();
      play.textContent = playing ? '■' : '▶';
      play.setAttribute('aria-label', playing ? 'Stop' : 'Play');
      reels.poll({ heard: src.pos(), playing, length: src.length, sampleRate: src.sampleRate });
      f.strip.setAttribute('aria-valuenow', String(Math.round(src.pos())));
      f.strip.setAttribute('aria-valuetext', fmtAt(src.pos(), src.sampleRate));
    } else {
      $('position').textContent = 'not on';
      $('np-marquee').textContent = `${t0.name.toUpperCase()} · PUT IT ON TO HEAR IT`;
    }
    paintTapeStrip();
    renderSections();
  }
  // The strip is the tape source's own paint: its tracks' clips, the loop
  // and the playhead.
  function paintTapeStrip() {
    const c = f.strip, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (r.width <= 0) return;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const col = (n, d) => css.getPropertyValue(n).trim() || d;
    if (src && src.ready) src.paint(ctx, r.width, r.height, col);
    else {
      ctx.clearRect(0, 0, r.width, r.height);
      paintOxide(ctx, r.width, r.height, oxideColors(col));
    }
  }
  function start() {
    src = tapeSource(id, { onError: (m) => h.toast(`The tape: ${m}`, 'bad') });
    src.on(render);
    for (const k of [toStart, rew, play, fwd]) k.disabled = false;
    render();
  }
  toStart.addEventListener('click', () => src?.seek(0));
  rew.addEventListener('click', () => src?.seek(src.pos() - 5 * src.sampleRate));
  fwd.addEventListener('click', () => src?.seek(src.pos() + 5 * src.sampleRate));
  play.addEventListener('click', () => { if (!src) return; if (src.playing()) src.pause(); else src.play(); });
  stripSeek(f.strip, { length: () => (src ? src.length : len()), seek: (fr) => src?.seek(fr), pos: () => (src ? src.pos() : 0), sampleRate: () => (src ? src.sampleRate : sr()) });
  putOn.addEventListener('click', async () => {
    try {
      const r = await loadTape(id, { ask: askFirst });
      if (r.loaded) start();
    } catch (e) { h.toast(`Couldn’t put it on: ${e.message}`, 'bad'); }
  });

  // Asks before taking the Studio's tape.
  const askText = el('p', 'room-ask-text');
  const askNo = el('button', 'icon-btn', { value: 'no' });
  const askYes = el('button', 'icon-btn primary', { value: 'yes' });
  const ask = el('dialog', 'sheet room-ask', { 'aria-labelledby': 'chair-ask-h' },
    el('form', 'sheet-inner', { method: 'dialog' },
      el('h3', '', { id: 'chair-ask-h', text: 'The Studio’s tape' }), askText,
      el('div', 'sheet-actions', {}, askNo, askYes)));
  document.body.append(ask);
  function askFirst(q, kind = 'swap') {
    return new Promise((resolve) => {
      askText.textContent = q;
      askNo.textContent = kind === 'cut' ? 'Not now' : 'Leave it';
      askYes.textContent = kind === 'cut' ? 'Cut it' : 'Swap it';
      ask.returnValue = 'no';
      ask.addEventListener('close', () => resolve(ask.returnValue === 'yes'), { once: true });
      ask.showModal();
    });
  }

  f.studio.addEventListener('click', async () => {
    try {
      const r = await loadTape(id, { ask: askFirst });
      if (r.loaded) location.href = '/tape.html';
    } catch (e) { h.toast(`Couldn’t load it in the Studio: ${e.message}`, 'bad'); }
  });
  f.cutKey.disabled = !(t0.tracks || []).some((tr) => (tr.clips || []).length);
  f.cutKey.addEventListener('click', async () => {
    try {
      if (!(await readyToCut(id, { ask: askFirst }))) return;
      if (!src) start();
    } catch (e) { h.toast(`The record wasn’t cut: ${e.message}`, 'bad'); return; }
    const what = t0.name;
    f.setCut({ what, frac: 0, words: 'starting' });
    try {
      await cutTapeRecord(id, { onProgress: (p) => f.setCut({ what, frac: p.state === 'playing' ? p.frac : null, words: p.words }) });
      h.toast(`${what} is on the Records shelf`, 'ok', { action: { label: 'Stand up', run: () => { location.href = '/takes.html'; } } });
    } catch (e) {
      h.toast(`The record wasn’t cut: ${e.message}`, 'bad');
    } finally {
      f.setCut(null);
    }
  });

  if (s.loaded) start();
  else render();
  new ResizeObserver(() => { cache = ''; render(); }).observe(f.strip);
  return { chair: f.chair };
}
