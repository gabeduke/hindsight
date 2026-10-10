import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubLine } from './settings.js';

const url = 'https://mike.hindsight.leetserve.com';

test('no hub, no line', () => {
  assert.equal(hubLine(null), null);
  assert.equal(hubLine(undefined), null);
});

test('the secure address is linked once there is a certificate', () => {
  assert.deepEqual(hubLine({ name: 'mike.hindsight.leetserve.com', url, error: '', cert_not_after: '2027-01-07T00:00:00Z' }), { href: url, error: '' });
  // A failing heartbeat doesn't take the link away; the certificate still serves.
  assert.deepEqual(hubLine({ url, error: 'heartbeat: 502 Bad Gateway', cert_not_after: '2027-01-07T00:00:00Z' }), { href: url, error: 'heartbeat: 502 Bad Gateway' });
});

test('without a certificate, why not', () => {
  assert.deepEqual(hubLine({ url, error: 'the hub is still getting a certificate for mike.hindsight.leetserve.com', cert_not_after: null }),
    { href: '', error: 'the hub is still getting a certificate for mike.hindsight.leetserve.com' });
  assert.deepEqual(hubLine({ name: '', url: '', error: '', cert_not_after: null }), { href: '', error: 'waiting for the hub' });
});
