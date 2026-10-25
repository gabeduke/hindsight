// The user-flow harness: boots a demo of its own (or attaches to one), opens
// each flow in a fresh browser context per device profile, and records what
// passed. A flow fails on a failed expectation, a thrown step, or any page
// error or console error along the way: a journey that "works" while the
// page throws is how the shell shipped broken.
//
// Flows are in scripts/flows/*.flow.mjs; the stories they check are in
// docs/flows.md. Run them with scripts/flows.mjs.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLayout, findingKey, seenMenus } from './layout.mjs';

// Android tablet (tap + stylus) is the main device; the laptop is second.
export const PROFILES = {
  tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false },
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  // A Pixel Tablet, on its side (its own size) and held upright: where the
  // bar ran off the edge, and no flow looked (docs/plan/listening-back.md).
  pixel: { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false },
  upright: { viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: false },
};

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.unref();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bootDemo runs `go run ./cmd/hindsight --demo` on a free port with every
// directory it writes under one temp dir, so a run starts empty and leaves
// nothing behind (a demo without TAPE_DIR writes ~/hindsight).
export async function bootDemo({ ringSeconds = 60, log = () => {} } = {}) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-flows-'));
  for (const d of ['takes', 'tapes']) mkdirSync(join(dir, d));
  const env = {
    ...process.env,
    CGO_ENABLED: '0',
    PORT: String(port),
    RING_SECONDS: String(ringSeconds),
    OUTPUT_DIR: join(dir, 'takes'),
    TAPE_DIR: join(dir, 'tapes'),
    SETTINGS_FILE: join(dir, 'settings.env'),
  };
  const bin = process.env.HINDSIGHT_BIN;
  const proc = bin
    ? spawn(bin, ['--demo'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('go', ['run', './cmd/hindsight', '--demo'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  proc.stdout.on('data', (b) => { out += b; });
  proc.stderr.on('data', (b) => { out += b; });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    try { bin ? proc.kill() : process.kill(-proc.pid); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  };
  const deadline = Date.now() + 120_000; // a cold `go run` compiles first
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`demo exited (${proc.exitCode}):\n${out.slice(-2000)}`);
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) { log(`demo up at ${base}`); return { base, stop, dir }; }
    } catch { /* not yet */ }
    await sleep(250);
  }
  stop();
  throw new Error(`demo did not answer within 120s:\n${out.slice(-2000)}`);
}

// api is a thin JSON client for seeding and for checking what the Pi holds.
export function apiFor(base) {
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return json;
  };
  const api = {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    takes: async () => {
      const j = await call('GET', '/api/jams');
      return Array.isArray(j) ? j : (j?.takes ?? []);
    },
    // ringHas waits until the ring holds at least `seconds` of audio.
    ringHas: async (seconds, timeout = 90_000) => {
      const end = Date.now() + timeout;
      for (;;) {
        const s = await call('GET', '/api/status');
        if (s.buffered_seconds >= seconds) return s;
        if (Date.now() > end) throw new Error(`ring holds ${s.buffered_seconds}s, wanted ${seconds}s`);
        await sleep(500);
      }
    },
    // keep saves the last `seconds` as a take and resolves once it is
    // playable: listed, with its preview and peaks written. A tap on a take
    // still encoding does nothing, so a flow that taps one too soon fails.
    keep: async (seconds = 5) => {
      await api.ringHas(seconds);
      const before = new Set((await api.takes()).map((t) => t.name));
      await call('POST', `/api/trigger?seconds=${seconds}`);
      return api.until(async () => (await api.takes()).find((t) => !before.has(t.name) && t.has_preview && t.has_peaks),
        'the kept take to be playable');
    },
    // tape makes a fresh tape, loads it and empties the buffer, so a Studio
    // flow starts from a blank tape whatever ran before it.
    tape: async (name = 'Flows', bpm = 96, bars = 4) => {
      const t = await call('POST', '/api/tapes', { name, bpm, bars });
      await call('POST', `/api/tapes/load?id=${encodeURIComponent(t.id)}`);
      await call('DELETE', '/api/clipboard').catch(() => {});
      return t;
    },
    // tapeState is the loaded tape as the Pi has it.
    tapeState: async () => {
      const { loaded } = await call('GET', '/api/tapes');
      return (await call('GET', `/api/tapes/state?id=${encodeURIComponent(loaded)}`)).tape;
    },
    until: async (fn, what, timeout = 20_000) => {
      const end = Date.now() + timeout;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(250);
      }
    },
  };
  return api;
}

