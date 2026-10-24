import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha, tokenCache } from './theme.js';

test('a token colour takes an alpha, whichever way it is written', () => {
  assert.equal(withAlpha('#cb4b16', 0.5), 'rgba(203,75,22,0.5)');
  assert.equal(withAlpha('#abc', 1), 'rgba(170,187,204,1)');
  assert.equal(withAlpha('  #268BD2 ', 0.25), 'rgba(38,139,210,0.25)');
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1,2,3,0.2)');
  assert.equal(withAlpha('rgba(1, 2, 3, 0.9)', 0.2), 'rgba(1,2,3,0.2)');
});

test('a colour it cannot read comes back as it was, never NaN', () => {
  assert.equal(withAlpha('nonsense', 0.2), 'nonsense');
  assert.equal(withAlpha('', 0.2), '');
  assert.equal(withAlpha('#12345', 0.2), '#12345');
});

test('a token cache reads each property once, until it is cleared', () => {
  const reads = [];
  const values = { '--accent': ' #b84a1b ', '--warn': '#d99a0a' };
  const saved = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => { reads.push(n); return values[n] ?? ''; } });
  try {
    const tok = tokenCache(() => ({}));
    assert.equal(tok.get('--accent', '#000'), '#b84a1b');
    assert.equal(tok.get('--accent', '#000'), '#b84a1b');
    assert.equal(tok.get('--none', '#123'), '#123', 'a property that is not set gives the fallback');
    assert.equal(tok.get('--none', '#123'), '#123');
    assert.deepEqual(reads, ['--accent', '--none'], 'each read once, a missing one too');
    values['--accent'] = '#cb4b16'; // the scheme flipped
    tok.clear();
    assert.equal(tok.get('--accent', '#000'), '#cb4b16');
    assert.equal(reads.length, 3);
  } finally {
    globalThis.getComputedStyle = saved;
  }
});
