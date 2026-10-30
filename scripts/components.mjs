// The components' harness (docs/architecture/components.md, *The harness*):
// mounts one component alone, on fixture models (testdata/protocol/), in a
// bare page, at the phone's, the Pixel tablet's, 1024×768's and the
// desktop's size, in light and dark, and runs the flows' layout checks
// (scripts/flows/layout.mjs checkLayout) on its root alone. No demo, no Go:
// a small server here serves web/static read-only, the harness page at
// /__components/ and the fixtures at /__fixtures/.
//
//   npm install --no-save playwright@1.49.0 axe-core@4.11.4 && npx playwright install chromium
//   node scripts/components.mjs                  # every component with a check
//   node scripts/components.mjs display          # just these
//   node scripts/components.mjs --profile=phone  # only these sizes (phone,pixel,tablet,desktop)
//   node scripts/components.mjs --scheme=dark    # only this scheme
//   node scripts/components.mjs --storyboard=dir # a picture of each, and dir/index.html
//   node scripts/components.mjs --json=out.json  # results for a machine to read
//
// A component's check is scripts/components/<id>.check.mjs: its root's id,
// its cases (the fixtures by noun, the props it is handed, the verbs
// refused), and what else it should do (expect). A layout fail, a page
// error, or an expect that fails fails the run (exit 1). Nothing a
// component shows goes into layout-known.json, and an allowance in
// layout-allow.mjs doesn't excuse it: a component starts with no findings.

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PROFILES } from './flows/harness.mjs';
import { checkLayout } from './flows/layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const STATIC = join(repo, 'web', 'static');
const FIXTURES = join(repo, 'testdata', 'protocol');
const SIZES = ['phone', 'pixel', 'tablet', 'desktop'];
const SCHEMES = ['light', 'dark'];

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const wanted = args.filter((a) => !a.startsWith('--'));
const sizes = opt('profile')?.split(',') ?? SIZES;
const schemes = opt('scheme')?.split(',') ?? SCHEMES;
const storyboard = opt('storyboard');
if (storyboard) mkdirSync(storyboard, { recursive: true });
for (const p of sizes) if (!PROFILES[p]) { console.error(`no profile ${p}: one of ${SIZES.join(', ')}`); process.exit(2); }

// The checks, and the components they check.
const checks = [];
for (const f of readdirSync(join(here, 'components')).filter((n) => n.endsWith('.check.mjs')).sort()) {
  const check = (await import(pathToFileURL(join(here, 'components', f)))).default;
  if (wanted.length && !wanted.includes(check.id)) continue;
  const def = (await import(pathToFileURL(join(STATIC, 'lib', 'components', check.id, 'index.js')))).default;
  checks.push({ ...check, css: def.css, file: f });
}
if (!checks.length) {
  console.error(wanted.length ? `no component check for ${wanted.join(' ')}` : 'no component checks in scripts/components/');
  process.exit(2);
}

