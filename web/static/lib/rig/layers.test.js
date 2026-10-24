import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileCss, rules as cssRules } from '../stylesheets.js';

// The ropes run over the jacks, so a plug is seen; the names beside the
// jacks sit above them, so a rope reads as running behind a name instead of
// striking through it. That's a matter of stacking, which the node tests
// can't see: so this reads the stylesheet, as styles.test.js does.
const all = cssRules(fileCss('styles.css'));

/** rules is every `selectors { body }` in the stylesheet, flattened (media queries included). */
const rules = () => all;

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};
/** zOf is the z-index a rule gives `selector` (the last such rule wins), or null. */
const zOf = (selector) => {
  let z = null;
  for (const r of rules()) if (r.sel.includes(selector)) z = decl(r.body, 'z-index') ?? z;
  return z;
};

test('the names the ropes cross are above the ropes', () => {
  const ropes = Number(zOf('.rig-wires'));
  assert.ok(ropes > 0, 'the ropes have a z-index');
  for (const name of ['.rig-sock-label', '.rig-sock-name', '.rig-row-title', '.rig-dev-name', '.rig-tag']) {
    const z = Number(zOf(name));
    assert.ok(z > ropes, `${name} is at z-index ${zOf(name)}: it must be above the ropes' ${ropes}`);
  }
});

test('the gear is not a stacking context that would hold those names under the ropes', () => {
  // A numeric z-index on a positioned card makes it one: everything inside it
  // is then painted with the card, as one layer, below the ropes.
  for (const card of ['.rig-devices', '.rig-bay']) {
    const z = zOf(card);
    assert.ok(z === null || z === 'auto', `${card} has z-index ${z}`);
  }
});

test('each name has a halo of the plate it is printed on', () => {
  const lifted = rules().filter((r) => r.sel.includes('.rig-sock-label'));
  assert.ok(lifted.some((r) => /text-shadow\s*:[^;]*var\(--rig-plate\)/.test(r.body)), 'a socket label has a halo');
  // The plate is the card's own: the grey interface and the black gear differ.
  const plates = rules().filter((r) => decl(r.body, '--rig-plate'));
  assert.ok(plates.length >= 2, 'the interface and the black cards each set --rig-plate');
});

test('dimming the sockets that are not targets does not put their names under the ropes', () => {
  // opacity below 1 on the button makes it a layer of its own, painted
  // below the ropes, names and all. The dimming is on its parts instead.
  const dim = '.rig-desk.picking .rig-sock:not(.target):not(.sel)';
  let opacity = null;
  for (const r of rules()) if (r.sel.includes(dim)) opacity = decl(r.body, 'opacity') ?? opacity;
  assert.equal(opacity, '1', `the button itself is at opacity ${opacity}`);
  const parts = rules().filter((r) => r.sel.some((s) => s.startsWith(`${dim} `)) && decl(r.body, 'opacity'));
  assert.ok(parts.length > 0, 'its jack and its names are dimmed instead');
});
