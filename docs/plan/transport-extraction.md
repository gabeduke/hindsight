# The Transport's extraction (1d)

> A spec, 2026-11-02, for Gabe. It is item 1d of the component migration
> (`STATE.md`, *Next*; `components.md` §6, row 1, and *For Gabe*, call 1),
> after the engine split (1c, #247). It is not built yet. Each decision has
> a recommendation; the ones marked **Gabe's** change a rule he made, or a
> flow, and wait for his answer. The build order follows them.

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
  `out-strip*`. The flows select five of them (J1.4, J1.5, J1.10, J1.12,
  J4.1, J4.4), and so do the Studio (`lib/tape/page.js`), `output-ui.js`,
  `rig/patch.js` and Open (`wave/page.js`).
- **The page's layout reads the bar's state off `<body>`.**
  `body.np-fold` and `body.player-open` are written by `fold.js` and
  `player.js`; `css/bar.css` keys 44 of its rules on them (and 8 more on
  `body.tape-page`, `.shelf-page`, `.main-page`, `.selecting` and
  `body:has(…)`), and `styles.css` 12 of its own (the inspector, the
  multi-bar, the buffer panel). A component may not touch `<body>`, and its
  stylesheet starts every selector at its root.
- **The Studio hears the fold** by `hindsight:np-fold` on the document,
  and **the bar knows it is in the Studio** by a `MutationObserver` on
  `body.tape-page` (the tempo's menu is the Studio's).
- **The Studio's own keys live in the bar**: ●, Catch and its ▾, the
  click, the overview, the clock-out lamp and the output strip, looked up
  by id from `lib/tape/page.js` and `output-ui.js`.
- **The window**: J's keydown reads `dialog[open]` off the page, and the
  phone's player and the fold each make a `matchMedia` of their own; `cx`
  has neither a media query nor a way to ask the stack what is open.
- **Open shares the files**: `wave.html` has its own `#np`, links
  `css/bar.css`, and imports `player.js`, `slots.js`, `display.js` and
  `carry.js`. Open's bar moves in Open's pass, not this one.

## Decisions

1. **Gabe's: the ids become the component's.** Each of the twelve takes
   its `np-` name (`#position` → `#np-position`, `#rec` → `#np-rec`, …),
   and the flows' selectors, the Studio's and Open's change with them in
   the same PR. No flow's expectation changes, only how it finds the key.
   The other way, a flow that may not be edited, leaves the component an
   id of its own, which Guardrail 15 has no exception for. *Recommended.*
   (The alternative: flows find the bar's keys by `data-part` and role,
   not by id, which is a larger edit to the same flows.)
2. **The bar's state goes on its root; the page's layout is the
   surface's.** The component says fold and player-up on `#np`
   (`data-fold`, and `data-size`, which it already sets), and its
   stylesheet keys on them. `body.np-fold` and `body.player-open`, which
   the page's own rules read, are set by the surface (`lib/shell/boot.js`)
   from the component's `props.onLayout({folded, open})`, not by the
   component. The rules in `css/bar.css` keyed on a page's body class
   (`tape-page`, `shelf-page`, `main-page`, `selecting`) move to the
   stylesheet of the page they lay out, or become the root's `data-room`,
   set from the surface. *Recommended.*
3. **The surface tells the Transport which room it is in, and hears its
   fold.** `props.room()` answers the room shown (the tempo's menu is the
   Studio's), and the shell redraws the component on a room switch; the
   Studio hears the fold through `ctx` (the shell's
   `ctx.bar.onLayout(fn)`), not a document event. `hindsight:np-fold` and
   the `MutationObserver` go. *Recommended.*
4. **●, Catch and the click are the Transport's keys, on the tape's
   verbs** (`record`, `punchOut`, `cancelRecord`, `catch`, `setClick`,
   which the tape model has had since 1b), drawn from the tape's
   `snapshot()`, as row 1 says. **The overview, the clock-out lamp and
   the output strip stay the Studio's**, in a slot of the bar's the Studio
   fills (`ctx.barSlot`, which the Listening Room's grease marks already
   use), so the
   Transport carries no Studio drawing. *Recommended.*
5. **`cx` gains two things** (`lib/components/mount.js`, its own PR with
   its tests): `cx.media(query)`, a MediaQueryList whose `change` is
   quiet while hidden and off on unmount (the phone's player and the
   fold); and `cx.layers.open({except})`, whether the stack holds
   something open (J's back five seconds stays quiet under a dialog, read
   from the stack, not the DOM). `cx.floor` is already `barTop`'s; inside
   the Transport the floor is its own root's top. *Recommended.*
6. **One display.** The bar mounts the `display` component in place of
   its own three keys, and `display` learns a take's and the feed's words
   (it draws the tape's only today), reading the engine
   (`engine.bar.snapshot()`) beside the transport. Its root inside the bar
   is `#np-lcd`, so its keys are `#np-lcd-tempo`, `-source`, `-output`
   (decision 1 again: J1.12, J1.13 and J2.3 select `#np-source`, and J1.4,
   J1.20 and J2.7 `#np-tempo`).
   *Recommended.*
7. **Open keeps today's files until its pass.** `wave.html` keeps its
   `#np`, `css/bar.css` (frozen: no new rule) and its imports of
   `lib/bar/player.js`, `slots.js`, `display.js` and `carry.js`; the
   component has its own copies of what it needs, and Open's pass deletes
   the old ones. For one stretch the two bars' rules are in two files.
   *Recommended*: the other way, Open linking the component's stylesheet
   now, puts Open's markup under the component's rules before Open is on
   the component.
8. **The models the Transport needs** are the engine's `bar` (what plays,
   its verbs; `snapshot()` and `onChange` since 1c), the transport, the
   tape and the takes (the source menu's list), and the phone's recorder.
   `mountComponent` checks each has `snapshot()` and `onChange`; the
   recorder has `state()` and `onChange`, and gains `snapshot()` as an
   alias. *Recommended.*

AGENTS.md's bar rule and decision 0047 change with the PR that moves the
markup (call 1): *a new key goes in the Transport's template, in its slot*,
in place of *in the markup, in `shell.html` and `wave.html`*.

## Build order

Each its own PR, green, reviewed and merged before the next, nothing on
screen changing, J1.10, J1.12, J1.13, J1.15, J1.16, J2.3, J4.1 and J4.4
unmoved:

1. **`cx.media` and `cx.layers.open`** (decision 5), and the recorder's
   `snapshot()`, with tests. No caller yet.
2. **The bar's state on its root, the layout the surface's** (decisions 2
   and 3), in place in `lib/bar/`: `fold.js` and `player.js` say it on
   `#np` and through `onLayout`; the shell sets the body classes and hands
   the Studio `ctx.bar`; `css/bar.css`'s rules move off `body.*`.
   `hindsight:np-fold` and the `MutationObserver` go.
3. **The Studio's keys on the tape's verbs, and the Studio's slot**
   (decision 4), still in `lib/bar/`.
4. **The ids** (decision 1): the twelve renamed, with the flows', the
   Studio's and Open's selectors.
5. **The move**: `lib/components/transport/` (`index.js` with the
   template from `shell.html`, `NowPlaying` as its mount, the modules
   beside it), `css/transport.css` from `css/bar.css`'s shell half,
   `display` mounted inside (decision 6), the harness check
   (`scripts/components/transport.check.mjs`, every size), `ci.yml`'s
   globs and AGENTS.md's list, `SHELL`, and AGENTS.md's bar rule and 0047
   amended.

Then Gabe tries the bar on the tablet, before the List (item 2) starts.
