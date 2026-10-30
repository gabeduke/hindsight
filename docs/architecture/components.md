# Components

The UI is moving into a kit of components, so that a change lands in one
small component and is checked on its own (`docs/plan/components.md`, the
spec; `the-ecosystem.md`, steps 4 and 5). This file is what is built: the
contract, the protocol client and its fixtures, the harness, and the
components so far.

## The contract

A component is a module's default export, `lib/components/<id>/index.js`:

```js
export default {
  id: 'display',            // its name, and its check's (scripts/components/<id>.check.mjs)
  root: 'lcd-keys',         // the class put on its root; every selector in its css starts there
  needs: ['transport'],     // its models, by noun
  css: 'css/display.css',   // its one stylesheet
  mount(root, models, cx) { /* … */ return { show() {}, hide() {}, unmount() {} }; },
};
```

A surface mounts it with `mountComponent(def, root, models, ctx, props)`
(`lib/components/mount.js`): `models` the page's, by noun; `ctx` a shell
view's (`lib/shell/view.js`); `props` the surface's callbacks and values
for this one (the menu a key opens, the take it shows). It answers
`{ show(), hide(), unmount(), shown }`. It refuses a component that lacks
one of the five, a model in `needs` without `snapshot()` and `onChange()`,
and a root that already has one mounted.

| `cx` | What it is |
|---|---|
| `watch(model, fn)` | `fn(model.snapshot())` now and on each change; never while hidden; on show, once, if the snapshot moved meanwhile; off on unmount. A watcher that throws is reported, and the others still draw |
| `on(target, type, fn, opts)` | `ctx.on`, quiet while the component is hidden as well as the view; off on unmount |
| `loop(fn)` | `ctx.loop`, parked on hide, started on show if it was wanted (one that parked itself stays parked) |
| `layers` | its share of the view's stack: opened through the view's scope, and what it opened closes on hide (`'navigate'`) and unmount, leaving the view's own |
| `floor` | `menu()`'s floor: `ctx.floor`, else the bar's top (`barTop`) |
| `toast`, `go` | `ctx`'s |
| `id(name)` | its root's id and the name: root `np` and `play` make `np-play` |
| `props` | the surface's, frozen |

It mounts shown. A surface out of sight hides it at once (a prewarmed
view's `hide()` runs before its first show, decision 0048, so a view that
hides its components in its own `hide()` covers it). `unmount` is real:
the component's own `unmount` runs, then everything that went through
`cx` is taken off, the root emptied and its class removed, so a second
mount binds each listener once (`mount.test.js` counts them).

**Enforced by directory** (`architecture.test.js`, Guardrail 15), over
every module under `lib/components/`, with no list of exceptions: no
`fetch`, socket or `'/api/` string; no `document.getElementById`,
`querySelector` or `body`; no listener on the window or the document but
`cx.on`; no `setInterval`; no `hindsight:` event; no `new Audio`; no
`location` or `history`; no id written in (`id="`, `.id = '…'`); no
`setTimeout` beside a `pointerdown`. And each component directory has an
`index.js` exporting the five, a harness check, and a stylesheet whose
every selector starts at `.root`, which no other stylesheet reaches inside
(it may name the root to place it, or lay out around it with `:has()`).
Guardrails 12 and 13 (`pushState`, `aria-haspopup`) cover it too.

## Models, and the protocol client

A model is one per page, has no DOM, and answers `snapshot()` (frozen, the
same object until it moves, with a version `v`) and `onChange(fn)`.

- **The takes** (`lib/models/takes.js`): `snapshot()` is `{v, list}`, the
  ETag and the list (`list()` and `etag` are its old names, kept until
  their callers move). It reads through the page's protocol client.
- **The transport** (`lib/models/transport.js`): `snapshot()` is `{v, id,
  tape, live}`, `v` counting the moves this page has seen (the Pi's `rev`
  takes its place once the tape's answer carries it). What runs on between
  answers, `playing()` and `pos()`, is read on the ticker, not from it. It
  still asks the Pi itself, until the spec's models step moves it onto the
  client.

**The protocol client** (`lib/models/protocol.js`, `createProtocol`) is the
one module that names a route a model reads: `read(noun, {v})` answers
`{ok, status, v, body}` (a 304 for the version held). It reads the takes
(`GET /api/jams`; Guardrail 14 now names it, not the takes model); each
model's routes, and its verbs, join as the model moves onto it. `Refusal`
is the one error a verb throws: `message` for a person, `code` for a page
(today's `reason`, or `http_<status>`, or `offline`), `words` for a key.

## Fixtures

`lib/models/fixture.js` is a protocol client with no Pi, for the tests and
the harness, never shipped (not in `SHELL`):
`fixture(snapshots, {refuse, answers})` answers reads from JSON, records
verbs in `calls` and answers or refuses them as scripted
(`{refuse: {play: 'no_audio_out'}}`), and stands in for the changes socket
(`watch`, `set(noun, body)`, `press(p)`). `fixtureModels(fx, needs)` makes
the models a component needs over it, `{models, ready, stop()}`. The
transport is made over the fixture through the fetch, send and socket its
tests stand in for, until it is on the client.

The snapshots are the Pi's answers, saved: `testdata/protocol/<noun>/<case>.json`
(`tape/` is `GET /api/tapes/state`, `takes/` is `GET /api/jams`). Outside
`release.yml`'s paths, so a new one cuts no release. They can't drift:
`internal/api/protocol_fixtures_test.go` decodes each, refusing any field
the Pi doesn't send, into the type its route encodes, and fails on a noun
directory it has no type for.

## The harness

`node scripts/components.mjs [id…]` (not shipped) mounts each component
with a check alone: a small node server serves `web/static` read-only, the
harness page at `/__components/` (`styles.css`, `objects.css` and the
component's stylesheet, a stage with its root, and
`scripts/components/page.js`, which makes the fixture's models and mounts
the component in a real shell view's `ctx`), and `testdata/protocol/` at
`/__fixtures/`. No demo, no Go.

Each case in `scripts/components/<id>.check.mjs` (its fixtures by noun,
the props whose presses are recorded, the verbs refused) is mounted at
`PROFILES`' phone (390×844), Pixel tablet (1280×800), tablet (1024×768)
and desktop (1440×900), in light and dark, and checked by:

- `checkLayout` from `scripts/flows/layout.mjs`, with `root`, which
  counts only what is inside the component (covered, offscreen,
  menu-offscreen, clipped, target-size, small-touch);
- its fit: the root's box against the screen's own width. A phone zooms
  out a page wider than itself and `innerWidth` grows with it, so
  `checkLayout`'s offscreen does not see a root that runs off a phone;
- the check's `expect(page, {tap})`, what else it should do.

A layout fail (an allowance in `layout-allow.mjs` doesn't excuse a
component), a page error or a failed expect fails it. `--storyboard=dir`
keeps a picture of each and `dir/index.html`; CI's flows job runs it
before the flows, into `storyboard/components/`.

## The components

| Component | What it is | Models | Mounted by |
|---|---|---|---|
| `display` | the display's three keys, the tempo, what plays and where, for the tape; the long forms from 420 px of its own width (`css/display.css`); a key the surface hands nothing to (`props.tempo`, `source`, `output`) is disabled | transport | the harness only. The bar still draws its own (`#np-tempo`, `#np-source`, `#np-output`) until the Transport's extraction puts this in their place |
