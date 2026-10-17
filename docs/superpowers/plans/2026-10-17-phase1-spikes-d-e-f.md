# Phase 1 spikes D, E and F: the dock, the continuity check, the back-forward cache

**Date:** 2026-10-17 · **Plan:** [2026-10-17-phase1-shell.md](2026-10-17-phase1-shell.md)
§4 (R4, R5, R6) · **Status:** done against the demo; F still needs the iPad.

Run against `main` at f0988d4, in the demo (`TAPE=true`, one tape loaded, a
60 s take), with Playwright 1.60 and its Chromium 148. That is newer than the
1.49 the smoke scripts name; nothing below depends on the difference. The
scratch pages and scripts were not committed. The sampler is below, in full.

## Summary

| Spike | Answer | Change to the plan |
|---|---|---|
| **D** the bar in `.np-dock` on the Room | Wrapping the Room's `#np` in the dock **hides the bar below the fold** at 1400×900 and 1024×768: the dock is not sticky, and the Room's height rule (`styles.css:4843`) stops subtracting the bar. Long pages lose the bar, and Select mode stops hiding it. On a phone nothing visible changes. About **25 selector edits and 3 new rules, roughly an hour**. Two wrappers the plan implies break more than they help. | Step 4: make the dock sticky, not the bar; no `#np-dock-view` wrapper element; no `.np-studio` wrapper around Catch. Add an on-screen check to the smoke. |
| **E** can headless Chromium see continuity? | **Yes, reliably.** The take's `currentTime` follows wall time to ±9 ms for each 50 ms step, across view transitions and 20 swaps. The stream worklet's played frames give a lag that does not move at all, to the millisecond, while the sound flows. Playwright sees exactly one stream socket. The **scrubber can't carry the step rule**: it is rounded to 0.1 s, so a third to a half of 50 ms steps are zero. And **`page.evaluate` counts as a tap**, so it unlocks autoplay. | §5: replace the step rule with drift against `performance.now`. Read through CDP with `userGesture:false`. Use `page.reload()`/`goto()` for the "autoplay refused" checks. Add `#np[data-source]` early. |
| **F** bfcache on Back from wave.html / rig.html | Playwright **turns the cache off** (`--disable-back-forward-cache`), and the headless shell never uses it. With full Chromium and the flag removed, the **Room is restored** and the **Studio is not**: `/api/live` (`connectLive`) is open at pagehide. Close it on pagehide and the Studio is restored too. On restore the Room's take is **paused where it left**, and the carry is dropped (`carry.js:179`). So after Back from the take page it does not play on, while a reload would. | Step 6a/6b: views close their sockets on `pagehide` (persisted) and reopen on `pageshow`. Decide what a restored shell does with the carry: apply it rather than drop it. Add a bfcache smoke flow. |

Incidental: the Studio's shadow player (`rooms/studio.js:368`) asks for
`/api/preview?file=`, which has no route (404). A take carried into the
Studio never plays there today: the element is "playing", stuck,
`MEDIA_ERR_SRC_NOT_SUPPORTED`. Step 5c deletes it, but it is broken until then.

---

## D. The bar in the dock, on the Listening Room

**Method.** Three scratch copies, run at 1400×900, 1024×768 (touch) and 390×844
(touch, mobile) in both schemes, with a take in the bar:

- **wrap**: `takes.html` with its own `#np` inside
  `<div id="np-dock" class="np-dock"><div id="np-dock-view"></div>#np</div>`.
- **studio**: the §2.5 bar in the Room. That is the `np-*` ids plus
  `out-strip`, `clock-out`, `tape-overview`, and Rec, Click and Catch in
  `.np-studio` groups.
- **tape**: `tape.html` with the clip editor and action bar inside
  `#np-dock-view`, and `.np-studio` groups.

Each page was measured: the bar's and the dock's rects, `elementFromPoint` at ▶,
a 3,000 px page, `body.selecting`, and the phone player. Each was shot again
with a scratch fix stylesheet. Safe areas were emulated with CDP
`Emulation.setSafeAreaInsetsOverride`, which works in Chromium 148: 47/34 px
on the phone, 24/20 px on the tablet.

