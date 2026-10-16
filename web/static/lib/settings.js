// web/static/lib/settings.js
// Settings, from the foot of Capture: "Hindsight v… · Releases · Settings ·
// the guide" (docs/superpowers/specs/2026-10-09-settings-design.md).
//
// GET /api/settings is the registry: every setting with its value, the value
// running now, and where it comes from (the app, the env file, the default).
// The sheet draws a field per setting, grouped as the registry says. Save
// PUTs what changed; Reset PUTs null, which hands the value back to the env
// file or the default. Changes apply on restart: once one is saved the sheet
// offers Restart, which POSTs /api/restart and reloads when Hindsight is back
// with nothing owed.

import { DEVICE_PREFS, read as readDevicePrefs, write as writeDevicePref } from './device-prefs.js';
import { say, settingsGroup } from './rooms/words.js';

const POLL_MS = 1000;
const GIVE_UP_MS = 90 * 1000;
// The groups that start open; the rest are folded.
const OPEN = new Set(['Input', 'Buffer', 'Saving']);

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** bytes as "345 MB" / "3.7 GB". */
export function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

/**
 * ringBytes is what a buffer of `seconds` takes: seconds × rate × channels ×
 * 4 bytes, the ring's raw int32 samples. A full-buffer save copies it once
 * more while it encodes, so the peak is twice this.
 */
export function ringBytes(seconds, rate, channels) {
  const s = Number(seconds), r = Number(rate), c = Number(channels);
  if (!(s > 0 && r > 0 && c > 0)) return 0;
  return s * r * c * 4;
}

/**
 * ringNote is the line under Buffer length: what it costs, and a warning
 * when a full-buffer save's peak would crowd the machine's memory.
 */
export function ringNote(seconds, rate, channels, memory) {
  const b = ringBytes(seconds, rate, channels);
  if (!b) return { text: '', warn: false };
  const minutes = Math.round((Number(seconds) / 60) * 10) / 10;
  let text = `${minutes} min of ${channels} channel${channels === 1 ? '' : 's'}: ${humanBytes(b)} of memory`;
  if (memory > 0) text += ` of ${humanBytes(memory)}`;
  const warn = memory > 0 && 2 * b > 0.6 * memory;
  if (warn) text += '. Saving the whole buffer needs twice that, which is more than this machine can spare';
  return { text, warn };
}

/** inputLabel is "Scarlett Solo 4th Gen · 2 in" for a PortAudio input. */
export function inputLabel(inp) {
  const name = inp.name.replace(/:.*$/, '').trim() || inp.name;
  return `${name} · ${inp.channels} in`;
}

/** changes is {key: value} for every field whose value differs from the saved one. */
export function changes(settings, edits) {
  const out = {};
  for (const s of settings) {
    if (!(s.key in edits)) continue;
    const v = String(edits[s.key]).trim();
    if (v !== s.value) out[s.key] = v;
  }
  return out;
}

/**
 * hubLine is what the sheet says about the hub (GET /api/settings "hub"):
 * the secure address to link once there is a certificate for it, and the
 * hub's error, if any. null when the hub is off.
 */
export function hubLine(hub) {
  if (!hub) return null;
  const href = hub.url && hub.cert_not_after ? hub.url : '';
  let error = hub.error || '';
  if (!href && !error) error = 'waiting for the hub';
  return { href, error };
}

const FROM = { app: 'set here', env: 'from the env file', default: 'default' };

/** RESTART_WARNING is what a restart costs, said wherever one is offered. */
/**
 * revealOnOpen makes a settings group scroll into view when a person opens it.
 * The sheet's body scrolls, and the last group's rows open below its fold:
 * on a phone, tapping "This device" looked like nothing happened, because
 * the switches it had just shown were out of sight under Close and Save.
 *
 * Only a person's tap counts. A group that starts open fires the same
 * `toggle` event when the sheet is built, and revealing each of those
 * scrolled the sheet down to its last open group before anyone had touched
 * it. A tap or key on the summary arrives as a click first, so the click
 * arms the next toggle and an unarmed toggle is ignored.
 */