// runFlow runs one flow on one profile and answers its result. `t`, the
// flow's handle, is: page, api, base, profile, given(name, fn) for setup,
// step(name, fn) for what the person does, expect(name, ok, detail) for
// what should follow, and wait(ms). They read as Given/When/Then in the
// report (log), in the order they ran.
//
// Each screen the flow leaves (before every When, and at the end) gets the
// layout checks (layout.mjs); a "fail" among them fails the flow. The
// line it pins them to keeps the menus that were open (`menus`), and a
// flow's checksMenus (ids) must each be among them on some screen. With
// storyboard, a directory, each of those screens is also saved there as a
// picture, for scripts/flows/storyboard.mjs.
//
// known is the baseline (layout-known.json): findings already there when
// the checks came in. They show as "known" and don't fail; a new one does.
export async function runFlow(browser, flow, profileName, { base, api, shots, storyboard = null, known = new Set() }) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({ ...profile, serviceWorkers: 'block' });
  const page = await context.newPage();
  // FLOWS_CPU=4 runs the page four times slower, as a CI runner can: a
  // flow that only passes on a fast machine is racing the app.
  const cpu = Number(process.env.FLOWS_CPU);
  if (cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const checks = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} ${(e.stack || '').split('\n')[1]?.trim() ?? ''}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/.test(text) && flow.allowHttpErrors) return;
    errors.push(`console.error: ${text.slice(0, 300)}`);
  });
  // Which elements a person's input reached, by id, for the coverage map:
  // the page reports its own pointer and key events, however they came.
  const touched = new Set();
  await page.exposeBinding('__flowTouched', (_, id) => { touched.add(id); });
  await context.addInitScript(() => {
    for (const type of ['pointerdown', 'keydown', 'input', 'change']) {
      addEventListener(type, (e) => {
        for (let el = e.target; el && el.nodeType === 1; el = el.parentElement) {
          if (el.id) window.__flowTouched?.(el.id);
        }
      }, true);
    }
  });
  let stage = 'start';
  const log = [];
  let frame = 0;
  const seenLayout = new Set();
  // screen checks the screen the last line left and pins what it found
  // (and its picture) to that line.
  const screen = async () => {
    const at = log.at(-1);
    if (!at || at.layout || page.isClosed() || page.url() === 'about:blank') return;
    // A finding already reported on an earlier screen is marked again, so
    // the report says each one once, where it first showed.
    at.layout = (await checkLayout(page, { touch: profile.hasTouch })).map((f) => {
      const k = findingKey(f);
      if (f.severity === 'fail' && known.has(`${profileName}|${k}`)) f = { ...f, severity: 'known' };
      if (seenLayout.has(k)) return { ...f, again: true };
      seenLayout.add(k);
      return f;
    });
    // The menus open as it was checked: proof a flow's checks saw a menu open.
    const menus = await seenMenus(page);
    if (menus.length) at.menus = menus;
    if (storyboard) {
      const file = `${flow.id}-${profileName}-${String(++frame).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: join(storyboard, file), type: 'jpeg', quality: 60 }).then(() => { at.shot = file; }, () => {});
    }
  };
  const t = {
    page, api, base, profile: profileName,
    wait: (ms) => page.waitForTimeout(ms),
    expect(name, ok, detail = '') {
      const c = { name, ok: !!ok, detail: ok ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)) };
      checks.push(c);
      log.push({ kind: 'then', ...c });
      return !!ok;
    },
    async given(name, fn) {
      stage = name;
      log.push({ kind: 'given', name, ok: true });
      return fn();
    },
    async step(name, fn) {
      await screen();
      stage = name;
      log.push({ kind: 'when', name, ok: true });
      return fn();
    },
    // hold is the select gesture: a finger held on the target on a touch
    // profile (real touch events, so pointerType is "touch"), ⇧-click with a
    // mouse, which is what the app takes there (a mouse never holds).
    async hold(locator, ms = 700) {
      if (!profile.hasTouch) return locator.click({ modifiers: ['Shift'] });
      const box = await locator.boundingBox();
      const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    },
    // tap is a finger's tap on a touch profile, a click otherwise.
    tap: (locator) => (profile.hasTouch ? locator.tap() : locator.click()),
    // poll re-evaluates fn in the page until it is truthy or the time runs out.
    async poll(fn, arg, timeout = 5000) {
      const end = Date.now() + timeout;
      let v;
      for (;;) {
        v = await page.evaluate(fn, arg);
        if (v || Date.now() > end) return v;
        await page.waitForTimeout(100);
      }
    },
  };
  const started = Date.now();
  let thrown = null;
  try {
    await flow.run(t);
  } catch (e) {
    thrown = `threw at "${stage}": ${e.message.split('\n')[0]}`;
    const at = log.findLast((l) => l.name === stage);
    if (at) Object.assign(at, { ok: false, detail: e.message.split('\n')[0] });
  }
  await screen().catch(() => {});
  // A flow that names menus (checksMenus) has the layout checks see each of
  // them open on some screen, so the menus it opens stay ones a run looks
  // at, open (menu-offscreen and the rest).
  for (const id of flow.checksMenus ?? []) {
    const ok = log.some((l) => l.menus?.includes(id));
    const c = { name: `the layout checks saw ${id} open`, ok, detail: ok ? '' : 'no screen had it open when it was checked' };
    checks.push(c);
    log.push({ kind: 'then', ...c });
  }
  const failed = checks.filter((c) => !c.ok);
  const layout = log.flatMap((l) => (l.layout ?? []).filter((f) => f.severity === 'fail'));
  const ok = !thrown && failed.length === 0 && errors.length === 0 && layout.length === 0;
  let shot = '';
  if (!ok && shots) {
    shot = join(shots, `${flow.id}-${profileName}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => { shot = ''; });
  }
  await context.close();
  return {
    flow: flow.id, title: flow.title, status: flow.status ?? 'core', profile: profileName,
    ok, ms: Date.now() - started, checks, thrown, errors, shot, log, touched: [...touched].sort(),
  };
}

