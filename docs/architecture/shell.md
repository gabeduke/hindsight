# The UI

Mobile-first, no build step, no npm, no framework, no vendored libraries:
vanilla ES modules.

It is served with `http.FileServer` straight from disk on every request, which
is why `./deploy.sh --static` can push a CSS change in about a second with no
rebuild and no restart. Anything served with an `.html`, `.js`, `.css` or
`.json` extension is sent `Cache-Control: no-cache`, so the browser revalidates
it and a redeploy is picked up on reload. Nothing here is fingerprinted; the
icons carry no explicit directive and fall through to `http.FileServer`'s ETag and `Last-Modified`
handling.

The takes list is one per page, the takes model (`lib/models/takes.js`;
`push.md`, *The takes' revision*): asked for when the changes socket says
the list moved, on its own slow poll otherwise, and guarded by the
`/api/jams` ETag, so an unchanged list does not re-render and interrupt a
playing preview. Nothing else on a page asks `/api/jams`
(`architecture.test.js`, Guardrail 14): the shell's boot makes the model
and hands it to the engine and to every view (`ctx.takes`); Open's page
(`wave/page.js`) makes its own, unfed, and hands it to Open (`h.takes`).

## The shell

One document, `web/static/shell.html`, is served at `/`, `/index.html`,
`/tape.html` and `/takes.html` (`cmd/hindsight/main.go`; `main_test.go`
checks it). It holds the header, `<main id="views">` with one
`<section class="view">` per view, `#np-dock` (the dock slot, then the one
`#np`), `#toasts`, the shared sheets (Settings, Releases, output, phone) and
one script, `lib/shell/boot.js`. `wave.html` (Open), `rig.html` and
`guide.html` are separate pages; leaving for one unloads the shell, and the
carry (`lib/bar/carry.js`, `handoff.js`) resumes a take on the way back.

**Views** (`lib/shell/views/`: `studio.js`, `room.js`, `capture.js`; Capture
is what `/` shows when the tape is off) export
`{ id, title, bodyClass, help, prewarm, mount }`. `mount(ctx)` runs **once**,
on the first visit (or before it, out of sight: *Moving between rooms*,
below), and answers `{ ready, show({first}), hide(), destroy() }`. A view stays
mounted after that and is hidden, never rebuilt: the tape page is a module
singleton, and a listener registered twice makes Space press ▶ twice. `ctx`
(`lib/shell/view.js`) carries:

- `engine`, `go(url)`, `tapes`, `takes`, `toast`, `link`: shared. A view never creates
  the bar's audio and never assigns `location` to a room path. `takes` is
  the page's takes model (`lib/models/takes.js`): `list()`, `get()`,
  `find(name)`, `refresh({force})`, `onChange(fn)`. A view lists takes from
  it, never from `/api/jams`; a `TakesList` is made with it (`takes:`), and
  a view draws on its `onChange` while shown (`TakesList.behind()`), its
  own tick then asking the Pi nothing while the model vouches for its list.
- `on(target, type, fn)`, `every(fn, ms)`, `loop(fn)`: a listener, interval or
  ticker step that does nothing while the view is hidden. Every global
  listener, poll and frame loop goes through these, so a hidden view costs no
  CPU and no network.
- `socket(open)`: a connection held only while the view is shown.
  `open()` runs on each wake (after `show()`, with the polls) and answers
  something with a `close()`, called when the view is hidden or destroyed.
  A room's socket to the Pi (`lib/socket.js`'s `connectSocket` or what is
  built on it) goes through it, so a room not shown holds none open.
- `active()`: shown and the document visible.
- `layers`: the view's scope of the shell's one stack of open things
  (below). A menu, sheet, drawer or selection the view opens goes on it with
  its `onClose`, and whatever is still open when the view is hidden is
  closed then, as its slots are taken out.
- `headerSlot`, `dockSlot`, `barSlot`: **Slots**. What a view adds to the
  header, the dock or the bar is in the page only while it is shown: `hide()`
  takes the nodes **out of the document** and `show()` puts them back. So
  `getElementById` on a docked node (`#multi-bar`, `#clip-editor`) answers
  null while the Studio is hidden; code that can run then (a timer) must hold
  the node, not look it up.

All views share one id namespace, since hidden ones stay in the DOM
(`pages.test.js` checks the union). The CSS is global and keyed on the body
class the router sets (`tape-page`, `shelf-page`, `main-page`).

