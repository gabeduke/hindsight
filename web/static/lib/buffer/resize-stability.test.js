import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { mountBuffer } from './buffer.js';

const html = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

const template = (id) => new RegExp(`<template id="${id}">[\\s\\S]*?</template>`).exec(html)[0];

test('grabRow stays anchored in keysRow when media query triggers min-width: 1100px', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, ['buffer-grab-tpl', 'buffer-panel-tpl', 'buffer-sel-tpl'].map(template).join('')).children);

  const head = doc.createElement('div');
  head.className = 'studio-feed-head';
  const feed = doc.createElement('section');
  feed.className = 'studio-feed';
  const keysRow = doc.createElement('div');
  keysRow.className = 'studio-keys';
  const sel = doc.createElement('div'); sel.id = 'rb-sel';
  const save = doc.createElement('button'); save.className = 'rb-sel-save';
  sel.append(save);
  const viz = doc.createElement('div'); viz.id = 'viz-wrap';
  doc.body.append(head, feed, keysRow, sel, viz);

  let mediaListener = null;
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = (query) => {
    return {
      matches: false,
      media: query,
      addEventListener: (type, fn) => {
        if (type === 'change') mediaListener = fn;
      },
      removeEventListener: () => {},
    };
  };

  try {
    const buffer = mountBuffer(doc, { feed, head, keysRow, ribbon: null, toast: () => {} });
    assert.ok(buffer);

    const grab = doc.querySelector('.buffer-grab');
    assert.ok(grab, 'buffer-grab exists');
    assert.equal(grab.parentElement, keysRow, 'initially mounted in keysRow');

    // Simulate resizing across 1100px boundary
    if (mediaListener) {
      mediaListener({ matches: true });
    }

    // Must still be in keysRow, NEVER reparented into head
    assert.equal(grab.parentElement, keysRow, 'buffer-grab stays in keysRow and is never moved to head');
  } finally {
    globalThis.matchMedia = originalMatchMedia;
    mock.timers.reset();
  }
});

test('styles.css does not cram head and keys into the same row at min-width: 1100px', () => {
  // At min-width: 1100px, studio-feed must not have "head head keys" which caused
  // head to visually overflow and overwrite buttons in keys.
  const at1100 = css.match(/@media \(min-width:\s*1100px\)\s*\{([^}]+)\}/g) || [];
  for (const block of at1100) {
    if (block.includes('.studio-feed')) {
      assert.ok(!block.includes('"head head keys"'), 'no "head head keys" collision at 1100px');
    }
  }
});

test('styles.css allows studio-keys to wrap cleanly so buttons never squeeze each other', () => {
  assert.match(css, /\.studio-keys\s*\{[^}]*flex-wrap:\s*wrap/);
});