// scenario is one run in Gherkin form: Given/When/Then, a repeat as And,
// each line marked, a layout fail under the line whose screen it was on.
export function scenario(r) {
  const word = { given: 'Given', when: 'When', then: 'Then' };
  const out = [`Scenario: ${r.flow} ${r.title} [${r.profile}]`];
  let last = '';
  for (const l of r.log ?? []) {
    const mark = l.ok ? (l.kind === 'then' ? '✓' : ' ') : '✗';
    out.push(`  ${mark} ${(l.kind === last ? 'And' : word[l.kind]).padStart(5)} ${l.name}${l.ok ? '' : `  -- ${l.detail}`}`);
    last = l.kind;
    for (const f of (l.layout ?? []).filter((x) => x.severity === 'fail' && !x.again)) {
      out.push(`  ✗       layout ${f.rule}: ${f.el} ${f.msg}`);
    }
  }
  for (const e of r.errors ?? []) out.push(`  ✗ ${e}`);
  return out.join('\n');
}

export function report(results) {
  const rows = results.map((r) => {
    let result = r.ok ? 'PASS' : 'FAIL';
    if (r.status === 'todo') result = r.ok ? 'PASS (todo: promote it)' : 'TODO';
    return [`${r.flow} ${r.title}`, r.profile, result, `${(r.ms / 1000).toFixed(1)}s`];
  });
  const head = ['Flow', 'Profile', 'Result', 'Time'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  const out = [line(head), `|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`, ...rows.map(line)];
  const detail = [];
  for (const r of results.filter((x) => !x.ok && x.status !== 'todo')) {
    detail.push(`\n${r.flow} [${r.profile}]`);
    if (r.thrown) detail.push(`  ${r.thrown}`);
    for (const c of r.checks.filter((c) => !c.ok)) detail.push(`  FAIL ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
    for (const e of r.errors) detail.push(`  ${e}`);
    for (const l of r.log ?? []) {
      for (const f of (l.layout ?? []).filter((x) => x.severity === 'fail' && !x.again)) detail.push(`  LAYOUT ${f.rule} at "${l.name}": ${f.el} ${f.msg}`);
    }
    if (r.shot) detail.push(`  screenshot: ${r.shot}`);
  }
  const core = results.filter((r) => r.status !== 'todo');
  const todo = results.filter((r) => r.status === 'todo');
  const summary = `${core.filter((r) => r.ok).length}/${core.length} core runs passed` +
    (todo.length ? `; ${todo.filter((r) => r.ok).length}/${todo.length} todo runs pass` : '');
  return `${out.join('\n')}\n${detail.join('\n')}\n\n${summary}`;
}

export function writeJSON(path, results) {
  writeFileSync(path, JSON.stringify(results, null, 2));
}
