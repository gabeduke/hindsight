# Plan: Phase 1, the shell and the one player

**Date:** 2026-10-17 · **Spec:**
[2026-10-16-shell-player-and-cue-lane-design.md](../specs/2026-10-16-shell-player-and-cue-lane-design.md)
§1 · **Parent plan:** [2026-10-16-shell-cue-lane-plan.md](2026-10-16-shell-cue-lane-plan.md)
Phase 1 · **Status:** proposed; the open questions at the end need Gabe.

Goal: one document owns the header, the bar and the audio engine. The Studio
and the Listening Room are views mounted inside it by a small `pushState`
router, so a take, the tape on this device and the feed never stop or restart
on a room switch. Phase 0 is merged: one layout, no rooms flag.

## 1. What is there now (main at 2b63437)

### Who owns audio

The browser plays sound in five places. None of them survives a page load.

| Sound | Created by | Owner today |
|---|---|---|
| A take in the bar | `new Audio()` per shelf row, `lib/takes.js:794-796` | The **row**. `destroyRow` (`takes.js:1113`) calls `RowWave.destroy`, which pauses and empties it (`lib/wave/rowwave.js:202-207`). That fires `emptied`, then `onGone`, then `backToTape` (`lib/bar/take-source.js:49`). |
| The tape on this device | `StreamPlayer`: AudioContext, worklet and WebSocket (`lib/tape/stream-player.js:56,62,103`) | **Two copies.** `tapeStream()` in `pageBar` (`lib/bar/bar.js:431`) on Capture and Takes, and `initOutput` (`lib/tape/output-ui.js:16`) on the tape page. Each page calls `rejoin` (`lib/tape/listener.js:31`). The Pi waits 6 s and then stops the tape (`listener.js:2-5`). The sound then waits for a tap (`stream-player.js:85-87`). |
| The feed | `feedSource` (`lib/bar/feed-source.js`) | **No sound.** `play()` only sets `active` and polls `/api/status` and `/api/envelope` every 2 s (`feed-source.js:67-94`). The rooms-architecture spec's table says it plays `/api/stream.wav`. The code does not. "The feed keeps playing" therefore means its state (live or scrubbed back, its offset) survives the switch. |
| A carried take in the Studio | `new Audio('/api/preview?…')` (`lib/rooms/studio.js:368`) | A shadow player with its own Feed/Tape/Shelf switch (`studio.js:335-418`). The Studio's bar never shows it. |
| Previews and recording | bounce/KEEP toast ▶ (`rooms/bounce.js:241`), buffer audition (`buffer/audition.js:12`), overdub (`tape/away-sheet.js:172`), phone mic (`phone/recorder.js:226`), the take page clock (`wave/clock.js:41,221`) | View-local and short-lived. |

### Who owns the bar: three implementations of `#np`

- **NowPlaying** (`lib/bar/bar.js:27`), used by `index.html:159` and `takes.html:90` through `pageBar` (`bar.js:249`). It holds feed, tape and take sources. Its ids are `np-play`, `np-start`, `np-back5`, `np-loop`, `np-eject`, `np-open` and `np-scrub`. It adds the source switch, the take's name and ✎ in script (`bar/take-keys.js:26`). Its own frame loop runs on the shared ticker (`bar.js:35`).
- **The tape page's bar** (`tape.html:185`, inside `#np-dock` at `:126`) is written by `lib/tape/page.js`. Its ids are `play`, `loop`, `to-start`, `rec`, `click`, `catch-pass`, `tape-overview`, `clock-out` and `out-strip`. `page.js` writes the LCD and the ▶ key directly: `render()` at `:570-595`, and `playheadLoop` at `:392-407` writes `#position`, `#np-time` and `#np-unit` 60 times a second. ▶ goes through `transport()` (`:3602`), which drops stale polls and toasts a recording kept on stop. A tape-only bar **cannot hold a take** (`carry.js:70` `mayCarry`; `studioVisit` at `:328`).
- **The take page's bar** (`wave.html:203`, `lib/wave/page.js`) has its own clock.

### Who owns document-level state

