// Runs the user flows (docs/flows.md) in a real browser against the demo.
//
//   npm install --no-save playwright@1.49.0 && npx playwright install chromium
//   node scripts/flows.mjs                     # every flow on its profiles (tablet, desktop, phone unless it says)
//   node scripts/flows.mjs J2.2 J1.1           # just these
//   node scripts/flows.mjs --profile=phone     # only that device's runs (tablet,desktop,phone,pixel,upright)
//   node scripts/flows.mjs --workers=1         # one run at a time (default: half the cores, 4 at most)
//   node scripts/flows.mjs --json=out.json     # results for a machine to read
//   node scripts/flows.mjs --storyboard=dir    # a picture per screen, and dir/index.html
//   node scripts/flows.mjs --storyboard=dir --review   # and Claude's notes on each (opt-in)
//   node scripts/flows.mjs --update-layout-known       # rewrite the layout baseline from this run
//   FLOWS_AUDIO=1 node scripts/flows.mjs       # hear the demo (muted by default: the flows play audio)
//
// With no HINDSIGHT_URL it boots its own demo (`go run ./cmd/hindsight
// --demo`, CGO_ENABLED=0) on a free port with its data in a temp dir, so
// every run starts from an empty shelf. HINDSIGHT_BIN runs a built binary
// instead of `go run`. Exits 1 when any core flow fails; a `todo` flow (a
// story not built yet) is reported but never fails the run.
//
// The runs are shared out among workers, each with a demo of its own, so no
// run sees what another seeded; the scenarios print as they finish, and the
// table, the JSON and the storyboard are in the flows' order whatever the
// workers' was. Against HINDSIGHT_URL there is one demo, so one worker. A
// flow that says `alone: true` waits for the rest and runs by itself.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { apiFor, bootDemo, report, runFlow, scenario, writeJSON } from './flows/harness.mjs';
import { findingKey } from './flows/layout.mjs';
import { writeStoryboard } from './flows/storyboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const wanted = args.filter((a) => !a.startsWith('--'));
const picked = opt('profile')?.split(',');
const shots = opt('shots') ?? join(tmpdir(), 'hindsight-flows-shots');
mkdirSync(shots, { recursive: true });
const storyboard = opt('storyboard');
if (storyboard) mkdirSync(storyboard, { recursive: true });
if (args.includes('--review') && !storyboard) {
  console.error('--review reviews the storyboard: give --storyboard=dir too');
  process.exit(2);
}

// The layout baseline: findings the checks met when they came in, each
// for a fix or an allowance (flows/layout-allow.mjs). A new one fails.
const knownFile = join(here, 'flows', 'layout-known.json');
const known = new Set(existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, 'utf8')) : []);

const flows = [];
for (const f of readdirSync(join(here, 'flows')).filter((n) => n.endsWith('.flow.mjs')).sort()) {
  const mod = await import(pathToFileURL(join(here, 'flows', f)));
  const flow = { ...mod.default, file: f };
  if (!wanted.length || wanted.some((w) => flow.id.toLowerCase().startsWith(w.toLowerCase()))) flows.push(flow);
}
if (!flows.length) {
  console.error(`no flow matches ${wanted.join(' ')}`);
  process.exit(2);
}

// Every run, in the order the table lists them. A flow may name the
// profiles it makes sense on (a tablet's budget, a phone-only sheet): those,
// else the tablet, the desktop and the phone. --profile narrows.
const runs = flows.flatMap((flow) => {
  const own = flow.profiles ?? ['tablet', 'desktop', 'phone'];
  return (picked ? own.filter((q) => picked.includes(q)) : own).map((profile) => ({ flow, profile }));
});

const asked = Number(opt('workers') ?? process.env.FLOWS_WORKERS);
if (opt('workers') !== undefined && !(Number.isInteger(asked) && asked >= 1)) {
  console.error('--workers takes a whole number, 1 or more');
  process.exit(2);
}
const external = process.env.HINDSIGHT_URL;
const workers = external ? 1
  : Math.min(runs.length, asked >= 1 ? asked : Math.max(1, Math.min(4, availableParallelism() >> 1)));

