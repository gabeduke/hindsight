// web/static/lib/styles.test.js
// The stylesheet's promises, checked without a browser: both schemes define
// the same tokens, text is readable on what it sits on, hover never sticks
// on a touch screen, and every control shows focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
// The materials -- tape, cassettes, reels, the VU faces -- live next door in
// objects.css. Same :root, no dark block of its own, because every token in
// it is the same in both schemes. These checks run over the two files
// together, because that is what a page loads.
const materials = readFileSync(new URL('../objects.css', import.meta.url), 'utf8');

// The body of the first block opening at `start` (brace-matched).
function block(start, text = css) {
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = {
  ...tokens(block(materials.indexOf(':root'), materials)),
  ...tokens(block(css.indexOf(':root'))),
};
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
  ['--well-ink', '--well'], ['--well-dim', '--well'], ['--danger-ink', '--bg'], ['--link', '--bg'],
  // A take's dropouts: the header's line, and the cassette's sticker.
  ['--warn-ink', '--bg'], ['--on-flag', '--warn'],
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
  for (let n = 1; n <= 8; n++) {
    for (const t of [`--stripe-${n}`, `--stripe-${n}-ink`, `--stripe-${n}-under`]) assert.ok(light[t], `light lacks ${t}`);
    const c = contrast(light[`--stripe-${n}-ink`], light[`--stripe-${n}`]);
    assert.ok(c >= 4.5, `--stripe-${n}-ink on --stripe-${n} is ${c.toFixed(2)}:1`);
  }
});

// A spine is for picking: a press anywhere on it picks the take, so its
// parts take no clicks, and the row's own controls live on the cassette.
test('a spine hides its controls and lets a press fall through to it', () => {
  const rules = RULES.filter((r) => r.sel.some((x) => x.startsWith('.take.spine')));
  const said = (part, re) => rules.some((r) => r.sel.includes(part) && re.test(r.body));
  assert.ok(said('.take.spine .take-actions', /display:\s*none/), 'the actions stay on the cassette');
  for (const p of ['.take-name', '.take-bpm', '.star', '.wave'])
    assert.ok(said(`.take.spine ${p}`, /pointer-events:\s*none/), `${p} takes the spine's press`);
});