| | Capture `index.html` | Listening Room `takes.html` | Studio `tape.html` |
|---|---|---|---|
| Entry | `app.js` (module scope) | `lib/shelf-page.js` (module scope), then `room/mount.js:19` → `doorway.js:132` | `lib/tape/page.js` (4,738 lines, module scope). `rooms/mount.js:18` and `play/mount.js:30` start themselves on `body.tape-page`. |
| Body class | `main-page` (`:37`) | `shelf-page` (`:23`). Doorway adds `room-on` (`doorway.js:143`), `room-rack` and `room-search`. Also `cassette-open` and `selecting` (`takes.js`). | `tape-page` (`:22`), `tracks-fold` (`page.js:4716`), `buffer-open` and `buffer-fold` (`buffer/fold.js:20-25`), Play's `play-unfolded` |
| Intervals and polls | status 2 s and takes 5 s (`app.js:423-424`), ribbon, nav lamp 10 s (`nav.js:162`) | takes 5 s and status 15 s (`shelf-page.js:542-543`), nav lamp | tape state 200 ms and clipboard 2 s (`page.js:218-219`), studio status 2 s (`studio.js:296`), the buffer's and the strip's, nav lamp |
| Sockets | `connectLive` (`app.js:407`) | none | `connectLive` (`studio.js:273`), and the stream when the tape plays here |
| Global listeners (approximate grep) | `pageshow`/`pagehide` (`app.js:109,259`), bar `keydown` J (`bar.js:70`) | `popstate`/`keydown` (`shelf-page.js:234,246`), `pagehide`/`pageshow` (`:497,520`) | about 18 on window or document (`page.js:1322-23,1737-38,4334-39,4414-30,4702-03`), `bindStudioKeys` (`rooms/keys.js`), the buffer's and Play's |
| Ticker loops | `NowPlaying.loop`, VU, ribbon | `NowPlaying.loop`, deck reels, Play all's `Loop` (`shelf-page.js:380`) | `playheadLoop` (`page.js:392`), VU, ribbon, buffer |
| History | the player's `{player:1}` (`bar/player.js:51,65`) | the cassette sheet's `{cassette}` (`shelf-page.js:199,222,234`), the player's | the player's |
| Dialogs and sheets | `rb-flag`, `update`, `settings` and `phone` (`index.html:199-269`) | `confirm` (`:136`), the sketchbook added at runtime (`doorway.js:483`) | 7 dialogs in markup plus `studio-sheets-tpl` (`tape.html:485`), which clones `update` and `settings` again |
| Header | `.health` | `.appbar-page`: title, Play all, Select | `.appbar.tape-top` and `.appbar-page`: tape pills, REC sign, lock dot, undo, ⋯ (`tape.html:38-72`), `#out-banner` (`:74`) |

**Shared by all three pages:** `initNav` (`nav.js:108`, which wires Settings and Releases through `mountHeaderTools` at `:63`), `initHelp({page})` (`help/help.js:43`, with document capture listeners at `:102`), `initPlayer`, `#toasts`, `#out-btn`, `#help` and `styles.css` plus `objects.css`. Nothing in any `<head>` differs except the `<title>` and `index.html`'s redirect script (`:9`), so there are **no per-view head assets to load**.

**What already helps:**
- One ticker for the whole document (`objects/motion.js:223`), and `Loop` parks on `false` (`:232`).
- `NowPlaying.onChange` returns an unsubscribe function (`bar.js:207`).
- `connectLive` returns `close()`, and `Ribbon` has `destroy()`.
- Doorway already reads the bar through `h.np` (`doorway.js:432`).
- The Studio already mounts its feed from `<template>`s (`studio.js:46-54`).

**What gets in the way:**
- Source subscriptions cannot be removed: `tapeSource.on` (`tape-source.js:177`) and `takeSource.on` return nothing.
- Doorway puts its own elements into the bar (`.room-sit` after `#np-open` and `.room-grease` after `#np-scrub`, `doorway.js:437,442`).
- The bar's phone CSS assumes a position in the DOM: `:is(body.main-page, body.shelf-page) > .np` (`styles.css:3149-3169`), compared with `.np-dock > .np` on the tape page.

**Serving.** The static files come from `http.FileServer` behind `noCacheShell` (`cmd/hindsight/main.go:284-288,438`). FileServer redirects `/index.html` to `/`. The PWA starts at `/` (`manifest.json`). With the tape on, `index.html:9` replaces `/` with `/tape.html`, which is a second document load. **TAPE defaults to off** (`internal/config/config.go:138`), so on any kit without it the Studio is Capture.

**The service worker** precaches 200 files network-first, with `skipWaiting` and `clients.claim` (`sw.js:214-240`). Its offline fallback is `caches.match('/index.html')`, which FileServer answers with a redirect. Whether a navigation will accept that redirected response is unverified (see §4, R7).

## 2. Target design

### 2.1 The shell

The shell is one document, `web/static/shell.html`. It holds:

- **`<head>`:** today's shared head, with no redirect script.
- **`<header class="appbar">`:** the brand, the two tabs, `.appbar-end` (from `mountHeaderTools`), `#out-btn`, `#help`, and an empty `.appbar-page` slot.
- **`#out-banner`.**
- **`<main id="views">`:** one `<section class="view" data-view="…">` per mounted view.
- **`#np-dock`:** a `#np-dock-view` slot (the Studio's clip editor and action bar, Play's strip), then the one `#np`.
- **`#toasts`.**
- **Shared dialogs:** `update`, `settings`, `out-sheet` and `jam-only`.
- **`<template id="view-studio|view-room|view-capture">`.**
- **One script:** `lib/shell/boot.js`.

The shell creates these once: the engine (§2.4), `initNav`, `initHelp`, `initPlayer`, `initWakeLock`, Settings, Releases, the service worker registration and `carry.wire`.

### 2.2 Views and pages

