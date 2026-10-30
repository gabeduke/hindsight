// Layout checks: run on every screen a flow passes through, deterministic,
// no LLM. They read the page's geometry for what a person would trip on:
//
//   covered    a control whose middle is under another element, so a tap
//              there lands on something else (the buffer over track 2)
//   offscreen  a control cut off by the viewport's side: a phone that has
//              to scroll sideways to reach it
//   menu-offscreen  an open menu (or a key's ▾ panel) whose box the screen
//              cuts, at a side, the top or the foot: its words cut off, or
//              rows out of reach (Open's ⋯ once opened at x -144 on a phone)
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

// What counts as an open menu: a menu, or a key's ▾ panel (lib/ui/menu.js,
// and the pages' own), but not a sheet.
const MENU = '.menu, [role=menu], .key-pop, [role=listbox]';

// Scrolled under the pinned chrome (the bar, the app bar) is not a fault:
// the page scrolls it back out, so long as it can scroll. The covered check
// and axe's target-size both judge it so, by these, which run in the page
// (each check puts PIN there first). axe alone once failed J2.7 on a List
// just long enough to leave a sliver of a row's key above the bar.
function pinned(n) {
  for (let p = n instanceof Element ? n : n.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/fixed|sticky/.test(getComputedStyle(p).position)) return p;
  }
  return null;
}
function scrolls(n) {
  const d = document.scrollingElement;
  if (d && d.scrollHeight > innerHeight + 1) return true;
  for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll)/.test(o.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
  }
  return false;
}
function underChrome(el, hit) {
  const { pinned, scrolls } = window.__layoutPin;
  const pin = pinned(hit);
  return !!pin && !pin.contains(el) && !pinned(el)?.contains(pin) && scrolls(el);
}
const PIN = `window.__layoutPin = { pinned: ${pinned}, scrolls: ${scrolls}, underChrome: ${underChrome} };`;

