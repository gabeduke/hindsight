// The storyboard: one page, from one run, for a person to look through.
// A card per scenario (Gabe's story from docs/flows.md, its Given/When/Then
// with a picture of each screen, the layout findings, and Claude's notes
// when --review asked for them), then the coverage map: the controls in the
// pages that no flow's input reached, and the stories not written yet.
//
// It is made from the run and nothing else, so it can't drift from what
// the flows check. The pictures sit beside it in the same directory.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { review } from './review.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES = ['shell.html', 'wave.html', 'rig.html'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// stories reads docs/flows.md's two tables: the flows, and the ones not
// written yet.
export function stories() {
  const md = readFileSync(join(root, 'docs', 'flows.md'), 'utf8');
  const strip = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\\\|/g, '|').trim();
  const rows = [];
  let table = null;
  for (const line of md.split('\n')) {
    if (/^## The flows/.test(line)) table = 'built';
    else if (/^### Not written yet/.test(line)) table = 'gap';
    else if (/^## /.test(line)) table = null;
    if (!table || !/^\| [A-Z]\d/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(strip);
    rows.push(table === 'built'
      ? { id: cells[0], story: cells[1], file: cells[2], status: cells[3], table }
      : { id: cells[0], story: cells[1], status: cells[2], table });
  }
  return rows;
}

// controls lists the pages' controls that have an id, each with the
// panel, sheet or view it sits in, from the HTML as shipped.
export function controls() {
  const out = [];
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const GROUP = /^(section|aside|dialog|details|nav|header|footer|main)$/;
  for (const file of PAGES) {
    const html = readFileSync(join(root, 'web', 'static', file), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, '');
    const stack = [];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const [, close, tagRaw, attrs] = m;
      const tag = tagRaw.toLowerCase();
      if (close) {
        const i = stack.findLastIndex((s) => s.tag === tag);
        if (i >= 0) stack.length = i;
        continue;
      }
      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      const view = attrs.match(/\bdata-view="([^"]+)"/)?.[1];
      const isControl = /^(button|input|select|textarea)$/.test(tag) || (tag === 'a' && /\bhref=/.test(attrs)) || /\brole="(button|tab|slider)"/.test(attrs);
      if (isControl && id && !/type="hidden"/.test(attrs)) {
        const g = stack.findLast((s) => s.group);
        const label = attrs.match(/\b(?:aria-label|title)="([^"]+)"/)?.[1] ?? '';
        out.push({ page: file, id, tag, label, group: g?.group ?? file });
      }
      const cls = attrs.match(/\bclass="([^"\s]+)/)?.[1];
      // A semantic box by its id or class; a div only by its id (a bar).
      const group = (id && (GROUP.test(tag) || (tag === 'div' && !isControl))) ? `${tag}#${id}`
        : (GROUP.test(tag) && cls) ? `${tag}.${cls}` : view ? `view ${view}` : null;
      if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/')) stack.push({ tag, group });
    }
  }
  return out;
}

const mark = (l) => (!l.ok ? '✗' : l.kind === 'then' ? '✓' : '');