// The ribbon's print -- its ruler and readout -- sits on the tape itself.
test('print on the ribbon reads on the oxide and on its ruler', () => {
  for (const bg of ['--oxide', '--oxide-ruler']) {
    assert.ok(light[bg], `light lacks ${bg}`);
    const c = contrast(light['--oxide-label'], light[bg]);
    assert.ok(c >= 4.5, `--oxide-label on ${bg} is ${c.toFixed(2)}:1`);
  }
  const at = css.search(/^\.rb-readout\s*\{/m);
  assert.match(block(at), /color:\s*var\(--oxide-label\)/);
});

// The monitor: VU meters backlit amber, stats in amber LCD windows -- both
// objects, the same in both schemes.
test('the VU faces are backlit, and their scale reads on the dimmest part', () => {
  for (const t of ['--vu-bezel-hi', '--vu-bezel-lo', '--vu-face-hi', '--vu-face-mid', '--vu-face-lo', '--vu-needle'])
    assert.ok(light[t], `light lacks ${t}`);
  for (const [scheme, t] of [['light', light], ['dark', dark]]) {
    const c = contrast(t['--vu-ink'], t['--vu-face-lo']);
    assert.ok(c >= 4.5, `${scheme} --vu-ink on --vu-face-lo is ${c.toFixed(2)}:1`);
  }
});

test('stats read as amber LCD readouts', () => {
  const v = RULES.filter((r) => r.sel.includes('.stat .v'));
  assert.ok(v.some((r) => /background:\s*var\(--lcd\)/.test(r.body)), '.stat .v sits in an LCD window');
  // Warnings have windows of their own (the next test); a normal reading sits in the LCD.
  for (const [sel, scheme, t] of [['.stat .v', 'light', light], ['.stat .v', 'dark', dark]]) {
    const r = RULES.filter((x) => x.sel.includes(sel)).map((x) => /(?:^|[;{\s])color:\s*([^;]+);/.exec(x.body)).filter(Boolean).at(-1);
    assert.ok(r, `${sel} has a colour`);
    const c = contrast(resolve(r[1], t), t['--lcd']);
    assert.ok(c >= 4.5, `${scheme} ${sel} on --lcd is ${c.toFixed(2)}:1`);
  }
});

// The Capture key's second line is extra height, which a short landscape
// screen hasn't got: the 844x390 fold is a Global Constraint.
test("a short landscape screen hides the Capture key's second line", () => {
  const at = css.indexOf('@media (orientation: landscape) and (max-height: 560px)');
  assert.ok(at > 0);
  assert.match(block(at), /\.cap-sub\s*\{[^}]*display:\s*none/);
});

// A readout that warns must look different from one that doesn't: its own
// window, not just a shade of the same amber.
test('a warning readout has its own window, and reads in it', () => {
  for (const sel of ['.stat .v.warn', '.stat .v.bad']) {
    const rules = RULES.filter((x) => x.sel.includes(sel));
    const bg = rules.map((x) => /background:\s*([^;]+);/.exec(x.body)).filter(Boolean).at(-1);
    const fg = rules.map((x) => /(?:^|[;{\s])color:\s*([^;]+);/.exec(x.body)).filter(Boolean).at(-1);
    assert.ok(bg && bg[1].trim() !== 'var(--lcd)', `${sel} sits in its own window`);
    for (const [scheme, t] of [['light', light], ['dark', dark]]) {
      const c = contrast(resolve(fg[1], t), resolve(bg[1], t));
      assert.ok(c >= 4.5, `${scheme} ${sel} is ${c.toFixed(2)}:1 in its window`);
    }
  }
});

// Print on the tape gets a dark plate: the trace can run behind it at any
// brightness. The readout lets a tap through to the flags under it.
test('REC and the readout sit on plates, and the readout takes no taps', () => {
  for (const sel of ['.rb-now-label', '.rb-readout']) {
    const at = css.search(new RegExp('^' + sel.replace(/\./g, '\\.') + '\\s*\\{', 'm'));
    const b = block(at);
    assert.match(b, /background:\s*var\(--oxide-ruler\)/, `${sel} has a plate`);
    const fg = /(?:^|[;{\s])color:\s*([^;]+);/.exec(b)[1];
    for (const [scheme, t] of [['light', light], ['dark', dark]]) {
      const c = contrast(resolve(fg, t), t['--oxide-ruler']);
      assert.ok(c >= 4.5, `${scheme} ${sel} is ${c.toFixed(2)}:1 on its plate`);
    }
  }
  assert.match(block(css.search(/^\.rb-readout\s*\{/m)), /pointer-events:\s*none/);
});

test("the VU scale's red numerals read on the backlit face", () => {
  const c = contrast(light['--vu-red'], light['--vu-face-lo']);
  assert.ok(c >= 4.5, `--vu-red on --vu-face-lo is ${c.toFixed(2)}:1`);
  assert.ok(RULES.some((r) => r.sel.includes('.vu-num.red') && /fill:\s*var\(--vu-red\)/.test(r.body)));
});

// A token defined twice in one block silently takes the later value: the
// tape machine's --hub once overwrote the cassette's.
test('no token is defined twice in a scheme', () => {
  for (const [name, body] of [[':root', block(css.indexOf(':root'))], ['dark', block(darkAt)]]) {
    const seen = new Set();
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      assert.ok(!seen.has(m[1]), `${name} defines ${m[1]} twice`);
      seen.add(m[1]);
    }
  }
});

// The tape's metal: brushed in each scheme, metal reels the same in both,
// keys that light yellow (mute) and blue (solo); and the bar's LCD, whose
// position and dim lines read on its black.
test('the tape deck tokens exist, and the bar\'s LCD reads', () => {
  for (const t of ['--deck-hi', '--deck-lo', '--deck-cap', '--reel-metal', '--reel-edge', '--reel-hub', '--mute-hi', '--mute-lo', '--mute-ink', '--solo-hi', '--solo-lo', '--solo-ink'])
    assert.ok(light[t], `light lacks ${t}`);
  for (const [fg, bg] of [['--mute-ink', '--mute-lo'], ['--mute-ink', '--mute-hi'], ['--solo-ink', '--solo-lo'], ['--solo-ink', '--solo-hi']]) {
    const c = contrast(light[fg], light[bg]);
    assert.ok(c >= 4.5, `${fg} on ${bg} is ${c.toFixed(2)}:1`);
  }
  for (const sel of ['.np-pos', '.np-time']) {
    const r = RULES.filter((x) => x.sel.includes(sel)).map((x) => /(?:^|[;{\s])color:\s*([^;]+);/.exec(x.body)).filter(Boolean).at(-1);
    assert.ok(r, `${sel} has a colour`);
    for (const [scheme, t] of [['light', light], ['dark', dark]]) {
      const c = contrast(resolve(r[1], t), t['--lcd']);
      assert.ok(c >= 4.5, `${scheme} ${sel} on --lcd is ${c.toFixed(2)}:1`);
    }
  }
});

// On a phone, upright or sideways, the now-playing bar is docked: Play, Loop,
// Rec and Catch always on screen, whatever the page has scrolled to.
test('a phone docks the now-playing bar', () => {
  const at = css.indexOf('@media (max-width: 699.98px), (orientation: landscape) and (max-height: 440px)');
  assert.ok(at > 0, 'a media block for both phone shapes');
  assert.match(block(at), /\.np\s*\{[^}]*position:\s*fixed/);
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

test('nothing hides the about line, which carries the only way into Settings', () => {
  // The Settings button lives in `.about` at the Studio's foot, and nowhere
  // else in the app: on Capture, and with the two rooms on (lib/rooms) at the
  // foot of the tape page, which is the Studio while the tape is on
  // (pages.test.js keeps it there). A layout rule that hides that line leaves
  // the window shape it matches with no route to the per-device switches or
  // the guide -- which is exactly what happened to a laptop browser that was
  // not full height, and was noticed only because someone went looking for
  // Settings and could not find it.
  const offenders = [];
  for (const m of css.matchAll(/([^{}]*\.about[^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    if (!/display\s*:\s*none/.test(body)) continue;
    // `[hidden]` is the element asking to be hidden, which is not a layout
    // deciding for it.
    if (selector.includes('[hidden]')) continue;
    offenders.push(`${selector} { ${body.trim()} }`);
  }
  assert.deepEqual(offenders, [],
    "these hide the Studio's about line, and with it the only entry to Settings");
});

test('the Studio’s rules reach only the Studio', () => {
  // The two rooms are behind a per-device flag, but styles.css is on every
  // page of every kit. So the Rooms P1 block may only style what the Studio's
  // templates in tape.html put in the page: a studio- class, the about line
  // in the tape page's body, which only the Studio puts there, or anything
  // under :root[data-rooms], which only the flag's early script sets.
  const start = css.indexOf('/* ---------- Rooms P1:');
  assert.ok(start >= 0, 'the Rooms P1 block');
  // To the next section's header, however many dashes it has.
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  const body = css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
  const loose = [];
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      if (!sel || sel.startsWith('@') || /^(from|to|\d+%)$/.test(sel)) continue; // a keyframe's steps
      if (/\.studio-[a-z0-9-]+/.test(sel) || /^body\.tape-page > \.about\b/.test(sel) || /^:root\[data-rooms\] /.test(sel)) continue;
      loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'these Studio selectors could match something that is not the Studio');

  // And no page wears a studio- class outside those templates, nor any
  // script but the Studio's.
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) =>
    (f.endsWith('.html') || f.endsWith('.js')) && !f.endsWith('.test.js') && !f.includes('lib/rooms/'));
  const borrowed = [];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<template id="studio-[a-z-]+">[\s\S]*?<\/template>/g, '')
      .replace(/\sid="[^"]*"/g, '');
    for (const m of text.matchAll(/(?:^|[^\w-])(studio-[a-z0-9-]+)/g)) borrowed.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(borrowed, [], 'these files use a class the Studio styles');
});

test('the Listening Room’s rules reach only the room', () => {
  // The room is behind the rooms flag; its CSS is on every page of every
  // kit. So the Rooms P5 block may only style what the room's modules make
  // (a room-, chair- or book- class, or .room and .chair themselves) or the
  // pages the room has marked (body.room-on, body.chair-on).
  const start = css.indexOf('/* ---------- Rooms P5:');
  assert.ok(start >= 0, 'the Rooms P5 block');
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  const body = css.slice(start, next < 0 ? undefined : start + 1 + next)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A keyframes' steps are not selectors.
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  // Commas inside :is() and :not() don't separate selectors.
  const split = (list) => {
    const out = [];
    let depth = 0, from = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === '(') depth++;
      else if (list[i] === ')') depth--;
      else if (list[i] === ',' && depth === 0) { out.push(list.slice(from, i)); from = i + 1; }
    }
    return [...out, list.slice(from)].map((x) => x.trim());
  };
  const loose = [];
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue; // a media query, not a selector
    for (const sel of split(m[1])) {
      if (!sel) continue;
      if (/\.(?:room|chair|book)(?:-[a-z0-9-]+)?(?![\w-])/.test(sel)) continue;
      loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'these room selectors could match something that is not the room');

  // And nothing outside the room's modules wears one of its classes.
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) =>
    (f.endsWith('.html') || f.endsWith('.js')) && !f.endsWith('.test.js') && !f.includes('lib/room/') && !f.endsWith('help/tips.js'));
  const borrowed = [];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
    for (const m of text.matchAll(/(?:^|[^\w-])((?:room|chair|book)-[a-z0-9-]+)/g)) borrowed.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(borrowed, [], 'these files use a class the room styles');
});

test('the room never hides the bar, on any shelf or in a month’s box', () => {
  // The bar is the only transport (docs/superpowers/specs/2026-10-15-flow-
  // design.md): the phone's deck card used to be the player, and the room hid
  // the bar behind it. The card is gone, so a rule that hides the bar leaves
  // nothing to pause with. (The chair's deck is its bar and is not the doorway.)
  const start = css.indexOf('/* ---------- Rooms P5:');
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  const body = css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
  const hiding = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel, decl]) => /\.room-on/.test(sel) && /(^|[\s>])\.np(?![\w-])/.test(sel) && /display:\s*none/.test(decl) && !/\.np \./.test(sel))
    .map(([, sel]) => sel.trim());
  assert.deepEqual(hiding, []);
});