export function revealOnOpen(d) {
  let asked = false;
  d.addEventListener('click', (e) => {
    const t = e && e.target;
    if (t && typeof t.closest === 'function' && t.closest('summary')) asked = true;
  });
  d.addEventListener('toggle', () => {
    const byHand = asked;
    asked = false;
    if (byHand && d.open && typeof d.scrollIntoView === 'function') d.scrollIntoView({ block: 'nearest' });
  });
  return d;
}

/**
 * The Pi's groups in the order a person reaches for them: what is recording,
 * how far back, where it is kept, then the machines around it. A group the
 * registry adds later goes after these, in the order it came.
 */
const GROUP_ORDER = ['Input', 'Buffer', 'Saving', 'MIDI', 'Tape'];
export function groupOrder(names) {
  const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? GROUP_ORDER.length : i; };
  return names.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

/**
 * RESTART_NOTE is the one statement of what Save and Restart do, said once at
 * the head of the Pi's settings. The wording is the rooms' where they are on.
 */
export const RESTART_NOTE = say('These are the Pi’s, shared by every phone and laptop that opens it. Save keeps them; they apply when Hindsight restarts, and a restart empties the ring, so capture anything you want to keep first.');

/** busyNow is true while this page holds a phone recording (lib/phone/recorder.js sets it): a reload would lose it. */
const busyNow = () => typeof document !== 'undefined' && document.documentElement.dataset.phoneBusy === '1';

/**
 * One switch for one device preference: a button with role=switch, On or Off
 * written on it, named by its label and described by its note. `onChange`
 * gets the new value and answers whether it was kept.
 */
function prefRow(p, value, { onChange }) {
  const row = el('div', 'set-pref');
  const text = el('div', 'set-pref-text');
  const label = el('span', 'set-label', p.label);
  label.id = `pref-${p.id}-label`;
  const note = el('p', 'set-note set-pref-note', `${p.note} This device only.`);
  note.id = `pref-${p.id}-note`;
  const status = el('p', 'set-pref-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  text.append(label, note, status);
  const sw = el('button', 'set-switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-labelledby', label.id);
  sw.setAttribute('aria-describedby', note.id);
  const word = el('span', 'set-switch-word');
  sw.append(word, el('span', 'set-switch-knob'));
  const draw = (on) => {
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    word.textContent = on ? 'On' : 'Off';
  };
  draw(!!value);
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    const r = onChange(p, next);
    if (!r.ok) {
      status.textContent = 'This device cannot store settings (private browsing?).';
      status.hidden = false;
      return; // the switch stays as it was: do not claim it saved
    }
    draw(next);
    status.textContent = r.reload ? `Will be ${next ? 'on' : 'off'} after a reload.` : '';
    status.hidden = !r.reload;
  });
  row.append(text, sw);
  return row;
}

/**
 * The previews, as their own section at the top of the sheet: always open,
 * never folded, each a switch. They are this device's, kept in localStorage,
 * and save as they are clicked: there is nothing to send and nothing to
 * restart, so Save and Reset do not apply. One the page reads only at load
 * needs a reload, and one Reload for the section applies them all (an
 * installed phone app has no reload of its own). Flip one back and the
 * Reload goes away. It will not run while this page holds a phone recording.
 */