function card(r, story, notes) {
  const word = { given: 'Given', when: 'When', then: 'Then' };
  let last = '';
  const fails = (r.log ?? []).flatMap((l) => (l.layout ?? []).filter((f) => f.severity === 'fail' && !f.again));
  const lines = (r.log ?? []).map((l) => {
    const w = l.kind === last ? 'And' : word[l.kind];
    last = l.kind;
    const found = (l.layout ?? []).filter((f) => f.severity !== 'allowed' && !f.again);
    const findings = found.length ? `<ul class="find">${found.map((f) =>
      `<li class="${f.severity}"><b>${esc(f.rule)}</b> ${esc(f.el)} — ${esc(f.msg)}${f.why ? ` <i>(${esc(f.why)})</i>` : ''}${f.severity === 'known' ? ' <i>(known: in layout-known.json)</i>' : ''}</li>`).join('')}</ul>` : '';
    const shot = l.shot ? `<a href="${esc(l.shot)}" target="_blank"><img loading="lazy" src="${esc(l.shot)}" alt="the screen after: ${esc(l.name)}"></a>` : '';
    return `<li class="line ${l.kind} ${l.ok ? 'ok' : 'bad'}"><span class="mark">${mark(l)}</span><span class="kw">${w}</span> <span class="what">${esc(l.name)}</span>${l.ok ? '' : `<div class="detail">${esc(l.detail)}</div>`}${shot}${findings}</li>`;
  }).join('');
  const errs = (r.errors ?? []).map((e) => `<li class="line bad"><span class="mark">✗</span>${esc(e)}</li>`).join('');
  const verdict = r.ok ? 'pass' : r.status === 'todo' ? 'todo' : 'fail';
  const n = notes ? `<div class="notes"><h4>Claude's review</h4>${notes.error ? `<p class="detail">${esc(notes.error)}</p>` : ''}${(notes.notes ?? []).map((x) =>
    `<p class="note ${esc(x.kind)}"><b>${esc(x.kind)}</b>${x.step ? ` <i>at “${esc(x.step)}”</i>` : ''} ${esc(x.text)}</p>`).join('') || (notes.error ? '' : '<p>Nothing to note.</p>')}</div>` : '';
  return `<article class="card ${verdict}" id="${esc(`${r.flow}-${r.profile}`)}">
<header><span class="badge ${verdict}">${verdict}</span><h3>${esc(r.flow)} ${esc(r.title)}</h3><span class="prof">${esc(r.profile)} · ${(r.ms / 1000).toFixed(1)}s${fails.length ? ` · ${fails.length} layout` : ''}</span></header>
${story ? `<p class="story">As Gabe I want to ${esc(story.story)}</p>` : ''}
<ol class="steps">${lines}${errs}</ol>${n}</article>`;
}

