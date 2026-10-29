# The push: the revision, the changes socket and the keyboard's press

**The revision** (`changes.go`, `Engine.Changes()`) moves whenever what
`/api/tapes/state` shows moves, apart from the playhead and the device's
counts, which move all the time: the loaded tape once it is the new one
(an edit, an undo, a load); in the render goroutine, a transport action,
trick or cue launch queued or carried out, a count-in ending, the tape
running off its end, the cue lane's clips starting, ending or leaving,
and each pass of the loop logged; ● Rec arming, turning on and ending; a
mixdown's state; the output mode; and the clipboard and the crate once
written (the store's `changed` hook). A page is told of a new revision so
that it polls at once: a nudge, not the state, so the page has one way in
for its state, at about 30–50 ms from a change to the tablet's paint where
the 200 ms poll alone took up to 235. `Bump` runs on
the render goroutine, so it takes no lock and never blocks: each
subscriber's channel holds one tap, and a subscriber reads `Rev` when it
wakes. The render goroutine bumps once a block, after it has published
the block's view of the transport and the cue lane, so a page polling at
the tap finds what it was told of. A carried-out action bumps when it is
rendered, up to the FIFO's 100 ms before it is heard; the page's playhead
goes by `heard`, so it doesn't jump ahead. Not bumped yet, so a page sees
them on its next poll: the alignment locking (Δ), a render panic, the
output device going or coming back, the stream's listeners, tap tempo's
pending tap, the clock's status and a failed pool file.
`TestEveryChangeThePageSeesMovesTheRevision` drives the tape, ● Rec, the
clipboard, ▶ and ■ (and that the view already shows them at the tap), a
pass and a count-in, and fails on one that doesn't move the revision.

**`/api/tapes/changes`** (`internal/api/changes.go`) is a WebSocket of its
own that tells a page of the revision: `{"rev":N,"at_ms":…}` when it opens,
on each tap of `Changes().Subscribe()`, and once a second (`changesBeat`)
whether anything changed or not, with `at_ms` the Pi's clock so a page can
time the push. It sends a nudge, not the state: the page polls
`/api/tapes/state` at once, through the poll it already has. The beat is
what keeps a quiet socket from being taken for a dead one (`lib/socket.js`
replaces one silent for 4 s), and a beat whose rev differs from the last
one heard catches a nudge that was lost. The page never writes to it; with
the tape off it is a 404, as the rest of `/api/tapes` is. Not on
`/api/live`, which is the capture's levels.

In the page, `lib/tape/changes.js` (`watchChanges(onNudge)`, and
`revisions()`, which says whether a message's rev is one not yet heard) is
the client, kept open by `lib/socket.js`'s `connectSocket`, the reconnect
and dead-socket rules `lib/live.js` had, moved so both use them. A watch
takes its socket's first rev as seen, not news: whoever opens one polls as
they do, and counting it would ask the Pi twice; after a reconnect, a rev
that moved while it was down is news. The Studio (`lib/tape/page.js`) holds
it through `ctx.socket` (*The shell*, `shell.md`), so it is open only while the Studio
is shown, and with it the bar's hand-over: opening it delegates the bar's
tape to the Studio, closing it hands it back (`delegate(null)`). A nudge
asks `poll-gate.js`'s `nudge()`, which polls at once with no poll out, or
has the poll that is out poll once more when it ends (`end()` says so),
never two at once. The bar's tape source (`lib/bar/tape-source.js`) is not
a view: its socket's life is tied to `del` instead. It watches while the
tape is not handed to the Studio (`!del`), and closes on `delegate(d)` and
on `destroy()`. With a take in the bar (`setActive(false)`) it stays open
for the keyboard's presses (*The keyboard's press*), but its nudges poll
nothing until the tape is back. Its polls go through a gate of their
own on the same rules (a tick skipped while one is out, a wake-up forced,
a nudge, a press or the hand-back asked for once), with a 4 s timeout so a
poll lost in a sleep frees the gate. The 200 ms and 500 ms polls stay, as
the fallback for a socket that is down. J1.14 times ▶, ■ and a rename made
at the Pi to the page's paint, in the Studio and in the Listening Room's
bar: within 100 ms on the demo.

**The keyboard's press** (`internal/api/press.go`; `the-instrument.md`,
step 7, *The tablet*) rides the same socket, as an event carrying the words
and what changed, not a diff. Each press on the SMK-37 that says something
on its own screen (`keyboardSays`, `banner.go`: the verbs, their refusals,
a Play pad refused) is published on the API's `presses` feed, which never
blocks the verb (a socket four presses behind misses one), and every open
changes socket sends it at once, with the revision as it is then:

    {"rev":N,"at_ms":…,"press":{"words":"DROPPED ON T2","role":"verb","lit":["track"],"track":2,"at_ms":…}}

- `words` are the banner's, in capitals, at most 19 characters;
- `role` is its colour, as on the keyboard: `play` (green), `stop` and
  `verb` (CATCH, GRAB, DROP: the display's own ink), `rec` (KEEP, which
  is the keyboard's REC: red), `refused` (amber), and `mixer`, a Mixer
  page press in its `track`'s colour (K6: nothing says it yet);
- `lit` is what it changed: `play` (▶, for PLAY and STOP), `rec` (●, for
  KEEP), `track` (that track's head, for CATCH and DROP). A refusal lights
  nothing;
- `track` is the track lit, 1 up, and left out for none;
- `at_ms` is when the banner's second began, by the Pi's clock: the press,
  or for a verb timed from when it was done, then. The message's own
  `at_ms` is when it left, so a page takes what is left of the second
  from the two, whatever its own clock says.

Only the keyboard's presses are sent (another controller's say nothing),
whether or not Hindsight has its screen. In the page, `watchChanges({onNudge,
onPress})` reads it with `pressOf` (`lib/tape/changes.js`), and a message
whose rev moved is a nudge as well. The bar's tape source hands each press
to `onPress` listeners, from its own socket or, while the Studio is shown,
from the Studio's (`heardPress`); the engine's listener is the bar's note
(`lib/bar/press-note.js`, `#np-press`), which puts the words over the
display, after the keyboard's icon, for what is left of the second, and
lights ▶ or ● (`.kb-lit`, `data-kb` the role). The Studio lights the
track's head itself (`lightTrackHead`). The note is out of the layout,
over the display alone (in the phone's mini player, over the whole window,
reels and all, since the display there is too narrow), and lets taps
through, so nothing on the bar moves. `#np-press` is a live region
(`role="status"`, `aria-atomic`) that is always in the page: a press shows
by its `data-kb` and its words, and goes by emptying them, never by
`hidden`, which would take it out of the accessibility tree.

**Every press answers, whatever the bar holds.** The keyboard plays the
tape, not the bar's source, so the note shows over the display in every
room with the shell's bar: over the tape, the live feed or a take alike,
in the Studio (through its socket) and anywhere else (through the bar's,
which stays open for presses while a take is in the bar). Open's page
(`wave.html`) has no tape source and no note.

J1.15 presses PLAY, STOP, a refused CATCH, GRAB and DROP on a keyboard in
the demo (`api.keyboard()`, a FIFO for its rawmidi node), in the Studio
and in the Listening Room, with a take in the bar there too, and checks
each note comes and goes, what it lit (▶, the dropped-on track's head)
and that ▶ never moved.
