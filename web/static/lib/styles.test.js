// web/static/lib/styles.test.js
// The stylesheet's promises, checked without a browser: both schemes define
// the same tokens, text is readable on what it sits on, hover never sticks
// on a touch screen, and every control shows focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of the first block opening at `start` (brace-matched).
function block(start) {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(block(css.indexOf(':root')));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(block(darkAt)) };

function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a 6-digit hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const NEW = ['--face-hi', '--face-lo', '--panel-hi', '--card-hi', '--card-lo', '--edge', '--edge-soft', '--edge-strong',
  '--hl', '--sh', '--sh-strong', '--track', '--thumb-hi', '--thumb-lo', '--key-hi', '--key-lo', '--field', '--field-sh',
  '--accent-hi', '--accent-lo', '--accent-glow', '--go-glow', '--warn-glow', '--focus',
  '--well-hi', '--well-ink', '--well-dim', '--well-rule', '--lane', '--lane-hi', '--case-hi', '--case-lo'];

test('both schemes define the depth tokens', () => {
  for (const t of NEW) assert.ok(light[t], `light lacks ${t}`);
});

const PAIRS = [
  ['--ink', '--bg'], ['--ink-dim', '--bg'], ['--ink-faint', '--bg'], ['--ink', '--panel'], ['--ink-dim', '--panel'],
  ['--ink', '--field'], ['--on-accent', '--accent'], ['--on-accent', '--accent-lo'], ['--lcd-ink', '--lcd'],
  ['--well-ink', '--well'], ['--well-dim', '--well'], ['--danger-ink', '--bg'], ['--link', '--bg']
];
for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: text is readable on what it sits on`, () => {
    for (const [fg, bg] of PAIRS) {
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 4.5, `${scheme} ${fg} on ${bg} is ${c.toFixed(2)}:1`);
    }
  });
}

test('hover lives only inside @media (hover: hover)', () => {
  const hoverBlocks = [...css.matchAll(/@media \(hover: hover\)/g)].map((m) => block(m.index));
  let outside = css;
  for (const b of hoverBlocks) outside = outside.replace(b, '');
  const stray = outside.split('\n').filter((l) => /:hover/.test(l) && !/^\s*(\/\*|\*)/.test(l));
  assert.deepEqual(stray, []);
});

test('every control shows a focus ring', () => {
  const rules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{/g)].map((m) => m[1]).join(',');
  for (const sel of ['.icon-btn', '.chip', '.seg button', '.appnav a', '.capture-btn', '.nudge', '.phone-btn', '.mark-btn'])
    assert.ok(rules.includes(sel), `no :focus-visible rule for ${sel}`);
});

// A colour value as hex: a token, a hex, or a color-mix of two of them.
function resolve(v, t) {
  v = v.trim();
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref) return resolve(t[ref[1]], t);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = rgb(resolve(mix[1], t)), b = rgb(resolve(mix[3], t)), p = Number(mix[2]) / 100;
    return '#' + a.map((c, i) => Math.round(c * p + b[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
  }
  return v;
}

// Text laid over a black window is not on the page: it needs the window's inks.
const WELL_TEXT = ['.rb-label', '.rb-label.on', '.rb-now-label', '.rb-readout', '.viz-wrap.stale::after', '.lane-name', '.lane-meta', '.lane-chev'];
for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: text over the black windows is readable`, () => {
    for (const sel of WELL_TEXT) {
      const at = css.search(new RegExp('^' + sel.replace(/\./g, '\\.') + '\\s*\\{', 'm'));
      assert.ok(at >= 0, `no rule for ${sel}`);
      const color = /(?:^|[;{\s])color:\s*([^;]+);/.exec(block(at));
      assert.ok(color, `${sel} sets no colour, so it inherits a page ink`);
      const c = contrast(resolve(color[1], t), t['--well']);
      assert.ok(c >= 4.5, `${scheme} ${sel} on --well is ${c.toFixed(2)}:1`);
    }
  });
}

// Selector specificity as [ids, classes, types]; enough for these rules.
function specificity(sel) {
  const s = sel.replace(/::[a-z-]+/g, '').replace(/:not\(([^)]*)\)/g, ' $1');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+/g) || []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[a-z-]+/g, ' ').match(/[a-z][\w-]*/gi) || []).length;
  return [ids, classes, types];
}
const outranks = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
// Every rule as { sel: [parts], body }, top level or inside @media.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = [...bare.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].split(',').map((x) => x.trim()).filter(Boolean), body: m[2] }));

test('a latched transport key sits as low as the raised key rule it overrides', () => {
  const raised = specificity('.tb-row.transport .icon-btn');
  const pressed = RULES.find((r) => r.sel.includes('.tb-row.transport .icon-btn[aria-pressed="true"]'));
  assert.ok(pressed);
  for (const part of pressed.sel.filter((x) => x.includes('.tb-')))
    assert.ok(outranks(specificity(part), raised) >= 0, `${part} loses to .tb-row.transport .icon-btn`);
});