| URL | Becomes | Why |
|---|---|---|
| `/tape.html` | **View: the Studio** (tape on) | It is a room. |
| `/` (tape off) | **View: Capture**, the Studio when the tape is off | TAPE is off by default, so other kits live here. With the tape on, `/` mounts the Studio and calls `replaceState('/tape.html')` with no second load. |
| `/takes.html` | **View: the Listening Room** | It *is* the room. The doorway draws over the rack (`shelf-page.js:24-27`). The rack's leftovers (the month box opened as a list `room-rack`, Select, Play all, the trash) are in-view state and come with it unchanged. `?take=NAME` goes to `wave.html` as a full load (`room/tap.js:174`). |
| `/wave.html` | **Page** | A third player with its own clock and AudioContext routing (`wave/clock.js`) and 1,964 lines. Folding it in is a later phase. The carry already resumes into it (`wave/page.js:1944`). |
| `/rig.html` | **Page** | No bar, no audio. It is small and the cheapest view to add next (Q4). Today, leaving for it while the tape plays *on this device* stops the tape after 6 s. |
| `/guide.html` | **Page** | A static document. Q4 recommends opening it in a new window. |
| Settings, Releases | **Shell sheets** | They are dialogs already. |

**Leaving the shell for a page:** the browser unloads it. The engine's `carry.wire` writes the take on `pagehide`, as today (`carry.js:165-180`, `handoff.js:44`). The stream drops: `wave.html` and the shell rejoin it, the rig and the guide do not. Coming back (Back, or a link) either restores the shell from the back-forward cache or reloads it. A reload boots the view its path names, the engine reads the carry, and a take resumes. On iOS it lands paused and ready, as now (`carry.js:190-205`). Spike F finds out which of the two happens.

### 2.3 The view contract (`lib/shell/view.js`)

```js
// A view module exports: { id, paths, title, bodyClass, help, mount }.
// mount(ctx) runs ONCE, on the first visit, and resolves to a handle:
//   { show({ url, from }), hide(), destroy() }
// ctx = {
//   root,      // the view's <section>, filled from its template
//   header,    // its .appbar-page part, placed in the header slot while shown
//   dock,      // its part of #np-dock-view, shown while shown
//   barSlot,   // the only place a view may add to #np (.room-sit, Play's strip)
//   engine,    // §2.4; a view never creates the bar's audio
//   go(url, { replace }),  // the router; a view never sets location to a room path
//   tapes,     // initNav's answer
//   toast,
//   active(),  // true while shown and the document is visible
//   on(target, type, fn, opts),  // a window/document listener that does nothing while hidden
//   every(fn, ms),  // an interval that skips while hidden, and runs once on show
//   loop(fn),  // a Loop on the shared ticker that parks while hidden
//   signal,    // aborted by destroy()
// }
```

**Mounted once, then hidden.** A view stays mounted after its first visit. `hide()` makes it cost no CPU and no network:

- It stops its polls (`every`), its loops (`loop`) and its sockets (`connectLive().close()`).
- It closes its menus, inspectors and modal sheets.
- It stops view-local previews (bounce, audition).
- It keeps its DOM, so canvases, lanes and the room are there again at once.

`show()` resumes, polls once, redraws and restores scroll. `destroy()` exists and is tested on the new small modules. The router never calls it in Phase 1 (Q1).

The reason: `page.js`, `shelf-page.js` and `app.js` are module singletons, and an ES module runs once per document. True re-mounting means making about 5,700 lines re-entrant, with a silent failure mode: a listener registered twice makes Space press ▶ twice, which plays and stops in the same tap. Gating them is about 60 mechanical edits. Keeping views mounted also keeps the Room's shelf rows, and so a take's audio, alive.

### 2.4 The engine (`lib/bar/engine.js`)

The engine is today's `pageBar`, lifted out of the page, created once by the shell and handed to every view.

| Part | What it exposes |
|---|---|
| `engine.bar` | `pageBar`'s API (`bar.js:398-422`): `loadTake`, `backToTape`, `setSource`, `takeName`, `sourceKind`, `playing()`, `snapshot()`, `onChange(fn) → off`, `frameNow`, `touches`, `ejected`, `looping`, `ready`. New: **`loadTakeByName(name)`**, which loads a take from `/api/jams` and `/api/peaks` with the engine's own `Audio`, for the Studio and for a reload where no shelf exists. |
| `engine.audio` | `adopt(audio)`, `owns(audio)`, `release(audio)`. The take in the bar's audio element belongs to the engine. `RowWave.destroy` leaves an adopted element alone. A row asks `audioFor(t)` first, so two shelves never hold two elements for one take. Engine media is never put in a view's subtree, because a media element removed from a document pauses. |
| `engine.tape` | `tapeSource`, plus: `on → off`; `ingest({tape, live})`, so the Studio's 200 ms poll feeds the LCD and the source skips its own 500 ms poll while fed; `delegate({play, stop, locate, setLoop} \| null)`, so ▶, Loop and \|◂ in the Studio go through `page.js`'s `transport()` and keep its kept-take toast, count-in and jam-only refusals; `setLevels(colors, at)`, for the per-track reel levels; `pos()`, which reads the stream's heard position when the tape plays here, as `page.js:376-379` does today. |
| `engine.stream` and `engine.output` | One `StreamPlayer`. One `wireOutput`. `render(live)`. `streamingHere()`. The `out-strip` and `out-banner`. `output-ui.js` becomes a renderer of it. |
| `engine.feed` | One `feedSource`. Its state (active, offset) is the feed's continuity. |
| `engine.np` | The one `NowPlaying` on `#np`. It sets `#np[data-source]` and `[data-playing]`, which the CSS and the smoke check read. |

### 2.5 The one bar

