# The Transport's extraction (1d)

> A spec, 2026-11-02, for Gabe. It is item 1d of the component migration
> (`STATE.md`, *Next*; `components.md` §6, row 1, and *For Gabe*, call 1),
> after the engine split (1c, #247). It is not built yet. What
> `components.md` already settled (agreed 2026-10-30) is cited, not
> reopened; the rest are recommendations within it. The build order
> follows them.

## Why a spec first

Row 1 reads as a move: `NowPlaying` and eight modules from `lib/bar/` into
`lib/components/transport/`, `#np`'s markup into its template, and
`css/bar.css` with them. Moving them as they are breaks Guardrail 15 in
six places that each need an interface first (AGENTS.md, *Build the
interface first*). None of them changes the screen. Each is a decision
about who owns what:

- **The ids.** A component writes an id only through `cx.id(name)`, its
  root's id and the name, so on `#np` every id is `np-<name>`. Twelve ids
  inside `#np` today are not: `position`, `rec`, `catch-pass`,
  `catch-more`, `click`, `tape-overview`, `clock-out` and the five
  `out-strip*`. The flows select five of them (`#position`: J1.12, J4.4;
  `#rec`: J4.1; `#catch-pass`: J1.4, J1.5, J4.4; `#catch-more`: J1.4,
  J4.4; `#tape-overview`: J1.10). Beside the flows: the Studio
  (`lib/tape/page.js`), `lib/tape/output-ui.js`, the bar itself (`bar.js`
  writes `#position`, `press-note.js` finds `#rec`), `lib/room/deck.js`'s
  `readBar` (`#position`), `lib/help/tips.js` (`tape-overview`,
  `catch-more`), `styles.css`'s `#out-strip-*`, and the tests that name
  them (`architecture.test.js`'s Step 5a, `deck.test.js`, `lcd.test.js`,
  `bar-room.test.js`, `engine.test.js`). Open's `#position` is its own
  markup's and stays.
- **The page's layout reads the bar's state off `<body>`.**
  `body.np-fold` and `body.player-open` are written by `fold.js` and
  `player.js`; `css/bar.css` keys 42 of its rules on them (14 and 28; and
  8 more on `body.tape-page`, `.shelf-page`, `.main-page`, `.selecting`
  and `body:has(.np)`, which sets `--dock-b` and the page's padding), and
  `styles.css` 12 of its own on `player-open` (the inspector, the
  multi-bar, the buffer panel). The router keeps `player-open` across a
  room switch (`KEEP_CLASSES`, `lib/shell/router.js`). `css/bar.css` also
  has 7 viewport `@media` blocks. A component may not touch `<body>`, and
  its stylesheet starts every selector at its root.
- **The Studio hears the fold** by `hindsight:np-fold` on the document,
  and **the bar knows it is in the Studio** by reading `body.tape-page` as
  it draws (`bar.js`, `paintDisplay`), redrawn by a `MutationObserver` on
  any change of `<body>`'s class (the tempo's menu is the Studio's).
  `player.js` has a second observer, on `#np`'s `hidden`, inside the root.
- **The Studio's own keys live in the bar**: ●, Catch and its ▾, the
  click, the overview, the clock-out lamp and the output strip, looked up
  by id from `lib/tape/page.js` and `output-ui.js`.
- **The window**: J's keydown reads `dialog[open]` off the page, and five
  `matchMedia`s are made in place (`bar.js`'s pointer and phone shape,
  `player.js`'s phone, `fold.js`'s reduced motion, `slots.js`); `cx` had
  neither a media query nor a way to ask the stack whether a modal sheet
  is up. The bar's own `$('np-…')` look-ups (row 1) become look-ups in its
  root by `data-part` with the move.
- **Open shares the files**: `wave.html` has its own `#np`, links
  `css/bar.css`, and imports `player.js`, `slots.js`, `display.js` and
  `carry.js`. Open's bar moves in Open's pass, not this one.

## Decisions

1. **The ids become the component's.** *Agreed*: `components.md` 1.3,
   *The flows keep finding it*. Each of the twelve takes its `np-` name
   (`#position` → `#np-position`, `#rec` → `#np-rec`, …), with each
   flow's selector and Step 5a's LCD ids moved in the same PR: "the
   selectors change, never what a flow expects". The Studio's lookups
   move with them; Open's own markup (`wave.html`, `wave/page.js`) keeps
   its ids until Open's pass.
2. **The bar's state goes on its root; the page's layout is the
   surface's.** *Agreed* for the stylesheet (`components.md` 1.4, *Told
   its state on its root*, and *Laid out by its own width*: container
   queries for its six viewport `@media`, `--dock-b` to the surface's
   stylesheet). Recommended for the page: the component says fold and player-up on `#np`
   (`data-fold`, and `data-size`, which it already sets), and its
   stylesheet keys on them. `body.np-fold` and `body.player-open`, which
   the page's own rules read, are set by the surface (`lib/shell/boot.js`)
   from the component's `props.onLayout({folded, open})`, not by the
   component, and the router's `KEEP_CLASSES` keeps working on them as
   now. `body:has(.np)`'s `--dock-b` and padding go to `styles.css`, the
   surface's, and the 7 viewport `@media` become container queries on the
   root. The rules in `css/bar.css` keyed on a page's body class
   (`tape-page`, `shelf-page`, `main-page`, `selecting`) move to the
   stylesheet of the page they lay out, or become the root's `data-room`,
   set from the surface. *Recommended.*
3. **The surface tells the Transport which room it is in, and hears its
   fold.** `props.room()` answers the room shown (the tempo's menu is the
   Studio's), and the shell redraws the component on a room switch; the
   Studio hears the fold through its `ctx` (a new `ctx.barLayout`,
   `{folded, open, onChange(fn)}`, the shell's, named apart from
   `ctx.engine.bar`), not a document event. `hindsight:np-fold` and
   the `MutationObserver` go. *Recommended.*
4. **●, Catch and the click are the Transport's keys, on the tape's
   verbs** (`record`, `punchOut`, `cancelRecord`, `catch`, `setClick`,
   which the tape model has had since 1b), drawn from the tape's
   `snapshot()`, as row 1 says. **The overview, the clock-out lamp and
   the output strip stay the Studio's**, in a slot of the bar's the Studio
   fills (`ctx.barSlot`, which the Listening Room's grease marks already
   use): the Transport's template keeps the grid area they sit in (`out`,
   `css/bar.css`) as an empty slot, so it carries no Studio drawing. Catch's
   ▾ menu (`#catch-menu`, outside `#np` in `shell.html` today) moves into
   the template with Catch. *Recommended.*
5. **The window through `cx` and the stack.** *Built* (step 1):
   `ctx.media(query)` on a view and `cx.media(query, fn)` on a component,
   a MediaQueryList whose `change` is quiet while hidden and off on
   unmount, for the five `matchMedia`s; and the stack's `covered()` (on
   every scope, so `cx.layers.covered()`), true while a modal `<dialog>`
   that is not on the stack is open. J asks it in place of reading
   `dialog[open]`. They are the same test: Settings, Rename, a confirm and
   the other `showModal` sheets are never on the stack, and an inspector
   is on it and not modal, so J still steps under one (`ownsKeys` would
   not do: it is true inside an inspector or a drawer, and under any
   menu). `cx.floor` is already `barTop`'s; inside the Transport the floor
   is its own root's top.
