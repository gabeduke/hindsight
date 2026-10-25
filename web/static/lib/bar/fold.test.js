import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTransportFold, NP_FOLD_KEY } from './player.js';
import { fileCss, rules } from '../stylesheets.js';

class MockStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

function makeDoc({ hasBtn = true, foldedInitial = false } = {}) {
  const listeners = new Map();
  const classList = new Set(foldedInitial ? ['np-fold'] : []);

  const body = {
    classList: {
      contains: (c) => classList.has(c),
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      toggle: (c, force) => {
        const on = force !== undefined ? !!force : !classList.has(c);
        if (on) classList.add(c);
        else classList.delete(c);
        return on;
      },
    },
  };

  // The key's drawn ▾: the stylesheet turns it over, so nothing writes to it.
  const glyph = {
    classList: { contains: (c) => c === 'np-fold-glyph' },
    textContent: '',
  };

  const btnAttrs = new Map();
  const btnListeners = new Map();
  const btn = hasBtn
    ? {
        id: 'np-fold-btn',
        querySelector: (sel) => (sel === '.np-fold-glyph' ? glyph : null),
        getAttribute: (k) => btnAttrs.get(k) ?? null,
        setAttribute: (k, v) => btnAttrs.set(k, String(v)),
        addEventListener: (ev, fn) => {
          if (!btnListeners.has(ev)) btnListeners.set(ev, []);
          btnListeners.get(ev).push(fn);
        },
        removeEventListener: (ev, fn) => {
          const arr = btnListeners.get(ev);
          if (arr) {
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
          }
        },
        click: () => {
          for (const fn of btnListeners.get('click') || []) fn();
        },
      }
    : null;

  const docEvents = [];
  const doc = {
    body,
    getElementById: (id) => (id === 'np-fold-btn' ? btn : null),
    dispatchEvent: (ev) => docEvents.push(ev),
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
  };

  return { doc, btn, glyph, classList, docEvents };
}

test('initTransportFold: returns null when #np-fold-btn is absent', () => {
  const { doc } = makeDoc({ hasBtn: false });
  const fold = initTransportFold(doc);
  assert.equal(fold, null);
});

test('initTransportFold: defaults to expanded, and clicking toggles body.np-fold and storage', () => {
  const { doc, btn, glyph, classList, docEvents } = makeDoc();
  const store = new MockStorage();

  const fold = initTransportFold(doc, store);
  assert.ok(fold);
  assert.equal(classList.has('np-fold'), false);

  // Click to fold
  btn.click();
  assert.equal(classList.has('np-fold'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Expand transport');
  assert.equal(store.getItem(NP_FOLD_KEY), '1');
  assert.equal(docEvents.length, 1);
  assert.equal(docEvents[0].detail.folded, true);

  // Click to expand again
  btn.click();
  assert.equal(classList.has('np-fold'), false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Collapse transport');
  assert.equal(store.getItem(NP_FOLD_KEY), null);
  assert.equal(glyph.textContent, '', 'the drawn ▾ is left as it is: no glyph is typed over it');
  assert.equal(docEvents.length, 2);
  assert.equal(docEvents[1].detail.folded, false);
});

test('initTransportFold: restores folded state when persisted in storage', () => {
  const { doc, btn, classList } = makeDoc();
  const store = new MockStorage();
  store.setItem(NP_FOLD_KEY, '1');

  initTransportFold(doc, store);
  assert.equal(classList.has('np-fold'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-label'), 'Expand transport');
});

test('folded, the key’s ▾ is turned over into ▴ by the body’s np-fold, and only then', () => {
  const turned = rules(fileCss('styles.css')).filter((r) => /rotate\(180deg\)/.test(r.body)
    && r.sel.some((x) => /^body\.np-fold\b/.test(x) && /\.np-fold-glyph\b/.test(x) && /\.i\b/.test(x)));
  assert.equal(turned.length, 1, 'one rule turns the fold’s icon over');
  assert.equal(turned[0].media, '', 'wherever the key shows');
});

test('initTransportFold: throwing storage (private mode) does not throw or break the toggle', () => {
  const { doc, btn, classList } = makeDoc();
  const throwingStore = {
    getItem() { throw new Error('QuotaExceededError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('QuotaExceededError'); },
  };

  assert.doesNotThrow(() => {
    const fold = initTransportFold(doc, throwingStore);
    btn.click();
    assert.equal(classList.has('np-fold'), true);
    btn.click();
    assert.equal(classList.has('np-fold'), false);
    fold.destroy();
  });
});
