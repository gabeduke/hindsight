# The continuity sampler

From spike E (2026-10-17). It instruments a page so a test can tell whether
audio carried through a room switch, Back/Forward or a reload: one document
(no reload), ▶ held, the take's clock advancing with wall time, the stream's
lag steady, no underruns. Not yet used by `scripts/flows/`; J2.2 checks the
same things more coarsely.

What the spike learned:

- **Read through CDP with `userGesture: false`.** `page.evaluate` counts as a
  user gesture and unlocks autoplay by itself, which hides a refused-autoplay
  bug. Use `page.reload()` or `page.goto()` for refused-autoplay checks;
  Chromium carries activation across same-origin navigations.
- **The scrubber is rounded to 0.1 s,** so "monotonic per 50 ms" fails as a
  test. Assert drift against wall time (`performance.now`).
- **The back-forward cache:** Playwright's default headless shell never
  restores from it. Use full Chromium (`channel: 'chromium'`) with
  `ignoreDefaultArgs: ['--disable-back-forward-cache']`. An open `/api/live`
  socket blocks it, which is why `connectLive` closes on `pagehide`.

In use: `await instrument(context)` before the first page, a real
`locator.click()` to start the take, `await mark(page)`, the move, a wait,
then `verdict(await read(page), { kind: 'take' })`. Pair it with
`page.on('websocket')` for the socket count the browser sees.

```js
// sampler-min.mjs -- continuity sampler (Spike E), to fold into scripts/flows. No app changes.
//   await instrument(context)        // before the first page
//   await mark(page)                 // forget what came before
//   ... the swap, Back/Forward, or a reload ...
//   const r = verdict(await read(page), { kind: 'take' | 'stream', wrap: loopSeconds });
// It reads through CDP with userGesture:false: page.evaluate grants user
// activation, which would unlock autoplay by itself under a refusing policy.

function hooks() {
  if (window.__s) return;
  const S = window.__s = { media: [], ctxs: [], nodes: [], ws: [], buf: [] };
  window.__boot ??= crypto.randomUUID();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { S.media = S.media.filter((m) => m !== this).concat(this); return play.apply(this, a); };
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); S.ctxs.push(this); } };
  const AWN = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends AWN {
    constructor(...a) {
      super(...a);
      const n = { under: 0, rd: null, at: null, started: false };
      S.nodes.push(n);
      this.port.addEventListener('message', ({ data: d }) => { if (d?.underrun) n.under++; if (d && 'rd' in d) Object.assign(n, { rd: d.rd, at: d.at, started: d.started }); });
    }
  };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS { constructor(...a) { super(...a); S.ws.push(this); } };
  const sample = (ev) => {
    const $ = (id) => document.getElementById(id), m = S.media.at(-1), n = S.nodes.at(-1), sc = $('np-scrub');
    return {
      ev, boot: window.__boot, path: location.pathname, t: performance.now(), wall: performance.timeOrigin + performance.now(),
      act: navigator.userActivation?.hasBeenActive, play: $('np-play')?.textContent.trim(), src: $('np')?.dataset.source ?? null,
      scrub: sc ? +sc.getAttribute('aria-valuenow') : null,
      take: m ? { t: m.currentTime, paused: m.paused, err: m.error?.code ?? 0 } : null,
      stream: n ? { rd: n.rd, at: n.at, started: n.started, under: n.under } : null,
      ctx: S.ctxs.at(-1)?.state ?? null,
      sockets: S.ws.filter((w) => w.readyState <= 1 && /\/api\/tapes\/stream/.test(w.url)).length,
    };
  };
  setInterval(() => { S.buf.push(sample()); if (S.buf.length > 4000) S.buf.shift(); }, 50);
  addEventListener('pagehide', (e) => {
    S.buf.push(sample(e.persisted ? 'pagehide-bfcache' : 'pagehide'));
    try { sessionStorage.setItem('__s', JSON.stringify(JSON.parse(sessionStorage.getItem('__s') || '[]').concat(S.buf))); } catch {}
    S.buf = [];
  });
  addEventListener('pageshow', (e) => S.buf.push(sample(e.persisted ? 'pageshow-bfcache' : 'pageshow')));
  S.take = () => { let a = []; try { a = JSON.parse(sessionStorage.getItem('__s') || '[]'); sessionStorage.removeItem('__s'); } catch {} const out = a.concat(S.buf, [sample()]); S.buf = []; return out; };
}

export const instrument = (context) => context.addInitScript(hooks);
const cdp = new WeakMap();
async function quiet(page, expression) {
  if (!cdp.has(page)) cdp.set(page, await page.context().newCDPSession(page));
  const r = await cdp.get(page).send('Runtime.evaluate', { expression, returnByValue: true, userGesture: false });
  return r.result.value;
}
export const mark = (page) => quiet(page, 'window.__s.take().length');
export const read = (page) => quiet(page, 'window.__s.take()');

/** verdict: the pass conditions over one run of samples. */
export function verdict(s, { kind = 'take', sr = 48000, wrap = 0, drift = 0.05, lagMoves = 0.02, slack = 0.3, playText = kind === 'take' ? '❚❚' : '■' } = {}) {
  const fails = [];
  const boots = new Set(s.map((x) => x.boot));
  if (boots.size > 1) fails.push(`reloaded (${boots.size} documents)`);
  if (s.some((x) => x.play !== playText)) fails.push(`▶ showed ${[...new Set(s.map((x) => x.play))].join(' / ')}`);
  const sockets = new Set(s.map((x) => x.sockets));
  if (kind === 'stream' && (sockets.size !== 1 || !sockets.has(1))) fails.push(`stream sockets ${[...sockets].join('/')}`);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i], dt = (b.t - a.t) / 1000;
    if (a.boot !== b.boot) continue;
    let ds = (b.scrub - a.scrub) / sr;
    if (wrap && ds < 0 && Math.abs(ds + wrap) < slack) ds += wrap; // a looping tape
    if (ds < 0) fails.push(`scrubber back ${ds.toFixed(2)} s at ${i}`);
    if (kind === 'take' && a.take && b.take) {
      const d = b.take.t - a.take.t;
      if (d <= 0 || Math.abs(d - dt) > drift) fails.push(`take clock moved ${d.toFixed(3)} s in ${dt.toFixed(3)} s at ${i}`);
    }
  }
  if (kind === 'stream') {
    const lag = s.filter((x) => x.stream?.started).map((x) => x.stream.at - x.stream.rd / sr);
    if (!lag.length || Math.max(...lag) - Math.min(...lag) > lagMoves) fails.push(`stream lag moved ${lag.length ? (Math.max(...lag) - Math.min(...lag)).toFixed(3) : 'n/a'} s`);
    if (s.at(-1).stream?.under > s[0].stream?.under) fails.push('stream underran');
  }
  const wall = (s.at(-1).wall - s[0].wall) / 1000;
  const sc = (s.at(-1).scrub - s[0].scrub) / sr;
  if (!wrap && Math.abs(sc - wall) > slack) fails.push(`scrubber advanced ${sc.toFixed(2)} s in ${wall.toFixed(2)} s`);
  return { ok: !fails.length, fails: fails.slice(0, 5), n: s.length, wall: +wall.toFixed(2) };
}
```
