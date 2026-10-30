// Does the page's push connect on this kit? Opens the Studio, then the
// Listening Room, in Chromium at a kit's address (its HTTPS name through
// Caddy, plain http://, or a demo), and reports the page's changes sockets
// (/api/tapes/changes, docs/architecture/push.md): the page holds one,
// which carries a frame at least once a second, and a room switch neither
// closes it nor opens another. The flows check the same on the demo
// (J1.14), over plain HTTP; this is for what only a real kit has: TLS, HTTP/2
// to Caddy, and a network in between.
//
//   npm install --no-save playwright@1.49.0 && npx playwright install chromium
//   node scripts/push-probe.mjs https://<kit-name>       # or http://<pi-host>:5000
//
// It only reads: it opens two pages and presses nothing. A certificate it
// can't check (a test Caddy's own) is accepted. Exits 1 if the page never
// heard the Pi, opened more than one socket, or closed one while it was
// still connecting (Chrome says so in the console).

import { chromium } from 'playwright';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/push-probe.mjs <https://kit-name | http://host:port>');
  process.exit(2);
}
const HOLD_MS = 8000; // how long each room is watched: several beats

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const T0 = Date.now();
const socks = [];
page.on('websocket', (ws) => {
  if (!ws.url().includes('/api/tapes/changes')) return;
  const s = { opened: Date.now() - T0, frames: 0, firstFrame: null, closed: null };
  socks.push(s);
  ws.on('framereceived', () => { s.frames++; if (s.firstFrame === null) s.firstFrame = Date.now() - T0; });
  ws.on('close', () => { s.closed = Date.now() - T0; });
});
const unborn = [];
page.on('console', (m) => { if (/closed before the connection is established/.test(m.text())) unborn.push(Date.now() - T0); });

const res = await page.goto(`${base}/tape.html`);
const protocol = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.nextHopProtocol || '?');
await page.waitForTimeout(HOLD_MS);
const atSwitch = socks.map((s) => s.frames);
await page.locator('.appnav a[data-tab="room"]').click();
await page.waitForTimeout(HOLD_MS);
await browser.close();

const heard = socks.some((s, i) => s.closed === null && s.frames > (atSwitch[i] ?? 0));
console.log(`page ${res?.status()} over ${protocol}`);
for (const [i, s] of socks.entries()) {
  console.log(`socket ${i + 1}: opened at ${s.opened} ms, first frame ${s.firstFrame ?? 'never'}${s.firstFrame !== null ? ' ms' : ''}, ${s.frames} frames, ${s.closed === null ? 'open' : `closed at ${s.closed} ms`}`);
}
const fails = [];
if (!heard) fails.push('no socket carried a frame after the switch to the Listening Room');
if (socks.length !== 1) fails.push(`${socks.length} changes sockets opened; the page holds one`);
if (unborn.length) fails.push(`${unborn.length} closed while still connecting (at ${unborn.join(', ')} ms)`);
console.log(fails.length ? `FAIL: ${fails.join('; ')}` : 'ok: one socket, heard in both rooms');
process.exit(fails.length ? 1 : 0);
