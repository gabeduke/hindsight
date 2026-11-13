# The bar

The bar (`#np`, `css/bar.css`) is the one transport, the same
object in both rooms and the same shape on Open (`wave.html`), so **▶ never
moves**: not between rooms, nor between the tape, a take and the feed
(J1.13 measures it at 800, 1024 and 1280 and fails past 2 px, or on a
sideways scroll).

- **Five zones in a row, and the strip under them**, each a named slot in
  the markup (`data-slot`; `lib/bar/slots.js` `SLOTS`): the **deck** (the
  reels and the display), the **transport** (|◀ ▶ ●, and ●'s ▾ for the
  tape in the Studio, which Catch is on; ↺ 5 s in ●'s place for a take,
  the feed, or the tape away from the Studio), the **verb** (GRAB for the
  feed), the **modes** (⟲ Loop or Repeat) and the **end** (⏏, Open ›, ✎
  for a take), laid out first so nothing pushes it off. Catch's own key and
  the metronome left the bar in the calm Studio's step 7a (Gabe's calls,
  2026-11-13): Catch is on ●'s ▾, the metronome the Click in the tempo's
  panel. Every key
  is in the markup, in its slot (in the rooms, the Transport's template:
  *The Transport*, below); a script that adds to the bar puts it in a slot
  by name (`putIn(root, name, node)`, inside the bar's root), never after
  whatever was appended last.
- **What shows is said positively.** Each key lists in `data-for` the
  sources it is for (`tape`, `studio` = the tape in the Studio, `away` = the
  tape anywhere else, `take`, `feed`) and in `data-mini` those it stays for
  in the phone's mini player; one rule in `css/bar.css` shows each source's
  keys, and a key's `display` is set nowhere else. Which room it is in is
  the bar's own root's, `#np[data-room]` (`studio`, `room`, `capture`: the
  router's `shown()`, set as the shell switches rooms, in the same step as the body classes), never the page's body class. No `:not()` lists and no
  `!important` (`shape.test.js`). A key a script hides by `hidden` (⏏ with
  no tape) stays hidden.
- **Every id inside the shell's `#np` is `np-<name>`**, `cx.id(name)`'s
  (`components.md`, *The contract*): the Transport's template writes no
  id, but names each part by `data-part`, and `fill()` gives it its id
  (`#np-position`, the display's big line; `#np-rec`, `#np-rec-more` and
  `#np-rec-menu`, `tape-keys.js`'s; `#np-clock-out`
  and `#np-out-strip` with its `-led`, `-text`, `-right` and `-resume`,
  from `tape-status.js`). Guardrail 20 fails on an id in the template,
  and on the shell's `#np` holding anything but the empty root. Open's own `#np` (`wave.html`) keeps its ids
  until Open's pass: its `#position` is `lib/wave/page.js`'s. The
  overview, `#np-tape-overview`, is not in `#np`'s markup at all: it is
  the Studio's (*The Studio's part of the bar*, below).
- **Its widths are its own**: a container query on its first row
  (`.np-row-1`, never `.np` or the dock, whose fixed descendants a container
  would hold). The deck's width hangs on the row's width alone
  (`--deck-w`, from `100cqi`), so ▶ stands at one x whatever the bar
  holds: from 600 px the zones are one row (the reels go under 960), from
  960 the deck is 352 at 1024 and grows to 768, and from 1180 the display
  says everything in full. The verb and the modes are as wide as what they
  hold, so in the Studio ⟲ follows ●'s ▾. Under 600 (the phone's player
  pulled up) the zones stack. The phone's mini player is
  `data-size="mini"`: its window, |◀ ▶ ● ▾, and a tail one width for every
  source (empty for the tape; in the Studio it gives up the 22 px ●'s ▾ is
  wider than the phone's, so ▶ stands at one x). Under 480 px its window
  is the display alone, without its reels.
- **A key of the mini player alone** says only `data-mini`: the phone's ●
  (`#np-phone-rec`) and its ▾ (`#np-phone-more`), for a take, the feed and
  the tape away from the Studio. **One ▾ beside ●, never two**: in the
  Studio with the tape, the mini player's ● is the tape's own (`#np-rec`,
  `data-mini="studio"`) and its ▾ is ●'s (`#np-rec-more`), whose menu on a
  phone is Catch's rows, a line (`role="separator"`, a child of
  `#np-rec-menu`), then the phone's (`phoneKey`'s `rows(panel)`: what ●
  does now, the inputs, the level and input). A tap on ● records the jam
  room, a hold (`ARM_PRESS`, as a track's ●) opens that menu (`phoneKey`'s
  `offer(host)`; with the player pulled up, the recorder's sheet), and with
  the tape playing on this phone a tap records here (the recorder's
  `quick()`). While this phone records, wherever it was started, that ● is
  pressed, says so, and a tap stops it (*The Studio's keys*, below). The
  phone's own ▾'s menu (`lib/components/transport/phone-key.js`,
  `#np-phone-menu`, over the mini player) says what ● does now, lists the
  phone's inputs and opens the recorder's sheet with its meter. All are the
  page's one recorder's (`shell.md`, *Recording from this phone*).
- **The foot** (`data-slot="foot"`, `#np-out-foot`) is where it plays, at the
  foot of the phone's player pulled up, under the thumb; the display's OUT
  is hidden there. Both open the shell's Output sheet (`NowPlaying`'s
  `output()`, the shell's `openOutput`: `lib/tape/out-switch.js`
  `outputSheet(engine)`, which does nothing until the engine has a tape,
  and the first time wires the sheet (`wireOutput`) and marks the mode and
  the delay at once, then on every transport change); they are keys only
  once the engine has a tape, the same test. `paintDisplay` writes both.
- **Its height is measured** by the page around it (`measureBar` on the
  bar's root, called by the shell's boot and by Open, on
  `lib/ui/measure.js`'s `measureInto`: one `ResizeObserver` writing
  `--np-h` on `<html>`), never written into the CSS; every reader has its
  `0px` fallback.
- **The display says what plays** (`lib/bar/display.js`): where it is, then
  three keys on the LCD, each a value over its legend: the tempo (in the
  Studio, with the tape, the tempo's panel, `renderTempo`: a dialog with
  the tempo to type, −1 and +1, TAP (`tappedBpm`, `SLOWEST_BEAT_MS` in
  `lib/tape/geometry.js`), the Click under them (the metronome, *The
  Studio's keys*) and the grid's bars counted half or twice;
  elsewhere a readout), the source
  (TAPE, FEED or the take's name; `source-menu.js`: the tape, the live
  feed, the last few takes, Go to the shelf) and where it plays (JAM ROOM,
  PHONE, BOTH for the tape; THIS TABLET, THIS PHONE or THIS COMPUTER for a
  take or the feed; the output sheet). Each value has a short form and a
  long one, for the widest bar.
- **A take's counter** (`lib/models/take-source.js` `takeBar`, drawn by
  `lib/objects/lcd.js` `takeCounter`) is BAR and beat by the take's own
  tempo, counted from its own downbeat; with no tempo, and before the
  downbeat, it is the take's time. Before the downbeat it once counted up
  from below zero (*BAR -1.4*, on a take whose downbeat was set a few
  seconds in).
- **In the Studio, the tape** (`lib/models/engine.js` `tapeUnlessPlaying`):
  in the Studio the bar gives a take or the feed back to the tape when it
  isn't playing, so ▶ there plays the tape. That is checked as the Studio
  is shown (`lib/shell/views/studio.js` `show`, every visit), as the
  hand-off from the last page settles, and as ▶ stops what the bar holds
  (`NowPlaying`'s ▶, through the engine's `tapeUnlessPlaying`). A take still playing when you change rooms
  stays, and plays on (J2.2). A take that stops by itself in the Studio
  (its end, its selection's Out, Play all moving on to the next) is left be
  until the Studio is shown again, so Play all carries on there. Gabe's ▶
  on his Mac once played a take left in the bar from the Listening Room,
  and the tape, never moving, had no playhead (J1.17). **Decided on Gabe's
  behalf on 2026-10-30, while he was away; his to overrule** (the other
  way: a take stays in the Studio's bar until ⏏, as before, with ▶
  playing it).
- **It folds by its grabber** (`lib/components/transport/fold.js`), a pill on a lip above its
  top edge: a tap toggles, a drag down folds, a drag up unfolds, and it
  slides by a FLIP on the lid spring (a transform, never a height a frame).
  Folded it is one row of 44 px keys, `body.np-fold`, kept for the visit. On
  a phone the grabber is the player's, and puts it away. ▾ only ever opens
  a menu. The fold, the player up and what is docked above the bar are the
  page's bar layout (`lib/bar/layout.js` `barLayout(doc, {root,
  storage})`: `folded`, `open`, `docked`, `set({folded, open, docked})`,
  `sync()`, `snapshot()`, `onChange(fn)`, `fn(after, before)`), the one
  place that writes `body.np-fold` and `body.player-open`, and that keeps
  the fold for the visit (`storage`, the page's `sessionStorage`: read once
  as it is made, so a page reloaded folded opens folded; `fold.js` keeps
  nothing). The shell makes it and hands it to the bar and to every view
  (`ctx.barLayout`), where the Studio hears a fold to draw its lanes again.
  The router keeps `np-fold` with its room, so the body is where it is
  kept. **The bar's root says the same on itself** (step 5c):
  `data-fold`, `data-open` and `data-docked`, each there while it is so,
  written by `set()` and by `sync()`, which the shell calls from the
  router's `chrome.classesGiven`, the moment a room has been given its
  body classes and before it is revealed, so the root never paints a frame
  apart from the body (not in `setPath`, which runs after the room's
  reveal is awaited). `docked` is said by the dock's slot (`ctx.dockSlot.show`,
  `shell.md`): the Studio's clip editor or action bar, or Capture's
  drawer, showing above the bar. Open's root says `data-open` too, through
  `player.js`'s layout. `css/bar.css` reads them (step 5d): its fold,
  player and docked rules key on `.np[data-fold]`, `.np[data-open]` and
  `.np[data-docked]`, never on `<body>`. On a switch, `data-docked` can read false for a moment
  between the room left taking its docked parts out and the room arriving
  putting its own back (both inside the turn's update, before it is
  drawn): a rule on it must not animate that blink.
- **The page around the bar is the page's.** What a page does about the bar
  is `styles.css`'s, not `css/bar.css`'s: `--dock-b` and the padding and
  toasts that keep clear of the bar on a phone, the player pulled up
  holding the page still, covering the tabs and being the sheet (fixed
  over the page: `#np-dock` in the rooms, Open's `#np` itself, which has
  no dock), select mode hiding the bar, the Studio's `#np-dock` and its
  tempo menu (`.tempo-menu`), and a pressed key's colour (`.kb-lit`, which
  lights a track's head too). `css/bar.css` draws the bar: the
  Transport's stylesheet, so it keeps Guardrail 15's stylesheet half
  (`components.md`): every selector starts at `.np` and goes into it, its
  menus' panels' too, and no other stylesheet names a class only it styles
  (the output strip's look, `.np .out-strip`, is the bar's, beside the
  Output sheet's `.out-banner` in `styles.css`, on one token,
  `--well-sh`). Its five viewport
  `@media` blocks stay (D1): a container query can't ask a height, an
  orientation or a preference, nor style the root itself.