**What breaks** (unfixed → today):

| | 1400×900 | 1024×768 | 390×844 |
|---|---|---|---|
| Bar top | **900, off-screen** (today 828) | **768, off-screen** (today 696) | 635 (same) |
| ▶ reachable (`elementFromPoint`) | no | no | yes |
| 3,000 px page: bar at the window's foot | no, it scrolls away | no | n/a (fixed) |
| `body.selecting` hides the bar | no | no | no |
| §2.5 extras in the Room | Rec, ♩, Catch shown; `tape-overview` halves the scrubber | the same, and the row overflows | hidden by the mini player anyway |

- **The dock does not stick.** `.np` is `position: sticky`, but inside a dock
  its own height it cannot move. `.np-dock` is `position: relative`
  (`styles.css:3669`). On the Studio this never showed, because `tape.html`
  scrolls inside `main` at that size.
- **19 selectors assume `body > .np`.** These are `styles.css:3149`, 3156–3169
  (the 1024×600 one-row bar), 3172 (Select hides the bar), 3180–3181 (the
  picked take's pane), 3750 and 4843 (the room's height: without it the room
  fills the window and pushes the dock under the fold).
- **The phone's dock padding** (`styles.css:3792`, `.np-dock { padding: 0 12px 12px }`)
  is the Studio player sheet's. Unscoped, it leaves a 12 px strip in the
  Room's flow.
- **A `#np-dock-view` wrapper element** breaks the 9 `.np-dock > .clip-editor`
  and `.np-dock > .multi-bar` selectors (2295, 3314, 3671–3682, 3793–3815).
  The Studio's action bar comes out unstyled: no panel, no border, keys loose
  under the lanes.
- **A `.np-studio` wrapper around Catch** hides Catch in the phone mini player.
  `styles.css:3724` keeps only `.np-own > .np-catch`, so a wrapper span is
  `display: none !important`. This was measured in the Studio at 390 px.
- **z-index and the room art:** no conflict. `.room` is `isolation: isolate`,
  and the dock (z 18) paints over it. The fly-to-deck ghost (`.room-carry`,
  z 30, fixed) still flies over the bar, as now. On the phone the tabs (z 30)
  are below the fixed bar, as now.
- **Safe areas:** with insets emulated, the fixed variant puts the bar in the
  same place as today at all three sizes. The Room's wide rule
  `.room-on .np { padding: 8px 12px }` drops the bar's own
  `env(safe-area-inset-bottom)`, as it does today. Body padding covers it.

**The fix, as measured.** A scratch stylesheet restored every number above to
today's, within 10 px. The bar now sits 10 px higher on wide screens, because
the Room's 12 px margin under the bar is now inside the dock. Today the
page already scrolls by those 10 px. The changes:

1. `.np-dock { position: sticky; bottom: 0; }`. It is equivalent on the
   Studio, where it also fixes the 3,000 px case.
2. Rewrite the 19 `> .np` selectors as `.np-dock > .np`, or
   `:has(.np-dock > .np:not([hidden]))`. This is mechanical.
3. Scope 3792's padding to `body.tape-page`, or to the open player.
4. `body:not(.tape-page) :is(.np-studio, #tape-overview, #clock-out, #out-strip) { display: none }`,
   until `#np[data-source]` exists to key on.
5. **No wrappers.** Put `np-studio` as a class on each extra itself. Make the
   dock slot a position, not an element: the router inserts a view's dock
   nodes as direct children of `#np-dock`, before `#np`. With wrappers, add
   `display: contents` and re-point 9 selectors, plus a phone rule for
   Catch.
6. Fold the bar's 12 px margin into `--np-h`, or move it to the dock, so the
   room's height arithmetic closes.

