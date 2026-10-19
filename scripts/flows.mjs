// Runs the user flows (docs/flows.md) in a real browser against the demo.
//
//   npm install --no-save playwright@1.49.0 && npx playwright install chromium
//   node scripts/flows.mjs                     # every flow on its profiles (tablet + desktop unless it says)
//   node scripts/flows.mjs J2.2 J1.1           # just these
//   node scripts/flows.mjs --profile=phone     # only that device's runs (tablet,desktop,phone)
//   node scripts/flows.mjs --json=out.json     # results for a machine to read
//
// With no HINDSIGHT_URL it boots its own demo (`go run ./cmd/hindsight
// --demo`, CGO_ENABLED=0) on a free port with its data in a temp dir, so
// every run starts from an empty shelf. HINDSIGHT_BIN runs a built binary
// instead of `go run`. Exits 1 when any core flow fails; a `todo` flow (a
// story not built yet) is reported but never fails the run.

import { mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { apiFor, bootDemo, report, runFlow, writeJSON } from './flows/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const wanted = args.filter((a) => !a.startsWith('--'));
const picked = opt('profile')?.split(',');
const shots = opt('shots') ?? join(tmpdir(), 'hindsight-flows-shots');
mkdirSync(shots, { recursive: true });

const flows = [];
for (const f of readdirSync(join(here, 'flows')).filter((n) => n.endsWith('.flow.mjs')).sort()) {
  const mod = await import(pathToFileURL(join(here, 'flows', f)));
  const flow = mod.default;
  if (!wanted.length || wanted.some((w) => flow.id.toLowerCase().startsWith(w.toLowerCase()))) flows.push(flow);
}
if (!flows.length) {
  console.error(`no flow matches ${wanted.join(' ')}`);
  process.exit(2);
}

let demo = null;
let base = process.env.HINDSIGHT_URL;
if (!base) {
  console.log('booting the demo…');
  demo = await bootDemo({ log: console.log });
  base = demo.base;
}
const api = apiFor(base);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
try {
  for (const flow of flows) {
    // A flow may name the profiles it makes sense on (a phone-only sheet):
    // those by default, else the tablet and the desktop. --profile narrows.
    const own = flow.profiles ?? ['tablet', 'desktop'];
    for (const p of picked ? own.filter((q) => picked.includes(q)) : own) {
      const r = await runFlow(browser, flow, p, { base, api, shots });
      console.log(`${r.ok ? 'pass' : r.status === 'todo' ? 'todo' : 'FAIL'} ${flow.id} [${p}] ${flow.title}`);
      results.push(r);
    }
  }
} finally {
  await browser.close();
  demo?.stop();
}

console.log(`\n${report(results)}`);
const json = opt('json');
if (json) writeJSON(json, results);
process.exit(results.some((r) => !r.ok && r.status !== 'todo') ? 1 : 0);