export function featuresGroup({ prefs = DEVICE_PREFS, read = readDevicePrefs, write = writeDevicePref, reload = () => location.reload(), busy = busyNow } = {}) {
  const feats = prefs.filter((p) => p.feature);
  const sec = el('section', 'set-features');
  sec.append(el('h4', 'set-section', 'Preview features'));
  sec.append(el('p', 'set-intro', 'Try-outs for this device only. The Pi and the other kits are unaffected, and none needs a restart.'));
  const now = read();
  const start = { ...now };
  const pending = new Set();
  const bar = el('div', 'set-reload-bar');
  bar.hidden = true;
  const barText = el('p', 'set-reload-text', 'Reload this page to apply. Only this page reloads: Hindsight keeps running.');
  barText.setAttribute('role', 'status');
  const again = el('button', 'icon-btn primary set-reload', 'Reload to apply');
  again.type = 'button';
  again.addEventListener('click', () => {
    if (busy()) {
      barText.textContent = 'A phone recording is running on this page. Finish it first, then reload.';
      return;
    }
    reload();
  });
  bar.append(barText, again);
  const onChange = (p, value) => {
    const r = write(p.id, value);
    if (!r.ok) return r;
    if (r.reload && value !== !!start[p.id]) pending.add(p.id);
    else pending.delete(p.id);
    bar.hidden = pending.size === 0;
    if (pending.size) barText.textContent = 'Reload this page to apply. Only this page reloads: Hindsight keeps running.';
    return r;
  };
  for (const p of feats) sec.append(prefRow(p, now[p.id], { onChange }));
  sec.append(bar);
  return sec;
}

/**
 * Device preferences that are not previews, if any: a folded group of the
 * same switches. A preview never goes here -- it would be out of sight. With
 * none left there is no group at all.
 */
export function deviceGroup({ prefs = DEVICE_PREFS, read = readDevicePrefs, write = writeDevicePref } = {}) {
  const rest = prefs.filter((p) => !p.feature);
  if (!rest.length) return null;
  const d = revealOnOpen(el('details', 'set-group'));
  d.open = false;
  d.append(el('summary', null, 'This device'));
  const now = read();
  for (const p of rest) d.append(prefRow(p, now[p.id], { onChange: (q, v) => write(q.id, v) }));
  return d;
}

export const RESTART_WARNING = say('Hindsight restarts to use it, so the ring starts empty: capture anything you want to keep first.');

/**
 * restartHindsight asks Hindsight to restart, and waits for it to come back
 * as a new process: the sheet's Restart, and the rig's. `before` is the
 * `started` of the process asking; `load` reads /api/settings; `accepted`
 * is called once the Pi has said yes. It answers {ok, data} once it's back,
 * or {ok: false, error}, with `gone` when it never came back.
 */
export async function restartHindsight({ before, load, accepted = () => {}, fetchFn = fetch, wait = (ms) => new Promise((res) => setTimeout(res, ms)) }) {
  let r;
  try {
    r = await fetchFn('/api/restart', { method: 'POST' });
  } catch {
    r = null;
  }
  if (!r || r.status !== 202) {
    const resp = r ? await r.json().catch(() => ({})) : {};
    return { ok: false, error: resp.error || 'Couldn’t reach Hindsight' };
  }
  accepted();
  const started = Date.now();
  while (Date.now() - started < GIVE_UP_MS) {
    await wait(POLL_MS);
    const d = await load();
    // Back as a new process.
    if (d && d.started !== before) return { ok: true, data: d };
  }
  return { ok: false, gone: true, error: 'It hasn’t come back. Check the Pi: journalctl _SYSTEMD_USER_UNIT=hindsight.service' };
}

