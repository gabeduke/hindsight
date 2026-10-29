// web/static/lib/play/styles.test.js
// The instrument strip's CSS (styles.css, "Rooms P3") reaches only the
// strip, and is drawn in the pad controller's materials. It's behind
// hindsight.play, but styles.css is on every page of every kit: a bare rule
// here would restyle the kits that never turned it on (AGENTS.md, CSS), and
// a token that follows the scheme would turn the instrument pale at noon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { block as braces, decls, fileCss, rules, section, tokens } from '../stylesheets.js';

const css = fileCss('styles.css');

const block = (name) => section(css, `/* ---------- Rooms ${name}:`);
// P3's strip, and P4's FX and mods drawn into it.
const blocks = () => block('P3') + block('P4');
const p3Block = blocks;

test('every rule in the strip’s blocks (P3, P4) hangs off a play- class', () => {
  const loose = [];
  for (const m of p3Block().matchAll(/([^{}]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue;
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
      if (!/\.play-[a-z0-9-]+/.test(sel)) loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'these could match something that is not the strip');
});

test('the strip is drawn in its own materials, the same in both schemes', () => {
  const scheme = new Set(Object.keys(tokens(css, { scheme: 'dark', only: true })));
  const offenders = [];
  for (const m of p3Block().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const v of m[2].matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (scheme.has(v[1])) offenders.push(`${m[1].trim()}: ${v[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'these follow the scheme; use a --pad- material from objects.css');
});

test('the overlay is gone: no full-screen sheet, and no rule locks the page', () => {
  assert.doesNotMatch(css, /\.play-mode\b/);
  assert.doesNotMatch(css, /\.play-enter\b/);
  assert.doesNotMatch(css, /body\.play-open/);
});

test('a laptop’s height keeps two lanes in sight while the strip is unfolded', () => {
  // At 1440 × 790 (a 900-px laptop's real window) the unfolded strip and the
  // feed once left no lane at all, so the track keys dropped out tracks no
  // one could see. Under 1000 px tall the strip is compact and the feed
  // folds to its keys; the browser check measures the lanes
  // (docs/superpowers/plans/2026-10-15-p3-strip.md, Look).
  const block = p3Block();
  const at = block.search(/@media[^{]*\(max-height: 1000px\)/);
  assert.ok(at >= 0, 'a block for a laptop’s height');
  const rules = braces(block, at);
  assert.match(rules, /body\.play-unfolded \.studio-feed > \.viz-wrap \{ display: none; \}/);
  assert.match(rules, /\.play-tracks \.play-track \{ min-height: (\d+)px/);
  assert.ok(Number(/\.play-tracks \.play-track \{ min-height: (\d+)px/.exec(rules)[1]) <= 48, 'short track keys');
});

test('at a laptop’s height the FX and the mods go up beside the tracks, not beside the tricks', () => {
  // P4's one-row grid (min-width: 1100px) once overrode P3's compact one:
  // at 1280–1440 wide and under 1000 tall the tricks and the bus were
  // crushed into one column, ½× and 2× 24 px wide and KEEP under the FX.
  // So inside P4's laptop-height block the tricks' row spans every column
  // after the reel, and the FX and the mods sit in the first row. The
  // browser check measures the pads (the P4 plan, Look).
  const p4 = block('P4');
  const at = p4.search(/@media \(min-width: 1100px\) and \(min-height: 441px\) and \(max-height: 1000px\)/);
  assert.ok(at >= 0, 'P4 has a block for a laptop’s height');
  const rules = braces(p4, at);
  assert.match(rules, /\.play-body:has\(> \.play-slot-fx:not\(\[hidden\]\)\) > \.play-side \{ grid-column: 2 \/ -1; grid-row: 2; \}/);
  assert.match(rules, /\.play-slot-fx:not\(\[hidden\]\) \{ grid-column: 3; grid-row: 1; \}/);
  assert.match(rules, /\.play-slot-mods:not\(\[hidden\]\) \{ grid-column: 4; grid-row: 1; \}/);
  // And it comes after the one-row grid, so it wins where both apply.
  assert.ok(at > p4.search(/@media \(min-width: 1100px\) \{/), 'after the one-row grid');
});

// The rules of the P3 block, one per selector, each with the @media it sits
// in: [{ media, sel, decls }].
function rulesOf(block) {
  return rules(block).flatMap((r) => {
    const d = Object.fromEntries(decls(r.body).map((x) => [x.prop, x.important ? `${x.value} !important` : x.value]));
    return r.sel.map((sel) => ({ media: r.media, sel, decls: d }));
  });
}
const PHONE_MEDIA = '(max-width: 699.98px), (orientation: landscape) and (max-height: 440px)';
const LAPTOP_MEDIA = '(min-width: 700px) and (min-height: 441px) and (max-height: 1000px)';
const find = (rules, media, sel) => rules.find((r) => r.media === media && r.sel === sel);

test('on a phone the buffer’s sheet sits above the mini player, so EDIT | PLAY is never under it', () => {
  // P2's sheet is fixed at the dock and tucks the mini player under it. With
  // Play mode on the mini player carries the EDIT | PLAY toggle, so the sheet
  // stands on the player instead. Its half detent keeps the height it had,
  // so DROP is still in it; the page's room above it follows the sheet.
  const rules = rulesOf(p3Block());
  const lifted = 'body:not(.player-open):has(.play-toggle) .buffer-panel';
  const r = find(rules, PHONE_MEDIA, lifted);
  assert.ok(r, 'a rule that lifts the sheet when the toggle is there');
  assert.equal(r.decls.bottom, 'calc(var(--dock-b, 0px) + var(--np-h, 0px))');
  assert.equal(r.decls.height, undefined, 'the half detent is still P2’s 45svh, which keeps DROP in view');
  const full = find(rules, PHONE_MEDIA, `${lifted}[data-height="full"]`);
  assert.ok(full, 'the full detent gives up the player’s height, so it stops under the top bar');
  assert.match(full.decls.height, /var\(--np-h, 0px\)/);
  assert.equal(find(rules, PHONE_MEDIA, `${lifted}[data-height="peek"]`), undefined, 'the peek detent is unchanged');
  const lift = 'calc(var(--dock-b, 0px) + var(--np-h, 0px) + 45svh';
  const pad = find(rules, PHONE_MEDIA, 'body.tape-page.buffer-open:not(.player-open):has(.play-toggle)');
  assert.ok(pad?.decls['padding-bottom'].startsWith(lift), 'the page leaves room above the lifted sheet');
  const toasts = find(rules, PHONE_MEDIA, 'body.tape-page.buffer-open:not(.player-open):has(.play-toggle) #toasts');
  assert.ok(toasts?.decls.bottom.startsWith(lift), 'and so do the toasts');
});

test('PLAY drops the sheet to its peek and the strip stands above it', () => {
  const rules = rulesOf(p3Block());
  const peek = /\.buffer-panel\[data-height="peek"\] \{ height: (\d+)px/.exec(css)?.[1];
  assert.ok(peek, 'P2’s peek detent');
  const sheet = rules.find((r) => r.media === PHONE_MEDIA && /^body\.play-unfolded:not\(\.player-open\):has\(\.play-toggle\) \.buffer-panel/.test(r.sel));
  assert.ok(sheet, 'PLAY (the strip unfolded) shrinks the sheet');
  assert.equal(sheet.decls.height, `${peek}px`, 'to the peek detent’s height');
  const strip = rules.find((r) => r.media === PHONE_MEDIA && /^body\.buffer-open:not\(\.player-open\) \.play-strip\[data-fold="open"\]$/.test(r.sel));
  assert.ok(strip, 'the open strip clears the peeked sheet');
  assert.match(strip.decls.bottom, new RegExp(`${peek}px`));
  assert.match(strip.decls['max-height'], new RegExp(`${peek}px`));
});

test('a laptop: the unfolded strip folds the buffer to one line, and the buffer alone folds the feed', () => {
  const rules = rulesOf(p3Block());
  // The one-line bench: its body and foot go, nothing else of it does.
  const hidden = rules.filter((r) => r.decls.display === 'none' && /^body\.play-unfolded\.buffer-open \.buffer-/.test(r.sel)).map((r) => r.sel.replace(/^.* /, ''));
  for (const part of ['.buffer-body', '.buffer-foot']) assert.ok(hidden.includes(part), `${part} hides in the one-line bench`);
  for (const keep of ['.buffer-head', '.buffer-close', '.buffer-audition', '.buffer-drop', '.buffer-keep', '.buffer-toss']) {
    assert.ok(!hidden.includes(keep), `${keep} is not what the peek hides (the close and audition stay in the head)`);
  }
  // With the buffer the one open, a laptop's height gives the lanes room
  // by folding the feed to its keys, as the unfolded strip does.
  // (The meters are the strip's head's, docs/plan/the-studio-on-one-screen.md.)
  for (const part of ['.studio-feed > .viz-wrap', '.studio-feed-head > .vu-row']) {
    const r = find(rules, LAPTOP_MEDIA, `body:has(.play-strip).buffer-open ${part}`);
    assert.equal(r?.decls.display, 'none', `${part} folds away while the buffer is open and Play mode is on`);
  }
});