`#np` keeps NowPlaying's `np-*` ids and markup in both rooms. The Studio's extras are in the shell markup, so they paint from frame zero:

- `rec`, `click` and `catch-pass`, in a `.np-studio` group;
- `tape-overview`, beside `np-scrub`;
- `clock-out`, in the LCD.

They are shown only under `body.tape-page #np[data-source=tape]`, where `tape-overview` replaces `np-scrub`. The Studio's `play`, `loop` and `to-start` ids go away. NowPlaying draws the LCD, ▶, Loop and \|◂ for every source. `page.js` stops writing them and only feeds the engine (`ingest`, `delegate`, `setLevels`). The bar sits at `.np-dock > .np` in every view. The dock holds the Studio's clip editor and action bar above it.

### 2.6 The router (`lib/shell/router.js`)

The routes are `/tape.html` → studio, `/takes.html` → room, and `/` (and `/index.html`) → studio or capture, chosen by the cached `hindsight.tapeOn`. That is `studioRedirect` (`nav.js:40`) applied with `replaceState` instead of `location.replace`.

| Event | What the router does |
|---|---|
| A click on a link | Capture-phase. A same-origin `a[href]` whose path is a route (the tabs, the brand, `np-open`, the tape-empty link) is routed, unless a modifier, a middle button, `target` or `download` says otherwise. Every other link loads normally and leaves the shell. |
| `go(url)` | `pushState({shell: 1, view, scroll})`. Before that, it writes the outgoing scroll into the current entry with `replaceState`. |
| Switching | `old.hide()`. Body classes: the outgoing view's (everything except `help-mode` and `player-open`) are saved and removed, and the incoming view's saved set is restored, its `bodyClass` included. The header slot and the dock slot swap. `document.title = view.title`. `nav.setPath(path)` (aria-current, the lamp). `help.setPage(view.help)`. `new.show()`. The swap is wrapped in `document.startViewTransition` when it exists and reduced motion is not asked for. The CSS already names `tabs` and `tab-lit` (`styles.css:3843`). |
| `popstate` | Switches only when the entry's path names a different view. Same-path entries, the player's `{player:1}` and the cassette's `{cassette}`, belong to their owners (`player.js:65`, `shelf-page.js:234`), so Back still closes the player first. |
| Reload | The URL is a real path, so the same view boots. |
| Deep links | `/tape.html`, `/takes.html` and `/` work. `?take=` goes to `wave.html` as a full load. Any unknown path loads normally. |
| Scroll | `history.scrollRestoration = 'manual'`. Each view keeps its own `scrollY`, restored on show and on popstate from `state.scroll` (Q7). |
| Focus | If focus was inside the outgoing view, or on `body`, it moves to the incoming root (`tabindex=-1`, `preventScroll`). A tab that was tapped keeps focus. A polite live region says the room's name. Nothing ever focuses a text field, so no keyboard pops up on a tablet. |
| Failure | If `mount` or `show` throws, the router falls back to a full navigation to the URL, so a router bug costs a reload and not a session. |

### 2.7 Markup, CSS and head

Each view's markup is a `<template>` in the shell, as `studio-feed-tpl` is today, cloned once on first mount. All ids share one namespace, because the hidden view stays in the DOM. `pages.test.js:14` then checks the whole union.

Known collisions to rename in Capture's template: `#takes` and `#takes-empty` (`index.html:146-147`) clash with the Room's. The Studio's copies of `update-sheet` and `settings-sheet` (`tape.html:520-548`) go, because the shell owns those sheets.

The CSS stays global and keyed on the body class the router sets. The rule changes are:

- the bar's structural selectors become `.np-dock > .np`;
- the view-only bits added to the bar are hidden outside their view;
- `:has(.appbar-page)` becomes `:has(.appbar-page:not([hidden]))`, or the header part is moved out of the header while its view is hidden (preferred: no selector changes).

There are no head assets to load (§1).

### 2.8 Audio rules the design relies on

These need Spike A on the devices before the build.

- **Pushing history or hiding DOM does not touch media or an AudioContext.**
  - Detached `new Audio()` elements are never in a document, so the rule that pauses media on removal never applies to them.
  - A view that is hidden is not removed.
  - Chrome's and Safari's autoplay gates are per document, with sticky activation. After the first tap in the shell, a `play()` later in the session needs no new gesture.
  - This removes today's iOS restart: the carry resumes paused (`carry.js:190-205`) and the stream sits locked until a tap.
- **The AudioContext is created once,** on a tap (Safari), with `audioSession.type = 'playback'` (`stream-player.js:55`). It resumes on `visibilitychange` (`:20`), and moves to `locked` on `suspended` or `interrupted` (`:57-60`). The shell makes the document live for hours, so these paths run more often. Their behaviour does not change.
- **Media Session has one owner,** the engine. The stream's `setQuiet` hand-off (`stream-player.js:188`) covers a take.
- **Backgrounding** (screen lock, switching apps) is unchanged by the shell. Android may freeze or discard the PWA. A discard is a reload, and the carry covers it.
- **The service worker.** In-shell moves never fetch, so the SW is not involved. A long-lived document under network-first with `skipWaiting` can import a newer module later. So the inactive view's modules are imported at idle after boot, and `update.js:439` already reloads after an install.

## 3. Build order

