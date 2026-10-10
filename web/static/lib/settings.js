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
    const label = el('label', 'set-label', s.label);
    label.htmlFor = `set-${s.key}`;
    const ctl = control(s);
    const head = el('div', 'set-head');
    if (s.kind === 'bool') head.append(ctl, label);
    else head.append(label);
    if (s.unit && s.kind !== 'choice') head.append(el('span', 'set-unit', s.unit));
    row.append(head);
    if (s.kind !== 'bool') row.append(ctl);
    row.append(el('p', 'set-help', s.help));
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
    const groups = [];
    for (const s of data.settings) {
      let g = groups.find((x) => x.name === s.group);
      if (!g) groups.push((g = { name: s.group, items: [] }));
      g.items.push(s);
    }
    for (const g of groups) {
      const d = el('details', 'set-group');
      d.open = OPEN.has(g.name);
      d.append(el('summary', null, g.name));
      for (const s of g.items) d.append(field(s));
      body.append(d);
    }
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
    let r;
    try {
      r = await fetch('/api/restart', { method: 'POST' });
    } catch {
      r = null;
    }
    if (!r || r.status !== 202) {
      const resp = r ? await r.json().catch(() => ({})) : {};
      setError(resp.error || 'Couldn’t reach Hindsight');
      restartBtn.disabled = false;
      return;
    }
    const before = data.started;
    restarting = true;
    restartEl.hidden = true;
    save.hidden = true;
    progress.hidden = false;
    progress.textContent = 'Restarting…';
    const started = Date.now();
    while (Date.now() - started < GIVE_UP_MS) {
      await new Promise((res) => setTimeout(res, POLL_MS));
      const d = await load();
      // Back as a new process.
      if (d && d.started !== before) {
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
    }
    restarting = false;
    progress.textContent = 'It hasn’t come back. Check the Pi: journalctl _SYSTEMD_USER_UNIT=hindsight.service';
    progress.classList.add('bad');
  });
}
