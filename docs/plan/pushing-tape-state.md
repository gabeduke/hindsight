# Pushing the tape's state

Asked for by Gabe on 2026-10-28, at the SMK-37 rig test: *"could we start
pushing state to the UI … what would the latency be over webapp?"* With a
keyboard on the Pi, the tablet has to keep up with a press that it didn't
make: PLAY, an arm, a mute (`the-instrument.md`, step 7: *the tablet follows
the keyboard*). The decisions below were agreed with Gabe on 2026-10-28, as
recommended; then the build order.

## Where the time goes now

Measured on the rig on 2026-10-28:

- The Studio polls `/api/tapes/state` every 200 ms (`lib/tape/page.js`,
  `POLL_MS`), and the bar every 500 ms (`lib/bar/tape-source.js`).
- The Pi answers a poll in about 0.5 ms.
- The Wi-Fi round trip from a Mac to the Pi was 8–35 ms (19 ms on average,
  over 10 pings).

So a change made on the Pi reaches the Studio about 120 ms later on
average, and up to about 235 ms later; on the bar it takes up to half a
second. The sound never waits on any of this: a controller's press acts on
the Pi. It is only what the tablet shows that lags.

## Decisions

| | |
|---|---|
| What is pushed | **A nudge, not the state.** The Pi says *the tape changed* (a revision number) the moment it does, and the page polls at once, through the poll it already has: about 30–50 ms in all. Sending the state itself would save the poll's 20 ms or so, but gives the page a second way in for its state. Do it only if the nudge still feels slow. |
| How it travels | **A WebSocket of its own, `/api/tapes/changes`**, on gorilla as `/api/live` and Play's socket are. Not on `/api/live`: that is the capture's levels, and the tape is a separate thing. Not SSE: it would need the same heartbeat and dead-socket handling, written a second time. |
| Kept alive by | **The revision once a second**, changed or not. `lib/live.js` treats a silent socket as dead after 4 s, and a nudge socket is silent when nothing happens, so it needs a heartbeat to be judged alive. A heartbeat whose revision differs from the page's also catches a nudge that was lost. |
| The poll | **Kept at 200 ms until push is proved at the rig, then slowed to 1 s** as the fallback, for when a socket is down. Gabe's call when it is proved. |
| A Pi touch display | **Parked.** Gabe has one. It takes out the Wi-Fi hop (about 1 ms, plus a frame), but it still needs the push to be quick. |

The page's latency after this is the push one way (about 10 ms on Wi-Fi),
one poll (about 20 ms), and up to one frame (16 ms). The spikes to watch
for are the tablet's Wi-Fi power saving, which can add 100 ms or more now
and then.

## What changes the revision

One signal in `internal/tape`: `Engine.Changes()`, a revision number and a
way to subscribe, coalescing and never blocking, like
`cap.Levels().Subscribe()`. It moves when what `/api/tapes/state` shows
moves:

- the tape is written (`Store.Save`, and `Store.Create` for a new one: the
  store's two writes of a `tape.json`);
- a transport action is **carried out**, not when it is queued (`apply`,
  on the render goroutine), so a quantised ▶ nudges when it lands, not
  before;
- recording starts, stops or arms;
- Play mode's held pads change (`tricks`), and the cue lane launches or
  stops;
- the output mode, the clipboard and the crate change;
- a different tape is loaded.

A test fails if a change seen in `/api/tapes/state` (any field the page
reads) comes with no new revision: it drives each of the above through the
API and checks the revision moved.

## Under the hood

The interfaces this touches, for the pull requests and
`docs/architecture.md`:

- `internal/tape`: `Engine.Changes()`, new. Called by `internal/api`.
- `internal/api`: the route `/api/tapes/changes`. It sends
  `{"rev":N,"at_ms":…}` on each change and once a second. `at_ms` is the
  Pi's clock, so a page can measure the push.
- `web/static/lib/tape/changes.js`, new, node-tested: the client, with
  `lib/live.js`'s reconnect and dead-socket rules (moved somewhere both can
  import, not copied) and `lib/link.js`'s `onResume`.
- `lib/tape/page.js`: a nudge forces a poll through `poll-gate.js`. A nudge
  that arrives while a poll is in flight polls once more after it, never
  twice. `lib/bar/tape-source.js` listens too. Each is a view, so the socket
  is opened through `ctx` and is quiet in a room not shown.
- `sw.js`'s `CACHE` bumped, and the new module added to `SHELL`.

## Build order

Each step is a PR of its own:

1. `Engine.Changes()` and the test that every change moves it (Go).
2. `/api/tapes/changes`, with its heartbeat, and its tests.
3. `lib/tape/changes.js`, the Studio's and the bar's nudge, and a flow:
   with the Studio open, a change made through the API (as a controller
   would make it) shows on the page within 100 ms on the demo. Run
   `node scripts/flows.mjs`; look at it on a tablet and on a desktop.
4. At the rig: the SMK-37's PLAY, timed from its log line to the
   tablet's paint. Then Gabe decides the fallback poll.
