// The optional review (--review): Claude looks at each storyboard card as a
// person would and writes notes on whether the flow makes sense -- where
// the next control is, how crowded the screen is, whether the labels say
// what the story says, a gesture nobody would guess, feedback that's
// missing. Notes only: it never passes or fails anything; the flows and the
// layout checks do that.
//
// The layout checks' findings go in as facts, so the review spends its
// tokens on judgment, not on measuring again. A card's review is cached by
// what could change it: the flow's source, the UI (web/static), the steps
// and the findings -- not the pictures' bytes, which differ every run (the
// feed moves). So a run where neither the flow nor the UI changed costs
// nothing; the tokens a run did cost are printed at the end.
//
//   ANTHROPIC_API_KEY     required; without it each card says so, and the run goes on
//   FLOWS_REVIEW_MODEL    default claude-sonnet-5-5
//   FLOWS_REVIEW_CACHE    default .cache/flows-review at the repo root

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findingKey } from './layout.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = 1; // bump with the prompt, so the cache doesn't answer for an old one
const MAX_SHOTS = 12;

const PROMPT = `You review one user flow of Hindsight, a jam-room recorder and tape studio used mostly on an Android tablet by touch and stylus. You get the user's story, the steps the automated flow took (Given = setup, When = what the person does, Then = what should follow, each marked passed or failed), a screenshot of the screen after each step, and the layout findings a deterministic checker already measured (treat those as facts; don't re-measure them).

Judge whether the flow is coherent for a person doing it by hand, from the screenshots:
- coherence: does each next step follow from what the screen shows? Would a person find the next control?
- layout: crowding, overlap the checker can't see, things hard to reach on a tablet
- labels: do the controls' words match the story's words?
- gesture: does a step need a gesture nobody would guess (a hold, a drag, a modifier)?
- feedback: after each When, does the screen show clearly that it worked?

Only note what a person would actually trip on, most important first, at most 6 notes. If nothing, return an empty list. Answer with JSON only:
{"notes":[{"kind":"coherence|layout|labels|gesture|feedback","step":"<the step's words, or empty>","text":"<one or two sentences>"}]}`;

const sha = (b) => createHash('sha256').update(b).digest('hex');

// ui is a hash of every file the pages are made of.
let uiHash = null;
const ui = () => {
  if (uiHash) return uiHash;
  const h = createHash('sha256');
  const dir = join(root, 'web', 'static');
  for (const f of readdirSync(dir, { recursive: true }).map(String).sort()) {
    try { h.update(f).update(readFileSync(join(dir, f))); } catch { /* a directory */ }
  }
  return (uiHash = h.digest('hex'));
};

function gherkin(r) {
  const word = { given: 'Given', when: 'When', then: 'Then' };
  return (r.log ?? []).map((l) => `${l.ok ? (l.kind === 'then' ? '[pass]' : '') : '[FAIL]'} ${word[l.kind]} ${l.name}${l.ok ? '' : ` -- ${l.detail}`}`.trim()).join('\n');
}

async function one(dir, r, story, { model, key, cache, usage }) {
  const shots = (r.log ?? []).filter((l) => l.shot).slice(0, MAX_SHOTS);
  const images = shots.map((l) => ({ step: l.name, data: readFileSync(join(dir, l.shot)) }));
  const findings = (r.log ?? []).flatMap((l) => (l.layout ?? []).filter((f) => f.severity !== 'allowed' && !f.again)
    .map((f) => `${f.severity} ${f.rule} at "${l.name}": ${f.el} ${f.msg}`));
  const text = `Story (${r.flow}, ${r.profile}, ${r.status}): As Gabe I want to ${story?.story ?? r.title}\n\nSteps:\n${gherkin(r)}\n\nLayout findings:\n${findings.join('\n') || 'none'}`;
  const source = r.file ? readFileSync(join(root, 'scripts', 'flows', r.file)) : '';
  // The key leaves out what varies run to run with nothing changed: a
  // failure's numbers, and the warnings (a toast over a control or not is
  // timing).
  const stable = (r.log ?? []).map((l) => `${l.kind}|${l.name}|${l.ok}|${(l.layout ?? [])
    .filter((f) => !f.again && (f.severity === 'fail' || f.severity === 'known')).map(findingKey).join(',')}`);
  const key0 = sha([VERSION, model, PROMPT, r.flow, r.profile, story?.story, ...stable, sha(source), ui()].join('\n'));
  const file = join(cache, `${key0}.json`);
  if (existsSync(file)) return { ...JSON.parse(readFileSync(file, 'utf8')), cached: true };
  if (!key) return { error: 'Not reviewed: set ANTHROPIC_API_KEY to run the review.' };

  const content = [{ type: 'text', text }];
  for (const i of images) {
    content.push({ type: 'text', text: `Screen after: ${i.step}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: i.data.toString('base64') } });
  }
  const res = await fetch(process.env.FLOWS_REVIEW_URL ?? 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1500, system: PROMPT, messages: [{ role: 'user', content }] }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  if (!res.ok) return { error: `The review failed (${res.status}): ${(await res.text()).slice(0, 200)}` };
  const body = await res.json();
  usage.input += body.usage?.input_tokens ?? 0;
  usage.output += body.usage?.output_tokens ?? 0;
  const said = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let notes;
  try {
    notes = JSON.parse(said.slice(said.indexOf('{'), said.lastIndexOf('}') + 1)).notes;
  } catch {
    return { error: `The review's answer wasn't JSON: ${said.slice(0, 200)}` };
  }
  const out = { notes: Array.isArray(notes) ? notes : [], model };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// review answers each run's notes, keyed "flow|profile".
export async function review(dir, results, stories, { log = () => {} } = {}) {
  const model = process.env.FLOWS_REVIEW_MODEL ?? 'claude-sonnet-5-5';
  const key = process.env.ANTHROPIC_API_KEY;
  const cache = process.env.FLOWS_REVIEW_CACHE ?? join(root, '.cache', 'flows-review');
  mkdirSync(cache, { recursive: true });
  const usage = { input: 0, output: 0 };
  const out = new Map();
  const queue = [...results];
  let cached = 0;
  const worker = async () => {
    for (let r; (r = queue.shift());) {
      const n = await one(dir, r, stories.get(r.flow), { model, key, cache, usage });
      if (n.cached) cached++;
      out.set(`${r.flow}|${r.profile}`, n);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!key) log('review: no ANTHROPIC_API_KEY, so only cached reviews are shown');
  log(`review: ${results.length} cards with ${model}, ${cached} from the cache; ${usage.input} input + ${usage.output} output tokens`);
  return out;
}