- **Its menus are inside it** (step 5e): ●'s ▾ (`#np-rec-menu`,
  `lib/components/transport/tape-keys.js`), the source's (`#np-source-menu`,
  `lib/components/transport/source-menu.js`) and the phone's (`#np-phone-menu`,
  `lib/components/transport/phone-key.js`) are the last children of `#np`, and open in the
  top layer (`menu()`'s `popover`, `shell.md`, *Menus*): over the page and
  the phone's player pulled up with no z-index of their own, where `.np`'s
  z-index 18 would cover them and its transform, as it folds, would move
  their fixed place. `architecture.test.js`, *the bar's menus are inside
  #np, and open in the top layer*.
- **✎ is the page's** (`lib/components/transport/take-keys.js`, `engine.setOnNote`): the
  shell's notes drawer (`rooms.md`, *The notes drawer*) takes the frame
  being heard (`frameNow`); a page without one opens the take on its own
  page (`noteHere`, `lib/models/engine.js`). The drawer sends the bar to a note's time with the
  engine's `seekTake(name, frame, {play})`, which loads the take if the bar
  holds another and puts it back in the bar over the feed or the tape;
  false when it can't be loaded (still saving).
- **On a phone the player is a sheet you drag** (`lib/bar/player.js` on
  `lib/ui/sheet.js`; `shell.md`, *Sheets*). The sheet is the surface's
  (D5): `playerSheet(el, {root, layers, layout, phone})`, made by the
  shell's boot over `#np-dock` (the bar and its drawers) and by Open over
  its bar, stills the page under it (`inert` on the body's other children),
  says the player up through the layout and closes as the bar empties or
  the screen grows past a phone; it answers `{open(), close(), grab(e),
  isOpen, lend(keys)}`, and gives the lent key the focus back as it is
  put away (unless the bar emptied or the focus went on to a menu or a
  dialog). The keys are the bar's: `playerKeys(root, {player, layout,
  phone, on, btn, grabber, handles})` opens and puts it away from ▣ and
  the grabber, hands the grabber's and the window's pointerdown to
  `grab(e)` (the sheet hears the rest of that drag on the handle), keeps
  `data-size` (`mini` or `full`), hearing `phone` change through `on`
  (`cx.on`), and lends `{owner, shown(), hidden()}`: ▣, the key the focus
  goes back to, and what the bar does as the player is laid out and put
  away; it never reads the document. `initPlayer({btn, grabber, layers,
  layout, phone, on})` is both, for Open, which hands it its parts and what
  is the page's. A tap on the mini player's
  window, or a drag up from it, pulls it up from where the mini player
  stood, so the mini player grows into the full one; a swipe down on its
  grabber or its art (the reels and the display), a tap on the grabber,
  Back or Escape puts it away, back down to the mini player. Held upright
  (under 700 px) it is laid out on the bar itself (`.np-row-1` and
  `.np-zones` are `display: contents` there): the reels and the display as
  its art at the top, the strip, a space, then the transport, the verb and
  the modes in the thumb's reach, and the foot. On its side it keeps the
  stacked zones. The bar's menus (●'s, the tempo's, the source's) open
  over it (`css/bar.css`): the source's once opened under it, where no tap
  reached it. Its transport row is |◀ ▶ ● and ●'s ▾, a ▾'s width (56).
- **The flows hold the phone's bar to its shape** (`scripts/flows/layout.mjs`,
  `bar-*`; `docs/flows.md`, *Layout checks*), on every screen where it
  shows: the mini player one row, its full width, no key over another, a
  window a finger wide, ▶ at one x for every source; the player pulled up
  with every key on the screen and |◀ ▶ ● on one row.

## The Transport

The bar in the rooms is a component on the contract (`components.md`):
`lib/components/transport/index.js`, `{ id: 'transport', root: 'np',
needs, css: 'css/bar.css', mount }`, mounted once by the shell's boot on
`#np` in its shell scope (`mountComponent(transport, npRoot, models,
shell.ctx, props)`; `shell.md`, *The shell scope*). `shell.html`'s `#np`
is its root and nothing else, `<section id="np" class="np"
aria-label="Now playing" data-size="full" hidden></section>`, so
`body:has(.np)` lays the page out around it from the first frame.

