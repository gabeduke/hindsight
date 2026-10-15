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
//
// The cables are ropes (R4, docs/superpowers/specs/2026-10-15-r4-cables-design.md):
// each is a `cable` object in a scene on the shared ticker. This page says
// where each one's ends are; the model (lib/scene/cable.js) hangs and swings
// the rope, and the renderer (ropes.js) only draws it. A plug in the hand
// snaps into a socket and comes out with a pull (lib/scene/plug.js).

import { on as roomsOn } from '../rooms/flag.js';
import { initNav } from '../nav.js';
import { toast } from '../toast.js';
import { initHelp } from '../help/help.js';
import { restartHindsight, RESTART_WARNING } from '../settings.js';
import { desk as deskOf, allSockets } from './desk.js';
import { centreIn } from './cables.js';
import { Leader } from './route.js';
import { legend } from './kinds.js';
import { RopeRenderer, strokes } from './ropes.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { snap, pull, lean, PULL_PX } from '../scene/plug.js';
import { deskClick, release, dropSeed, remade } from './gesture.js';
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
  drag: null, // a drag from a socket: {from, x, y, moved, pointer}, and once moved what's in the hand
  gRead: 0, // the read the graph came from
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
let reads = 0; // reads of /api/rig begun
async function refresh() {
  const n = ++reads;
  let g;
  try {
    g = await read();
  } catch (e) {
    if (!state.g) $('rig-found').textContent = `Couldn’t reach Hindsight: ${e.message}`;
    return;
  }
  // A read that began before the one already drawn is older: drop it.
  if (n < state.gRead) return;
  state.g = g;
  state.gRead = n;
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
    // A drop's rope, or a pulled plug, waits for the first read begun after
    // this write: that read is the one that draws what the write did.
    for (const h of [dropped, pulled]) if (h && h.after === Infinity) h.after = reads;
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
  if (!w) return false;
  const both = [role(G.socketById(g, a)), role(G.socketById(g, b))];
  send(w, said(g, a, b), { undo: both.includes('bus') });
  return true;
}

