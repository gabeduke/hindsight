// web/static/lib/rig/page.js
// The rig page (docs/superpowers/specs/2026-10-15-rig-design.md): the
// devices on a desk, the kit's patch bay, the cables between them, and an
// inspector. The Pi builds the picture from its settings, its tape and
// what's plugged in (GET /api/rig); this page draws it, and when a cable is
// plugged it sends the setting that cable is, then draws the next read. It
// never keeps a picture of its own.
//
// Patching: drag from a socket and drop on a socket; a pull on a plug
// unplugs it. Or choose a socket -- every socket is a button -- and then
// where it goes (picker.js); Unplug is in its inspector. The cables are
// drawn over the buttons and are not the controls.

import { on as roomsOn } from '../rooms/flag.js';
import { initNav } from '../nav.js';
import { toast } from '../toast.js';
import { initHelp } from '../help/help.js';
import { restartHindsight, RESTART_WARNING } from '../settings.js';
import { desk as deskOf, allSockets } from './desk.js';
import { cablePath, centreIn } from './cables.js';
import { styleOf, legend } from './kinds.js';
import { choose, letGo } from './picker.js';
import * as G from './graph.js';
import {
  writeFor, unplugFor, replugFor, labelWrite, fixWrite, armWrite, keepWrite, outputWrite, offerWrite, role, recording,
} from './patch.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 1500;
const SVGNS = 'http://www.w3.org/2000/svg';

const state = {
  g: null,
  pick: letGo(), // the socket chosen, and where it can go
  cable: null, // a cable tapped, shown in the inspector
  drag: null, // a cable being drawn from a socket: {from, x, y, moved, id}
  deskSig: '',
  inspSig: '',
  sending: false,
  restarting: false,
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(cls, text, onClick, tip) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (tip) b.dataset.tip = tip;
  b.addEventListener('click', onClick);
  return b;
}

// --- the Pi ---------------------------------------------------------------------

// lastSource is what a track with no input of its own records from on this
// device: the tape page's last choice (lib/tape/page.js, 'tape.source'). The
// Pi needs it to judge what such a track would record.
function lastSource() {
  try { return localStorage.getItem('tape.source') || 'aux'; } catch { return 'aux'; }
}