// --- the server ---------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// page is the harness page for one mount: styles.css, objects.css and the
// component's stylesheet, a stage holding its root, and the script.
function page(spec) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(spec.id)} — the components' harness</title>
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/objects.css">
<link rel="stylesheet" href="/${esc(spec.css)}">
<style>#stage { padding: 16px; }</style>
</head>
<body>
<div id="stage"><div id="${esc(spec.rootId)}"></div></div>
<script type="module" src="/__components/page.js"></script>
</body>
</html>`;
}

// inside answers the file under dir that url names, or null for one outside it.
function inside(dir, rel) {
  const p = normalize(join(dir, decodeURIComponent(rel)));
  return p === dir || p.startsWith(dir + sep) ? p : null;
}

// answer is one request: the harness page, its script, a fixture, or a file
// of web/static. It throws on a request it can't read (a bad escape, a spec
// that isn't JSON), which serve answers 400.
function answer(req, res) {
  const url = new URL(req.url, 'http://harness');
  let file = null;
  if (url.pathname === '/__components/' || url.pathname === '/__components/index.html') {
    const html = page(JSON.parse(url.searchParams.get('spec')));
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
  if (url.pathname === '/__components/page.js') file = join(here, 'components', 'page.js');
  else if (url.pathname.startsWith('/__fixtures/')) file = inside(FIXTURES, url.pathname.slice('/__fixtures/'.length));
  else file = inside(STATIC, url.pathname.slice(1) || 'index.html');
  const body = file && statSync(file, { throwIfNoEntry: false })?.isFile() ? readFileSync(file) : null;
  if (!body) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serve() {
  const server = createServer((req, res) => {
    try {
      answer(req, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(400);
      res.end(`bad request: ${e.message}`);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --- the runs -------------------------------------------------------------------

async function run(browser, base, check, c, size, scheme) {
  const profile = PROFILES[size];
  const context = await browser.newContext({ ...profile, colorScheme: scheme, serviceWorkers: 'block' });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`); });
  const spec = { id: check.id, rootId: check.rootId ?? check.id, css: check.css, fixtures: c.fixtures, props: c.props, refuse: c.refuse };
  const started = Date.now();
  const result = { component: check.id, case: c.name, profile: size, scheme, findings: [], expects: [], errors, shot: '' };
  try {
    await p.goto(`${base}/__components/?spec=${encodeURIComponent(JSON.stringify(spec))}`);
    await p.waitForFunction(() => window.__harness && (window.__harness.mounted || window.__harness.failed), null, { timeout: 15_000 });
    const failed = await p.evaluate(() => window.__harness.failed);
    if (failed) throw new Error(`the mount failed: ${failed.split('\n')[0]}`);
    const root = `#${spec.rootId}`;
    result.findings = await checkLayout(p, { touch: profile.hasTouch, root });
    // And it fits the screen. A phone shows a page wider than itself zoomed
    // out, and innerWidth, which checkLayout's offscreen goes by, grows to
    // match, so a root that runs off a phone is measured here, against the
    // screen's own width.
    const fit = await p.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, right: r.right, screen: document.documentElement.clientWidth };
    }, root);
    if (fit.left < -1 || fit.right > fit.screen + 1) {
      result.findings.push({ rule: 'screen', severity: 'fail', el: root, msg: `spans ${Math.round(fit.left)}–${Math.round(fit.right)} px of a ${fit.screen} px screen` });
    }
    if (storyboard) {
      result.shot = `${check.id}-${slug(c.name)}-${size}-${scheme}.png`;
      await p.locator('#stage').screenshot({ path: join(storyboard, result.shot) });
    }
    const tap = (locator) => (profile.hasTouch ? locator.tap() : locator.click());
    if (check.expect) result.expects = await check.expect(p, { tap, profile: size, scheme });
  } catch (e) {
    errors.push(`threw: ${e.message.split('\n')[0]}`);
  }
  await context.close();
  // An allowance (layout-allow.mjs) is the pages', and doesn't excuse a component.
  const fails = result.findings.filter((f) => f.severity === 'fail' || f.severity === 'allowed');
  result.ok = fails.length === 0 && errors.length === 0 && result.expects.every((x) => x.ok);
  result.ms = Date.now() - started;
  return result;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function report(results) {
  const head = ['Component', 'Case', 'Size', 'Scheme', 'Result'];
  const rows = results.map((r) => [r.component, r.case, r.profile, r.scheme, r.ok ? 'PASS' : 'FAIL']);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((x) => x[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  const out = [line(head), `|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`, ...rows.map(line)];
  for (const r of results) {
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const bad = r.findings.filter((f) => f.severity === 'fail' || f.severity === 'allowed');
    if (r.ok && !warns.length) continue;
    out.push(`\n${r.component} · ${r.case} [${r.profile}, ${r.scheme}]`);
    for (const f of bad) out.push(`  LAYOUT ${f.rule}: ${f.el} ${f.msg}${f.severity === 'allowed' ? ' (allowed on the pages, not here)' : ''}`);
    for (const x of r.expects.filter((e) => !e.ok)) out.push(`  FAIL ${x.name} -- ${JSON.stringify(x.detail)}`);
    for (const e of r.errors) out.push(`  ${e}`);
    for (const f of warns) out.push(`  warn ${f.rule}: ${f.el} ${f.msg}`);
  }
  out.push(`\n${results.filter((r) => r.ok).length}/${results.length} component runs passed`);
  return out.join('\n');
}

function writeIndex(dir, results) {
  const cards = results.map((r) => `<figure class="${r.ok ? 'ok' : 'bad'}"><figcaption>${esc(r.component)} · ${esc(r.case)} · ${esc(r.profile)} · ${esc(r.scheme)} — ${r.ok ? 'pass' : 'FAIL'}</figcaption>${r.shot ? `<img src="${esc(r.shot)}" alt="">` : ''}</figure>`).join('\n');
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Components</title>
<style>body{font:14px system-ui;margin:16px;background:#f4f1ea}figure{margin:0 0 20px}figcaption{margin-bottom:6px}.bad figcaption{color:#b3261e;font-weight:600}img{max-width:100%;border:1px solid #ccc}</style>
<h1>The components, one at a time</h1>
${cards}`);
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
try {
  for (const check of checks) {
    for (const c of check.cases) {
      for (const size of sizes) {
        for (const scheme of schemes) {
          const r = await run(browser, base, check, c, size, scheme);
          console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.component} · ${r.case} [${r.profile}, ${r.scheme}] ${(r.ms / 1000).toFixed(1)}s`);
          results.push(r);
        }
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${report(results)}`);
const json = opt('json');
if (json) writeFileSync(json, JSON.stringify(results, null, 2));
if (storyboard) { writeIndex(storyboard, results); console.log(`storyboard: ${join(storyboard, 'index.html')}`); }
process.exit(results.every((r) => r.ok) ? 0 : 1);
