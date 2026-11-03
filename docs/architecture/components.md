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
(`lib/components/mount.js`): `models` the page's, by noun, of which it is
handed those in `needs` and no others; `ctx` a shell view's
(`lib/shell/view.js`); `props` the surface's callbacks and values for this
one (the menu a key opens, the take it shows). It answers `{ show(),
hide(), unmount(), shown }`. It refuses a component that lacks one of the
five, a model in `needs` without `snapshot()` and `onChange()`, and a root
that already has one mounted.

| `cx` | What it is |
|---|---|
| `watch(model, fn)` | `fn(model.snapshot())` now and on each change; never while hidden; on show, once, if the snapshot moved meanwhile; off on unmount. A watcher that throws is reported, and the others still draw |
| `on(target, type, fn, opts)` | `ctx.on`, quiet while the component is hidden as well as the view; `once` means once while shown; off on unmount |
| `loop(fn)` | `ctx.loop`, parked on hide, started on show if it was wanted (one that parked itself stays parked) |
| `layers` | its scope of the view's: `scope()` on the view's scope (`lib/ui/layers.js`, where a scope's scope is a share of it). What it opened closes on hide (`'navigate'`) and unmount, newest first, and the view's own stay open |
| `media(query, fn)` | the view's `ctx.media(query)`, a MediaQueryList read where it is needed (`.matches`); `fn`, if given, hears its `change` as `on` does, quiet while hidden, off on unmount |
| `visible()` | shown, and its view `active()` (shown, the document visible): what it reads in place of `document.hidden`; false once unmounted |
| `floor` | `menu()`'s floor: the bar's top (`barTop`) |
| `toast`, `go` | `ctx`'s |
| `id(name)` | its root's id and the name: root `np` and `play` make `np-play` |
| `props` | the surface's, frozen |

What belongs to no room (the shell's chrome: the bar, once it is a
component) mounts in the shell scope, `shellScope()` (`lib/shell/view.js`;
`shell.md`, *The shell scope*): a view that is always shown, so its
components are quiet only while the document is hidden.

What a component can't reach for itself has a helper outside
`lib/components/` that takes no window or document:
- **its menus' rows**: `menuItem(opts)`, `menuRows(groups)`,
  `menuDivider()`, `menuGroup(label)` (`lib/ui/menu.js`), made with no
  document handed in, or with the panel in its place
  (`menuRows(panel, groups)`), in that panel's document;
- **a key that opens a dialog**: `dialogKey(button, dialog)`
  (`lib/ui/menu.js`), which says so (`aria-haspopup="dialog"`,
  `aria-controls`), so neither its template nor its script writes
  `aria-haspopup` (Guardrail 13);
- **a canvas at the screen's density**: `sizeCanvas(cv, w, h)`
  (`lib/ui/canvas.js`), answering `{ctx, dpr}`, the context scaled to CSS
  pixels, or null for a canvas with no width yet;
- **the scheme flipping**: `onSchemeChange(fn)` (`lib/theme.js`), which
  answers its off, for its `unmount`; or `cx.media('(prefers-color-scheme:
  dark)', fn)`, which is taken off by itself.

It mounts shown. A surface out of sight hides it at once (a prewarmed
view's `hide()` runs before its first show, decision 0048, so a view that
hides its components in its own `hide()` covers it). `unmount` is real:
the component is hidden and quieted (its layers closed, its loops parked),
its own `unmount` runs, then everything that went through `cx` is taken
off, the root emptied and its class removed, so a second mount binds each
listener once (`mount.test.js` counts them). After that `cx` takes
nothing: a `watch`, `on` or `loop` throws.

**Enforced by directory** (`architecture.test.js`, Guardrail 15), over
every module under `lib/components/`, the contract's own included, with no
list of exceptions:
- no `fetch`, `timedFetch`, socket, or `'/api` string;
- `window` and `document` only as `cx.on`'s target, and never
  `globalThis`, an `ownerDocument` or a `defaultView`: no look-up, no
  listener of its own, no `document.onkeydown`;
- no bare `addEventListener` or `setInterval`;
- no `hindsight:` event, no audio, no `location` or `history`;
- no id written in (an `id=` in markup, `.id = '…'`, `setAttribute('id')`);
- no `setTimeout` beside a `pointerdown`.

A test beside it lists what these catch and what they let be. Each
component directory has an `index.js` exporting the five and a harness
check. Its stylesheet starts every selector at `.root` and goes into it,
never beside it (`.root + .x`). No other stylesheet may reach inside it:
it may not name the root before a combinator, or name a class the
component owns (one its stylesheet styles that nothing outside its
directory writes). It may name the root to place it, or lay out around it
with `:has()`. Guardrails 12 and 13 (`pushState`, `aria-haspopup`) cover it
too.

A component's stylesheet joins the stylesheet tests (the budget, the
cascade, the tokens, the keys' `.down`) when a page links it: they read
`cssOf(page)`. `css/display.css`, which only the harness links, would add
nothing to the budget today.

## Models, and the protocol client

A model is one per page, has no DOM, and answers `snapshot()` (frozen, the
same object until it moves, with a version `v`) and `onChange(fn)`.

- **The takes** (`lib/models/takes.js`): `snapshot()` is `{v, list}`, the
  ETag and the list (`list()` and `etag` are its old names, kept until
  their callers move). It reads through the page's protocol client.
- **The tape** (`lib/models/tape.js`): `snapshot()` is the Pi's last
  answer about the loaded tape (`{v, id, loaded, tape, live, …}`), `v`
  counting its answers. It is the page's one poller of the tape, at the
  quickest any reader asks (`every(who, ms)`), and its verbs (`record`,
  `punchOut`, `cancelRecord`, `catch`, `setClick`; `tape.md`, *The tape
  model*) answer the Pi's answer or throw a `Refusal`. It reads and sends
  through the page's protocol client.
- **The transport** (`lib/models/transport.js`): `snapshot()` is `{v, id,
  tape, live, pending}`, `v` counting the moves this page has seen (the
  Pi's `rev` takes its place once the tape's answer carries it), `pending`
  a ▶ (`true`) or ■ (`false`) pressed and not yet answered. What runs on
  between answers, `playing()` and `pos()`, is read on the ticker, not from
  it. Its verbs (`play`, `stop`, `locate`, `setLoop`, `setOutput`,
  `setTempo`, `setBars`, `tapLoop`, `tapCancel`; `bar.md`, *The
  transport*) answer the Pi's answer or throw a `Refusal`. It reads the
  tape from the page's tape model, and sends through the page's protocol
  client.

**The protocol client** (`lib/models/protocol.js`, `createProtocol`) is the
one module that names a route a model reads or sends: `read(noun, {v,
id, suggest})` answers `{ok, status, v, body}` (a 304 for the version held);
`verb(noun, name, args, {id})` answers the Pi's body or throws a
`Refusal`; `watch(handlers)` is the page's changes socket
(`lib/tape/changes.js`). It reads the takes (`GET /api/jams`; Guardrail
14), the tape's state and which tape is loaded (`tape`, `tapes`;
`/api/tapes/state`, which Guardrail 17 lets no other module name), and
sends the tape's verbs (`/api/tapes/record`, `/api/tapes/catch`, Guardrail
17, and the click's `PATCH /api/tapes`) and the transport's
(`VERB_NAMES`: `/api/tapes/transport`, `/api/tapes/output`,
`/api/tapes/tap`, which Guardrail 16 lets no other module name, and the
tempo and loop's `PATCH /api/tapes`, which the tape's other edits share
until the tape's model has them). The shell makes one (`boot.js`) and
hands it to the takes, the tape and the engine; the rig
page makes its own for where the tape plays. Each other model's routes
join as it moves onto it. `Refusal` is the one error a verb throws:
`message` for a person, `code` for a page (the Pi's `code`, today's
`reason`, or `http_<status>`, or `offline`), `words` for a key.

## Fixtures

`lib/models/fixture.js` is a protocol client with no Pi, for the tests and
the harness. It is in a release like all of `web/static`, but no page
imports it and it is not in `SHELL`, so no phone caches it:
`fixture(snapshots, {refuse, answers})` answers reads from JSON, records
verbs in `calls` and answers or refuses them as scripted
(`{refuse: {play: 'no_audio_out'}}`), and stands in for the changes socket
(`watch`, `set(noun, body)`, `press(p)`). `fixtureModels(fx, needs)` makes
the models a component needs over it, `{models, ready, stop()}`, each
made over the fixture as the page makes it over its client. A refused verb
throws to whoever pressed it, as on the page. `MODELS` names the nouns it
can make:
- `takes`, `tape`, `transport`: the page's models, over the fixture;
- `bar`: the engine's bar (`lib/models/engine.js`), with the tape in it
  when the `tape` fixture is the loaded one. The engine owns the bar's
  audio, so it needs a page: a browser, or `lib/bar/bar-harness.js`'s
  stand-in. A take in it needs its Audio and peaks, which no fixture serves
  yet;
- `recorder`: the phone's recorder as a component sees it, its
  `snapshot()` (`{mode, seconds}`, from the `recorder` body, closed by
  default) and its verbs `open`, `quick` and `stop`, recorded (or refused)
  in `calls` as `recorder.<verb>`. A verb moves nothing:
  `set('recorder', …)` does;
- `layout`: `barLayout` (`lib/bar/layout.js`) itself, on a body no page
  shows, from the `layout` body (`{folded, open}`, neither by default; its
  snapshot says `docked` too, false until `set({docked})`).

The snapshots are the Pi's answers, saved: `testdata/protocol/<noun>/<case>.json`
(`tape/` is `GET /api/tapes/state`, `takes/` is `GET /api/jams`). Outside
`release.yml`'s paths, so a new one cuts no release.
`internal/api/protocol_fixtures_test.go` decodes each into the type its
route encodes, refusing any field the Pi doesn't send, and fails on a noun
directory it has no type for. So a fixture says nothing the Pi doesn't:
a field renamed or dropped on the Pi fails it. It checks one way only: a
field the Pi adds, or a value it now says differently, does not.

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