async function read() {
  const r = await fetch(`/api/rig?source=${encodeURIComponent(lastSource())}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let polling = 0;
async function refresh() {
  try {
    state.g = await read();
  } catch (e) {
    if (!state.g) $('rig-found').textContent = `Couldn’t reach Hindsight: ${e.message}`;
    return;
  }
  render();
}

/** send writes what a cable is, says so, and draws the next read. */
async function send(w, said, { undo = false } = {}) {
  if (!w) return false;
  state.sending = true;
  try {
    const r = await fetch(w.url, { method: w.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w.body) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
    if (said) {
      const opts = undo && state.g && state.g.tape ? { action: { label: 'Undo', run: () => undoTape() } } : {};
      toast(w.restart ? `${said}. It takes effect when Hindsight restarts.` : said, 'ok', opts);
    }
    return true;
  } catch (e) {
    toast(`Couldn’t do that: ${e.message}`, 'bad');
    return false;
  } finally {
    state.sending = false;
    await refresh();
  }
}

async function undoTape() {
  const id = state.g && state.g.tape && state.g.tape.id;
  if (!id) return;
  await fetch(`/api/tapes/undo?id=${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {});
  refresh();
}

// --- what a write is, in words ------------------------------------------------------

function said(g, a, b) {
  const sa = G.socketById(g, a), sb = G.socketById(g, b);
  if (!sa || !sb) return 'Patched';
  return `${G.title(g, sa)} → ${G.title(g, sb)}`;
}

function patch(a, b) {
  const g = state.g;
  const w = writeFor(g, a, b);
  if (!w) return;
  const both = [role(G.socketById(g, a)), role(G.socketById(g, b))];
  send(w, said(g, a, b), { undo: both.includes('bus') });
}

function unplug(c) {
  const w = unplugFor(state.g, c);
  if (!w) return;
  send(w, `Unplugged ${G.title(state.g, G.socketById(state.g, c.from)) || c.label} → ${G.title(state.g, G.socketById(state.g, c.to))}`);
}

// --- drawing ------------------------------------------------------------------------

function render() {
  const g = state.g;
  if (!g) return;
  $('rig-found').textContent = G.found(g);
  const d = deskOf(g);
  const sig = JSON.stringify([d.devices.map((x) => [x.id, x.sub, x.sockets.map((s) => [s.id, s.label, s.name])]), d.rows.map((r) => [r.id, r.title, r.sockets.map((s) => [s.id, s.label, s.name])])]);
  if (sig !== state.deskSig) {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.sock : null;
    buildDesk(d);
    state.deskSig = sig;
    if (focused) document.querySelector(`.rig-sock[data-sock="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }
  // A choice made before the read may have gone.
  if (state.pick.sel && !G.socketById(g, state.pick.sel)) state.pick = letGo();
  if (state.pick.sel) state.pick = { sel: state.pick.sel, targets: state.pick.targets.filter((t) => writeFor(g, state.pick.sel, t)) };
  if (state.cable && !(g.cables || []).some((c) => c.id === state.cable)) state.cable = null;
  updateSockets(d);
  drawCables();
  drawRestart();
  drawInspector();
}

function buildDesk(d) {
  const devs = $('rig-devices');
  devs.replaceChildren(...d.devices.map((dev) => {
    const card = el('div', `rig-dev rig-dev-${dev.role}`);
    card.dataset.dev = dev.id;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', dev.name);
    const head = el('div', 'rig-dev-head');
    head.append(el('span', 'rig-dev-name', dev.name), el('span', 'rig-dev-sub', dev.sub));
    card.append(head);
    if (dev.placeholder || dev.generic) card.append(el('p', 'rig-dev-note', dev.note || ''));
    const jacks = el('div', 'rig-jacks');
    for (const s of dev.sockets) jacks.append(socketCol(s));
    card.append(jacks);
    return card;
  }));
  const bay = $('rig-bay');
  const title = el('div', 'rig-bay-head');
  title.append(el('span', 'rig-dev-name', 'Hindsight kit'), el('span', 'rig-dev-sub', d.version));
  bay.replaceChildren(title, ...d.rows.map((r) => {
    const row = el('div', `rig-row rig-row-${r.id}`);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', r.title);
    row.append(el('span', 'rig-row-title', r.title));
    const socks = el('div', 'rig-row-socks');
    for (const s of r.sockets) socks.append(socketCol(s));
    row.append(socks);
    return row;
  }));
}

// socketCol is a socket's button, with the label drawn into it above.
function socketCol(s) {
  const col = el('div', 'rig-col');
  const tag = el('span', 'rig-tag');
  tag.dataset.tag = s.id;
  tag.hidden = !s.name || s.kind === 'tap' || s.kind === 'track';
  tag.textContent = s.name || '';
  const b = el('button', 'rig-sock');
  b.type = 'button';
  b.dataset.sock = s.id;
  b.dataset.kind = s.kind;
  b.dataset.tip = 'rig-socket';
  const hole = el('span', 'rig-hole');
  hole.setAttribute('aria-hidden', 'true');
  b.append(hole, el('span', 'rig-sock-label', s.label));
  if (s.kind === 'tap' || s.kind === 'track') b.append(el('span', 'rig-sock-name', s.name || ''));
  const warn = el('span', 'rig-warn-dot');
  warn.setAttribute('aria-hidden', 'true');
  b.append(warn);
  b.addEventListener('click', () => onChoose(s.id));
  b.addEventListener('pointerdown', (e) => onPointerDown(e, s.id));
  col.append(tag, b);
  // A track's red lamp is its own button: it arms the track, or disarms it.
  // A cable only ever says what the track would record.
  if (s.kind === 'track') {
    const lamp = el('button', 'rig-arm-lamp');
    lamp.type = 'button';
    lamp.dataset.arm = String(s.track);
    lamp.dataset.tip = 'rig-arm';
    lamp.addEventListener('click', () => armLamp(s.track));
    col.append(lamp);
  }
  return col;
}

// armLamp arms or disarms track n from its lamp.
function armLamp(n) {
  const g = state.g;
  const s = g && G.socketById(g, `kit.track.${n}`);
  if (!s) return;
  const w = armWrite(g, n, !s.armed);
  if (!w) { toast('● Rec is armed or recording: what’s armed waits until it ends', 'warn'); return; }
  send(w, s.armed ? `Track ${n} disarmed` : `Track ${n} armed`);
}

function updateSockets(d) {
  const g = state.g;
  const pend = new Set();
  const plugged = new Set();
  for (const c of g.cables || []) {
    plugged.add(c.from);
    plugged.add(c.to);
    if (c.pending) { pend.add(c.from); pend.add(c.to); }
  }
  for (const s of allSockets(d)) {
    const b = document.querySelector(`.rig-sock[data-sock="${CSS.escape(s.id)}"]`);
    if (!b) continue;
    b.classList.toggle('sel', state.pick.sel === s.id);
    b.classList.toggle('target', state.pick.targets.includes(s.id));
    b.classList.toggle('armed', !!s.armed);
    b.classList.toggle('warn', !!s.warn || G.warningsAt(g, s.id).length > 0);
    b.classList.toggle('signal', !!s.signal);
    b.classList.toggle('pending', pend.has(s.id));
    b.classList.toggle('plugged', plugged.has(s.id));
    b.setAttribute('aria-label', s.spoken + (state.pick.targets.includes(s.id) ? `: plug ${G.title(g, G.socketById(g, state.pick.sel))} in here` : ''));
    b.setAttribute('aria-pressed', String(state.pick.sel === s.id));
    const name = b.querySelector('.rig-sock-name');
    if (name && name.textContent !== (s.name || '')) name.textContent = s.name || '';
    const lamp = b.parentElement.querySelector('.rig-arm-lamp');
    if (lamp) {
      lamp.setAttribute('aria-pressed', String(!!s.armed));
      lamp.setAttribute('aria-label', s.armed ? `Track ${s.track} is armed: disarm it` : `Arm track ${s.track}`);
      lamp.setAttribute('aria-disabled', String(recording(g).length > 0));
    }
  }
  $('rig-desk').classList.toggle('picking', !!state.pick.sel && state.pick.targets.length > 0);
}

// holeAt is a socket's centre on the desk; a label's end is its tag.
function holeAt(id, deskBox) {
  if (id.startsWith('label:')) {
    const t = document.querySelector(`.rig-tag[data-tag="${CSS.escape(id.slice(6))}"]`);
    if (!t || t.hidden) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left - deskBox.left + r.width / 2, y: r.top - deskBox.top + r.height / 2 };
  }
  const b = document.querySelector(`.rig-sock[data-sock="${CSS.escape(id)}"] .rig-hole`);
  if (!b || !b.getClientRects().length) return null;
  return centreIn(b.getBoundingClientRect(), deskBox);
}

function drawCables() {
  const g = state.g;
  const deskEl = $('rig-desk');
  const box = deskEl.getBoundingClientRect();
  const wires = deskEl.querySelector('.rig-wires');
  const hits = deskEl.querySelector('.rig-hits');
  for (const svg of [wires, hits]) {
    svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    svg.setAttribute('width', String(Math.round(box.width)));
    svg.setAttribute('height', String(Math.round(box.height)));
  }
  const paths = [], hitPaths = [];
  for (const c of g.cables || []) {
    const a = holeAt(c.from, box), b = holeAt(c.to, box);
    if (!a || !b) continue;
    const d = c.kind === 'jack' ? `M${a.x} ${a.y} L${b.x} ${b.y}` : cablePath(a, b);
    paths.push(...wire(d, styleOf(c), `rig-wire rig-wire-${c.kind}${c.pending ? ' pending' : ''}${state.cable === c.id ? ' sel' : ''}`));
    const h = document.createElementNS(SVGNS, 'path');
    h.setAttribute('d', d);
    h.setAttribute('class', 'rig-hit');
    h.dataset.cable = c.id;
    h.addEventListener('click', () => { state.cable = c.id; state.pick = letGo(); render(); });
    hitPaths.push(h);
  }
  // The socket ends: a plug on each, over the hole.
  for (const c of g.cables || []) {
    if (c.kind === 'jack') continue;
    for (const id of [c.from, c.to]) {
      const at = holeAt(id, box);
      if (!at) continue;
      // A plug waiting for a restart is an open square; a live one, round.
      const plug = document.createElementNS(SVGNS, c.pending ? 'rect' : 'circle');
      if (c.pending) {
        for (const [k, v] of [['x', at.x - 6], ['y', at.y - 6], ['width', 12], ['height', 12]]) plug.setAttribute(k, String(v));
      } else {
        plug.setAttribute('cx', String(at.x));
        plug.setAttribute('cy', String(at.y));
        plug.setAttribute('r', '5');
      }
      plug.setAttribute('class', `rig-plug${c.pending ? ' pending' : ''}`);
      paths.push(plug);
    }
  }
  if (state.drag && state.drag.moved) {
    const a = holeAt(state.drag.from, box);
    if (a) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', cablePath(a, { x: state.drag.x - box.left, y: state.drag.y - box.top }));
      p.setAttribute('class', 'rig-wire rig-wire-drawing');
      p.setAttribute('stroke-width', '5');
      paths.push(p);
    }
  }
  wires.replaceChildren(...paths);
  hits.replaceChildren(...hitPaths);
}

// wire is a cable's stroke: one path, or two for a hollow one (a restart
// cable before the restart) -- its ink, and the desk showing down the middle.
function wire(d, st, cls) {
  const one = (width, stroke, extra) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', `${cls}${st.faded ? ' faded' : ''}${extra}`);
    p.setAttribute('stroke-width', String(width));
    if (st.dash) p.setAttribute('stroke-dasharray', st.dash);
    p.style.stroke = stroke;
    return p;
  };
  if (!st.hollow) return [one(st.width, st.ink, '')];
  return [one(st.width, st.ink, ''), one(Math.max(1.5, st.width - 3.5), 'var(--desk-felt-lo)', ' rig-wire-core')];
}

function drawRestart() {
  const g = state.g;
  const bar = $('rig-restart');
  if (state.restarting) return;
  bar.hidden = !g.restart_needed;
  if (!g.restart_needed) return;
  const n = G.pendingCables(g).length;
  const what = n ? `${n} cable${n === 1 ? ' waits' : 's wait'} for a restart` : 'A setting waits for a restart';
  bar.querySelector('.rig-restart-text').textContent = `${what}. ${RESTART_WARNING.replace('to use it', n === 1 || !n ? 'to use it' : 'to use them')}`;
}

async function doRestart() {
  const btn = $('rig-restart-go');
  btn.disabled = true;
  const load = async () => {
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      return r.ok ? r.json() : null;
    } catch { return null; }
  };
  const now = await load();
  if (!now) { toast('Couldn’t reach Hindsight', 'bad'); btn.disabled = false; return; }
  const text = $('rig-restart').querySelector('.rig-restart-text');
  const res = await restartHindsight({
    before: now.started,
    load,
    accepted: () => { state.restarting = true; text.textContent = 'Restarting…'; btn.hidden = true; },
  });
  if (res.ok) {
    text.textContent = res.data.error ? `Back, but your saved settings weren’t used: ${res.data.error}` : 'Back';
    setTimeout(() => location.reload(), 600);
    return;
  }
  state.restarting = false;
  btn.disabled = false;
  btn.hidden = false;
  if (res.gone) text.textContent = res.error;
  else toast(res.error, 'bad');
}

// --- the inspector -------------------------------------------------------------------

function drawInspector() {
  const g = state.g;
  const insp = $('rig-insp');
  const sel = state.pick.sel ? G.socketById(g, state.pick.sel) : null;
  const cable = state.cable ? (g.cables || []).find((c) => c.id === state.cable) : null;
  // Rebuilt only when what it shows changed: a level moving updates in place.
  const strip = (s) => s && { ...s, peak_db: undefined, signal: undefined };
  const sig = JSON.stringify([state.pick, strip(sel), cable, sel && G.cablesAt(g, sel.id), g.warnings, g.keep, g.offer, g.tape, g.settings, g.labels, g.restart_needed]);
  if (sig !== state.inspSig) {
    const keep = insp.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    insp.replaceChildren(...(cable ? cableView(g, cable) : sel ? socketView(g, sel) : overview(g)));
    state.inspSig = sig;
    insp.classList.toggle('open', !!(sel || cable));
    if (keep) insp.querySelector(`[data-key="${CSS.escape(keep)}"]`)?.focus({ preventScroll: true });
  }
  // The level, kept moving.
  const lv = insp.querySelector('.rig-level');
  if (lv && sel) {
    const tap = sel.kind === 'tap' ? sel : sel.tap ? G.socketById(g, `kit.tap.${sel.tap}`) : null;
    const peak = tap ? tap.peak_db : null;
    lv.querySelector('.rig-level-words').textContent = G.levelWords(peak);
    const pct = typeof peak === 'number' ? Math.max(0, Math.min(100, (peak + 60) / 60 * 100)) : 0;
    lv.querySelector('.rig-level-fill').style.width = `${pct}%`;
  }
}

function heading(kicker, title, about) {
  const out = [el('p', 'rig-kicker', kicker), el('h2', 'rig-insp-title', title)];
  if (about) out.push(el('p', 'rig-insp-about', about));
  return out;
}

function closeBtn() {
  return button('icon-btn rig-insp-close', 'Done', () => { state.pick = letGo(); state.cable = null; render(); }, 'rig-done');
}

function overview(g) {
  const out = heading('The rig', 'Choose a socket', 'Every socket is a button: choose one to see what it carries, then where it goes. Or drag from one socket to another. Each cable is a setting.');
  for (const w of g.warnings || []) out.push(warningBox(g, w));
  if (g.offer) out.push(offerBox(g));
  out.push(settingsBox(g));
  return out;
}

function warningBox(g, w) {
  const box = el('div', 'rig-warn');
  box.append(el('p', 'rig-warn-title', `The tape is in ${w.tap.toUpperCase()}`), el('p', 'rig-warn-text', w.text));
  if (w.fix) {
    const b = button('icon-btn rig-fix', w.fix.label, () => send(fixWrite(g, w), w.fix.label.replace(/^Move/, 'Moved'), { undo: true }), 'rig-fix');
    b.dataset.key = `fix:${w.id}`;
    box.append(b);
  }
  return box;
}

function offerBox(g) {
  const box = el('div', 'rig-offer');
  box.append(el('p', 'rig-offer-text', g.offer.about));
  if (g.offer.pending) box.append(el('p', 'rig-note', 'Saved: it takes effect when Hindsight restarts.'));
  else {
    const b = button('icon-btn', g.offer.label, () => send(offerWrite(g), 'The taps are this interface’s own'), 'rig-offer');
    b.dataset.key = 'offer';
    box.append(b);
  }
  return box;
}

function settingsBox(g) {
  const det = el('details', 'rig-settings');
  det.append(el('summary', '', 'The settings this picture is'));
  const dl = el('dl', 'rig-settings-list');
  for (const l of g.settings || []) {
    dl.append(el('dt', '', l.key), el('dd', l.pending ? 'pending' : '', l.value === '' ? '—' : l.value + (l.pending ? `  (running: ${l.running || '—'})` : '')));
  }
  det.append(dl);
  return det;
}

function levelBox() {
  const lv = el('div', 'rig-level');
  const bar = el('span', 'rig-level-bar');
  bar.setAttribute('aria-hidden', 'true');
  bar.append(el('span', 'rig-level-fill'));
  lv.append(el('span', 'rig-level-k', 'level now'), bar, el('span', 'rig-level-words', ''));
  return lv;
}

function cableRow(g, s, c) {
  const other = G.socketById(g, G.otherEnd(c, s.id));
  const row = el('li', `rig-patched${c.pending ? ' pending' : ''}`);
  const what = c.kind === 'jack' ? `“${c.label}”, drawn by you` : other ? G.title(g, other) : G.otherEnd(c, s.id);
  row.append(el('span', `rig-kind rig-kind-${c.kind}`, ''), el('span', 'rig-patched-what', what));
  const notes = [];
  if (other && other.kind === 'track' && other.armed) notes.push('armed');
  if (c.pending === 'plug') notes.push('waits for a restart');
  if (c.pending === 'unplug') notes.push('unplugged: on until the restart');
  if (c.waiting) notes.push('no signal yet');
  if (c.off) notes.push('carrying nothing now');
  if (notes.length) row.append(el('span', 'rig-patched-note', notes.join(' · ')));
  const un = unplugFor(g, c), re = replugFor(g, c);
  if (un) {
    const b = button('icon-btn rig-unplug', 'Unplug', () => unplug(c), 'rig-unplug');
    b.dataset.key = `unplug:${c.id}`;
    b.setAttribute('aria-label', `Unplug ${what}`);
    row.append(b);
  } else if (re) {
    const b = button('icon-btn rig-unplug', 'Plug it back', () => send(re, 'Plugged back in'), 'rig-unplug');
    b.dataset.key = `replug:${c.id}`;
    row.append(b);
  }
  row.title = c.about || '';
  return row;
}

function socketView(g, s) {
  const dev = G.deviceOf(g, s.id);
  const kicker = dev && dev.id !== 'kit' ? `Selected · ${dev.name}` : 'Selected · the kit';
  const out = [closeBtn(), ...heading(kicker, G.title(g, s), s.about || '')];
  if (s.kind === 'tap' || s.tap) out.push(levelBox());
  // What it's patched to.
  const cables = G.cablesAt(g, s.id);
  if (cables.length) {
    out.push(el('p', 'rig-k', 'Patched to'));
    const ul = el('ul', 'rig-patched-list');
    for (const c of cables) ul.append(cableRow(g, s, c));
    out.push(ul);
  } else {
    out.push(el('p', 'rig-note', 'Nothing plugged in.'));
  }
  // A track: armed or not.
  if (s.kind === 'track' && g.tape) {
    const b = button(`icon-btn rig-arm${s.armed ? ' on' : ''}`, s.armed ? '● Armed: disarm it' : '● Arm it', () => armLamp(s.track), 'rig-arm');
    b.setAttribute('aria-pressed', String(!!s.armed));
    b.dataset.key = 'arm';
    b.disabled = recording(g).length > 0;
    out.push(b);
    if (recording(g).length) out.push(el('p', 'rig-note', `● Rec is ${recording(g).includes(s.track) ? 'on this track' : 'running'}: what’s armed, and its inputs, wait until it ends.`));
    if ((G.armed(g)).length > 1 && s.armed) out.push(el('p', 'rig-note', `Tracks ${G.armed(g).join(', ')} are armed: one ● records them all, each from its own input.`));
  }
  // Warnings it's part of.
  for (const w of G.warningsAt(g, s.id)) out.push(warningBox(g, w));
  // What a KEEP writes: one tap, or all.
  if (s.kind === 'keep') out.push(keepBox(g));
  // OUT: where the tape plays.
  if (s.kind === 'out') out.push(outBox(g));
  // A jack: what's plugged into it, as a label.
  if (role(s) === 'jack') out.push(labelBox(g, s));
  if (dev && dev.role === 'interface' && s.kind === 'usb' && g.offer) out.push(offerBox(g));
  // Where it can go: the keyboard's way to patch.
  if (state.pick.targets.length) {
    out.push(el('p', 'rig-k', 'Plug it into'));
    const ul = el('ul', 'rig-targets');
    for (const t of state.pick.targets) {
      const ts = G.socketById(g, t);
      const w = writeFor(g, s.id, t);
      const li = el('li');
      const b = button('rig-target-btn', `→ ${G.title(g, ts)}${w && w.restart ? ' (on restart)' : ''}`, () => {
        state.pick = { sel: s.id, targets: [] };
        patch(s.id, t);
      }, 'rig-target');
      b.dataset.key = `to:${t}`;
      li.append(b);
      ul.append(li);
    }
    out.push(ul);
  }
  return out;
}

function keepBox(g) {
  const box = el('div', 'rig-keep');
  box.append(el('p', 'rig-k', 'What a KEEP writes'));
  const seg = el('div', 'rig-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'What a KEEP writes');
  for (const ch of g.keep.choices) {
    const on = ch === 'all' ? g.keep.all : g.keep.tap === ch;
    const b = button(on ? 'on' : '', ch.toUpperCase(), () => { if (!on) send(keepWrite(g, ch), `A KEEP writes ${ch === 'all' ? 'every input' : ch.toUpperCase()}`); }, 'rig-keep');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.dataset.key = `keep:${ch}`;
    seg.append(b);
  }
  box.append(seg, el('p', 'rig-note', `One tap, or all of them (about 23 MB a minute per pair). Applies on restart.${g.keep.pending ? ' Saved: waiting for the restart.' : ''}${!g.keep.all && !g.keep.tap && g.keep.pair ? ` Now USB ${g.keep.pair.join('/')}, which is no tap.` : ''}`));
  return box;
}

function outBox(g) {
  const box = el('div', 'rig-keep');
  box.append(el('p', 'rig-k', 'Where the tape plays'));
  const seg = el('div', 'rig-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Where the tape plays');
  const now = g.tape ? g.tape.output : 'jam';
  for (const [mode, words] of [['jam', 'The room'], ['phone', 'A phone'], ['both', 'Both']]) {
    const on = now === mode;
    const b = button(on ? 'on' : '', words, () => { if (!on) send(outputWrite(mode), `The tape plays in ${words.toLowerCase()}`); }, 'rig-out');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.dataset.key = `out:${mode}`;
    seg.append(b);
  }
  box.append(seg);
  return box;
}

function labelBox(g, s) {
  const form = el('form', 'rig-label');
  const id = `rig-label-${s.id.replace(/[^a-z0-9]/gi, '-')}`;
  const lab = el('label', 'rig-k', 'What’s plugged in here');
  lab.htmlFor = id;
  const input = el('input', 'rig-label-input');
  input.id = id;
  input.maxLength = 40;
  input.placeholder = 'guitar, Bento out, monitors…';
  input.value = (g.labels || {})[s.id] || '';
  input.dataset.key = 'label';
  input.dataset.tip = 'rig-label';
  const save = el('button', 'icon-btn', 'Label it');
  save.type = 'submit';
  save.dataset.tip = 'rig-label';
  form.append(lab, input, save);
  if ((g.labels || {})[s.id]) form.append(button('icon-btn', 'Take it off', () => send(labelWrite(s.id, ''), 'Label taken off'), 'rig-label'));
  form.append(el('p', 'rig-note', 'A label names what’s there, on the tap and the track’s input. Hindsight sees signal, not cables: it routes nothing.'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(labelWrite(s.id, input.value), input.value.trim() ? `Labelled “${input.value.trim()}”` : 'Label taken off');
  });
  return form;
}

function cableView(g, c) {
  const from = G.socketById(g, c.from), to = G.socketById(g, c.to);
  const fromName = c.from.startsWith('label:') ? `“${c.label}”` : G.title(g, from);
  const out = [closeBtn(), ...heading(`A cable · ${c.kind}`, `${fromName} → ${G.title(g, to)}`, c.about || '')];
  out.push(el('p', 'rig-note', `It is ${c.writes}.${c.restart ? ' It takes effect when Hindsight restarts.' : ' It takes effect at once.'}${c.pending === 'plug' ? ' Saved, and waiting for the restart.' : ''}${c.pending === 'unplug' ? ' Unplugged, and still on until the restart.' : ''}`));
  const un = unplugFor(g, c), re = replugFor(g, c);
  if (un) out.push(button('icon-btn rig-unplug', 'Unplug', () => { state.cable = null; unplug(c); }, 'rig-unplug'));
  if (re) out.push(button('icon-btn rig-unplug', 'Plug it back', () => send(re, 'Plugged back in'), 'rig-unplug'));
  return out;
}

// --- choosing and dragging -------------------------------------------------------------

function onChoose(id) {
  if (state.drag && state.drag.suppress) { state.drag = null; return; }
  const g = state.g;
  if (!g) return;
  state.cable = null;
  const r = choose(g, allSockets(deskOf(g)), state.pick, id);
  state.pick = r.state;
  render();
  if (r.write) patch(r.from, r.to);
}

function socketUnder(x, y) {
  const n = document.elementFromPoint(x, y);
  const b = n && n.closest ? n.closest('.rig-sock') : null;
  return b ? b.dataset.sock : null;
}

function onPointerDown(e, id) {
  if (e.button !== 0 || !state.g) return;
  state.drag = { from: id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, pointer: e.pointerId };
}

let scrollRaf = 0;
function autoscroll() {
  scrollRaf = 0;
  const d = state.drag;
  if (!d || !d.moved) return;
  const edge = 56;
  const dy = d.y < edge ? -12 : d.y > innerHeight - edge ? 12 : 0;
  if (dy) {
    scrollBy(0, dy);
    drawCables();
    scrollRaf = requestAnimationFrame(autoscroll);
  }
}

function onPointerMove(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointer) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) > 8) {
    d.moved = true;
    const g = state.g;
    state.cable = null;
    state.pick = { sel: d.from, targets: allSockets(deskOf(g)).filter((s) => writeFor(g, d.from, s.id)).map((s) => s.id) };
    $('rig-desk').classList.add('dragging');
    render();
  }
  if (d.moved) {
    e.preventDefault();
    const over = socketUnder(d.x, d.y);
    for (const b of document.querySelectorAll('.rig-sock.drop')) b.classList.remove('drop');
    if (over && state.pick.targets.includes(over)) document.querySelector(`.rig-sock[data-sock="${CSS.escape(over)}"]`)?.classList.add('drop');
    drawCables();
    if (!scrollRaf) scrollRaf = requestAnimationFrame(autoscroll);
  }
}

function endDrag(e, cancelled) {
  const d = state.drag;
  if (!d || (e && e.pointerId !== d.pointer)) return;
  $('rig-desk').classList.remove('dragging');
  for (const b of document.querySelectorAll('.rig-sock.drop')) b.classList.remove('drop');
  if (!d.moved) { state.drag = null; return; }
  // The click that follows a drag isn't a choice.
  state.drag = { suppress: true };
  setTimeout(() => { if (state.drag && state.drag.suppress) state.drag = null; }, 400);
  const g = state.g;
  if (cancelled) { drawCables(); return; }
  const over = socketUnder(d.x, d.y);
  if (over && over !== d.from && writeFor(g, d.from, over)) {
    state.pick = { sel: d.from, targets: [] };
    patch(d.from, over);
    return;
  }
  if (!over) {
    // A pull on a plug unplugs it: the one cable that can be.
    const can = G.cablesAt(g, d.from).filter((c) => unplugFor(g, c));
    if (can.length === 1) { unplug(can[0]); return; }
    if (can.length > 1) toast('More than one cable is in that socket: choose which to unplug', 'warn');
  }
  render();
}
function onKey(e) {
  if (e.key === 'Escape' && (state.pick.sel || state.cable)) {
    state.pick = letGo();
    state.cable = null;
    render();
  }
}

// --- the legend ----------------------------------------------------------------------

function drawLegend() {
  const ul = $('rig-legend');
  ul.replaceChildren(...legend().map((k) => {
    const li = el('li', 'rig-legend-item');
    // A sample of the cable, centred in its own little window of desk.
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '52');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 52 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'rig-swatch');
    svg.append(...wire('M7 10 H45', { width: Math.min(k.width, 9), dash: k.dash, ink: k.ink, hollow: !!k.hollow, faded: false }, `rig-wire rig-wire-${k.kind}`));
    li.append(svg, el('span', '', k.legend));
    return li;
  }));
}

// --- start ------------------------------------------------------------------------

/**
 * start draws the rig, with the two rooms on. With them off it says where
 * the switch is and stops: nothing is asked of the Pi, nothing listened for.
 * Everything is passed in, so a test can hold it to that.
 */
export function start({ flagOn = roomsOn, doc = document, nav = initNav, help = initHelp, win = globalThis } = {}) {
  nav();
  help({ page: 'rig' });
  let tapeOn = null;
  try { tapeOn = win.localStorage.getItem('hindsight.tapeOn'); } catch { /* fine */ }
  doc.getElementById('rig-back').href = tapeOn === 'false' ? '/' : '/tape.html';
  if (!flagOn()) {
    doc.getElementById('rig-off').hidden = false;
    const back = doc.getElementById('rig-back').querySelector?.('.back-text');
    if (back) back.textContent = 'Back'; // there's no Studio with the rooms off
    return false;
  }
  doc.getElementById('rig-room').hidden = false;
  drawLegend();
  doc.getElementById('rig-restart-go').addEventListener('click', doRestart);
  win.addEventListener('resize', () => { if (state.g) drawCables(); });
  win.addEventListener('pointermove', onPointerMove, { passive: false });
  win.addEventListener('pointerup', (e) => endDrag(e, false));
  win.addEventListener('pointercancel', (e) => endDrag(e, true));
  win.addEventListener('keydown', onKey);
  refresh();
  polling = setInterval(() => {
    if (doc.hidden || state.sending || (state.drag && state.drag.moved) || state.restarting) return;
    refresh();
  }, POLL_MS);
  return true;
}

// On the rig page, on load. Everything above stays importable and testable.
if (typeof document !== 'undefined' && document.body?.classList.contains('rig-page')) start();