**Pre-existing, seen on the way:**
- At 1024 px the Room's one-row bar is wider than the window: `OUT · This
  device` is clipped at the right edge.
- On the Studio at 390 px the mini player's ▶ is under the right reel:
  `elementFromPoint` at ▶ returns the reel SVG, and the source switch
  squeezes the window.

**Tests to add in step 4.** Keep the planned structural test ("the Room's bar
is `.np-dock > .np`"). It cannot see the failure that matters, though: the
bar off-screen. smoke-shell should also assert that in the Room, with a take
in the bar, `#np`'s bottom is within 2 px of `innerHeight` (minus
`--dock-b` on a phone), and that `elementFromPoint` at ▶ is ▶.

---

## E. Measuring continuity in headless Chromium

**Method.** An init script, the sampler below, hooks:
- `HTMLMediaElement.prototype.play`, which catches the bar's detached
  `new Audio()`;
- `AudioContext`;
- `AudioWorkletNode`, through its port: the stream worklet's `rd` (frames
  really played), `at` and `underrun`;
- `WebSocket`.

It samples inside the page every 50 ms from the document's first moment. A
document that goes away leaves its samples in sessionStorage. Runs:
- **a control** with no swap;
- **two simulated in-shell swaps**: `pushState`, the Room's `main` hidden, a
  stand-in Studio section shown and the body classes swapped, inside
  `startViewTransition`;
- **20 swaps** in 4 s;
- **today's tabs**, as full navigations.