// A demo per worker (or the one at HINDSIGHT_URL), booted together.
console.log(external ? `the demo at ${external}` : `booting ${workers === 1 ? 'the demo' : `${workers} demos`}…`);
const booted = await Promise.allSettled(Array.from({ length: workers },
  () => (external ? { base: external, stop() {}, dir: null } : bootDemo({ log: console.log }))));
const demos = booted.filter((b) => b.status === 'fulfilled').map((b) => b.value);
const down = booted.find((b) => b.status === 'rejected');
if (down) {
  for (const d of demos) d.stop();
  throw down.reason;
}

// A fake microphone, allowed without asking: recording from a phone (J4.1).
// Muted unless FLOWS_AUDIO=1: the page still plays (so the flows see the
// same thing), but nothing comes out of the machine's speakers.
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(process.env.FLOWS_AUDIO === '1' ? [] : ['--mute-audio'])] });
const results = new Array(runs.length);
// Where the phone's ▶ stood, for the whole run (layout.mjs, bar-play-x):
// one Map for every worker, so ▶ is held to one x across them all.
const bar = new Map();
const began = Date.now();
// A flow that measures time (alone: true, J1.14's 100 ms) runs after the
// rest, with nothing beside it: four pages and four demos on one machine
// are what it would be timing otherwise.
const order = runs.map((_, i) => i);
const shared = order.filter((i) => !runs[i].flow.alone);
const alone = order.filter((i) => runs[i].flow.alone);
const work = async (demo, queue) => {
  const api = apiFor(demo.base, { dir: demo.dir });
  while (queue.length) {
    const i = queue.shift();
    const { flow, profile } = runs[i];
    const r = { ...await runFlow(browser, flow, profile, { base: demo.base, api, shots, storyboard, known, bar }), file: flow.file };
    console.log(`${scenario(r)}\n  => ${r.ok ? 'pass' : r.status === 'todo' ? 'todo' : 'FAIL'}\n`);
    results[i] = r;
  }
};
try {
  await Promise.all(demos.map((demo) => work(demo, shared)));
  await work(demos[0], alone);
} finally {
  await browser.close();
  for (const d of demos) d.stop();
}
const took = (Date.now() - began) / 1000;
const summed = results.reduce((n, r) => n + r.ms, 0) / 1000;

console.log(`\n${report(results)}`);
console.log(`${runs.length} runs in ${took.toFixed(0)}s on ${workers} worker${workers === 1 ? '' : 's'} (${summed.toFixed(0)}s of runs)`);
const met = new Set(results.flatMap((r) => (r.log ?? []).flatMap((l) => (l.layout ?? [])
  .filter((f) => f.severity === 'fail' || f.severity === 'known').map((f) => `${r.profile}|${findingKey(f)}`))));
if (args.includes('--update-layout-known')) {
  if (wanted.length || picked) {
    console.error('--update-layout-known needs the whole run (no ids, no --profile), or it would drop the rest');
    process.exit(2);
  }
  writeFileSync(knownFile, `${JSON.stringify([...met].sort(), null, 1)}\n`);
  console.log(`layout baseline: ${met.size} findings in ${knownFile}`);
} else if (!wanted.length && !picked) {
  const gone = [...known].filter((k) => !met.has(k));
  if (gone.length) console.log(`layout baseline: ${gone.length} known findings are fixed; drop them with --update-layout-known:\n  ${gone.join('\n  ')}`);
}
const json = opt('json');
if (json) writeJSON(json, results);
if (storyboard) {
  const page = await writeStoryboard(storyboard, results, { review: args.includes('--review'), log: console.log });
  console.log(`storyboard: ${page}`);
}
process.exit(results.some((r) => !r.ok && r.status !== 'todo') ? 1 : 0);