Each step is its own branch and merge, green on the checks in `AGENTS.md`. Each one releases, because `web/` ships. Every step that touches `web/static` bumps `CACHE` and keeps `SHELL` in step (`paths.test.js:70,127`). The new `lib/shell/` directory joins the `node --test` globs in `ci.yml` and `AGENTS.md` in step 3 (`paths.test.js:107`). Every new regression test is shown red against the unfixed code before it merges. **Rollback** is a revert of that step's merge, plus `POST /api/update {"tag":…}` back to the previous release on the Pi (above `UpdateFloor`).

**1. Lift the engine out of `pageBar`, with no change in behaviour.**
- **Change:** `lib/bar/engine.js` takes `bar.js:249-445`. `pageBar` becomes a thin wrapper. `tapeSource.on` and `takeSource.on` return `off`.
- **Tests:** `bar/engine.test.js` on `bar-harness.js`. *Red first:* "a source subscription can be removed" (today `on()` returns undefined).
- **Look:** Capture and the Room with a take, the feed and the tape. Same as before.
- **Model:** Opus medium.

**2. The engine owns the take in the bar's audio.**
- **Change:** `adopt`, `owns` and `audioFor`; `RowWave.destroy` (`rowwave.js:202`) respects them; `loadTakeByName`.
- **Files:** `bar/engine.js`, `take-source.js`, `takes.js:794,891,1113`, `wave/rowwave.js`.
- **Tests:** *red first:* "a shelf row destroyed while its take is in the bar leaves it playing" (today: emptied, then backToTape). Also: "loadTakeByName plays without a TakesList".
- **Look:** delete a take from another tab while it plays. Filter it off the shelf while it plays.
- **Model:** Opus high (audio).

**3. The router and the view contract, as pure modules, not wired yet.**
- **Files:** `lib/shell/router.js`, `view.js`, their tests; the `ci.yml`, `AGENTS.md` and `SHELL` globs.
- **Tests:**
  - Routes for `/`, `/index.html`, `/tape.html`, `/takes.html` and `?take=`.
  - Link interception, including modifiers.
  - popstate ignores same-path entries.
  - `every` and `loop` skip while hidden.
  - `on` is inert while hidden.
  - Body-class save and restore.
  - Fallback to a full navigation when `mount` throws.
- **Look:** nothing.
- **Rollback:** trivial.
- **Model:** Opus high (it fixes the design).

**4. The shell document, with the Listening Room as its only view.**
- **Change:**
  - `takes.html` becomes the shell markup, with the Room in `view-room`.
  - `shelf-page.js` becomes `lib/shell/views/room.js` `mount(ctx)`: its module-scope code moves inside, its intervals move to `ctx.every`, and `popstate`, `keydown`, `pagehide` and `pageshow` move to `ctx.on`.
  - Doorway's bar additions go through `ctx.barSlot`, and its `h.np.onChange` keeps the `off`.
  - The bar moves into `.np-dock`, and `styles.css:3149-3181` is rewritten for that.
  - The engine is created by `boot.js`.
- **Tests:** `pages.test.js` and `paths.test.js` pass. *Red first:* "the Room's bar is `.np-dock > .np`" (a structural test in `styles.test.js` or `pages.test.js`).
- **Look:** the Room at phone and desktop size, both schemes; the player sheet on a phone; the cassette sheet and Back; Play all.
- **Rollback:** revert. The page is self-contained.
- **Model:** Opus medium (UI).

**5a. The Studio's bar becomes NowPlaying, on `tape.html` while it is still a page.**
- **Change:**
  - `tape.html`'s `#np` gets the §2.5 markup.
  - `page.js` drops its writes at `:398-401` and `:570-595`, and registers `engine.tape.delegate`, `ingest` and `setLevels`.
  - The `play`, `loop` and `to-start` ids go from `page.js`, `output-ui.js:33-38`, `buffer/keys.js` and `play/keymap.js`.
  - Space, L and `hindsight:play-transport` (`page.js:4334,4530`) press `np-play` and `np-loop`.
  - The engine on `tape.html` is handed `initOutput`'s player, so there is still one stream.
  - `smoke-tape.mjs` follows the new ids.
- **Tests:** *red first:*
  - `architecture.test.js`: "only `lib/bar` writes the LCD ids (`#position`, `#np-time`, `#np-unit`, `#np-status`, `#np-marquee`, `#np-mini`)". `page.js` fails it today.
  - `tape` delegate test: "■ in the Studio while recording goes through `transport()` and toasts the kept take".
- **Look:** the Studio at phone and desktop size, both schemes: ▶ ■, count-in, Rec, Catch, Click, Loop, \|◂, the overview drag, the LCD while playing on this device, the out strip, a mixdown's tail.
- **Model:** Opus high (real-time UI, behind Spike C).

**5b. The engine owns the one StreamPlayer.**
- **Change:** `output-ui.js` becomes a renderer of `engine.output`. `pageBar`'s `tapeStream` folds in.
- **Tests:** *red first:* "the engine and the output UI make one StreamPlayer" (counted with a stubbed constructor; it fails if both construct one).
- **Look:** switch the output to this device on the Studio and on the Room. Lock the screen and come back.
- **Model:** Opus high (audio).

