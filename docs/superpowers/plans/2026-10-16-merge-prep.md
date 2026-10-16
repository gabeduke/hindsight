# Merge prep · two small changes before rooms/all lands

**Branch:** `rooms/merge-prep` off `rooms/all` (38c4de1). PR base `rooms/all`.
`CACHE` -> v114.

## 1. Settings: "Plays the tape" only with the rooms on

The Pi setting `TAPE_CONTROLLER` stays as it is (key, default, Go). The sheet
leaves its row out unless `rooms/flag.js` `on()`. Save sends only the keys
that were edited, so a row that is not drawn can be neither edited nor
dropped: the PUT body for every other field is the one it always was.

- [ ] `visibleSettings(settings, roomsOn)` in `lib/settings.js`, used by `draw()`
- [ ] test: off -> no TAPE_CONTROLLER, others untouched; on -> all; the sheet
      draws no label, help or empty group

## 2. A refused edit says why

The Pi answers 409 to a PATCH /api/tapes that changes what is armed, or a
track's input, while ● Rec is armed or punching (`Recording.Allows`). The
refusal stays. Its body today is only `{"error": "a track is already
recording; end it first: …"}`, shared by other 409s, so the client would have
to match prose. Smallest Go change: that one refusal also carries
`"reason": "recording"`.

- [ ] Go: `tapeErr` adds `reason` for `tape.ErrRecording`; test in `internal/api`
- [ ] `lib/tape/refusal.js`: pure `refusal(status, body)` -> reason + words
- [ ] `toast()` takes `opts.detail`, a second line
- [ ] tape page `api()` shows the toast for a recording refusal and marks the
      error `shown`; `patch()`/`sendTrack()` do not toast twice; the poll
      brings the control back to the Pi's value (arm: `recWant` cleared)
- [ ] rig page write and Play bar `send()` use the same words
- [ ] tests red first, then green; sw.js v114; guide only if a claim breaks
- [ ] look at it: headless Chromium, demo with scratch dirs
