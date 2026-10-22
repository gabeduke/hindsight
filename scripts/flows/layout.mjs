// Layout checks: run on every screen a flow passes through, deterministic,
// no LLM. They read the page's geometry for what a person would trip on:
//
//   covered    a control whose middle is under another element, so a tap
//              there lands on something else (the buffer over track 2)
//   offscreen  a control cut off by the viewport's side: a phone that has
//              to scroll sideways to reach it
//   clipped    a control whose label overflows its box, cut off
//   target-size  axe-core's WCAG 2.2 rule: a control under 24 px with less
//              than 24 px around it, measured on the part not covered
//   small-touch  under 44 px on a touch profile (the fingers' guideline,
//              WCAG's stricter level): a warning, as a stylus copes
//
// A finding is a "fail" or a "warn". Fails fail the flow, unless
// layout-allow.mjs says the overlap is meant (a sheet over the page).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ALLOW } from './layout-allow.mjs';

const require = createRequire(import.meta.url);
let axeSource = null;
const axe = () => (axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

// geometry runs in the page: the covered, offscreen, clipped and
// small-touch checks over every visible control.
function geometry({ touch }) {
  const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex="-1"])';
  const W = innerWidth, H = innerHeight;
  const name = (el) => {
    if (!el || el === document.documentElement) return 'the page';
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return text ? `${s} "${text}"` : s;
  };
  const shown = (el) => {
    if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05 && st.pointerEvents !== 'none';
  };
  const pinned = (n) => {
    for (let p = n instanceof Element ? n : n.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position)) return p;
    }
    return null;
  };
  const scrolls = (n) => {
    const d = document.scrollingElement;
    if (d && d.scrollHeight > innerHeight + 1) return true;
    for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(auto|scroll)/.test(o.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll(CONTROL)) {
    if (!shown(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Only what's on screen: scrolled away is not a layout fault.
    if (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) continue;
    // A control inside a box that clips it (a scrolled lane, a folded
    // panel) is judged by the part its scroller shows.
    let vis = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(o.overflow + o.overflowX + o.overflowY)) {
        const q = p.getBoundingClientRect();
        vis = { l: Math.max(vis.l, q.left), t: Math.max(vis.t, q.top), r: Math.min(vis.r, q.right), b: Math.min(vis.b, q.bottom) };
      }
    }
    if (vis.r - vis.l < 1 || vis.b - vis.t < 1) continue; // its scroller hides it
    // Off the side even as its scroller shows it (a strip that scrolls
    // sideways shows the rest by scrolling, which is fine).
    if (vis.l < -1 || vis.r > W + 1) {
      out.push({ rule: 'offscreen', severity: 'fail', el: name(el), msg: `runs off the ${vis.l < 0 ? 'left' : 'right'} side (${Math.round(vis.l)}–${Math.round(vis.r)} of ${W})` });
    }
    const x = (Math.max(vis.l, 0) + Math.min(vis.r, W)) / 2, y = (Math.max(vis.t, 0) + Math.min(vis.b, H)) / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      const label = hit.closest('label');
      // Meant to cover: a sheet or a menu that's open over the page.
      const layer = hit.closest('dialog[open], [role=menu], .menu, :popover-open');
      // Scrolled under the pinned chrome (the bar, the app bar): the page
      // scrolls it back out, so long as the page can scroll.
      const pin = pinned(hit);
      const under = pin && !pin.contains(el) && !pinned(el)?.contains(pin) && scrolls(el);
      if (!(label && (label.contains(el) || label.control === el)) && !(layer && !layer.contains(el)) && !under) {
        const top = hit.closest(CONTROL) || hit;
        out.push({ rule: 'covered', severity: 'fail', el: name(el), by: name(top), msg: `its middle is under ${name(top)}` });
      }
    }
    if (el.matches('button, [role=button], [role=tab], a') && el.children.length === 0 &&
        el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis') {
      out.push({ rule: 'clipped', severity: 'warn', el: name(el), msg: `its label is cut off (${el.scrollWidth}px in ${el.clientWidth}px)` });
    }
    if (touch && Math.min(r.width, r.height) < 44 && !el.matches('input[type=range], input[type=checkbox], input[type=radio], a')) {
      out.push({ rule: 'small-touch', severity: 'warn', el: name(el), msg: `${Math.round(r.width)}×${Math.round(r.height)} px, under 44 for a finger` });
    }
  }
  return out;
}

const allowance = (f) => ALLOW.find((a) => a.rule === f.rule &&
  (!a.el || a.el.test(f.el)) && (!a.by || (f.by && a.by.test(f.by))));

// sample is one look at the page: the geometry checks and axe's.
async function sample(page, touch) {
  const found = await page.evaluate(geometry, { touch }).catch(() => []);
  // axe in the page by evaluate, not a script tag, so no CSP stops it.
  const axeFound = await page.evaluate(async (src) => {
    if (!window.axe) (0, eval)(src);
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['target-size'] }, resultTypes: ['violations'] });
    return r.violations.flatMap((v) => v.nodes.map((n) => ({
      rule: 'target-size', severity: 'fail', el: n.target.join(' '),
      msg: (n.any[0]?.message || n.failureSummary || v.help).replace(/\s+/g, ' ').slice(0, 160),
    })));
  }, axe()).catch((e) => [{ rule: 'axe', severity: 'warn', el: '', msg: `axe didn't run: ${e.message.split('\n')[0]}` }]);
  return [...found, ...axeFound];
}

// settle waits (two seconds at most) for the page to come to rest: what's
// animating to finish, and the controls to stop moving between two looks
// 250 ms apart (a list arriving moves its neighbours).
async function settle(page) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, 1000)),
  ])).catch(() => {});
  const where = () => page.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')]
    .map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`; }).join(';')).catch(() => '');
  const end = Date.now() + 2000;
  let last = await where();
  while (Date.now() < end) {
    await page.waitForTimeout(250);
    const now = await where();
    if (now === last) return;
    last = now;
  }
}

// checkLayout answers the findings on the page once it has settled, and
// only those it finds twice, 400 ms apart: a fault of the layout stays,
// one of a moment (something still arriving) doesn't, and a check that
// fails a flow must not fail it by chance.
export async function checkLayout(page, { touch }) {
  await settle(page);
  const first = new Set((await sample(page, touch)).map(findingKey));
  await page.waitForTimeout(400);
  const seen = new Set();
  return (await sample(page, touch)).filter((f) => {
    const k = findingKey(f);
    if (seen.has(k) || (f.severity === 'fail' && !first.has(k))) return false;
    seen.add(k);
    return true;
  }).map((f) => {
    const a = f.severity === 'fail' && allowance(f);
    return a ? { ...f, severity: a.as ?? 'allowed', why: a.why } : f;
  });
}

// key names a finding apart from the screen it was on.
export const findingKey = (f) => {
  const bare = (n) => (n ?? '').replace(/\s+".*$/, '');
  return `${f.rule}|${bare(f.el)}|${bare(f.by)}`;
};