test('a phone’s shelf row leaves room for a selected spine’s ring, halo and tick to be whole', () => {
  // The row scrolls (overflow clips both ways), the ring's halo is 2px and the tick sits 6px
  // above the spine: it needs 8px above and 2px beside, and a snap must not eat the side.
  const start = css.indexOf('/* ---------- Rooms P5:');
  const body = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '');
  const phone = body.slice(body.indexOf('@media (max-width: 999.98px), (prefers-reduced-data: reduce)'));
  const m = /\.room-row\s*\{[^}]*padding:\s*(\d+)px\s+\d+px\s+\d+px\s+(\d+)px[^}]*\}/.exec(phone);
  assert.ok(m, 'the phone’s .room-row has a four-value padding');
  assert.ok(Number(m[1]) >= 8, `${m[1]}px above the spines is too little for the tick`);
  assert.ok(Number(m[2]) >= 2, `${m[2]}px beside the first spine is too little for the halo`);
  assert.match(m[0], /scroll-padding-left:\s*[2-9]px/, 'a snap to the first spine keeps that room');
});

test('the room draws no deck on a phone, and the deck has no keys', () => {
  const start = css.indexOf('/* ---------- Rooms P5:');
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  const body = css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
  const phone = body.slice(body.indexOf('@media (max-width: 999.98px), (prefers-reduced-data: reduce)'));
  assert.match(phone, /\.room-deck\s*\{\s*display:\s*none/, 'the deck card is gone on a phone');
  assert.doesNotMatch(body, /room-deck-keys|room-deck-play|room-deck-sit|room-takecard|room-tapecard|\.room-put\b|\.room-reel\b/, 'no rule for what is gone');
});

test('Play mode’s rules reach only Play mode', () => {
  // Play mode is behind a per-device flag, but its CSS is not: styles.css is
  // on every page of every kit. Its overlay rule was once a bare `.play` --
  // the class the Takes page already gave its Play buttons -- so on a phone,
  // opening a take turned that button into a blank sheet over the whole
  // screen, with Play mode switched off.
  const start = css.indexOf('/* ---------- Play mode (lib/play) ---------- */');
  assert.ok(start >= 0, 'the Play mode block');
  const end = css.indexOf('/* ----------', start + 1);
  const body = css.slice(start, end < 0 ? undefined : end).replace(/\/\*[\s\S]*?\*\//g, '');

  // Every selector hangs off one of Play mode's own `play-` classes.
  const loose = [];
  const mine = new Set();
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',').map((s) => s.trim())) {
      if (!sel || sel.startsWith('@')) continue;
      const own = [...sel.matchAll(/\.(play-[a-z0-9-]+)/g)].map((c) => c[1]);
      if (!own.length) loose.push(sel);
      for (const c of own) mine.add(c);
    }
  }
  assert.deepEqual(loose, [], 'these Play mode selectors could match something that is not Play mode');

  // And nothing outside lib/play wears one of those classes.
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) =>
    (f.endsWith('.html') || f.endsWith('.js')) && !f.endsWith('.test.js') && !f.includes('lib/play/'));
  const borrowed = [];
  for (const f of files) {
    // An id is not a class, nor is a tip's name (data-tip, and the tips'
    // names in lib/help/tips.js).
    const text = readFileSync(new URL(f, root), 'utf8')
      .replace(/\sid="[^"]*"/g, '')
      .replace(/\sdata-tip="[^"]*"/g, '')
      .replace(/ids: \[[^\]]*\]/g, '');
    for (const c of mine) {
      if (new RegExp(`(^|[^\\w-])${c}(?![\\w-])`).test(text)) borrowed.push(`${f}: ${c}`);
    }
  }
  assert.deepEqual(borrowed, [], 'these files use a class that Play mode styles');
});