**5c. The Studio's bar holds a take and the feed.**
- **Change:**
  - Delete `studio.js:335-418`, the shadow switch and its `new Audio`.
  - `mayCarry` lets the Studio take the carry, through `loadTakeByName`.
  - The feed GRAB and Shelf buttons keep working.
- **Effect:** pages still reload, but a take now *arrives* in the Studio. It lands paused on iOS.
- **Tests:** *red first:* `handoff.test.js`, "a take record is applied in the Studio with a tape loaded" (today `'studio'`). Also: no `new Audio` in `rooms/studio.js`, checked in `architecture.test.js`.
- **Look:** Room → Studio with a take playing: it shows in the Studio's bar.
- **Model:** Opus medium.

**6a. The shell serves both rooms, one view per load.**
- **Change:**
  - `shell.html` holds the Studio and the Room templates.
  - Go serves it at `/tape.html` and `/takes.html` (`main.go` `newRouter`). Q2 has the alternative.
  - `tape.html` and `takes.html` are deleted.
  - `page.js`'s `boot()` (`:163`) becomes `views/studio.js` `mount(ctx)` with the `ctx.on`, `every` and `loop` gating (Spike B's checklist).
  - `rooms/mount.js` and `play/mount.js` are called by the view and no longer start themselves.
  - The tabs still do full loads.
- **Tests:**
  - `main_test.go` `TestShellPathsServeTheShell`, red first, with `go test -race ./...`.
  - `pages.test.js` checks one id namespace across the shell and its templates.
  - `nav-dom.test.js`.
- **Look:** both rooms by direct URL, the PWA start, a reload in each, at both sizes and in both schemes.
- **Rollback:** revert the merge (it restores the files and the route together).
- **Model:** Opus medium for the views; Sonnet for the Go route.

**6b. The tabs switch rooms without a reload. This is the gapless step.**
- **Change:** the router is live: links, popstate, body classes, the header and dock slots, title, focus, scroll, view transitions. `hide()` and `show()` are implemented for both views. The other view's modules are imported at idle.
- **Tests:** *red first:* `scripts/smoke-shell.mjs` (§5) fails against 6a, because a full load restarts the take, and passes here. Also: Back and Forward; the player entry and the cassette entry still close first.
- **Look:** all §5 checks by hand on the Pixel tablet and the iPad, plus a phone.
- **Rollback:** revert to 6a. Q6 proposes a per-device "reload between rooms" switch for the first week.
- **Model:** Opus high.

**7. Capture as a view; `/` is the shell.**
- **Change:**
  - `app.js` becomes `views/capture.js`.
  - Go serves the shell at `/` too.
  - The `index.html` redirect script goes; `replaceState` takes its place.
  - `rooms/redirect.test.js` is rewritten.
  - Capture's `#takes` and `#takes-empty` are renamed.
- **Tests:** *red first:* "with the tape on, `/` makes one navigation and ends at `/tape.html`" (smoke: `performance.getEntriesByType('navigation')` and history length). "With the tape off, Capture ↔ Room keeps a take playing" (smoke-shell on the no-tape demo).
- **Model:** Opus medium.

**8. Every move between rooms goes through the router.**
- **Change:**
  - `bar.js:272,365`, `studio.js:90,411`, `app.js:86,286`, `buffer/buffer.js:393`, `feed-source.js:121` and doorway's `forTheTape` paths use `ctx.go` or `takeHref`.
  - `forTheTape` is written only when the shell is being left.
  - The carry is kept for pages and reloads.
- **Tests:** *red first:* `architecture.test.js`, "nothing under lib/ assigns `location` to a room path".
- **Model:** Sonnet medium.

**9. The service worker.**
- **Change:** `SHELL` lists `/shell.html` and the view modules. The offline fallback becomes `/`. The idle prefetch of the inactive view. An offline start of the installed PWA.
- **Tests:** `paths.test.js`.
- **Look:** offline PWA start; an update installed mid-session reloads cleanly.
- **Model:** Sonnet.