| `index.js` exports | |
|---|---|
| `TEMPLATE` | the bar's markup: its zones, keys and menus, each part named by `data-part`, its icons `icon()`'s; no id, and no `aria-haspopup` (Guardrails 15, 20 and 13) |
| `fill(root, id)` | the template drawn into `root`, each part's id `id(part)` (the mount's `cx.id`; by default the root's id and the part), the grabber's `aria-controls` the root, and OUT and the foot's OUT `dialogKey`s. The tests fill a bar the same way |
| `TAPE_KEYS` | what the Studio presses of ● and its ▾ (Catch): `lend`, `draw`, `press`, `catch`, `closeMenu`, `focusPlay`, `tempo` |
| default | the component. Its mount fills the root, puts help's titles on it (`props.titles`), makes `NowPlaying(root, models, cx)`, provides its `tapeKeys` to `props.tapeKeys` and hears `props.onRoom`; its `unmount` takes those back and `NowPlaying.destroy()`s (its models' subscriptions, its strip's observer, the keyboard note's timer) |

Its models (`needs`) are `bar` (the engine's: what plays, its
`snapshot()` and verbs, and `tapeSource` and `stream`, the engine's tape
and this device's stream of it, since it is handed the bar and not the
engine), `transport` (the engine's: a press on the keyboard), `tape` (the
page's: the Studio's keys, the lamp, SYNC and the strip), `takes` (the
page's: the source menu's last few) and `recorder` (the page's phone
recorder, made at boot). Its props, the surface's: `layout` (the shell's
`barLayout`), `player` (the phone's player sheet), `output()` (the
Output sheet), `room()` (the room the router shows: the tempo opens its
menu in the Studio), `onRoom(fn)` (fn as the router shows another
room, from its `chrome.setPath`), `titles(root)` (help's `applyTitles`,
which the mount runs on the filled template before `NowPlaying` moves any
key's tip, so a key's hover title is its template's, as it was from
`shell.html`'s markup: ⟲ says the tape's *Loop the bracket…*), and `tapeKeys`, a relay
(`lib/components/relay.js` `relay(names)`, `{api, provide(impl)}`) the
Transport provides its keys to and the shell hands the views as
`ctx.tapeKeys` (its `api`): the contract's own *a callback the surface
passed in*, so `mountComponent` answers nothing new (decision D4).