test('Play mode is drawn in its own materials, the same in both schemes', () => {
  // It used the page's panels once, and in the light scheme its legends were
  // ivory on pale grey: unreadable, and nobody saw it, because the only look
  // anyone had was at night. Inside the overlay, nothing may use a token the
  // dark scheme redefines. Its way in, .play-enter, sits on the page, so it
  // dresses like the page.
  const start = css.indexOf('/* ---------- Play mode (lib/play) ---------- */');
  const end = css.indexOf('/* ----------', start + 1);
  const body = css.slice(start, end < 0 ? undefined : end).replace(/\/\*[\s\S]*?\*\//g, '');
  const scheme = new Set(Object.keys(tokens(block(darkAt))));
  const offenders = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.includes('play-enter')) continue;
    for (const v of m[2].matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (scheme.has(v[1])) offenders.push(`${sel}: ${v[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'these follow the scheme; use a --pad- material from objects.css');
});

test('on a phone the Studio’s selection bar wraps instead of running off the screen', () => {
  // Its readout and four keys are wider than a 390 px phone inside the
  // feed's padding: unwrapped, Save as take ended past the screen's edge,
  // the page scrolled sideways, and the readout shrank to nothing.
  const start = css.indexOf('/* ---------- Rooms P1:');
  const at = css.indexOf('@media (max-width: 699.98px)', start);
  assert.ok(start >= 0 && at > start, 'the Studio has a phone block');
  const phone = block(at);
  assert.match(phone, /\.studio-feed > \.rb-sel\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(phone, /\.studio-feed > \.rb-sel \.rb-sel-text\s*\{[^}]*flex:\s*1 1 100%/);
});

// A block that is never closed swallows what follows it: a merge once lost
// the `}` ending P3's last @media rule, and the Listening Room, the rig, the
// FX and the mods -- everything after it -- were then inside a 700 px query:
// a phone got none of it, and no test failed, because every test reads the
// text. And in objects.css a lost `}` left P4's tokens in a :root inside
// P6's, which matches nothing, so the selected tape formula was dark ink on
// the dark strip (1.2 : 1). Both are checked by shape: nothing that starts
// at the margin may open while another block is open, and the file ends shut.
function blanked(text) {
  const keep = (m) => m.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, keep).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, keep);
}
/** misnested is every rule that opens at the margin while a block is open, and the depth the file ends at. */
function misnested(text) {
  let depth = 0;
  const at = [];
  blanked(text).split('\n').forEach((line, i) => {
    if (depth > 0 && /^[^\s}]/.test(line) && /\{\s*$/.test(line)) at.push(`line ${i + 1} (inside ${depth} open): ${line.trim().slice(0, 60)}`);
    for (const c of line) { if (c === '{') depth++; else if (c === '}') depth--; }
  });
  return { at, end: depth };
}

test('the checker finds a block a merge left open', () => {
  assert.equal(misnested('a { x: 1; }\n@media (min-width: 1px) {\n  b { y: 2; }\n\n:root {\n  --z: 1;\n}\n').at.length, 1);
  assert.deepEqual(misnested('a { x: 1; }\n@media (min-width: 1px) {\n  b { y: 2; }\n}\n:root {\n  --z: 1;\n}\n'), { at: [], end: 0 });
});

for (const [name, text] of [['styles.css', css], ['objects.css', materials]]) {
  test(`${name} closes every block it opens`, () => {
    const { at, end } = misnested(text);
    assert.deepEqual(at, [], 'these rules are inside a block that was never closed');
    assert.equal(end, 0, 'the file ends inside a block');
  });
}

// The tape formulas (lib/play/mods.js): four labels, one of them selected.
// WCAG's 4.5 : 1 for text, from the tokens the rules name.
test('every tape formula label reads, selected or not', () => {
  const all = tokens(materials);
  const rule = (sel) => {
    const m = new RegExp(`${sel.replace(/[.[\]="]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `the ${sel} rule`);
    return m[1];
  };
  const token = (decl, prop) => {
    const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*var\\((--[a-z0-9-]+)\\)`).exec(decl);
    assert.ok(m, `${prop} names a token`);
    assert.ok(all[m[1]], `${m[1]} is defined in objects.css`);
    return all[m[1]];
  };
  const plain = rule('.play-formula');
  const chosen = rule('.play-formula[aria-checked="true"]');
  assert.ok(contrast(token(plain, 'color'), token(plain, 'background')) >= 4.5, 'an unselected formula');
  assert.ok(contrast(token(chosen, 'color'), token(chosen, 'background')) >= 4.5, 'the selected formula');
});

// Settings is the only way into Settings anywhere in the app (the about line
// on Capture, and the Studio's foot), so it is drawn as a button with a real
// target, not as the line's 12px link: at least 40px tall, a size up from the
// line, and its own rule so Releases and Update keep the link look.
test('the Settings button is a button-sized target, not a link in the line', () => {
  const m = /\.about #settings-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'a rule for .about #settings-btn');
  const body = m[1];
  const px = (prop) => {
    const d = new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`).exec(body);
    assert.ok(d, `${prop} in px`);
    return +d[1];
  };
  assert.ok(px('min-height') >= 40, 'at least 40px tall');
  assert.ok(px('font-size') >= 14, 'a size up from the 12px line');
  assert.match(body, /border:\s*1px solid var\(--line\)/, 'it has an edge, so it reads as a button');
  assert.match(body, /text-decoration:\s*none/, 'and is not underlined like a link');
});

// A phone showed "Fri, Oct 16, 11:2…": the date sat on the tag's line and
// was cut off. It has a line of its own now, and nothing may cut it.
test('a release row never cuts its date off', () => {
  const rows = RULES.filter((r) => r.sel.some((s) => /\.release-(date|tag|what)\b/.test(s)));
  assert.ok(rows.length);
  for (const r of rows) assert.doesNotMatch(r.body, /text-overflow:\s*ellipsis|white-space:\s*nowrap/, r.sel.join(', '));
  assert.ok(RULES.some((r) => r.sel.some((s) => /\.release-what$/.test(s)) && /flex-direction:\s*column/.test(r.body)), 'the tag sits over its date');
});

// On a touch screen the foot's Releases and Update are a finger tall without
// the line growing (they measured 29px), by a hit area past their words.
test('Releases and Update reach a finger on a touch screen', () => {
  const coarse = [...bare.matchAll(/@media \(pointer: coarse\)/g)].map((m) => block(m.index, bare)).join('\n');
  for (const id of ['releases-btn', 'update-btn']) {
    assert.match(coarse, new RegExp(`\\.about #${id}::after[^{]*\\{[^}]*inset:`), id);
  }
});