**10. Docs.**
- **`AGENTS.md`:** the shell rules (views never create the bar's audio, never set `location` to a room path, one id namespace, `ctx.on`, `every` and `loop`), and the CI globs.
- **`docs/development.md`:** `smoke-shell`.
- **`docs/guide.md`:** "it keeps playing as you move between rooms". This file is embedded in the binary, so it releases.
- **A handoff note.**
- **Model:** Sonnet.

## 4. Risks, and a spike for each before the build

| # | Risk | Spike (expected size) |
|---|---|---|
| R1 | Android Chrome (tab and installed PWA) or iPadOS Safari pause an `<audio>` or an AudioContext on a same-document swap, a view transition or backgrounding, or need a new gesture. | **A. Two-view audio page** (1.5–2 h). A throwaway page dropped into a local demo (not committed). A detached `Audio` plays a demo take and a worklet plays a tone. Switch views with `pushState`, `hidden` and `startViewTransition`, 50 times. Lock the screen, switch apps, come back. Log `currentTime`, `ctx.state` and pause events. Gabe runs it on the Pixel tablet (tap and stylus) and the iPad. |
| R2 | A hidden view still polls, ticks or answers keys. A long session leaks. | **B. Lifetime audit** (2 h). List every window and document listener, interval, timeout chain, `Loop`, observer, socket and history call in `page.js`, `shelf-page.js`, `app.js`, `takes.js`, `buffer/`, `play/`, `rooms/` and `ribbon.js`. Mark each gate, shell or keep. The output is 6a's checklist. Then a DevTools check on 6b: with the Room shown, no Studio requests and no Studio rAF. |
| R3 | NowPlaying cannot carry the Studio's transport semantics: kept-on-stop, count-in, jam-only, locked tap, ghost locate, disabled states. | **C. Delegate prototype** (2 h). On a scratch branch, wire `np-play` to `transport()`, run `smoke-tape.mjs`, and list every divergence. |
| R4 | One bar position breaks the Room's phone layout. | **D. CSS dry run** (1 h). Wrap `takes.html`'s `#np` in `.np-dock` locally, run `scripts/screenshots.mjs` at phone and desktop size in both schemes, and list the selectors to rewrite. |
| R5 | The acceptance check cannot see audio in headless Chromium. | **E. Measurement check** (1 h). Confirm that the take's `currentTime`, the `#np-scrub` `aria-valuenow` and `page.on('websocket')` all behave under both autoplay policies (as `smoke-carry.mjs:34` launches). |
| R6 | Back from `wave.html` or `rig.html` reloads the shell instead of restoring it. The WebSockets may block the back-forward cache. | **F. Back-forward cache test** (1 h). DevTools › Application › Back/forward cache on `tape.html` today, then on 6a. The result decides whether the return path relies on the carry. |
| R7 | Version skew in a long-lived document; the redirected `/index.html` used as the offline fallback. | No spike: covered by the idle prefetch and by checks in step 9. |
| R8 | A live jam lasts hours. | A soak test inside acceptance (§5, item 7). |

## 5. Acceptance: `scripts/smoke-shell.mjs`

Playwright 1.49 with Chromium, as the other smokes, against two demos: `TAPE=true` and no tape. It runs with `--autoplay-policy=no-user-gesture-required` and again with `refuse` (`document-user-activation-required`, one real click first). It runs at phone (390×844, touch) and desktop (1280×800) size, in both schemes. It exits non-zero on any failure.

The **sentinel** is `window.__boot ??= crypto.randomUUID()`, read before and after each move. If it is unchanged, the document was not reloaded.

The **sampler** is `p.evaluate` reading, every 50 ms over 3 s around the switch: `#np-scrub` `aria-valuenow` (frames, from the take's `currentTime`), `#np-play` text, `#np[data-source]`, and a rAF counter. The pass conditions are:
- the frame count rises monotonically;
- no step between samples is under 0.03 s or over 0.25 s of frames, so there is no stall and no jump;
- the end minus the start is within 0.3 s of wall time;
- `#np-play` shows ❚❚ throughout;
- no rAF gap is over 250 ms during the swap.

The checks:

1. **A take keeps playing.** In the Room, tap a spine, then do Room → Studio → Room by tab: the sampler passes, the sentinel is unchanged and `data-source=take`. Then `history.back()` and `history.forward()`: same.
2. **The tape on this device keeps playing.** In the Studio, choose Output › This device and press ▶. Switch rooms twice. `page.on('websocket')` sees exactly **one** `/api/tapes/stream` socket. `#out-strip-text` never shows "Starting" or "Paused". The `#np-scrub` frames pass the sampler.
3. **The feed keeps its place.** Choose Feed and scrub back 20 s. Switch rooms. The LCD still reads `-0:2x` and `data-source=feed`.
4. **Reload and deep links.** A reload on each view lands on the same view. The take resumes: playing, or under `refuse` paused at the same frame with ▶ ready (as in `smoke-carry.mjs:95`). `/`, `/tape.html` and `/takes.html` opened directly mount the right view. With the tape on, `/` makes one navigation and ends at `/tape.html`. `?take=X` opens `wave.html`.
5. **Leaving the shell.** The take's name opens `wave.html` and the carry plays on there (the existing `smoke-carry` flows still pass).
6. **No listener leaks.** With the Room shown, pressing Space and the Studio's G, K and C does nothing to the tape. Pressing them in the Studio does what it does now.
7. **Soak** (optional flag `soak=30m`). Switch rooms every 20 s with a take looping. Assert that `performance.memory.usedJSHeapSize` growth stays under 20%, and the sampler passes at the end.
8. **Manual**, because scripts cannot reach a real audio session: on the Pixel tablet (PWA, stylus) and the iPad (Safari, home-screen app), items 1–3, plus a screen lock and a switch to another app mid-take and back.

## 6. Effort and model per step

| Step | Size | Model and effort |
|---|---|---|
| Spikes A–F | 8–9 h | Opus medium. A and F need Gabe's devices. |
| 1 engine | S | Opus medium |
| 2 take audio | S–M | **Opus high** (audio) |
| 3 router and contract | M | **Opus high** (design) |
| 4 Room in the shell | M | Opus medium (UI) |
| 5a Studio bar on NowPlaying | L | **Opus high** (real-time UI) |
| 5b one StreamPlayer | S | **Opus high** (audio) |
| 5c Studio holds a take and the feed | S | Opus medium |
| 6a both rooms in the shell | L | Opus medium; Sonnet for the Go route |
| 6b in-shell switching | M | **Opus high** |
| 7 Capture view and `/` | M | Opus medium |
| 8 navigations through the router | S | Sonnet medium |
| 9 service worker | S | Sonnet |
| 10 docs | S | Sonnet |

Reviews of every Opus step and the re-checks after a fix go to Sonnet. Merging is Sonnet.

## 7. Open questions for Gabe

Each has a recommendation and the alternative.

1. **Hide or rebuild a room when you leave it?** *Recommend:* keep each room mounted after its first visit and hidden while you are away: no polls, no animation, no keys. Switching back is instant and nothing is reloaded. *Alternative:* tear it down and rebuild it on every switch. That uses less memory, but the 4,700-line tape page has to be rewritten so it can start twice, and a missed listener there fails silently.
2. **How do the room URLs get the shell?** *Recommend:* the Pi's server sends one `shell.html` for `/`, `/tape.html` and `/takes.html`. That is a small Go change with a test, and it ships with the release. *Alternative:* three identical files (or symlinks), checked identical by a test, with no Go change, so `make deploy-static` keeps working on an older binary.
3. **One bar in both rooms?** *Recommend:* yes. Rec, Click, Catch and the overview appear only in the Studio with the tape in the bar. The Studio can then show and pause a take. *Alternative:* keep the Studio's own bar over the shared engine. There is less UI churn, but there are two transports to maintain, and the Studio's bar still cannot show a take properly.
4. **The Rig and the Guide.** *Recommend:* they stay pages in Phase 1. The Guide opens in a new window, so nothing playing here stops. The Rig becomes a view straight after Phase 1, because leaving for it while the tape plays *on this device* stops the tape 6 s later. *Alternative:* make the Rig a view in Phase 1, as one more small step after 6b.
5. **The take page (`wave.html`).** *Recommend:* it stays a page now. It is a third player with its own clock, and the carry already plays on into it. *Alternative:* fold it in as a Listening Room sub-view in this phase. That is large.
6. **A safety switch for the first week?** *Recommend:* a per-device "Reload between rooms" switch, off by default, so a live session can fall back to today's behaviour without a release. *Alternative:* no switch. Phase 0 just removed the flags, and a revert is a release away.
7. **Scroll and lanes when you come back to a room.** *Recommend:* each room keeps its own scroll and its lanes' zoom. *Alternative:* the top each time, as a fresh load does now.
8. **The Capture view (the Studio with the tape off) in Phase 1?** *Recommend:* yes, step 7. TAPE is off by default, so a kit without it lives in Capture. *Alternative:* defer it, and tape-off kits keep the reload and the carry until then.

## 8. What I could not determine

- Whether iPadOS keeps Web Audio or `<audio>` running across the app being backgrounded in standalone mode. Whether Android discards the PWA mid-jam. Both need Spike A on the devices.
- Whether the shell is eligible for the back-forward cache (Spike F).
- The exact count of global listeners. The §1 counts come from a grep, and Spike B makes them exact.
- Which kits run with `TAPE=true` (the brother's, the brother-in-law's). This sets how urgent step 7 is.
- How Play mode's strip (`lib/play`, behind its own flag) behaves when the Studio hides while it is open. It owns the keyboard while open (`docs/development.md`, "Play mode"). The audit in Spike B covers it. It was not run here.
- Whether a navigation accepts the SW's redirected `/index.html` fallback offline today.

## Amendments from the spikes (2026-10-17)

From [spike B](2026-10-17-phase1-spike-b-audit.md) and
[spikes D, E, F](2026-10-17-phase1-spikes-d-e-f.md). These override the steps
above where they differ.

- **Step 1:** the engine sets `#np[data-source]` from the start, so tests and
  CSS can key on it.
- **Step 4 (the bar in the dock):** make `.np-dock` sticky, rewrite the 19
  `body > .np` selectors, add no wrapper elements (`#np-dock-view` and
  `.np-studio` both break existing selectors), and add an "is the bar on
  screen" check at 1400x900 and 1024x768.
- **Section 5 (acceptance):** the scrubber is rounded to 0.1 s, so "monotonic,
  no stall" per 50 ms step fails as written. Assert drift against wall time
  instead (`performance.now`), read through CDP with `userGesture:false`
  (`page.evaluate` counts as a tap and unlocks autoplay). Use
  `page.reload()`/`page.goto()` for the refused-autoplay checks; Chromium
  carries activation across same-origin navigations. The sampler is in the
  spike doc.
- **Steps 6a/6b:** `connectLive` closes on `pagehide` and reopens on
  `pageshow` (its open socket blocks the back-forward cache for the Studio).
  Decide what a restored shell does with the carry: apply it, not drop it.
  Add a bfcache smoke flow.
- **Order constraint (spike B):** unify the player and the two stream players
  (step 5b) before mounting both rooms (6a); hidden views must stop their polls,
  key handlers, MIDI and 60 fps loops first.
- **Decisions (the user's, 2026-10-17, defaults until told otherwise):** the
  wake lock is held while the tape plays or a recording runs, in either room;
  leaving the Studio during a recording shows a REC chip with a Stop in the
  header, never a refusal.
- **Existing bug to fix on the way:** `rooms/studio.js:368` asks for
  `/api/preview`, which 404s, so a take carried into the Studio is silent today.