function unplug(c) {
  const w = unplugFor(state.g, c);
  if (!w) return false;
  send(w, `Unplugged ${G.title(state.g, G.socketById(state.g, c.from)) || c.label} → ${G.title(state.g, G.socketById(state.g, c.to))}`);
  return true;
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

// --- the cables: ropes ------------------------------------------------------------

// Every cable is a `cable` object in this scene, on the shared ticker. The
// page says where each one's ends are; the model hangs and swings the rope;
// the renderer draws it in .rig-wires, over the sockets, taking no input.
let scene = null;
let ropes = null;
const DRAG = 'cable:drag'; // the rope in the hand: a new cable drawn out of a socket
let holes = new Map(); // socket id (or label:id) → its hole on the desk, as last measured
// The waypoints each cable is led through (lib/rig/route.js). The Leader runs
// the router only when the layout changed, once for a burst of changes, and
// at once for a new or removed cable; a later run redraws the ropes.
const leader = new Leader({ onRoutes: (r) => { routes = r; drawCables(); } });
let routes = new Map();
// A drop, and a pulled plug, are drawn as they were let go until the read
// after their write draws what it did: {…, after}, the reads begun by then
// (Infinity until the write is done).
let dropped = null; // {from, to, points, after}
let pulled = null; // {id, end, at, after}

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

// obstacles is what a rope must not cross, where it is on the desk: every
// jack's hole, and every name, title and lamp. Each socket's are its own
// (its cables plug into it); route.js leads the others round.
const TEXTS = '.rig-sock-label, .rig-sock-name, .rig-row-title, .rig-dev-name, .rig-dev-sub, .rig-dev-note, .rig-tag, .rig-arm-lamp';
function obstacles(deskBox) {
  const out = [];
  // A name's box is the text itself: a row's title is a block as wide as the
  // row, and a rope kept off all of that would have nowhere to go.
  const boxOf = (e, type) => {
    if (type === 'text' && e.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(e);
      const r = range.getBoundingClientRect();
      if (r.width && r.height) return r;
    }
    return e.getBoundingClientRect();
  };
  const rect = (e, type, owner) => {
    if (!e.getClientRects().length) return;
    const r = boxOf(e, type);
    if (!r.width || !r.height) return;
    out.push({ type, owner, x: Math.round((r.left - deskBox.left) * 10) / 10, y: Math.round((r.top - deskBox.top) * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  };
  for (const b of document.querySelectorAll('#rig-desk .rig-sock')) {
    const hole = b.querySelector('.rig-hole');
    if (hole) rect(hole, 'hole', b.dataset.sock);
  }
  for (const t of document.querySelectorAll(`#rig-desk :is(${TEXTS})`)) {
    if (!t.textContent.trim() && !t.classList.contains('rig-arm-lamp')) continue;
    rect(t, 'text', t.closest('.rig-sock')?.dataset.sock || '');
  }
  return out;
}

/**
 * lead says where each cable runs: the waypoints it is pinned to, so its
 * rope hangs through the gaps. The Leader works them out again only when the
 * desk is laid out differently (once for a burst of changes), not on every poll.
 */
function lead(box) {
  const g = state.g;
  const size = { w: box.width, h: box.height };
  const cables = (g.cables || []).map((c) => ({ id: c.id, from: c.from, to: c.to, declared: c.kind === 'jack', a: holes.get(c.from), b: holes.get(c.to) }));
  routes = leader.lead({ cables, obstacles: obstacles(box), size });
}

/**
 * measure finds every socket's hole, and every label's tag, on the desk, leads
 * the cables across it, and sizes the wires to it. It reads layout, so it
 * runs when the desk is drawn or resized, and at the start of a drag -- not
 * while a finger moves.
 */
function measure() {
  const g = state.g;
  const deskEl = $('rig-desk');
  const box = deskEl.getBoundingClientRect();
  const wires = deskEl.querySelector('.rig-wires');
  const w = String(Math.round(box.width)), h = String(Math.round(box.height));
  if (wires.getAttribute('width') !== w || wires.getAttribute('height') !== h) {
    wires.setAttribute('viewBox', `0 0 ${w} ${h}`);
    wires.setAttribute('width', w);
    wires.setAttribute('height', h);
  }
  holes = new Map();
  for (const s of allSockets(deskOf(g))) holes.set(s.id, holeAt(s.id, box));
  for (const c of g.cables || []) for (const id of [c.from, c.to]) if (!holes.has(id)) holes.set(id, holeAt(id, box));
  lead(box);
  return box;
}

// moved says an end has moved by half a pixel or more: less, and setting it
// would wake the ticker for nothing on every poll.
const moved = (p, q) => (!p || !q ? p !== q : Math.abs(p.x - q.x) >= 0.5 || Math.abs(p.y - q.y) >= 0.5);
const ledMoved = (u = [], v = []) => u.length !== v.length || u.some((p, i) => moved(p, v[i]));

/** setRope sets what changed in a rope's state, and nothing that didn't. */
function setRope(obj, next) {
  const s = obj.state;
  const patch = {};
  for (const k of Object.keys(next)) {
    if (k === 'via' ? ledMoved(s[k], next[k]) : k === 'a' || k === 'b' ? moved(s[k], next[k]) : s[k] !== next[k]) patch[k] = next[k];
  }
  if (Object.keys(patch).length) obj.set(patch);
}

/** deskPoint is where the finger is on the desk, from where the desk was at the drag's start and how far the page has scrolled since. */
function deskPoint(d) {
  return { x: d.x + scrollX - d.ox, y: d.y + scrollY - d.oy };
}

/**
 * hand is what's in the hand during a drag from socket S, and where:
 *   - near a socket S can go into: a new cable out of S, snapped into it;
 *   - holding S's one cable: its plug, in until it's pulled 48 px, then out
 *     at the finger -- let go there and it's unplugged;
 *   - otherwise a new cable out of S, its plug at the finger.
 * So the rope in the hand always shows what letting go will do.
 */
function hand(d) {
  const from = holes.get(d.from);
  if (!from) return null;
  const p = deskPoint(d);
  const over = snap(p, d.targets);
  d.over = over ? over.id : null;
  if (over) {
    d.out = false;
    return { rope: { a: from, b: { x: over.x, y: over.y }, to: over.id, loose: '' } };
  }
  if (d.holding) {
    d.out = pull(d.out, from, p);
    return { held: d.holding, end: d.end, at: d.out ? p : lean(from, p), loose: d.out };
  }
  return { rope: { a: from, b: p, to: '', loose: 'b' } };
}

/**
 * drawCables brings every rope's state up to date: one per cable in the
 * graph, with its ends where its sockets are (or in the hand), and the rope
 * being drawn out of a socket. The scene's ticker does the rest.
 */
function drawCables() {
  if (!scene || !state.g) return;
  const g = state.g;
  const d = state.drag && state.drag.moved ? state.drag : null;
  if (!d) measure();
  const h = d ? hand(d) : null;
  // The first read begun after a drop's or a pull's write draws what it did.
  const settled = (x) => x && state.gRead > x.after;
  const seen = new Set();
  for (const c of g.cables || []) {
    let a = holes.get(c.from), b = holes.get(c.to);
    if (!a || !b) continue;
    let loose = '';
    const held = h && h.held === c.id ? h : pulled && pulled.id === c.id && !settled(pulled) ? pulled : null;
    if (held) {
      if (held.end === 'a') a = held.at;
      else b = held.at;
      if (held.loose) loose = held.end;
    }
    const id = `cable:${c.id}`;
    seen.add(id);
    const next = {
      from: c.from, to: c.to, kind: c.kind, pending: c.pending || '', declared: c.kind === 'jack',
      off: !!c.off, waiting: !!c.waiting, selected: state.cable === c.id, loose, a, b,
      // A cable in the hand is free; the rest are led through the gaps.
      via: held ? [] : routes.get(c.id) || [],
    };
    // A drop's cable carries on from the rope that made it. A seed only
    // applies to a rope being made, so a drop onto an occupied socket, which
    // re-patches a cable that has an object already, takes that one off and
    // makes it again.
    const drop = settled(dropped) ? dropped : null;
    let obj = scene.get(id);
    if (obj && remade(obj.state, c, drop)) {
      scene.remove(id);
      obj = null;
    }
    if (obj) { setRope(obj, next); continue; }
    const seed = dropSeed(drop, c);
    scene.add(new SceneObject(id, 'cable', seed ? { ...next, seed } : next));
  }
  if (settled(pulled)) pulled = null;
  if (settled(dropped)) dropped = null;
  // The rope in the hand; or, let go into a socket, as it was until its read.
  const rope = h && h.rope;
  if (rope) {
    const next = { from: d.from, to: rope.to, kind: 'patch', drawing: true, loose: rope.loose, a: rope.a, b: rope.b };
    const obj = scene.get(DRAG);
    if (obj) setRope(obj, next);
    else scene.add(new SceneObject(DRAG, 'cable', next));
    seen.add(DRAG);
  } else if (dropped) seen.add(DRAG);
  for (const o of scene.objects()) if (!seen.has(o.id)) scene.remove(o.id);
  // Where a plug in the hand would go in, lit.
  for (const b of document.querySelectorAll('.rig-sock.drop')) if (!d || b.dataset.sock !== d.over) b.classList.remove('drop');
  if (d && d.over) document.querySelector(`.rig-sock[data-sock="${CSS.escape(d.over)}"]`)?.classList.add('drop');
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
    if (keep) insp.querySelector(`[data-key="${CSS.escape(keep)}"]`)?.focus({ preventScroll: true });
  }
  // On a phone the inspector is a sheet over the desk's foot: it waits for
  // a drag to end, rather than covering the rope in the hand.
  insp.classList.toggle('open', !!(sel || cable) && !(state.drag && state.drag.moved));
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

// socketUnder is the socket whose button is under a point, if any.
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

// grab starts a drag that has moved: it measures the desk once, finds where
// the plug can go, and what's in the hand -- S's one cable that can be
// unplugged, if it has exactly one.
function grab(d) {
  const g = state.g;
  const box = measure();
  d.ox = box.left + scrollX;
  d.oy = box.top + scrollY;
  state.cable = null;
  state.pick = { sel: d.from, targets: allSockets(deskOf(g)).filter((s) => writeFor(g, d.from, s.id)).map((s) => s.id) };
  d.targets = state.pick.targets.map((id) => {
    const at = holes.get(id);
    const b = document.querySelector(`.rig-sock[data-sock="${CSS.escape(id)}"]`);
    if (!at || !b) return null;
    const r = b.getBoundingClientRect();
    return { id, x: at.x, y: at.y, box: { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top } };
  }).filter(Boolean);
  const can = G.cablesAt(g, d.from).filter((c) => unplugFor(g, c));
  d.holding = can.length === 1 ? can[0].id : null;
  d.end = can.length === 1 && can[0].from === d.from ? 'a' : 'b';
  d.several = can.length > 1;
  d.out = false;
  d.over = null;
}

function onPointerMove(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointer) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) > 8) {
    grab(d);
    d.moved = true;
    $('rig-desk').classList.add('dragging');
    render();
  }
  if (d.moved) {
    e.preventDefault();
    drawCables();
    if (!scrollRaf) scrollRaf = requestAnimationFrame(autoscroll);
  }
}

function endDrag(e, cancelled) {
  const d = state.drag;
  if (!d || (e && e.pointerId !== d.pointer)) return;
  $('rig-desk').classList.remove('dragging');
  if (!d.moved) { state.drag = null; return; }
  // The click that follows a drag isn't a choice.
  state.drag = { suppress: true };
  setTimeout(() => { if (state.drag && state.drag.suppress) state.drag = null; }, 400);
  const g = state.g;
  if (cancelled) { render(); return; }
  // What letting go does: gesture.js decides. Over any socket's button the
  // plug isn't out, so a mis-drop onto one it can't go into changes nothing.
  const onSocket = socketUnder(d.x, d.y) !== null;
  const what = release({
    over: d.over, from: d.from, canPatch: !!d.over && !!writeFor(g, d.from, d.over),
    holding: d.holding, out: d.out, onSocket,
  });
  // Let go snapped into a socket: a new cable, carrying on from this rope.
  if (what === 'patch') {
    const rope = scene && scene.get(DRAG);
    dropped = { from: d.from, to: d.over, points: rope && rope.view ? rope.view.points : null, after: Infinity };
    state.pick = { sel: d.from, targets: [] };
    if (!patch(d.from, d.over)) dropped = null;
    drawCables();
    return;
  }
  // Let go of a plug pulled out: it's unplugged.
  if (what === 'unplug') {
    const c = (g.cables || []).find((x) => x.id === d.holding);
    if (c) {
      pulled = { id: c.id, end: d.end, at: deskPoint(d), loose: true, after: Infinity };
      if (!unplug(c)) pulled = null;
      render();
      return;
    }
  }
  const from = holes.get(d.from);
  if (d.several && !onSocket && from && Math.hypot(deskPoint(d).x - from.x, deskPoint(d).y - from.y) > PULL_PX) {
    toast('More than one cable is in that socket: choose which to unplug', 'warn');
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
    svg.append(...strokes(document, 'M7 10 H45', { width: Math.min(k.width, 9), dash: k.dash, ink: k.ink, hollow: !!k.hollow, faded: false }, `rig-wire rig-wire-${k.kind}`));
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
  // The ropes: a scene on the shared ticker, drawn over the sockets.
  const desk = doc.getElementById('rig-desk');
  scene = new Scene();
  ropes = new RopeRenderer({ doc });
  ropes.mount(desk.querySelector('.rig-wires'), scene);
  scene.start();
  // The sockets move when the desk is laid out again, or the fonts arrive.
  const again = () => { if (state.g && !(state.drag && state.drag.moved)) drawCables(); };
  if (win.ResizeObserver) new win.ResizeObserver(again).observe(desk);
  else win.addEventListener('resize', again);
  doc.fonts?.ready.then(again);
  // A tap on a rope's run shows its cable: through the renderer's hit(),
  // anywhere that isn't a control -- the felt, or a card under the rope.
  const control = (e) => e.target.closest?.('button, a, input, label, summary, select, textarea, form');
  desk.addEventListener('click', (e) => {
    // The click a drag leaves behind is spent, wherever it landed.
    const kind = deskClick(state.drag, !!control(e));
    if (kind === 'spent') { state.drag = null; return; }
    if (kind === 'control') return;
    const id = ropes.hit(e.clientX, e.clientY);
    if (!id || id === DRAG) return;
    state.cable = id.slice('cable:'.length);
    state.pick = letGo();
    render();
  });
  desk.addEventListener('pointermove', (e) => {
    if (state.drag || e.pointerType !== 'mouse') return;
    desk.classList.toggle('rig-over-rope', !control(e) && !!ropes.hit(e.clientX, e.clientY));
  });
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
