# Spike B: what each room does to the page

**Date:** 2026-10-17 · **For:** [2026-10-17-phase1-shell.md](2026-10-17-phase1-shell.md) step 6a (R2) · **Code:** main at f0988d4.

**Method.** I took the static and dynamic import closure of `tape.html`'s three entry scripts (`lib/tape/page.js`, `lib/play/mount.js`, `lib/rooms/mount.js`) and of `takes.html`'s one (`lib/shelf-page.js`). Then I read every module in it for side effects at document or window level. Listeners on elements inside a view's own subtree are left out, because a `display:none` subtree gets no input.

**Handling:** **on** / **every** / **loop** = route it through `ctx.on`, `ctx.every` or `ctx.loop` · **pause** = `hide()` and `show()` need explicit code for it · **idle** = leave it alone; it costs nothing while hidden · **change** = it needs a code change first (a handle is thrown away, it can't be removed, or it has the wrong owner) · **shell** = `boot.js` or the engine creates it once, and the view stops doing it.

## Totals

- **Modules:** the Studio loads 116 and the Room 90. They share 53, so **153 in all**. 78 of them have none of the effects below (§H).
- **Document and window listeners: 77 call sites** (a loop over several events counts once). 51 are Studio-only, 8 Room-only, and 18 are shared modules that both rooms call today, plus 6 `matchMedia` change listeners. 27 sites could be removed, because an `off`, `destroy()`, `stop()` or `close()` exists. **Only 6 are ever removed:** a flight's two, `takes.js:964` (`once`), `stream-player.js:81` on `stop()`, and the wake lock's two.
- **Always-on intervals: 17.** Studio 12: 200 ms at `page.js:218`, three at 2 s, six at 1 s, and with Play mode on one at 5 s and one at 1 s. Room 3. Shell 2 (nav's lamp runs twice today). Besides these: the engine's 500 ms tape chain, the stream's 500 ms fill while it streams, and the feed's 2 s poll (two instances) while it is active. **A hidden Studio that is not gated asks the Pi about 8 times a second.**
- **Ticker and rAF users that run while hidden: 13** (11 a view's, 2 the engine's). **Sockets: 4:** `/api/live`, `/api/tapes/play`, and two `/api/tapes/stream` today. **Audio graphs: 7 kinds,** plus one `Audio` per shelf row. **MIDI access: 1.**
- **History writers: 10 sites. `document.title` writers: 1. `location` navigations: 13**, plus 2 reloads.

## Top 10 risks

1. **The Studio's keys fire from the Room.**
   - `page.js:4430` (document keydown) handles Space ▶ (`:4530`), **R Rec** (`:4545`), L, M, J (locate), S (split), Delete (removes the selected clips), 1–4 (arm) and ⌘Z/C/X/V/D/A.
   - `rooms/keys.js:27`: C catches, and **K keeps the feed**.
   - `buffer/keys.js:103`: G GRAB, and ↵ DROP.
   - `play/keymap.js:162`: Space and the pads, while the strip owns the keys.
   - None of these can be removed, and a hidden button still answers `.click()`.
   - → **on**, with each `off` kept (acceptance §5.6).
2. **`playheadLoop` (`page.js:392-407`) parks only on `document.hidden`.** While the jam room plays the tape, a hidden Studio redraws its lanes, overview and ruler at 60 fps. It also writes `#position`, `#np-mini`, `#np-time` and `#np-unit` (`:398-401`), which are the shared bar's, over the Room's take. → **loop**, parking on `!active()`. Step 5a drops the writes.
3. **Two streams and two output switches.**
   - `initOutput` (`output-ui.js:16`) and `pageBar`'s `tapeStream` (`bar.js:299,433`) each make a StreamPlayer and each call `rejoin`. That is two `/api/tapes/stream` sockets, and the Pi tells one of them `moved`.
   - `wireOutput` (`out-switch.js:68-77`) is called from both places (`output-ui.js:43`, `bar.js:307`) and isn't idempotent, so one tap calls `switchOutput` twice.
   - → **6a must not land before 5b.**
4. **The shell's inits are not idempotent, and both rooms call them.**
   - `initPlayer` (`bar.js:44`, `page.js:203`): two click handlers, so the player opens and shuts in one tap.
   - `initHelp` (`page.js:164`, `shelf-page.js:531`): two `#help` toggles, two MutationObservers and two `.tip-pop`s.
   - `initNav` (`page.js:165`, `shelf-page.js:532`): two 10 s lamp polls and two `studioRedirect`s. The rig chip lands only in the first header (`rig/chip.js:43`).
   - `watchLink` (`page.js:217`, `shelf-page.js:527`): two "Reconnecting…" notes.
   - → **shell**.
5. **Two modules start themselves when imported**, `rooms/mount.js:18` and `play/mount.js:30`, but only if `body.tape-page` is set at that moment. A module runs once per document.
   - A shell that boots in the Room and imports them at idle never mounts the feed, the buffer or the strip.
   - A shell that sets the class early mounts them under the Room.
   - → **change:** `views/studio.js` calls `start()`.
6. **Handles are thrown away, so nothing can be paused.**
   - `connectLive` (`studio.js:273`) and `onResume` (`studio.js:297`).
   - The `off` of `bindStudioKeys` (`studio.js:330`) and of `bindBufferKeys` (`buffer.js:846`).
   - `mountBuffer` has no stop (`buffer.js:891-893`).
   - Bare `setInterval`s (`page.js:218-219`, `shelf-page.js:542-543`).
   - Doorway's `np.onChange` off (`doorway.js:432`).
   - → **change** before any gating.
7. **Play mode plays from the Room.**
   - Web MIDI (`strip.js:397,414`, then `midi.js:247` `onmidimessage`) presses pads over the play socket (`play/link.js:142`), so the Pi plays tricks while the Room is shown.
   - The strip's ticker step (`strip.js:263`) wants frames while `open && tape.playing`. `tape` is the last `hindsight:tape-state`, which stops arriving once the Studio is hidden, so the ring sweeps for ever.
   - → **pause:** `midiIn.close()` and unstep on hide.
8. **In a hidden Room, the bar drives per-frame work while a take plays**, and keeping the take playing is the point of the shell.
   - `renderPlaces` runs on every NowPlaying frame: `doorway.js:432`, with `bar.js:204` firing its listeners each frame.
   - The deck reels (`doorway.js:214`), `RowWave.frames` (`rowwave.js:43`), the cassette's follow step (`objects/cassette.js:96`) and Play all's `Loop` (`shelf-page.js:380`).
   - → **change / loop.** Play all must keep advancing on `timeupdate` and `ended` (`shelf-page.js:374`).
9. **A recording can outlive its view.**
   - The phone recorder (`recorder.js:174-235`, timer `:323`) and Overdub (`away-sheet.js:172-244`, timer `:380`) have their only Stop in the Studio. AGENTS.md says never hide the only route to something.
   - Their `beforeunload` guards (`recorder.js:103`, `away-sheet.js:130`) don't fire on an in-shell switch.
   - → **change:** veto `hide()` while `html[data-phone-busy]` (`recorder.js:133`) is set or Overdub is busy, or show a REC chip in the shell.
10. **History writes drop the router's state.**
    - `shelf-page.js:199` (`replaceState(null)` at import), `:239` (`replaceState(null)` on popstate) and `:417` (`{cassette}` alone) wipe `{shell, view, scroll}`.
    - The popstate handlers (`shelf-page.js:234`, `player.js:65`) run on every Back, a room switch included.
    - → **change:** merge `{...history.state}`, then **on**.

## A. Studio: `lib/tape/page.js` (all at module scope; `boot()` at `:4738`)

| Where | What | Removed | Handling |
|---|---|---|---|
| `:218` / `:219` | `setInterval`: tape state every 200 ms / clipboard every 2 s. They skip only on `document.hidden` | never | every |
| `:217` | `watchLink`: `onResume` (`link.js:54-59`: visibilitychange, pageshow, online, a 1 s tick) plus a `.link-note` (`link.js:150`) | `stop()` unused | shell (one link; the view reports ok/fail) |
| `:253` | `hindsight:tape-state` on each poll; the buffer and the strip listen | – | idle once the poll is gated |
| `:392-407` | `playheadLoop` (risk 2) | – | loop |
| `:442` | `ReelWindow` on the shared `#np-reel-l/r` and `#np-levels`. It parks 2 s after the polls stop (`objects/reels.js:18`) | – | change (5a: NowPlaying owns them) |
| `:137` `:1497` `:2440` | One-shot rAFs: lanes, edge scroll, view | self | idle |
| `:528` | `document.title` on every `render()` | – | change: the router owns the title |
| `:1098`, `:3975` | document pointerdown, capture (preview, inspector focus) | never | on |
| `:1322-1323` | window pointerdown/up/cancel, capture, at module scope | never | on |
| `:1737-1738` | window pointerup/cancel, **added for each lane every time `buildLanes` rebuilds** (`:2851`, when the track count changes). A leak that grows over a long session | never | change (an AbortController per build), then on |
| `:3972-3973` | window pointerup/cancel, for each of the 3 sliders | never | on |
| `:4334 :4338 :4339 :4732` | document `hindsight:play-transport`, `:clipboard`, `:tape-changed` (×2) | never | on |
| `:4414`; `:4418-4419` | document click → `closeMenus`; window scroll (capture) and resize | never | on |
| `:4430-4571` | document keydown (risk 1) | never | **on** |
| `:4702-4703` | visibilitychange and pagehide → `bar.commit()` | never | pause: commit on hide too |
| `:4341`; `:4662` | ResizeObservers write `--dock-h` and `--clipbar-h` inline on `<body>` | never | `--dock-h` → shell (it observes the shared dock); clear `--clipbar-h` on hide |
| `:4705` | ResizeObserver → 4 redraws. It fires at 0×0 on hide and again on show | never | idle (skip zero width) |
| `:2070` | EditorBar → document keyup (`edit/editor-bar.js:77`) | never | on |
| `:753` | Bounce `takePlayer` (`rooms/bounce.js:241` `new Audio`, lookup retries at `:225`) | – | pause: `stop()` |
| `:166` | `initAway`: `away-sheet.js:127` visibilitychange, `:130` beforeunload; AudioContext `:172`, mic `:223`, worklet `:242` | never | change (risk 9) |
| `:192` | `initOutput`: a StreamPlayer and a `#play` capture listener (`output-ui.js:34`). The player has `stream-player.js:24-25` pagehide/pageshow, added per instance and never removed; `:56` AudioContext, `:62` worklet, `:81` visibilitychange, `:82` 500 ms timer, `:103` WebSocket | partly | shell/engine (5b); keeps playing while hidden |
| `:164-165`, `:202-203` | `initHelp`, `initNav`; unhides `#np-dock`; `initPlayer` | – | shell |
| `:2444`, `:979` | `onSchemeChange` (`theme.js:37`); a `(hover: hover)` read | never | idle |
| `:4716-4734`, `:76-84` | body `tracks-fold` and session `hindsight.tracksFold`; local `tape.source`, `.mode`, `.snap`, `.loopLock`, `.ask` | – | idle |
| dialogs | Modal: `jam-only`, `away-sheet`, `rename-sheet`. Non-modal `dialog.inspector`: `clip-`, `section-`, `track-sheet`. Menus. An open one counts as `dialog[open]` to `bar.js:74` (J), `takes.js:133` and `player.js:70` | – | pause: close the inspectors, menus and previews on hide |

## B. Studio: `rooms/studio.js` and the buffer it mounts

| Where | What | Removed | Handling |
|---|---|---|---|
| `rooms/mount.js:18` | Starts itself (risk 5) | – | change |
| `studio.js:48-54` | Clones 3 templates; the sheets go into `<body>` | – | idle |
| `studio.js:112` | Ribbon: a Scene, a 1 s `/api/envelope` poll (`ribbon.js:312`) gated only on document visibility (`:121-123`), and a ResizeObserver (`:104`) | `destroy()` | pause: `ribbon.stop()` / `start()` |
| `studio.js:152` | VUMeters, fed by `/api/live` frames | – | idle once the socket closes |
| `studio.js:273` | `connectLive` `/api/live` (`live.js:52`), with a 1 s watch (`:115`) and `onResume` (`:120`). The handle is discarded | `close()` unused | change, then pause (close on hide, reopen on show) |
| `studio.js:286` | `initPhone`: `recorder.js:103` beforeunload, `:109` visibilitychange, `:323` timer | never | change (risk 9) |
| `studio.js:296`; `:297` | Status every 2 s; `onResume`, whose stop is discarded | never | every; change → the engine's link |
| `studio.js:299-308` | `initSettings`, `initUpdate`, `initWakeLock` (`wakelock.js:33`, visibilitychange `:98`), service worker registration | – | shell. Gabe: should the wake lock hold in the Room? |
| `studio.js:320`; `:330` | document `hindsight:verb`; `bindStudioKeys` (`<html>` keydown, capture) | off discarded | on; change |
| `studio.js:337-418` | The shadow player: `feedSource()` (2 s while active, `feed-source.js:71`, no check for hidden), `new Audio` (`:368`), window pagehide (`:376`), `location.assign` (`:411`) | never | change (5c deletes it) |
| `buffer.js:891`; `:892` | `/api/clipboard` every 2 s; the mark every 1 s while open | never | every |
| `buffer.js:840 :843 :844` | document keydown (×2) and pointerdown, capture | never | on |
| `buffer.js:846` | `bindBufferKeys` → `<html>` pointerdown, focusin, keydown (`keys.js:101-103`) | off discarded | change, then on |
| `buffer.js:867 :878`; `:893` | document `hindsight:verb`, `:tape-state`; visibilitychange → fetch or `audition.stop` | never | on; pause (`audition.stop`) |
| `buffer.js:505 :346 :781 :792`, `audition.js:41` | rAFs, `:505` repeating while an audition plays; the audition's AudioContext and decode | self | pause (`audition.stop`) |
| `fold.js:20,25`, `buffer.js:659/692`, `lanes.js:130/161` | body `buffer-open`, `buffer-fold`, `buffer-holding`, `buffer-lifting` | – | idle (the router saves the classes); end a drag on hide |

## C. Studio: Play mode (`lib/play`, flag `hindsight.play`, `flag.js:7`)

| Where | What | Removed | Handling |
|---|---|---|---|
| `play/mount.js:30` | Starts itself (risk 5) | – | change |
| `strip.js:137-138` | `#play-strip` is prepended into the shared `#np` | – | change: `ctx.barSlot`, hidden with the view |
| `strip.js:178` | `/api/tapes/play` socket (`link.js:142`), reconnecting | `destroy()` | pause: close, reopen on show |
| `strip.js:241` | `bindKeyboard` (`keymap.js:162-167`): document keydown, keyup, pointerdown, focusin (capture), visibilitychange, window blur | `destroy()` | pause: unbind and `letGo()` |
| `strip.js:263` | Ticker step (risk 7) | `destroy()` | change |
| `strip.js:294 :307 :322 :442 :477 :486` | document pointerdown, click and keydown (capture); `bench-forward`, `tape-state`, `keeps` | `destroy()` | on |
| `strip.js:397,414`, `midi.js:247,259` | Web MIDI, reopened from `hindsight.play.webmidi` | `close()` | pause (risk 7) |
| `strip.js:415`; `:488` | Controls every 5 s while open; the lead every 1 s, always | `destroy()` | every |
| `strip.js:134`, `:277` | `matchMedia(PHONE)`; body `play-unfolded` | – | idle |

## D. Room: `lib/shelf-page.js` (all at module scope)

| Where | What | Removed | Handling |
|---|---|---|---|
| `:534` | `pageBar`: NowPlaying, `tapeSource` (500 ms chain `tape-source.js:59`, visibilitychange `:62`), `tapeStream`, the handoff and the carry (`carry.js:174-179`) | – | shell (step 1) |
| `:527`; `:531-532` | `watchLink`; `initHelp`, `initNav` | – | shell |
| `:542`; `:543` | Takes every 5 s; status every 15 s | never | every |
| `:234`; `:246` | window popstate (the cassette sheet); window keydown Escape | never | on (the router decides first) |
| `:497`; `:520` | window pagehide → session `hindsight.shelf.scroll`; pageshow, if persisted → poll | never | keep, for leaving the shell; on |
| `:199 :222-230 :239 :417 :427` | `{cassette}` push, replace and back (risk 10) | – | change |
| `:200-207` | The cassette sheet sets `inert` on `.appbar`, `.about`, `#np` and the rack; body `cassette-open` | – | pause: close the sheet on hide, which clears the inert |
| `:380`, `:395` | Play all: a per-frame `Loop`, and `holdScreen` | stop | loop (keep the media-event path) |
| `:153`, `:176-179`, `:434` | `tagStore.subscribe`; the `wideMQ` change listener | never | idle |
| `:38-49` | local `hindsight.shelf` | – | idle |

## E. Room: `takes.js`, the rows, the detail and `lib/room`

| Where | What | Removed | Handling |
|---|---|---|---|
| `takes.js:131` | document keydown Escape → `exitSelect` | never | on |
| `takes.js:142 :150-153` | `onSchemeChange`; `tagStore.subscribe` and `load`; IntersectionObserver | never | idle |
| `takes.js:794` | `new Audio()` for each row (preload none) | – | the engine adopts the bar's (step 2); idle otherwise |
| `takes.js:964 :1018 :313` | document pointerup (`once`); body `selecting`; session `hindsight.order` | self | idle |
| `rowwave.js:43`; `cassette.js:96` (via `shelf-detail.js:225`) | A frame loop / ticker step while the take plays | stop | change: no paint while `!active()`, repaint on show |
| `doorway.js:432` | `np.onChange(renderPlaces)` on every bar frame; the off is discarded | – | change, then pause |
| `doorway.js:437 :442` | `.room-sit` and `.room-grease` go into the shared bar | – | change: `ctx.barSlot` |
| `doorway.js:214` | Deck `ReelWindow` (a Scene) | – | idle once `:432` is gated |
| `doorway.js:247`, `fly.js:113-124` | The flight's Scene, plus window pagehide and visibilitychange for each flight (removed at `fly.js:66-73`) | yes | pause: `flights.cancel()` |
| `doorway.js:128-129` | `startViewTransition` for the month box | – | change: never nest it in the router's |
| `doorway.js:137` | `forgetNote()` drops session `hindsight.replaced` at mount | – | change: on an arrival from another page only, not on a lazy mount |
| `doorway.js:143 :155 :659/669` | body `room-on`, `room-search`, `room-rack` | – | idle (router) |
| `doorway.js:119 :483 :639` | ResizeObserver (returns at width 0); the sketchbook `<dialog>` on `<body>`; `tagStore.subscribe` | never | idle; pause (close the sketchbook) |

## F. Ids, classes, history, location, storage, focus

**Ids in both pages.** `help`, `out-btn`, `toasts`, `np`, `np-expand`, `np-levels`, `np-marquee`, `np-mini`, `np-reel-l`, `np-reel-r`, `np-status`, `np-time`, `np-unit` and `position` (tape.html:36-221, takes.html:36-134). After 5a they are all shell chrome.
- Otherwise, none of tape.html's 256 ids collides with takes.html's 43.
- Of the ids made at runtime, only `out-sheet` (`out-switch.js:56`), `settings-sheet` and `update-sheet` come from both rooms. The last two are also in `tape.html:520,533`. → shell.

**Body classes.**
- **Read as a switch:** `body.tape-page`, by `rooms/mount.js:18`, `play/mount.js:30`, `settings.js:334` and `update.js:159`.
- **Shell-owned:** `player-open` (`player.js:42`) and `help-mode` (`help.js:75`).
- **On `<html>`:** `data-phone-busy`, set at `recorder.js:133` and read at `settings.js:141`.

**History.**
- Writers: `player.js:24-27,51,58` and `shelf-page.js:199,222,223,230,239,417,427`.
- No `hashchange` or `storage` listener anywhere, and nothing sets `scrollRestoration`.

**Location (step 8).**
- Navigations: `bar.js:266,272,365`, `carry.js:331`, `buffer.js:393`, `studio.js:90,411`, `doorway.js:136,625`, `tap.js:43`, `bounce.js:153,192` and `nav.js:142`.
- The two reloads, `settings.js:627` and `update.js:439`, are fine.

**Hand-off storage.** None of it needs a change for 6a.
- Session: `hindsight.bar.carry` and `.frame` (`carry.js:16-17`), `hindsight.replaced` (`replaced.js:15`), `hindsight.nextToast` (`toast.js:67`).
- Local: `tape.listener` (`listener.js:8`) and `hindsight.tapeOn` (`nav.js`).

**Focus.** Calling focus on an element in a hidden subtree does nothing, so the calls at `doorway.js:391,612,662,671` and `shelf-page.js:211,215` are idle. The exception is the inspector, which takes focus back when it loses it (`page.js:3978-3983`). Closing the inspector on hide covers it.

## G. Singletons that assume one page per load

- `page.js`: `state`, `boot()`, 18 global listeners and the EditorBar.
- `shelf-page.js`: everything, including a history write at import.
- The two self-starting mounts.
- `settings.js:193` `PAGE`: the device preferences as they were at load, so "restart to apply" still holds in a shell that lives for hours.
- `tags.js:52` `tagStore` and `motion.js:223` `ticker`: meant to be shared.

## H. Modules with none of these effects (78)

`buffer/{api,draw,model,state}`, `flags`, `help/tips`, `meter`, `objects/{cassette-geom,grease,icons,lcd,reels,ribbon-draw,ribbonmath}`, `play/{clock,controls,far,fxwire,held,reel,surface}`, `playall`, `rig/{arm,warn}`, `room/{art/*,deck,ghost,mount,shelves,space}`, `rooms/{keep,keeplabel,takename,words}`, `scene/*`, `tape/{align,away,blocks,catch,clipgestures,geometry,levels,menu-fit,overview,pending,poll-gate,range,rec,refusal,sections,selection,stream-buffer,timeedit}` and `wave/{boundary,draw,geometry,near,onset,tape-strip}`. `room/open.js` and `rooms/grab.js` are in the Room's graph through `room/mount.js`'s loader table, but `takes.html` never loads them.

## The DevTools check on 6b

With the Room shown and a take playing:

- **Network:** only the engine's `/api/tapes/state` and the Room's 5 s and 15 s polls. No `/api/clipboard`, no 2 s `/api/status`, no `/api/envelope` and no `/api/tapes/controls`; no `/api/live` frames, and no `/api/tapes/play` socket.
- **Performance:** no frames from `playheadLoop`, the ribbon, the VU meters or the strip.
- **Keys:** Space, R, C, K and G do nothing to the tape.

Then the reverse, with the Studio shown: no row or deck painting, and no `renderPlaces`.