**The router** (`lib/shell/router.js`) routes a same-origin click on a link
whose path is a view, unless a modifier, `target` or `download` says
otherwise; `go()` pushes `{shell, view, scroll}`; a switch hides the old view,
swaps body classes and slots, sets the title, `aria-current` and the help
page, and shows the new one, inside a View Transition when there is one
(*Moving between rooms*, below).
`popstate` switches only when the path names another view, so an entry of
the same room (the stack's own, in Safari) is left to its owner. Before a
switch the router calls `chrome.beforeSwitch` (the stack's `leave()`), which
closes everything open but the phone's player; on a tap it then waits for
the stack's own Back, or writes the room's entry over the stack's, so no
dead entry is left for Back to land on. Each view keeps its own scroll. If `mount` or `show`
throws, the router falls back to a full navigation.

**Moving between rooms** (`lib/shell/router.js`, `css/rooms-motion.css`).
The Studio's desk and the Listening Room's shelves are two walls of one
space, the Studio on the left, as the tabs are (`WALLS`; Capture is on the
Studio's wall). A switch from one wall to the other **turns a camera**: in
a View Transition the old room swings away to one side about a point in
front of the screen, its far edge turning from you, as the new one swings
in from the other, the two meeting at their corner halfway (28° between the
walls, 20° on a phone, the eye at the pivot so they never cross), dimming a
little over the room's own dark; on the lid spring
(`--spring-lid`/`--t-spring-lid`), transform and opacity only, on the
transition's snapshots. Along one wall (Studio and Capture), and every
switch with less motion (read at each switch, so turning it on takes at
once), it is a crossfade over `--t-touch` instead, and what would move on
the desk (the lit tab, a bar of another shape) changes in place.

- **The desk holds still.** While a switch is drawn, `.appbar` and `#np`
  have view-transition names (`appbar`, `np`), so only the room behind them
  turns; what changes on them (the header's left zone, the bar's keys)
  crossfades in place. The names are the only thing this file gives them:
  their layout is their own stylesheets'. (Until the bar has one shape, the
  Listening Room at 1000 px and wider draws it as a dock of its own, so
  there it morphs into the dock rather than holding still: J2.10, a todo
  flow, says when it stops.)
- **Into a take and back: the dolly.** Open is a page of its own, so
  opening a take is a cross-document View Transition. `lib/ui/dolly.js`,
  loaded render-blocking in the head of `shell.html` and `wave.html`, says
  its type on both sides of the move (`pageswap`, `pagereveal`):
  `dolly-in` into Open, `dolly-out` back out (`dollyType`; a take to the
  next take, or a page to the rig or the guide, crossfades). For either,
  `css/rooms-motion.css` names `.appbar` and `#np` so they hold still, and
  the room grows past you and fades as the take's page comes up from a
  little further off (`--t-room`, `--ease-out`), or the reverse. Less
  motion has no page transition at all (the opt-in is under
  `prefers-reduced-motion: no-preference`). Safari 18.0 has no `types`
  there, and crossfades.
- **The router says how to draw it** before `startViewTransition`, on the
  html element, so it works in Safari 18.0 (no transition `types`):
  `data-turn` is `right` or `left` (the way the camera turns, `turnOf`) or
  `fade`. It comes off when the transition has finished. A switch asked for
  while one is drawn (a second tap on a tab, Back) skips that one's turn
  (`skipTransition`).
- **The update only flips.** Inside the transition's update the router
  hides the room left, swaps the body classes and *reveals* the room
  arrived in (`view.js` `reveal`: its root shown and its slots back, as it
  was left; a canvas keeps its picture while hidden). Its own `show()`, its
  title, its loops and its polls (`wake`) run only once the turn is over:
  work on the page while it turns holds up the turn's first frames on a
  tablet.
- **Rooms are mounted before their first switch.** Once the first room is
  up (its mount's `ready`: the Studio's first poll), the router mounts, in
  idle time and out of sight, each room a tab leads to whose view says
  `prewarm: true` (the Listening Room, Capture; not the Studio, whose mount
  takes the bar's transport and output). A prewarmed mount runs with its
  root hidden; what it adds to a slot waits inside that root (in the
  document, so a lookup by id finds it); its listeners, polls and loops are
  as quiet as a hidden view's; then its polls run once, so its data is in,
  and its own `hide()` runs. So such a mount must not touch the room shown:
  no class on `<body>` (a class it adds anyway comes off at once and is
  reported; the view's classes are its `bodyClass`, the doorway's
  `room-on` is `lib/room/mount.js`'s `BODY`), nothing in the header, the
  dock or the bar but through its slots, and nothing to the room shown (a
  saved scroll is restored only by a room that mounts shown, never by one
  warming while the Studio is up). Its first visit is a reveal, still
  `first: true`, but its `hide()` has run before it: so its `show()` puts
  back on every visit what `hide()` put away (Capture's live socket), and
  what it runs outside `ctx` (Capture's ribbon, on its own timer) stops in
  `hide()` and starts in `show()`.
- **A tap lands where it looks, or nowhere.** While a switch is drawn,
  what is on the screen is the turn, and the page under it is the room
  arrived in laid out at rest (before the update has run, still the room
  left). Chromium hit-tests a press, and `elementFromPoint`, to `<html>`
  while a View Transition runs; a mouse's click goes to `<html>` too, and a
  finger's click goes through the overlay (`:root[data-turn]
  ::view-transition` has `pointer-events: none`) to what is laid out under
  it, not to the picture. So a press during a turn ends it at once
  (`skipTransition`), and its click lands only on the desk that holds
  still (`.appbar`, `#np`), on the control the press was on (hit-tested
  once the turn is over), and only once the swap is done; a click on the
  room, or on a key the swap took away, goes nowhere. A tap on ▶ or a tab
  as the camera turns does what it says; a tap on the room only ends the
  turn.
- **The entrance contract.** While a turn into a room plays,
  `html[data-arriving]` names that room (`room`, `studio`, `capture`): set
  before the transition starts, so the room's own entrance (the shelves
  settling, the room showing in full and then falling back to ambient
  light) plays inside the turn, and taken off when it has finished. With
  less motion, along one wall, or without View Transitions it is never
  set. A room's entrance is CSS keyed on it (`html[data-arriving="room"]
  .shelf …`), transform and opacity only, done within `--t-room`.
  `router.test.js` holds the contract.

The flows check it: J2.2 that the camera turns both ways, the header's box
is the same before, on every frame of the turn and after, the bar is never
turned with the room, a tap on ▶ mid-turn stops the take, and a tap on a
take's spine mid-turn plays nothing; J2.10 (todo until the bar has one
shape) that the bar keeps its box too.

**One way to close things** (`lib/ui/layers.js`). Menus, popovers, sheets,
drawers, a selection and the phone's player sit on one stack per document
(`layersOf(document)`: the shell's, handed to each view as a scope; Open,
the rig and the guide have their own). Back and Escape close the top one
first: a menu, then a sheet or a drawer, then the selection, then the
player (`RANK`), the newest first among the same, and nothing under a modal
layer (the player pulled up) before it. Only once nothing is open does Back
leave the room; a press
outside closes a menu; a switch of rooms closes the menus and the room's
own sheets and selection (the player stays up), as a view's hide would. An owner opens with `layers.open({el, kind,
owner, onClose})` and closes with `layer.close()`, so its `onClose` is the
one way out, whoever asked. Where the browser has `CloseWatcher` (Chromium:
Escape, and Android's Back) each layer has one, made in the press that
opened it; elsewhere (Safari) an Escape keydown closes the top layer, and the
stack holds one history entry while anything is open (`historyStep`), so the
iPad's edge swipe closes it too. A modal sheet that is not on the stack
(Rename, Settings, a confirm: a `<dialog>` shown with `showModal`) is over
all of it: with `CloseWatcher` its own is the newest, and in Safari the
stack leaves Escape to the browser and closes the sheet on Back, so neither
lets go of what is under it. Never both for one layer, or Back would
take two presses. A handler that keeps Escape for itself (a field's own, a
drag let go) calls `preventDefault()`, and the stack leaves that press be.
In Chromium the browser's own Back button is a move in the history, not a
close request: it switches rooms, with the menus closed on the way.

**Menus** (`lib/ui/menu.js`). A menu, or a ▾'s panel beside its key, is
`menu(button, panel, {layers, role, side, align, floor, render, focus})`
on that stack: the button says what it opens (`aria-haspopup`,
`aria-expanded`, `aria-controls`), ↑ ↓ Home End move along it, Tab closes it
and goes on from the button, and it closes only through its layer. `place`
is where it goes (pure: below its key or above it, its right or left edge
on the key's, moved in from the screen's sides and kept off the bar at the
foot by `floor`), fixed, so no panel's overflow clips it. It grows from its
key: `data-state` (`open`, `closed`) and `@starting-style` scale it from .96
as it fades in over `--t-touch`, and fade it out over `--t-exit` (eased
in, as anything leaving is), taking no press while it goes. `splitKey(verb, more, panel)` is a key with a ▾ of
its own (KEEP ▾, GRAB ▾). Its rows are `menuItem`s, the one style (☰'s, 48
px, a line under the word), with `menuRows` putting a divider between
groups and anything that destroys last. Several buttons may share one
panel (the Studio's four input chips, one input menu): it shows for one at
a time. ☰ and every menu in the Studio are on it: KEEP ▾, GRAB ▾, Catch ▾
(a key of its own beside Catch), the tape's name, the tempo on the bar's
display, the ruler's ⌗ (the View menu) and a track's input chip; on Open,
the take's name and More. Open's lane menus are still their own
(`OWN_MENUS`).

**Sheets** (`lib/ui/sheet.js`). A sheet or a drawer that comes up from
the foot and follows the finger is `createSheet(el, {layers, kind, modal,
owner, detents, closed, closable, handles, when, onShow, onHide,
onDetent})`, answering `{open({detent}), close(reason), snap(detent),
isOpen, detent, y, destroy()}`. It moves `el` by a transform alone, on the
shared ticker: a drag on one of its `handles` (never on `IGNORE`: a field,
a canvas, what has a drag of its own; up and down only) follows the
finger, past its top it gives (`give`), and let go it settles on the lid
spring (`SPRINGS.lid`) at the detent nearest where the flick would have
coasted to (`settleAt`, on `motion.js`'s `project`), or goes away. It
opens on the page's stack, and its layer is the one way out: a swipe down,
Back, Escape and the owner's `close()` all close the layer, and its
`onClose` slides the sheet out, then calls the owner's `onHide`. A drag up
on a handle while it is put away opens it under the finger; caught on its
way out, it is open again. The click a drag's lift sends is swallowed.
With less motion it doesn't travel: it is there at once and fades in and
out (`T.touch`, `T.exit`). The owner lays it out (`onShow`) and puts it
away (`onHide`); the sheet only moves it. Its first user is the phone's
player (`lib/bar/player.js`, `bar.md`); the notes drawer is the second
(`lib/room/drawer.js`, `rooms.md`, *The notes drawer*), with a half-way
detent.

**A height the CSS reads** (`lib/ui/measure.js`) is measured, never
written into a stylesheet: `measureInto(el, prop, {root, RO})` writes
`el`'s height, as drawn, into the custom property `prop` on the page's
`<html>`, once per change (0 hidden), and answers its disconnect. The bar's
`--np-h` (`measureBar`, `bar.md`) and help mode's tip, `--tip-h`
(`lib/help/help.js`, `take-page.md`), are its; every reader has a `0px`
fallback.

**Recording from this phone** (`lib/phone/recorder.js`). One recorder per
page, `phoneRecorder(doc)`, on the page's `#phone-sheet`: Capture's and the
Studio's ● Phone (`initPhone` wires a room's key to it), the tape's menu's
Record from this phone… (`hindsight:phone`, the sheet), the mini player's
● and ▾ (`lib/bar/phone-key.js`) and the Studio's ● with the tape playing on
this phone (`hindsight:phone-record`) all drive and show the same one. It
answers `open()` (the sheet: the input, its meter, Record), `quick()`
(record now from the input kept, or stop; what can't start opens the
sheet, which says why), `stop()`, `inputs()`, `input()`, `setInput(id)`,
`state()` (`{mode, seconds}`), `onChange(fn)`, `onSaved(fn)`. A key that
shows a recording without starting one (the mini player's ●, the Studio's)
takes it by `onPhoneRecorder(doc, fn)`: now, or as soon as a room makes
it.

**The engine** (`lib/bar/engine.js`), made once by the shell:

| Part | What it is |
|---|---|
| `engine.bar` | The bar's API: `loadTake`, `loadTakeByName(name)` (for the Studio and a reload with no shelf; from the page's takes, `createEngine({takes})`, or a model of its own when a page hands none), `backToTape`, `setSource`, `playing()`, `snapshot()`, `onChange` |
| `engine.audio` | `adopt`, `owns`, `release`, `audioFor`: the take in the bar belongs to the engine, so a shelf row torn down never stops it, and two shelves never hold two elements for one take. Engine media is never in a view's subtree (a removed media element pauses) |
| `engine.transport` | The page's transport (`lib/models/transport.js`; *The transport*, `bar.md`), made with the engine and loaded (`load(id)`) once the Pi has a tape. `ingest({tape, live})` (the Studio's poll feeds it), `delegate({play, stop, locate, setLoop, poll, nudge})` (▶ in the Studio goes through the tape page's transport; the Studio borrows it while it is shown, through `ctx.socket`, and hands it back, `delegate(null)`, on hide, so it polls the tape itself in the other rooms). It holds the page's one `/api/tapes/changes` socket (`lib/tape/changes.js`) from `load(id)` on, whoever has it (*One socket a page*, `push.md`): a new revision polls it, or the Studio while lent. `onPress(fn)` hears each press on the keyboard (see *The keyboard's press*, `push.md`); `onTakes(fn)` each message's `takes_rev`, which the engine hands to the page's takes model (*The takes' revision*, `push.md`) |
| `engine.tape` | The bar's tape source (`lib/bar/tape-source.js`): the transport drawn (the LCD, the display, the overview), `setLevels` (the Studio's reels), and this phone's stream, whose place `pos()` is when it plays here. Null until the Pi has a tape |
| `engine.stream`, `engine.output` | The one `StreamPlayer` and output wiring; `output-ui.js` renders them |
| `engine.feed` | The feed source |
| `engine.np` | The one `NowPlaying`; it sets `#np[data-source]` (`take`, `tape`, `feed`), and `.playing` on ▶ (`#np-play`) while it is heard playing: what ▶ draws (▶, ❚❚ for a take, ■ for the tape) is an icon, so a check reads the class. `lib/bar/player.js` sets `#np[data-size]` (`mini`, `full`) |

**Audio rules the design relies on.** Pushing history or hiding DOM never
touches media or an AudioContext. Autoplay gates are per document with sticky
activation, so after the first tap a later `play()` needs no new gesture. The
AudioContext is made once, on a tap, with `audioSession.type = 'playback'`,
and resumes on `visibilitychange`. Media Session has one owner, the engine.
`connectSocket` (`lib/socket.js`, under `connectLive` and `watchChanges`)
closes its socket on `pagehide` and reopens on `pageshow`, since
an open socket keeps the shell out of the back-forward cache, and a restored
shell applies a carry record rather than dropping it.

The checks that a journey through all this still works are the user flows
(`docs/flows.md`).

## The frame

The header (`css/chrome.css`, the second per-place stylesheet) is one rule
set for every page: the Studio, the Listening Room and Capture
(`shell.html`), Open (`wave.html`), the rig and the guide. It was four
blocks of per-page overrides once, which put Studio | Listening Room top
left in the rooms and top centre on Open and Capture, so a tap where it
usually was landed on the brand.

- **Three zones**, a grid of `minmax(0, 1fr) auto minmax(0, 1fr)`:
  `.appbar-start` (what you're working on: the tape's name in the Studio,
  the search field `#shelf-q` in the Listening Room, ‹ Takes and the take's
  name on Open, the feed's health on Capture), `.appnav` (the switch,
  centred, so it stands at one place on every page of a width; J5.1 checks
  it on the Studio, the Listening Room, Capture and Open) and `.appbar-end`
  (the page's ↶ ↷, then ☰, last). The brand shows only from 1280 px, first
  in the start zone.
- **A room puts its part into a zone as it is shown**: its context through
  the header slot (`lib/shell/boot.js`: the start zone), and the Studio's
  ↶ ↷ (`#header-studio-end`) into the tools before ☰
  (`ctx.headerSlot.add(el, { before: menu })`). Open, the rig and the
  guide have theirs in their markup. `lib/nav.js` `mountHeaderTools` adds ☰
  to the end of the tools zone the page has (and makes one only for a page
  without).
- **Each tab has its own picture**: the Studio's faders (`studio`) with the
  feed's lamp on them, the Listening Room's spines (`shelf`). **☰ means the
  header's menu and nothing else**: the shelf's List key has the `list`
  icon.
- **On a phone** (under 700 px) the header is the context (one pill a
  finger tall), ↶ and ☰ (↷ only while there is something to redo), and the
  switch is the tabs along the bottom, each its picture over its word.
- **What the header no longer holds**: the tempo (the bar's display), where
  the tape plays (the bar's display; `np-output` opens the output sheet,
  as the jam-only sheet's Switch does), and the alignment dot (SYNC on the
  bar's display, `lib/bar/display.js` `syncState`: green to the sample,
  amber by the clocks, red not lined up yet, out while the tape is stopped
  or plays on a phone).
- **A name that is a menu, and no ⋯.** What acts on a thing is in its
  name's menu, on `lib/ui/menu.js`, Delete last and red after a line of its
  own; never in a ⋯ beside it, which once split the tape's actions from its
  list of tapes, a third menu beside ☰.
  - In the Studio the tape's name (`#tape-name`) opens the tape's menu
    (`lib/tape/page.js` `renderTapeMenu`; its words, `lib/tape/tape-menu.js`):
    *The tapes*, each with its tempo and parts and the loaded one ticked,
    and New tape; Rename…, Duplicate; Download the mix and Share the mix…
    (Share only where the browser can share files, after Download with a
    mouse and before it on a touch screen: `orderExportKeys`,
    `lib/wave/share.js`), Bounce the loop, Bounce the whole tape, Export
    stems and Play the last bounce
    (`lib/rooms/bounce.js`); Record from this phone…; and Delete this
    tape…. Delete asks in `#confirm` (never the browser's prompt) by the
    tape's name and what is on it, then, the Pi keeping the tape it has
    loaded, loads the most recently changed other tape (or a new empty one)
    and deletes this one by its id. The menu reaches over the bar, as tall
    as its rows: a tablet's height above the bar can't hold them.
  - ⋯'s options went to ⌗ beside the ruler, the View menu on every screen:
    the snap, Lock the loop, Fit, Fold the tracks (`#tracks-fold-btn`, the
    one fold for the lanes) and, on a touch screen, Ask before Insert and
    Delete time. The key says the snap and shows the lock; Fit stands
    beside it too while the view is moved (in the menu alone on a phone).
  - On Open the take's name (`#take-name`, a pill with ▾) opens the take's
    menu: Rename… (the name becomes its field), Previous take and Next
    take, each with the take it opens by its spine's name, the downloads,
    Reset the downbeat, under 860 px its MIDI and under 1000 px its tag (no
    room beside the star), and Delete this take last. Its tempo, length and
    source are the line under the header (`.take-sub`), not in it.

## Waking up

A tablet that sleeps freezes its page, and a request or socket that was in
flight is often neither answered nor failed: it never comes back. Every page
therefore gives its reads a deadline and checks its link on waking
(`lib/link.js`, node-tested):

- **Reads time out.** `timedFetch` aborts a request that isn't answered
  (8 s; the Studio's tape poll, which runs five times a second, gives up after
  4 s). The Studio's poll used to run only when the last one had finished,
  so one lost poll stopped them all, and the page showed the tape as it was
  when the tablet went to sleep. Now `lib/tape/poll-gate.js` lets a poll
  forced on waking go ahead of one that may be lost, and drops the lost
  one's answer if it ever arrives.
- **A dead socket is noticed.** Nothing tells a page that its socket died
  in its sleep, so `lib/socket.js` (`connectSocket`, which `/api/live`'s
  client, `lib/live.js`, and `/api/tapes/changes`'s, `lib/tape/changes.js`,
  both use) treats 4 s without a message as dead and replaces it, waiting
  0.5 s after a failure and up to 5 s after repeated ones. `/api/live`'s
  frames come ~100 times a second; `/api/tapes/changes` beats once a second
  for this, since its pings are answered by the browser below JavaScript,
  where the page can't see them.
- **Waking is an event.** `onResume` fires when the page is visible again,
  shown again (`pageshow`, bfcache or not), online again, or when a one-second
  tick arrives more than 3.5 s late (the clock jumped; timers were frozen,
  whatever events fired). The page then refetches at once: the Studio its
  tape state and clipboard, Capture its status, takes and meters, the
  Listening Room its list, the take page the take (merged as after any return to
  the page, so an edit still being saved, or a selection not yet saved, is
  kept).
- **The note.** A source that fails (`link.fail('tape')`) and doesn't recover
  within a second shows *Reconnecting…* (`.link-note`) and clears when every
  source answers; a failure that clears first is never shown.

Service-worker registration and the screen wake lock are both guarded on
`window.isSecureContext`, so they switch themselves on if the Pi is ever given
an HTTPS name and stay quiet otherwise.