Each ran with a take in the bar and again with the tape on this device. Each
ran under the default policy, `no-user-gesture-required` and
`document-user-activation-required` (the plan's "refuse"). Chromium was
launched with `--mute-audio`, so the Mac stayed quiet; muting does not stop
the clocks.

**What is observable, and how reliable** (headless shell, 50 ms sampling):

| Signal | Behaviour | Use it for |
|---|---|---|
| Take `currentTime` (hooked media element) | Δ against Δ`performance.now` within **±9 ms** per step, in every run including 20 view-transition swaps | No stall, no jump: the main assertion for a take |
| Stream lag `at − rd/48000` (worklet reports) | **Constant to the millisecond** within a document: spread 0.000 in the control and across swaps. A dropped socket moved it 10 s | No gap in the tape's sound. Per-step `rd` aliases with the worklet's 50 ms reports, so don't step-test it |
| Stream underruns (worklet) | 0 throughout | Also a gap |
| `#np-scrub` `aria-valuenow` | Rounded to 0.1 s (`bar.js:198-201`) and written on rAF: **33–55% of 50 ms steps are 0**, drift ±0.1 s (±0.15 s in full Chromium) | Non-decreasing (allowing the tape's loop wrap), and total advance against wall time ±0.3 s. **Not** the step rule |
| `#np-play` text | Steady ❚❚ / ■ throughout; flips to ▶ on any pause | Yes |
| Stream sockets | `page.on('websocket')` and the hook agree. One socket across swaps; on a full navigation, close then open about 100 ms later, never two | "Exactly one" |
| `window.__boot` | Changes on every load, never on a swap | The no-reload sentinel |
| rAF gaps | Control 19–52 ms. Swaps with view transitions 98–235 ms. **Full Chromium: 217 ms with no swap at all** | Report only, or ≤ 300 ms in the headless shell |
| `AudioContext.state` / `currentTime` | Runs whether or not sound flows | Only that the context is alive |

The plan's step rule ("no step under 0.03 s or over 0.25 s") would fail on
every run. It caught 0–13 of ~60–220 `currentTime` steps (sampler timer
jitter) and 33–55% of scrubber steps (rounding).

**Autoplay in headless Chromium:**
- **Default and `refuse` behave alike.** A new document's `AudioContext` is
  `suspended` and `hasBeenActive` is false until a real click. `nogesture`
  runs without one.
- **`page.evaluate` is a gesture.** Playwright sends
  `Runtime.callFunctionOn` with `userGesture: true`. One evaluate made a
  fresh page `hasBeenActive: true` and let it start an `AudioContext`. A
  Node-side sampler built on it passes the refused case by itself.
  `Runtime.evaluate` with `userGesture: false`, through a CDP session, does
  not do this. The sampler reads that way.
- **Chromium carries sticky activation across same-origin navigations,**
  even script-initiated ones. A tab click, or `location.href` set without a
  gesture, lands on a document with `hasBeenActive: true`, and the carried
  take plays on after 175–250 ms of silence. Only a browser-initiated load,
  `page.reload()` or `page.goto()`, starts a document without activation;
  then the take lands paused with ▶ ready. iOS Safari does not carry
  activation. So headless Chromium shows the iPad's restart only through
  reload/goto. Also, `smoke-carry.mjs`'s `tab()` clicks through
  `p.evaluate`, so its "refused" tab flows are not Safari-like.

**Today's full navigation, measured** (default policy, Room → Studio → Room by
tab):
- **A take:**
  - The Studio's shadow player stalls on the 404 above.
  - The take is silent for **4.7–4.8 s**, the whole stay in the Studio.
  - Back in the Room, it resumes from the carry.
- **The tape on this device:**
  - **About 1.0 s of silence** on each navigation, though the socket gap is
    only about 100 ms.
  - The rest is the new AudioContext, the worklet module and the prefill.
  - In the Studio the strip says "Playing on this phone".
- **The verdict below fails all of these:** "reloaded (3 documents)", the
  clock stopping, and ▶ flipping. It passes the simulated swaps.

**What smoke-shell should assert** (replacing §5's sampler conditions):

1. `window.__boot` is unchanged after each move. Read through CDP without a gesture.
2. **A take:**
   - every 50 ms step of `currentTime` is > 0;
   - each step is within **0.05 s** of the `performance.now` step;
   - the total advance is within 0.3 s of wall time.
3. **The tape here:**
   - the worklet lag `at − rd/sr` moves by no more than **0.02 s**;
   - the underrun count does not rise;
   - `page.on('websocket')` sees exactly one open `/api/tapes/stream`, and
     no new one opens during the run.
4. **The scrubber:**
   - it never goes back, except by the tape's loop length (a wrap);
   - its total advance is within 0.3 s of wall time.
5. `#np-play` shows ❚❚ (take) or ■ (tape) at every sample. Once the
   engine sets it, `#np[data-source]` is constant.
6. rAF gaps: log them. Fail only above 300 ms, and only in the headless shell.
7. **The refused policy:**
   - one real click (`locator.click()`) starts playback;
   - every later read goes through CDP with `userGesture:false`;
   - the reload and deep-link items use `page.reload()`/`page.goto()`;
   - the swaps happen in one document, so sticky activation covers them, as
     it will on the iPad.
8. **Red first:** run the same flows against 6a. The verdict fails on today's
   tabs (checked above), on a 300 ms pause, on a 2 s seek and on a dropped
   stream socket. It passes on the swaps. All checked.

**The sampler** (`sampler-min.mjs`, 88 lines). It needs no app change, and
works under any autoplay policy:

```js
// sampler-min.mjs -- continuity sampler for smoke-shell (Spike E). No app changes.
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

/** verdict: the smoke-shell pass conditions over one run of samples. */
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

Pair it with `page.on('websocket')` for the socket count the browser sees. In
use: `await instrument(ctx)`, then a real `locator.click()` to start the
take, `await mark(p)`, the move, a wait, then
`verdict(await read(p), { kind: 'take' })`.

---

## F. Back from wave.html / rig.html, and the back-forward cache

**Method.** For each case: open the room, set it up, leave by
`location.href`, then `history.back()` from the destination. Both are read
through CDP without a gesture. The checks were whether `__boot` survived,
the `pagehide`/`pageshow` `persisted` flags,
`PerformanceNavigationTiming.notRestoredReasons`, and CDP
`Page.backForwardCacheNotUsed`. The service worker was allowed.

**The harness first.** Playwright launches Chromium with
`--disable-back-forward-cache`. With it removed
(`ignoreDefaultArgs: ['--disable-back-forward-cache']`), the default
**headless shell still never restores**: `BackForwardCacheDisabledForDelegate`
and `BrowsingInstanceNotSwapped`, both "circumstantial". It still reports the
page's own blockers. **Full Chromium** (`channel: 'chromium'`, the new
headless mode) does restore. Every result below is from it.

| Case | Restored? | Why not | What came back |
|---|---|---|---|
| Room, idle → rig → Back | **yes** | — | as left |
| Room, take playing → wave.html → Back | **yes** | — | the take **paused at the frame it left** (1.2 s), ▶. The take page had played it on to ~7 s |
| Studio, idle → rig → Back | **no** | `WebSocket` (SupportPending): `/api/live` | a reload |
| Studio, idle → wave.html → Back | **no** | the same | a reload |
| Studio, tape playing here → rig → Back | **yes** (stable over 3 runs) | — | the stream rejoined (`stream-player.js:25`), "Playing on this phone" |
| Room, tape playing here → wave.html → Back | **yes** | — | the stream rejoined |
| Studio idle, sockets closed on `pagehide` (an init-script stand-in for the fix) | **yes**, both destinations | — | `/api/live` reopened on its own |

**What it means for the plan:**
- **The WebSocket reason is real, and only `connectLive` causes it.** The
  stream player already stops on `pagehide` (persisted) and rejoins on
  `pageshow` (`stream-player.js:24-25`). `connectLive` (`live.js:20`) never
  closes. In the shell, the Studio view's `/api/live` stays open even while
  the Room is shown. **Once the Studio has been visited, the shell is never
  eligible.**
- **The fix is small.** `connectLive` closes on `pagehide` (persisted) and
  reopens on `pageshow`, as the stream player does. Gating a hidden view's
  socket (§2.3 `hide()`) is not enough, because the view on show may be the
  Studio.
- One case could not be explained: with the tape playing here, the Studio
  was restored with `/api/live` still open, three times out of three. Don't
  rely on it.
- **A restored page keeps its paused media and drops the carry.** Chrome
  pauses media for the cache, and `carry.js:179` drops the record on
  `pageshow` (persisted). So after Back from the take page, the Room shows
  the take paused at the frame it left, not at the frame the take page
  reached. Without the cache (a reload) the carry resumes it there. R6's
  question becomes "what does a restored shell do with the carry". Two
  options:
  - **(a)** on `pageshow` (persisted), the engine applies a carry record
    newer than the moment it left, and plays if it was playing (iOS: lands
    ready);
  - **(b)** reload on `pageshow` (persisted), as `wave/page.js:1962` does.
    That costs the restore.

  **Recommend (a).**
- **Still to run:** the iPad (Safari's own cache rules for WebSockets and
  media), and on 6a, the same flows against the shell.

---

## Recommended changes to the plan

1. **§3 step 4 (Room in the shell):**
   - `.np-dock` sticky;
   - the 19 `> .np` selectors rewritten;
   - 3792 scoped;
   - extras hidden outside the Studio;
   - no wrapper elements: the dock slot is a position in `#np-dock`, and
     `np-studio` is a class on each extra;
   - **Look:** add "the bar is on screen at load, at 1400×900 and 1024×768".
2. **§2.4 / step 1:** have the engine set `#np[data-source]` and
   `[data-playing]` in step 1. It costs a line, and smoke-shell and the D
   rules can key on it from the start.
3. **§5:**
   - replace the sampler conditions with E's list;
   - read through CDP `userGesture:false`;
   - "refuse" runs use `reload`/`goto` for new documents;
   - name the browser: the headless shell for continuity, and full Chromium
     plus `ignoreDefaultArgs` for any bfcache check;
   - put `sampler-min.mjs` in `scripts/` beside `smoke-shell.mjs` (or
     inline it).
4. **Step 6a/6b:**
   - `connectLive` closes on `pagehide` (persisted) and reopens on
     `pageshow`;
   - decide (a) or (b) for the carry on a restored shell;
   - add a smoke flow: with bfcache on in full Chromium, take playing →
     the take's name → Back. Assert `pageshow-bfcache` and the agreed take
     state.
5. **§4 table:** R4 is answered (S, about an hour; no wrappers). R5 is
   answered (yes, with the changes above). R6 is answered for Chromium
   (the Room yes, the Studio no until `connectLive` closes), with the iPad
   still to check.
6. **Fix or note now:** `rooms/studio.js:368` asks for `/api/preview`, a
   route that does not exist, so a take carried into the Studio is silent
   today. Step 5c deletes it anyway.