export function initSettings() {
  const btn = document.getElementById('settings-btn');
  const sheet = document.getElementById('settings-sheet');
  if (!btn || !sheet) return;
  const $ = (sel) => sheet.querySelector(sel);
  const body = $('.settings-body');
  const errEl = $('.settings-error');
  const restartEl = $('.settings-restart');
  const progress = $('.settings-progress');
  const save = $('.settings-save');
  const restartBtn = $('.settings-restart-go');
  const close = $('.settings-close');

  let data = null;
  let edits = {};
  let restarting = false;

  const setError = (msg) => {
    errEl.hidden = !msg;
    errEl.textContent = msg ? cap(msg) : '';
  };

  const dirty = () => Object.keys(changes(data ? data.settings : [], edits)).length > 0;

  function refreshButtons() {
    save.disabled = !dirty();
    restartEl.hidden = !(data && data.restart_needed) || dirty();
  }

  const valueOf = (key) => {
    if (key in edits) return String(edits[key]);
    const s = data.settings.find((x) => x.key === key);
    return s ? s.value : '';
  };

  function edit(key, v) {
    edits[key] = v;
    refreshButtons();
    drawNotes();
  }

  // Notes that follow other fields: the buffer's memory, the mono hint.
  function drawNotes() {
    const ring = body.querySelector('[data-note="RING_SECONDS"]');
    if (ring) {
      const ch = /^\d+$/.test(valueOf('CHANNELS')) ? Number(valueOf('CHANNELS')) : data.channels;
      const n = ringNote(valueOf('RING_SECONDS'), valueOf('SAMPLE_RATE'), ch, data.memory_bytes || 0);
      ring.textContent = n.text;
      ring.classList.toggle('warn', n.warn);
    }
    const mix = body.querySelector('[data-note="SAVE_MIX"]');
    if (mix) {
      const two = data.channels === 2 && valueOf('SAVE_MIX') === 'stereo' && valueOf('SAVE_ALL_CHANNELS') !== 'true';
      mix.textContent = two
        ? 'This interface has two inputs. In stereo, input 1 is left and input 2 right; mono puts a mic and an instrument both in the middle.'
        : '';
    }
  }

  function control(s) {
    const id = `set-${s.key}`;
    const v = s.value;
    let input;
    if (s.key === 'DEVICE_MATCH') {
      input = el('select');
      const opts = [['auto', 'Automatic']];
      for (const inp of data.inputs) opts.push([inp.name.replace(/:.*$/, '').trim() || inp.name, inputLabel(inp)]);
      if (!opts.some(([val]) => val === v)) opts.push([v, `${v} · not connected`]);
      for (const [val, label] of opts) {
        const o = el('option', null, label);
        o.value = val;
        input.append(o);
      }
      input.value = v;
      input.addEventListener('change', () => edit(s.key, input.value));
    } else if (s.kind === 'bool') {
      input = el('input');
      input.type = 'checkbox';
      input.checked = v === 'true';
      input.addEventListener('change', () => edit(s.key, String(input.checked)));
    } else if (s.kind === 'choice') {
      input = el('select');
      for (const c of s.choices) {
        const o = el('option', null, s.unit ? `${c} ${s.unit}` : cap(c));
        o.value = c;
        input.append(o);
      }
      input.value = v;
      input.addEventListener('change', () => edit(s.key, input.value));
    } else {
      input = el('input');
      input.type = 'text';
      input.value = v;
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (s.kind === 'int' || s.kind === 'float') input.inputMode = s.kind === 'int' && !s.auto ? 'numeric' : 'decimal';
      if (s.auto) input.placeholder = 'auto';
      input.addEventListener('input', () => edit(s.key, input.value));
    }
    input.id = id;
    return input;
  }

  function field(s) {
    const row = el('div', 'set-field' + (s.kind === 'bool' ? ' bool' : ''));
    row.dataset.key = s.key;
    const label = el('label', 'set-label', say(s.label));
    label.htmlFor = `set-${s.key}`;
    const ctl = control(s);
    const head = el('div', 'set-head');
    if (s.kind === 'bool') head.append(ctl, label);
    else head.append(label);
    if (s.unit && s.kind !== 'choice') head.append(el('span', 'set-unit', s.unit));
    row.append(head);
    if (s.kind !== 'bool') row.append(ctl);
    row.append(el('p', 'set-help', say(s.help)));
    const meta = el('div', 'set-meta');
    meta.append(el('span', 'set-from', FROM[s.from] || s.from));
    if (s.value !== s.running) meta.append(el('span', 'set-pending', `running: ${s.running || '(empty)'}`));
    if (s.from === 'app') {
      const reset = el('button', 'set-reset', 'Reset');
      reset.type = 'button';
      reset.addEventListener('click', () => put({ [s.key]: null }));
      meta.append(reset);
    }
    row.append(meta);
    if (s.key === 'RING_SECONDS' || s.key === 'SAVE_MIX') {
      const note = el('p', 'set-note');
      note.dataset.note = s.key;
      row.append(note);
    }
    return row;
  }

  function draw() {
    body.replaceChildren();
    if (data.device) body.append(el('p', 'set-device', `Recording from ${data.device.replace(/:.*$/, '')}, ${data.channels} channel${data.channels === 1 ? '' : 's'}`));
    else body.append(el('p', 'set-device', 'No interface found yet'));
    const hub = hubLine(data.hub);
    if (hub) {
      const p = el('p', 'set-device set-hub');
      if (hub.href) {
        const a = el('a', null, hub.href);
        a.href = hub.href;
        p.append('Secure address: ', a);
        if (hub.error) p.append(el('span', 'set-hub-error', ` (${hub.error})`));
      } else {
        p.append('No secure address yet: ', el('span', 'set-hub-error', hub.error));
      }
      body.append(p);
    }
    body.append(featuresGroup());
    body.append(el('h4', 'set-section', 'On the Pi'), el('p', 'set-intro set-restart-note', RESTART_NOTE));
    const groups = [];
    for (const s of data.settings) {
      let g = groups.find((x) => x.name === s.group);
      if (!g) groups.push((g = { name: s.group, items: [] }));
      g.items.push(s);
    }
    const order = groupOrder(groups.map((g) => g.name));
    groups.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));
    for (const g of groups) {
      const d = revealOnOpen(el('details', 'set-group'));
      d.open = OPEN.has(g.name);
      d.append(el('summary', null, settingsGroup(g.name)));
      for (const s of g.items) d.append(field(s));
      body.append(d);
    }
    const dev = deviceGroup();
    if (dev) body.append(dev);
    drawNotes();
    refreshButtons();
  }

  async function load() {
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch {
      data = null;
    }
    return data;
  }

  async function put(obj) {
    save.disabled = true;
    let r;
    try {
      r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    } catch {
      r = null;
    }
    const resp = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) {
      setError(resp.error || 'Couldn’t reach Hindsight');
      refreshButtons();
      return false;
    }
    data = resp;
    edits = {};
    setError(data.error ? `Your saved settings weren’t used at start: ${data.error}` : '');
    draw();
    return true;
  }

  async function open() {
    if (!sheet.open) sheet.showModal();
    if (restarting) return;
    edits = {};
    progress.hidden = true;
    body.replaceChildren(el('p', 'set-device', 'Loading…'));
    if (!(await load())) {
      body.replaceChildren();
      setError('Couldn’t reach Hindsight');
      return;
    }
    setError(data.error ? `Your saved settings weren’t used at start: ${data.error}` : '');
    draw();
  }

  btn.addEventListener('click', open);
  close.addEventListener('click', () => sheet.close());
  save.addEventListener('click', () => put(changes(data.settings, edits)));

  restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    const res = await restartHindsight({
      before: data.started,
      load,
      accepted: () => {
        restarting = true;
        restartEl.hidden = true;
        save.hidden = true;
        progress.hidden = false;
        progress.textContent = 'Restarting…';
      },
    });
    if (res.ok) {
      const d = res.data;
      progress.textContent = d.error ? 'Back, but your saved settings weren’t used' : 'Back';
      if (d.error) {
        restarting = false;
        save.hidden = false;
        setError(`Your saved settings weren’t used at start: ${d.error}`);
        draw();
        return;
      }
      setTimeout(() => location.reload(), 600);
      return;
    }
    if (!res.gone) {
      setError(res.error);
      restartBtn.disabled = false;
      return;
    }
    restarting = false;
    progress.textContent = res.error;
    progress.classList.add('bad');
  });
}
