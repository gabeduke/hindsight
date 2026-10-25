// The desk in front of you -- the header and the bar -- through a switch of
// rooms (docs/flows.md, J2.2 and J2.10). watchDesk installs a watcher in the
// page that, on every frame a switch is drawn (html[data-turn] is set, by
// lib/shell/router.js), writes down where the header and the bar are laid
// out and where the transition draws them (their ::view-transition-group
// boxes, and whether anything turns them), and how the room behind them is
// drawn; and every pointerdown, with the switch it came during. A flow reads
// it back with desk(page). Call it before the page loads: its listener has to
// hear a press before the router's, which ends the turn the press came in.

export async function watchDesk(page) {
  await page.addInitScript(() => {
    if (window.__desk) return;
    const desk = { samples: [], downs: [] };
    window.__desk = desk;
    const html = { getAttribute: (k) => document.documentElement?.getAttribute(k) ?? null };
    const rect = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    };
    const pseudo = (p) => getComputedStyle(document.documentElement, p);
    // Where the transition draws a named part: its group's box, and whether
    // that box is only moved (a 2D translation) or turned.
    const drawn = (name) => {
      const s = pseudo(`::view-transition-group(${name})`);
      if (!/px$/.test(s.width)) return null; // no transition, or not yet set up
      const m = /^matrix\(([^)]*)\)$/.exec(s.transform);
      const [a, b, c, d, e, f] = m ? m[1].split(',').map(Number) : s.transform === 'none' ? [1, 0, 0, 1, 0, 0] : [];
      return {
        flat: a === 1 && b === 0 && c === 0 && d === 1,
        box: [e, f, parseFloat(s.width), parseFloat(s.height)].map((v) => Math.round(v)),
        image: pseudo(`::view-transition-new(${name})`).transform,
      };
    };
    addEventListener('pointerdown', (e) => {
      desk.downs.push({ turn: html.getAttribute('data-turn'), on: e.target.closest?.('[id]')?.id ?? null });
    }, true);
    const step = () => {
      const turn = html.getAttribute('data-turn');
      if (turn) {
        desk.samples.push({
          turn,
          arriving: html.getAttribute('data-arriving'),
          appbar: rect('.appbar'),
          np: rect('#np'),
          header: drawn('appbar'),
          bar: drawn('np'),
          room: pseudo('::view-transition-old(root)').transform,
        });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** desk answers what the watcher saw since the last call, and starts afresh. */
export function desk(page) {
  return page.evaluate(() => {
    const d = window.__desk;
    const out = { samples: d.samples.slice(), downs: d.downs.slice() };
    d.samples.length = 0;
    d.downs.length = 0;
    return out;
  });
}

/** rects is where the header and the bar are laid out now. */
export function rects(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    };
    return { appbar: rect('.appbar'), np: rect('#np') };
  });
}

/** same says two boxes are one, to a pixel. */
export const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1);

/** turned is what a switch's frames say: drawn as a turn (the room's old picture turned in 3D), with the part's boxes. */
export function during(samples, part) {
  const drawnFrames = samples.filter((s) => s[part === 'appbar' ? 'header' : 'bar']);
  return {
    frames: drawnFrames.length,
    turned: samples.some((s) => /^matrix3d/.test(s.room || '')),
    laidOut: samples.map((s) => s[part]),
    drawn: drawnFrames.map((s) => (part === 'appbar' ? s.header : s.bar)),
  };
}