`NowPlaying` finds every part inside its root by name (`lib/bar/slots.js`
`partOf(root)('play')` is `#np-play`) and reaches past it only through
`cx`: `on` (the window's J, the document's visibility, a screen query's
change), `media(query)` (the phone, the finger, less motion, the scheme:
`slots.js` `PHONE`, `COARSE`, `fold.js` `REDUCED`, `theme.js` `SCHEME`),
`layers` (its menus, and `covered()` for J), `floor`, `visible()` (in
place of `document.hidden`) and `toast`. It hands its modules the same:
`initFold(root, {layout, phone, reduced})`, `takeKeys({root, …})`,
`phoneKey({root, layers, floor, …})`, `tapeKeys({root, phoneKeys,
phoneScreen, …})` (`phoneKeys` is `phoneKey`'s answer),
`sourceMenu({button, panel, layers, …})`, `barPressNote(root)`,
`playerKeys(root, {phone, on, …})` and `deviceOf(cx.media)`.

Its modules are its directory's: `bar.js` (`NowPlaying`), `fold.js`,
`phone-key.js`, `source-menu.js`, `tape-keys.js`, `take-keys.js`,
`press-note.js` (the keyboard's note over the display) and
`tape-status.js`, with their tests (`lib/components/transport/*.test.js`,
in CI's list). What it shares with Open stays in `lib/bar/`, imported by
both and never copied (decision D3): `slots.js`, `player.js`,
`display.js`, `carry.js` and `press-light.js` (`lightFor`, which lights
▶ or ● for a press, and `lightTrackHead`, the Studio's); `handoff.js` is
the engine's and `layout.js` the surface's. Guardrail 15 runs over the
directory with no exceptions, and *Step 5f* (`architecture.test.js`) over
it and the shared modules with what its regexes don't see besides: a
`doc`, a `getElementById`, a `matchMedia`, the page's storage,
`innerHeight`, `devicePixelRatio`.

The harness checks it alone (`node scripts/components.mjs transport`;
`scripts/components/transport.check.mjs`), at every size and in both
schemes, on the fixtures' bar, transport, tape, takes and recorder, with
the shell's props made in the page by its surface module
(`transport.surface.js`): the tape held, the mini player on a phone and
the full bar wider, the room on its root, ● and its ▾ in the Studio
alone and no Catch key, the source's menu in the top layer, OUT to the
surface. It never presses ▶.

**Open keeps its own bar** until Open's pass: `wave.html`'s `#np`, its
own markup and ids (`#position`, `#play`), drawn by `lib/wave/page.js`
on the shared modules and styled by the same `css/bar.css` (the same
root class). A key Open shows goes in both.

## The Studio's keys

● and its ▾ are the bar's keys for the tape in the Studio
(`lib/components/transport/tape-keys.js` `tapeKeys`, made by `NowPlaying`
with the page's tape model, `tape`, and the mini player's own keys,
`phoneKeys`). Catch is on the ▾ (the calm Studio's step 7a, Gabe's call:
the capture verbs on the bar are GRAB, KEEP and ●): ● and its ▾ are a
`splitKey` (`lib/ui/menu.js`), as GRAB's and KEEP's are, and its menu,
`#np-rec-menu`, is `catchRows({says, armed})` (pure): a head saying where
a catch lands (*Catch onto track 2*, or *Catch: no track is armed*), then
The last pass and The last 1, 2 and 4 bars; a row that can't go is
`aria-disabled="true"` with its reason under it, and a tap on it says why
and leaves the menu open. Pointing at The last pass with a mouse, or the
keyboard on it, outlines its pass on the lanes (`hover`), until the menu
shuts (`menu()`'s `onClose`). Open, it follows the tape: as `draw()` runs
(the tape's answers, the recorder's, the Studio's armed tracks), the menu
is filled again when Catch's rows have changed (a pass gone round lets The
last pass go, another track armed renames the head), by `menu()`'s
`refresh()`, which keeps the keyboard on its row, the same path the
phone's rows take as the recorder changes. On a phone (`phoneScreen`) the
menu has a line and then the phone's rows after Catch's
(`phoneKeys.rows(panel)`), and each time it opens, by the ▾, the keyboard
or a hold, its `onOpen` says so (`phoneKeys.opened(menu)`, which asks for
the inputs); a hold on ● opens it (`phoneKeys.offer(menu)`). ●'s press is bound before the split
key, which leaves alone the click a hold's lift sends (`splitKey`). The
shell hands every view a relay of them as `ctx.tapeKeys` (`TAPE_KEYS`,
below), which the Transport provides them to as it mounts (*The
Transport*). They are drawn from the tape's `snapshot()` (`{tape, live}`:
what records, the count-in, the alignment, a mixdown, where it plays, the
passes) and the phone recorder's (`{mode, seconds}`), as either changes and
as the Studio asks, and a press is one of the tape's verbs: `record(body)`,
`punchOut()`, `catch(body)` (`tape.md`, *The tape model*), then
`refresh()`. `faces({snap, phone, armed, inputOf})` is what ● says, pure:
its label, pressed, armed, counting, disabled and dim, and `says`
(`catchState`'s), which C and the menu read.

**The click is the Studio's** (step 7a): the Click switch in the tempo's
panel (`#tempo-click`, `aria-pressed`, disabled without a grid;
`lib/tape/page.js` `renderTempo`) and M press `toggleClick()`, the tape's
`setClick(on)` through `editTape`, and `paintClick()` draws the switch from
the tape as the Studio renders. The bar has no key for it.

What is the Studio's own reaches them only as the hands it lends, the one
interface between them (`lib/tape/page.js` `studioHands`, lent as it wires
up, taken back on destroy):

| `tapeKeys` answers | |
|---|---|
| `lend(hands)` → off | the Studio's hands, until `off()`; the keys are drawn and pressed only while some are lent |
| `draw()` | the keys again: the armed tracks or their inputs changed (the Studio's render) |
| `press(name)` | `'rec'`, as a tap on ● (R), or `'catch'`, C: the last pass, or, while it waits, why, with *Last 4 bars* on offer; nothing while ● is disabled |
| `catch(what)` | Catch `{pass}`, `{bars}` or `{out}`: ●'s menu's, and the Studio's passes and last-bars keys |
| `closeMenu()` | ●'s menu shut (the Studio's `closeMenus`) |
| `focusPlay()` | the keyboard's focus to ▶ (the Studio's, as the clip editor it was in goes) |
| `tempo(fn)` | `fn(key)` with the display's tempo key, on which the Studio wires its tempo menu; answers what `fn` made, or null on a bar without the key |

| `hands` | |
|---|---|
| `layers` | the scope ●'s menu opens on (the Studio's, so a switch of rooms closes it) |
| `armed()`, `inputOf(n)` | the armed tracks as the Studio shows them, and what each records from |
| `playsHere()` | the tape plays on this phone: ● records from this phone |
| `body(what)` | a record's or a catch's body (`recordBody`, replace or overdub), or null when the Studio refused it and said why (the jam-only sheet, *arm a track*) |
| `said(verb, answer, {before, what, body})` | the words for `record`'s, `punchOut`'s or `catch`'s answer, with the Studio's Undo or Cancel |
| `hover(on)` | The last pass pointed at, or the keyboard on it: its outline on the record track's lane |
| `ghost()` | a locate the Studio sent that this phone has not heard yet (`{pos, until}`), or null: the output strip says where it is moving to (`tapeKeys.ghost()` answers it, null with no hands lent) |

The bar says the rest itself: why C can't catch yet (with *Last 4 bars*),
why a row of ●'s menu can't go, and *Could not record* or *Could not
catch*. Guardrail 19 fails on `lib/tape/page.js` or `lib/rooms/studio.js`
looking up `#np-rec`, `#np-rec-more` or `#np-rec-menu` by the usual
spellings (`$('np-rec')`, `getElementById`, a
`querySelector` on `#np-rec`): a guard against the old wiring coming back,
not a proof; an id held in a variable, or another module of the Studio's,
gets past it.

The rest of what the Studio and the Listening Room do to the bar is a verb
or a callback too (step 5c): ▶ and Space are the engine's `playPause()`,
L is `setLoop()` (both nothing while the key is unlit), OUT and the
jam-only sheet's *Switch* are `ctx.openOutput()`, SYNC is the bar's
(*The lamp and the output strip*, below), the doorway's grease goes at the
end of the strip through `ctx.barSlot` (`{ place: 'strip', at: 'end' }`)
and takes the strip's box, the doorway reads the bar by the engine's
`snapshot()`, and ▶'s `data-gives-enter` is what tells the buffer's ↵
(`lib/buffer/keys.js`) that ▶ never keeps it. Guardrail 22 fails on
`lib/tape/page.js`, `lib/rooms/studio.js`, `lib/shell/views/studio.js`,
`lib/room/deck.js`, `lib/room/doorway.js` or `lib/buffer/keys.js` looking
up any id inside the shell's `#np` (by `$`, `getElementById`, a selector
naming `#id`, or `press('id')`), and on ▶ without `data-gives-enter`.

## The Studio's part of the bar

The overview (`#np-tape-overview`, the whole tape: tap to move the
playhead, drag its box to move what the lanes show) is the Studio's
drawing, not the bar's. Its markup is the Studio's, at the end of
`#view-studio` in `shell.html`; the Studio's view
(`lib/shell/views/studio.js`) puts it at the start of the bar's strip
through its slot, `ctx.barSlot.add(overview, { place: 'strip' })`, and
hands it to its page, `mountTapePage(ctx, { overview })`, which holds it
for its render, its keys and its size observer. The strip
(`[data-slot="strip"]`, `.np-row-2`) is a place the shell names in the bar
slot (`lib/shell/boot.js`, `slots.bar.places`): the bar's markup keeps it,
with the bar's own scrubber (`#np-scrub`) in it, and the overview is in it
only while the Studio is shown, so a look-up by its id answers null in
another room. It still shows only for the tape in the Studio
(`data-for="studio"`). Guardrail 21 fails on `#np`'s markup carrying it, on
`lib/tape/page.js` looking it up, or on the Studio putting it anywhere but
the strip.

## The lamp and the output strip

The clock-out lamp (`#np-clock-out`, who follows the tape's clock with
`TAPE_CLOCK=lead`), SYNC (`#np-sync`, how playback and recording line up:
`display.js` `syncState`, from `live.aligned`, out while the tape is
stopped or plays on a phone; a key for the Studio, `data-for="studio"`)
and the output strip across the bar's top
(`#np-out-strip…`, while the tape plays on this phone) are the bar's, in
every room, not the Studio's: `NowPlaying.paintTape()` draws them from the
models as the tape answers (`tape.onChange`), as the transport changes (the
stream's state among it) and as the engine's bar does. Their words are
`lib/components/transport/tape-status.js`'s, pure:

| `tape-status.js` | |
|---|---|
| `outStrip({stream, live, tape, ghost, now})` | `{hidden: true}` unless the tape plays on this device (`engine.stream` active, `live.output_mode` not `jam`), else `{hidden: false, resume, led, text, right}`: how it is going (starting, lost and where, locked, moving to a bar, playing, ready), how far behind, and whether its *Tap to play here* shows |
| `clockLamp(clock, tape)` | `{hidden: true}` with no `live.clock`, else `{hidden: false, text, none}`: who follows it, ● while it runs, the tempo it hears; `none` with no device plugged in |

`live` and `tape` are the page's tape model's `snapshot()`, `stream` the
engine's, and `ghost` the Studio's, through the hands it lends the bar
(`ghost()`, *The Studio's keys*), so only a locate sent while the Studio
is shown says *Moving to bar …*. The strip's *Tap to play here* is
`engine.stream.resume()`. The Studio keeps its own banner (another device
has the tape) and the output sheet's state (`lib/tape/output-ui.js`
`initOutput`).

## The engine

What the bar holds and plays is the page's engine
(`lib/models/engine.js` `createEngine`), made once by the shell
(`lib/shell/boot.js`, `ctx.engine`; `shell.md`, *The engine*). It holds the
sources, `lib/models/tape-source.js` (the transport drawn, and this
phone's stream), `feed-source.js` (the live ring) and `take-source.js` (a
take, played by its list row's player), which one is in the bar, the take's
Audio (the engine makes and adopts it: no view constructs the bar's audio),
⏏, where the tape plays (`output.setMode`) and the take carried across
pages (`carry.js`, `handoff.js`). Its `bar` is what a page drives it with:
`snapshot(here)`, what the bar draws, and `onChange(fn)`, which calls fn()
as what the bar holds changes and every frame while it plays, on the shared
ticker, where the source's playhead steps (`tick()`); `paintStrip(ctx, w,
h, colors, dpr)`, the strip's picture of what it holds (the tape's
overview, a take's trace, the feed's ring); `src`, the source itself, for
the tests and the hand-off; and the verbs
`setSource(kind)` (`tape`, `feed` or `take`), `loadTake(t, player)`,
`loadTakeByName(name)`, `seekTake(name, frame, {play})`, `eject()` (⏏,
by hand: the tape stays until a take is picked by hand), `backToTape()`,
`tapeUnlessPlaying()`, `pickSource(id)` (the source menu's), `note()` (✎),
`grabFeed()` (the feed's GRAB) and `touch()` (a use of the bar's keys,
counted in `touches`). The bar's own keys are verbs too: `playPause()` (▶:
the source's own say first, the tape's sound waiting for a tap; a stop by
▶ is `tapeUnlessPlaying()`), `toStart()` (|◂), `back5()` (↺ 5 s and J, of
what this device hears), `setLoop(on)` (⟲), each a touch (▶ and ⟲ do
nothing while unlit: `canPlay` false and not playing or waiting, `canLoop`
false, whoever presses them), and the strip's
`seekFraction(f)` (a tap, a drag, Home), `toEnd()` (End) and `step(n)`
(← →), which are not (the bar counts the strip's touch itself).

| `snapshot(here)` | frozen, cached on `v`: a cache key bumped on every emit and every kick, not only when something it carries changes |
|---|---|
| `id` | which source: a new number each time the bar holds another |
| `kind`, `title`, `href` | `tape`, `feed` or `take` (null with nothing), its name, its own page (Open ›) |
| `playing`, `waiting` | it plays; it plays on the Pi but isn't heard here yet (▶ is the tap) |
| `frame`, `length`, `sampleRate`, `frac` | where it is, in frames |
| `pos`, `lcd` | the display's big line, and the LCD (`{big, small, note, status, unit}`) |
| `display` | the display's keys for `here`, this device's word (`slots.js` `hereWord`); null with no `here` |
| `loop`, `canPlay`, `canLoop`, `canStart`, `canEject` | ⟲ on, and whether ▶, ⟲, \|◂ and ⏏ have something to do |
| `startLabel` | what \|◂ goes back to |
| `levels` | the reels' levels (`{colors, at(frame)}`), or null |

The engine is drawn by the Transport (*The Transport*, below), whose
mount is `NowPlaying` (`lib/components/transport/bar.js`). It draws the
engine's `snapshot()` on `#np` from its `onChange` (and the strip through
`paintStrip`, on a canvas sized by `lib/ui/canvas.js` `sizeCanvas`), sets
`#np[data-source]`, `#np[data-room]` and ⏏'s `hidden` (`canEject`), and
hands each press to the engine's verbs. It holds no source. Guardrail 18
fails on a module other than the engine that makes a source, on audio
made for the bar under `lib/bar/`, `lib/room/`, `lib/shell/` or
`lib/components/`, on a `NowPlaying` made anywhere but the Transport's
`index.js`, and on the Transport mounted anywhere but the shell's boot.

## The transport

What the bar shows of the tape, and what its keys send, is the page's
transport (`lib/models/transport.js`), one per page, made by the engine
(`engine.transport`, `shell.md`) over the page's protocol client
(`components.md`) and loaded with the Pi's tape. It has no DOM and names
no route: the tape and its `live` state as the tape's read last answered,
`snapshot()` of them (`{v, id, tape, live, pending}`, frozen, the same
object until one moves; what a component draws from, `components.md`),
`playing()` (through a count-in and a mixdown's tail, a press held
`HOLD_MS` over answers already on their way, nothing on an answer
`STALE_MS` old), `pos()` (run on at its rate, round the loop at its Out),
`sampleRate()`, `looping()`, |◂'s `start()`, a bar's `step()` and
`tempo()` (`{bpm, bars, barFrames}` from the grid, or null). Its verbs,
each answering the Pi's answer or throwing a `Refusal` to whoever pressed:
`play()`, `stop()`, `locate(frame)`, `setLoop(on)`, `setOutput(mode)`
(the output sheet's choice, through `switchOutput`, and the rig's),
`setTempo(bpm)` and `setBars(n)` (the tempo's panel, a re-grid: decision
0062), and `tapLoop(body)` and `tapCancel()` (a free loop's tap). The bar's
tape source catches a refusal of its own keys and says it (*The tape: …*);
the Studio's keys say it in theirs. It reads the tape from the page's
tape (`lib/models/tape.js`, *The tape model* in `tape.md`), the page's one
poller, which it asks every 500 ms in the bar and every 5 s with a take in
it, at once on the changes socket's nudge (`push.md`) and shortly after
each verb, never two at once. That socket is the page's one, held from
`load` to `destroy` whatever room is shown. Each verb is a change of the
tape's (`change`), so a poll it overtakes is dropped. While shown, the
Studio asks the tape every 200 ms, feeds the transport what it shows
(`ingest`: the place this phone hears) and lends it the hands each verb is
sent inside (`delegate({around})`), which say what a stop's punch kept,
whoever pressed. Guardrail 16 fails on a module other than the
protocol client naming the transport's routes.

The bar's tape source (`lib/models/tape-source.js`) draws it: the LCD, the
display, the overview and the levels, and this phone's stream (where it is
is what this phone hears, and ▶ is the tap its sound waits for). A new
reader of the tape's ▶, place, loop or tempo reads the transport, never the
bar's source or the DOM.

## The Transport's extraction

How the bar became the Transport (item 1d of the component migration;
`components.md`, *The components*), in steps 1 to 5g, each its own PR with
nothing on screen changing. What was decided, and still holds (Gabe's calls
D1 to D6 taken as recommended, 2026-11-02):

- **1. The ids are the component's**: `np-<name>`, `cx.id`'s; the flows'
  selectors moved with them (`#np-position`, `#np-rec`, `#np-catch-pass`,
  `#np-catch-more`, `#np-catch-menu`, `#np-tape-overview`), never what a
  flow expects. Open's own `#np` keeps its ids until its pass.
- **2. The bar's state is on its root, the page's layout the surface's**:
  `data-fold`, `data-open`, `data-docked` (`layout.js`, synced by the
  router's `chrome.classesGiven`) and `data-room`; `body.np-fold` and
  `body.player-open` are written by `barLayout` alone, and what lays the
  page out around the bar is `styles.css`'s. **D1**: the five viewport
  `@media` blocks stay in `css/bar.css` (a container query can't ask a
  height, an orientation or a preference, nor style the root itself).
- **3. The surface says the room** (`props.room()`, `props.onRoom`), and
  the Studio hears the fold through `ctx.barLayout`: no page-wide event,
  no `MutationObserver` on `<body>`.
- **4. ●, Catch and the click were the bar's keys on the tape's verbs**
  (*The Studio's keys*; since step 7a of the calm Studio, ● and its ▾,
  with Catch on it, and the click the Studio's); the overview is the Studio's, in the strip's slot
  (*The Studio's part of the bar*); the clock-out lamp and the output strip
  are the bar's, from the models, in every room ((b), 2026-11-02).
- **5. The window through `cx`**: `cx.media(query)` for every screen query
  and the stack's `covered()` for J.
- **6. One display** (the `display` component inside the bar) is **not
  built**: it changes what the screen shows (**D2**), so it is its own PR,
  5h, for Gabe to look at (`docs/plan/STATE.md`).
- **7. Open keeps its markup and its modules** until its pass, on the
  shared modules (**D3**: no copies; what both use stays in `lib/bar/`).
- **8. The models** are the engine's bar and transport, the page's tape and
  takes, and the phone recorder, made at boot.
- **D4**: the Studio reaches the Transport's keys through a relay in its
  props (`ctx.tapeKeys`), not an API `mountComponent` answers.
- **D5**: the phone's player sheet is the surface's (`playerSheet`, made by
  the boot over `#np-dock`); the bar's keys hand it their drag
  (`sheet.grab`).
- **D6**: the bar's three menus are inside its root and open in the top
  layer (`menu()`'s `popover`).

The spec it was built from (`docs/plan/transport-extraction.md`, deleted
when 5g landed) is in git: `git log --diff-filter=D --
docs/plan/transport-extraction.md`.