test('hovering a key never hides its state', () => {
  const hoverBlocks = [...css.matchAll(/@media \(hover: hover\)[^{]*/g)].map((m) => block(m.index)).join('\n');
  const lifts = [...hoverBlocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /border-color|box-shadow|transform/.test(m[2]))
    .flatMap((m) => m[1].split(',').map((x) => x.trim()));
  for (const part of lifts.filter((x) => x.startsWith('.icon-btn:')))
    for (const state of ['.playing', '.pending', '.armed', '.recording'])
      assert.ok(part.includes(`:not(${state})`), `${part} restyles a ${state} key under the cursor`);
  for (const part of lifts.filter((x) => x.startsWith('.phone-btn')))
    assert.ok(part.includes(':not(.recording)'), `${part} restyles a recording phone key under the cursor`);
});

// A field you are typing into says so: no field turns its outline off, and
// each has a focus ring.
test('every text field shows focus', () => {
  const at = bare.indexOf('.take-name-input, .take-bpm-input, .take-title-input');
  const fields = bare.slice(bare.lastIndexOf('}', at) + 1, bare.indexOf('{', at)).split(',').map((x) => x.trim());
  for (const r of RULES.filter((r) => r.sel.some((x) => /:focus/.test(x)) && /outline:\s*none/.test(r.body)))
    for (const f of fields)
      assert.ok(!r.sel.some((x) => x.startsWith(f + ':focus')), `${f} turns its outline off on focus`);
  const rings = RULES.filter((r) => /outline:\s*2px solid var\(--focus\)/.test(r.body)).flatMap((r) => r.sel);
  for (const f of fields) assert.ok(rings.includes(`${f}:focus-visible`), `${f} has no focus ring`);
});

// Audio is drawn in black windows in both themes: the waveform colours are
// chosen for black, and wash out on the aluminium.
test('every waveform sits in a black window', () => {
  for (const sel of ['.wave:not(.pending)', '.notes-strip']) {
    const bg = RULES.filter((r) => r.sel.includes(sel) && /background:/.test(r.body))
      .map((r) => /background:\s*([^;]+);/.exec(r.body)[1].trim());
    assert.ok(bg.length, `no background for ${sel}`);
    assert.equal(bg.at(-1), 'var(--well)', `${sel} is drawn on ${bg.at(-1)}`);
  }
});

// Tape is an object: brown oxide and a cream trace, the same in both schemes.
const TAPE = ['--oxide-edge', '--oxide-lo', '--oxide', '--oxide-sheen', '--oxide-shade', '--oxide-grain', '--trace', '--trace-hot', '--trace-glow'];
test('the tape tokens exist, and the trace reads on the oxide', () => {
  for (const t of TAPE) assert.ok(light[t], `light lacks ${t}`);
  const c = contrast(light['--trace'], light['--oxide']);
  assert.ok(c >= 4.5, `--trace on --oxide is ${c.toFixed(2)}:1`);
});

// Cassettes are objects: paper, printed stripes and plastic, the same in
// both schemes, with legends that read on what they're printed on.
const CASSETTE = ['--paper-hi', '--paper-lo', '--paper-ink', '--paper-dim', '--paper-bars', '--paper-bars-on', '--paper-rule',
  '--cas-hi', '--cas-mid', '--cas-lo', '--cas-screw', '--cas-slot', '--glass-hi', '--glass-lo',
  '--hub', '--hub-core', '--hub-tooth', '--pack', '--pack-edge'];
test('the cassette tokens exist, and print reads on paper and on its stripe', () => {
  for (const t of CASSETTE) assert.ok(light[t], `light lacks ${t}`);
  for (const ink of ['--paper-ink', '--paper-dim']) {
    const c = contrast(light[ink], light['--paper-lo']);
    assert.ok(c >= 4.5, `${ink} on --paper-lo is ${c.toFixed(2)}:1`);
  }
  assert.ok(contrast(light['--paper-bars-on'], light['--paper-lo']) >= 3, 'picked bars must show on paper');
  for (let n = 1; n <= 5; n++) {
    for (const t of [`--stripe-${n}`, `--stripe-${n}-ink`, `--stripe-${n}-under`]) assert.ok(light[t], `light lacks ${t}`);
    const c = contrast(light[`--stripe-${n}-ink`], light[`--stripe-${n}`]);
    assert.ok(c >= 4.5, `--stripe-${n}-ink on --stripe-${n} is ${c.toFixed(2)}:1`);
  }
});

// A spine is for picking: a press anywhere on it picks the take, so its
// parts take no clicks, and the row's own controls live on the cassette.
test('a spine hides its controls and lets a press fall through to it', () => {
  const rules = RULES.filter((r) => r.sel.some((x) => x.startsWith('.shelf-page .take.spine')));
  const said = (part, re) => rules.some((r) => r.sel.includes(part) && re.test(r.body));
  assert.ok(said('.shelf-page .take.spine .take-actions', /display:\s*none/), 'the actions stay on the cassette');
  for (const p of ['.take-name', '.take-bpm', '.star', '.wave'])
    assert.ok(said(`.shelf-page .take.spine ${p}`, /pointer-events:\s*none/), `${p} takes the spine's press`);
});

test('inputs sit on the field, not the well', () => {
  const at = css.indexOf('.take-name-input, .take-bpm-input, .take-title-input');
  assert.ok(at > 0);
  assert.match(block(at), /background:\s*var\(--field\)/);
});

// The takes search is a box with a bare input inside: the box is the field.
test('the takes search is a field, not a window', () => {
  const at = css.search(/^\.shelf-search\s*\{/m);
  assert.ok(at >= 0);
  assert.match(block(at), /background:\s*var\(--field\)/);
});