// writeStoryboard writes dir/index.html and answers its path.
export async function writeStoryboard(dir, results, { review: withReview = false, log = () => {} } = {}) {
  const all = stories();
  const byId = new Map(all.map((s) => [s.id, s]));
  const notes = withReview ? await review(dir, results, byId, { log }) : new Map();
  const ctl = controls();
  const touched = new Set(results.flatMap((r) => r.touched ?? []));
  const missed = ctl.filter((c) => !touched.has(c.id));
  const groups = Map.groupBy(missed, (c) => `${c.page} · ${c.group}`);
  const ran = new Set(results.map((r) => r.flow));
  const gaps = all.filter((s) => s.table === 'gap' || !ran.has(s.id));
  const pass = results.filter((r) => r.ok).length;
  const count = (sev) => results.reduce((n, r) => n + (r.log ?? []).flatMap((l) => l.layout ?? []).filter((f) => f.severity === sev && !f.again).length, 0);
  const layout = count('fail'), warns = count('warn'), knownN = count('known');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Flow Storyboard</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d1c1a;--mute:#6b675f;--line:#e2ded5;--ok:#1f7a4d;--bad:#b3261e;--warn:#9a6700;--accent:#3a5bc7;--badge-ink:#fff}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#151412;--card:#1f1e1b;--ink:#ece9e2;--mute:#a19c92;--line:#34312c;--ok:#5fc48f;--bad:#f2867e;--warn:#e0b44d;--accent:#8ea6ff;--badge-ink:#151412;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#151412;--card:#1f1e1b;--ink:#ece9e2;--mute:#a19c92;--line:#34312c;--ok:#5fc48f;--bad:#f2867e;--warn:#e0b44d;--accent:#8ea6ff;--badge-ink:#151412;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}h1{font-size:26px;margin:0 0 4px;text-wrap:balance}.kw,.prof,.sub{font-variant-numeric:tabular-nums}.sub{color:var(--mute);margin:0 0 20px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 24px}nav.toc a{font-size:13px;padding:3px 8px;border-radius:999px;border:1px solid var(--line);color:var(--ink);text-decoration:none;background:var(--card)}
nav.toc a.fail{border-color:var(--bad);color:var(--bad)}nav.toc a.todo{color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 20px}
.card header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}.card h3{margin:0;font-size:18px;flex:1;min-width:200px}.prof{color:var(--mute);font-size:13px}
.badge{font-size:12px;font-weight:600;text-transform:uppercase;padding:2px 8px;border-radius:6px;color:var(--badge-ink);background:var(--ok)}.badge.fail{background:var(--bad)}.badge.todo{background:var(--mute)}
.story{color:var(--mute);font-style:italic;margin:6px 0 12px}
.steps{list-style:none;margin:0;padding:0}.line{padding:4px 0 4px 26px;position:relative}.line .mark{position:absolute;left:4px;font-weight:700;color:var(--ok)}.line.bad .mark{color:var(--bad)}
.kw{font-weight:700;display:inline-block;min-width:46px}.line.given .kw{color:var(--mute)}.line.when .kw{color:var(--accent)}.line.then .kw{color:var(--ok)}.line.bad .what{color:var(--bad)}
.detail{color:var(--bad);font-size:13px;font-family:ui-monospace,monospace;overflow-wrap:anywhere}
.line img{display:block;max-width:min(100%,640px);margin:8px 0 6px;border:1px solid var(--line);border-radius:8px}
.find{margin:4px 0 8px;padding-left:18px;font-size:13px}.find li.fail{color:var(--bad)}.find li.warn,.find li.known{color:var(--warn)}.find b{font-family:ui-monospace,monospace}
.notes{margin-top:12px;border-top:1px dashed var(--line);padding-top:8px}.notes h4{margin:0 0 6px;font-size:14px}.note{margin:4px 0;font-size:14px}.note b{text-transform:capitalize}
section.map{margin-top:36px}section.map h2{font-size:20px}table{border-collapse:collapse;width:100%;font-size:14px;background:var(--card)}
td,th{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--bg)}code{font-family:ui-monospace,monospace;font-size:13px;overflow-wrap:anywhere}
.tablewrap{overflow-x:auto}
</style></head><body><main>
<h1>Flow storyboard</h1>
<p class="sub">${pass}/${results.length} runs passed · ${layout} new layout fails · ${knownN} known · ${warns} warnings · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${withReview ? ' · reviewed by Claude' : ''}</p>
<nav class="toc">${results.map((r) => `<a class="${r.ok ? 'pass' : r.status === 'todo' ? 'todo' : 'fail'}" href="#${esc(`${r.flow}-${r.profile}`)}">${esc(r.flow)} ${esc(r.profile)}</a>`).join('')}<a href="#map">coverage map</a></nav>
${results.map((r) => card(r, byId.get(r.flow), notes.get(`${r.flow}|${r.profile}`))).join('\n')}
<section class="map" id="map"><h2>Coverage map</h2>
<p>${ctl.length - missed.length} of ${ctl.length} controls with an id (in ${PAGES.join(', ')}) got a person's input in this run. The rest, by where they sit:</p>
<div class="tablewrap"><table><tr><th>Where</th><th>Controls no flow touched</th></tr>
${[...groups].map(([g, cs]) => `<tr><td><code>${esc(g)}</code></td><td>${cs.map((c) => `<code title="${esc(c.label)}">#${esc(c.id)}</code>`).join(' ')}</td></tr>`).join('\n')}
</table></div>
<h2>Stories with no flow in this run</h2>
<div class="tablewrap"><table><tr><th>Id</th><th>Story</th><th>Status</th></tr>
${gaps.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.story)}</td><td>${esc(s.table === 'gap' ? s.status : `${s.status} (not run)`)}</td></tr>`).join('\n')}
</table></div></section>
</main></body></html>`;
  const page = join(dir, 'index.html');
  writeFileSync(page, html);
  return page;
}