6. **One display.** The bar mounts the `display` component in place of
   its own three keys, and `display` learns a take's and the feed's words
   (it draws the tape's only today), reading the engine
   (`engine.bar.snapshot()`) beside the transport. Its root inside the bar
   is `#np-lcd`, so its keys are `#np-lcd-tempo`, `-source`, `-output`
   and their parts (decision 1 again: J1.12, J1.13 and J2.3 select
   `#np-source`; J1.12, J2.3 and J2.7 `#np-source-short`; J1.4 and J1.20
   `#np-tempo`). *Recommended.*
7. **Open keeps its markup and its modules until its pass.** The
   Transport's stylesheet is `css/bar.css` (`components.md` 1.4), which
   `wave.html` links already, and Open's `#np` has the same root class,
   so its rules keep drawing Open's bar. The rules keyed on
   `body.wave-page` become the root's (`data-room="open"`, which
   `wave/page.js` sets on its own `#np`), the one change to Open. Open
   keeps importing `lib/bar/player.js`, `slots.js`, `display.js` and
   `carry.js`, which stay where they are until Open's pass; the
   component has its own copies of what it needs from them. *Recommended.*
8. **The models the Transport needs** are the engine's `bar` (what plays,
   its verbs; `snapshot()` and `onChange` since 1c), the transport, the
   tape and the takes (the source menu's list), and the phone's recorder.
   `mountComponent` checks each has `snapshot()` and `onChange`; the
   recorder has `snapshot()` since step 1. It is made lazily today (the
   mini player's ● makes it on first use); the shell makes it at boot and
   hands it to the Transport. *Recommended.*

AGENTS.md's bar rule and decision 0047 change with the PR that moves the
markup (call 1): *a new key goes in the Transport's template, in its slot*,
in place of *in the markup, in `shell.html` and `wave.html`*.

## Build order

Each its own PR, green, reviewed and merged before the next, nothing on
screen changing, J1.10, J1.12, J1.13, J1.15, J1.16, J2.3, J4.1 and J4.4
unmoved:

1. **`cx.media` and the stack's `covered()`** (decision 5), and the
   recorder's `snapshot()`, with tests; J asks `covered()`. *Built*, #249.
2. **The bar's state on its root, the layout the surface's** (decisions 2
   and 3), in place in `lib/bar/`, in two PRs.
   - **2a, the script's half**: *built*, #250. `lib/bar/layout.js`
     `barLayout(doc)` is the one place that writes `body.np-fold` and
     `body.player-open` (`fold.js` and `player.js` go through it), shared
     as `ctx.barLayout`, `onChange(fn(after, before))`; the Studio hears a
     fold there; `NowPlaying` takes `room()`, kicked by the shell's
     `chrome.setPath`. `hindsight:np-fold` and the `MutationObserver` are
     gone. The body stays where the fold is kept: the router takes
     `np-fold` with each room (it is not in `KEEP_CLASSES`), so the fold
     is a room's, and a copy kept across a switch goes stale.
   - **2b, the stylesheet's half**: *built*, #253. What lays out the page moves to
     `styles.css`, the surface's: `body.player-open`'s `overflow`,
     `.appnav` and `.np-dock`; `body:has(.np)`'s `--dock-b`, padding and
     toasts; `body.selecting .np`; and the studio and away keys,
     `:is(body.tape-page, .shelf-page, .main-page)`, become
     `.np[data-room]`, set from `room()`. One rule stays in `css/bar.css`:
     the player pulled up, `body.player-open .np-dock, body.player-open >
     .np`, lays out the Studio's dock and Open's bar alike, so it waits for
     step 5 with the rest. What styles inside the root
     under `body.np-fold` and `body.player-open` waits for step 5: a root
     attribute has to follow the router's per-room fold (the shell can
     mirror it in `chrome.setPath`, after the room's classes are given:
     look at the turn in a browser), and the 7 viewport `@media` become
     container queries on a wrapper inside the root, which is the
     template's. `css-budget.test.js` counts the `@media` conditions:
     moving a rule must not add one.
3. **The Studio's keys on the tape's verbs, and the Studio's slot**
   (decision 4), still in `lib/bar/`.
   - **The keys**: *built*, #254. `lib/bar/tape-keys.js` `tapeKeys`, made
     by `NowPlaying` with the page's tape and shared as `ctx.tapeKeys`,
     draws ●, Catch and its ▾ and the click from the tape's and the
     recorder's snapshots and presses the tape's verbs; the Studio lends it
     its hands (`lend(hands)`: `layers`, `armed()`, `inputOf(n)`,
     `playsHere()`, `body(what)`, `said(verb, answer, …)`, `hover(on)`) and
     presses it with `press(name)` and `catch(what)` (`bar.md`, *The
     Studio's keys*). Guardrail 19 fails on the Studio looking them up.
     `hindsight:phone-offer` and `hindsight:phone-record` are gone: the bar
     calls `phoneKey`'s `offer()` and the recorder's `quick()`.
   - **The slot**: *not built*. The overview, the clock-out lamp and the
     output strip go into `ctx.barSlot` only once nothing looks them up
     while the Studio is hidden, since a slot takes its nodes out of the
     page on hide: `lib/tape/output-ui.js` draws the strip on every change
     of the bar's tape source, in any room, by id, and `page.js` finds the
     overview and the lamp by id in its render and size observer. Each has
     to be handed its elements first (held references, from the Studio's
     own markup), which is its own change. Next, before step 4 renames
     them.
4. **The ids** (decision 1): *built*, #255, ahead of step 3's slot. The
   twelve renamed (`#np-position`, `#np-rec`, `#np-catch-pass`,
   `#np-catch-more`, `#np-click`, `#np-tape-overview`, `#np-clock-out`,
   `#np-out-strip` and its parts), with the flows', the Studio's,
   `output-ui.js`'s, `deck.js`'s, `tips.js`'s (the overview's and Catch's
   ▾'s tip keys follow their ids), `styles.css`'s, `css/bar.css`'s and the
   tests'; Open's own markup keeps its ids, and `#catch-menu`, outside
   `#np`, waits for step 5. Guardrail 20 fails on an id inside the shell's
   `#np` that is not `np-<name>` (`bar.md`). The slot, when it is built,
   holds the renamed elements.
5. **The move**: `lib/components/transport/` (`index.js` with the
   template from `shell.html`, `NowPlaying` as its mount, the modules
   beside it), `css/bar.css` as its stylesheet, scoped to `.np`,
   `display` mounted inside (decision 6), the harness check
   (`scripts/components/transport.check.mjs`, every size), `ci.yml`'s
   globs and AGENTS.md's list, `SHELL`, and AGENTS.md's bar rule and 0047
   amended.

Then Gabe tries the bar on the tablet, before the List (item 2) starts.