// geometry runs in the page: the covered, offscreen, clipped and
// small-touch checks over every visible control, and menu-offscreen over
// every open menu; those inside `root` (a selector) alone, when it is given.
function geometry({ touch, MENU, PIN, root }) {
  if (!window.__layoutPin) (0, eval)(PIN);
  const scope = root ? document.querySelector(root) : document;
  if (!scope) return [{ rule: 'root', severity: 'fail', el: root, msg: 'the root to check is not in the page' }];
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
  const { pinned, scrolls } = window.__layoutPin;
  const out = [];
  for (const el of scope.querySelectorAll(CONTROL)) {
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
      // Meant to cover: a sheet, a menu or a panel that's open over the page
      // (a key’s ▾ opens a role=dialog panel, lib/ui/menu.js splitKey).
      const layer = hit.closest('dialog[open], [role=menu], .menu, :popover-open, [role=dialog]:not([hidden])');
      // Scrolled under the pinned chrome: not a fault (underChrome).
      const under = window.__layoutPin.underChrome(el, hit);
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
  // An open menu stays on the screen, all of it: unlike a control above,
  // one wholly off it counts (its rows are what a person came for).
  for (const m of scope.querySelectorAll(MENU)) {
    if (m.closest('dialog') || !shown(m)) continue;
    const r = m.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const off = [r.left < -1 && 'left side', r.right > W + 1 && 'right side', r.top < -1 && 'top', r.bottom > H + 1 && 'foot'].filter(Boolean);
    if (off.length) {
      out.push({ rule: 'menu-offscreen', severity: 'fail', el: name(m), msg: `an open menu runs off the ${off.join(' and the ')} of the screen (x ${Math.round(r.left)}–${Math.round(r.right)}, y ${Math.round(r.top)}–${Math.round(r.bottom)} of ${W}×${H})` });
    }
  }
  return out;
}

// openMenus names the menus open on the screen, as the checks saw them: a
// screen's line in the report keeps them (`menus`), so a run shows which
// screens had a menu open when they were checked.
function openMenus({ MENU }) {
  const shown = (el) => !el.closest('[inert], [hidden], [aria-hidden="true"], dialog') && getComputedStyle(el).display !== 'none'
    && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.05;
  return [...document.querySelectorAll(MENU)].filter((m) => shown(m) && m.getBoundingClientRect().width > 0)
    .map((m) => (m.id ? `#${m.id}` : `${m.tagName.toLowerCase()}.${[...m.classList].join('.')}`));
}

export const seenMenus = (page) => page.evaluate(openMenus, { MENU }).catch(() => []);

const allowance = (f) => ALLOW.find((a) => a.rule === f.rule &&
  (!a.el || a.el.test(f.el)) && (!a.by || (f.by && a.by.test(f.by))));

// sample is one look at the page: the geometry checks and axe's.
async function sample(page, touch, root = null) {
  const found = await page.evaluate(geometry, { touch, MENU, PIN, root }).catch(() => []);
  // axe in the page by evaluate, not a script tag, so no CSP stops it.
  const axeFound = await page.evaluate(async ([src, pin, root]) => {
    if (!window.axe) (0, eval)(src);
    if (!window.__layoutPin) (0, eval)(pin);
    const r = await window.axe.run(root ? document.querySelector(root) : document, { runOnly: { type: 'rule', values: ['target-size'] }, resultTypes: ['violations'] });
    // A control partly under an open sheet, menu or panel is meant to be,
    // as the covered check above has it: the ⋯ menu over the feed's keys.
    const layers = [...document.querySelectorAll('dialog[open], [role=menu]:not([hidden]), .menu:not([hidden]), [role=dialog]:not([hidden])')]
      .map((l) => l.getBoundingClientRect()).filter((b) => b.width && b.height);
    const underLayer = (sel) => {
      const el = document.querySelector(sel);
      const b = el?.getBoundingClientRect();
      return !!b && layers.some((l) => b.left < l.right && b.right > l.left && b.top < l.bottom && b.bottom > l.top);
    };
    // And one partly scrolled under the pinned chrome, as the covered
    // check has it: whatever covers it, at its middle and its edges.
    const underPinned = (sel) => {
      const el = document.querySelector(sel);
      const b = el?.getBoundingClientRect();
      if (!b) return false;
      const x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
      const covers = [[x, y], [x, b.top + 1], [x, b.bottom - 1], [b.left + 1, y], [b.right - 1, y]]
        .map(([px, py]) => document.elementFromPoint(px, py))
        .filter((h) => h && h !== el && !el.contains(h) && !h.contains(el));
      return covers.length > 0 && covers.every((h) => window.__layoutPin.underChrome(el, h));
    };
    return r.violations.flatMap((v) => v.nodes.map((n) => ({
      rule: 'target-size', severity: 'fail', el: n.target.join(' '),
      // axe passes a small target that has room around it, so a fail is
      // two checks failing: its size, and its offset from the neighbours
      // named here. Without them the report can't say what came close.
      msg: [(n.any[0]?.message || n.failureSummary || v.help).replace(/\s+/g, ' ').slice(0, 160),
        ...n.any.flatMap((c) => c.relatedNodes ?? []).slice(0, 3).map((x) => `near ${x.target.join(' ')}`)].join('; '),
    })).filter((f) => !(/obscured/.test(f.msg) && (underLayer(f.el) || underPinned(f.el)))));
  }, [axe(), PIN, root]).catch((e) => [{ rule: 'axe', severity: 'warn', el: '', msg: `axe didn't run: ${e.message.split('\n')[0]}` }]);
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
// fails a flow must not fail it by chance. With `root` (a selector), only
// what is inside it is checked: one component, in its harness
// (scripts/components.mjs), where the page around it is not its fault.
export async function checkLayout(page, { touch, root = null }) {
  await settle(page);
  const first = new Set((await sample(page, touch, root)).map(findingKey));
  await page.waitForTimeout(400);
  const seen = new Set();
  return (await sample(page, touch, root)).filter((f) => {
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

// The Studio's budget on a tablet (docs/plan/the-studio-on-one-screen.md,
// step 4): at rest (a tape loaded, nothing open), at most `controls` on the
// screen, at most `under32` of them under 32 px, each track's ● (the jam's
// key) `jam` px or more, and all four tracks above the bar. The review of
// 2026-10-22 counted 65 controls on the tablet, 30 under 32 px, and 1½
// tracks above the bar; just before the heads on a touch screen it was 51
// and 27. They left 43 at 1024×768 and upright at 800, and 44 at 1280×800,
// where the header shows the brand; 1 under 32 px, the sections' strip (a
// canvas you hold and drag on). Like layout-known.json these only go down: lower one
// when a change leaves less, never raise it to make a flow pass.
export const STUDIO_BUDGET = Object.freeze({ controls: 44, under32: 1, jam: 44 });

// studioCount runs in the page: what the budget counts, as it is now.
function studioCount() {
  const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=slider], [tabindex]:not([tabindex="-1"])';
  const W = innerWidth, H = innerHeight;
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}`;
  const shown = [...document.querySelectorAll(CONTROL)].filter((el) => {
    if (el.closest('[inert], [hidden], [aria-hidden="true"], dialog:not([open])')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) <= 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
  });
  const size = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; };
  const small = shown.filter((el) => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height) < 32; });
  const arms = [...document.querySelectorAll('#lanes .tt-arm')].map((el) => { const r = el.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); });
  const bar = document.getElementById('np')?.getBoundingClientRect();
  const tracks = [...document.querySelectorAll('#lanes .tape-track')];
  const above = tracks.filter((tr) => !bar?.height || tr.getBoundingClientRect().bottom <= bar.top + 1).length;
  return {
    controls: shown.length, under32: small.length, small: small.map((el) => `${name(el)} ${size(el)}`),
    jam: arms.length ? Math.min(...arms) : 0, tracks: tracks.length, above,
  };
}

export const studioBudget = (page) => page.evaluate(studioCount);
