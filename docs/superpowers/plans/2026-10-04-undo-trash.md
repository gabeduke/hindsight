# Undo and trash; several takes at once — step 4 of the editing-model roadmap

**Spec:** [editing model](../specs/2026-10-03-editing-model-design.md):
"Undo, and nothing permanent by accident", "New capabilities" item 3.
**Checks:** [guide](../../guide.md), §5. **Branch:** `undo-trash`, stacked on
`take-page`.

## Decisions taken while planning

- **What Undo covers:** the name, the selection, the BPM, the downbeat, drum
  or notes lanes, and every flag change (added, moved, renamed, deleted), as
  the guide says. Starring is left out: it is its own one-tap toggle, and an
  Undo that flipped a star back would surprise more than help.
- **Operations are recorded by the API**, where a person's edit arrives
  (`PATCH /api/take`, the flag endpoints), as a diff of the sidecar before
  and after, under the take's lock. The saver's own stamps (created, tempo,
  flags at save) are not operations: they are how the take was made.
- **Coalescing.** A change to the same field within 2 s of the last one, that
  starts where that one ended, extends it. Holding a nudge, or In then Out in
  quick succession, is one step to undo, not twenty.
- **Undo addresses one operation.** `POST /api/take/undo?file=` undoes the
  newest; `&op=<id>` undoes that one, which is what a toast's *Undo* sends,
  so the toast still means what it said after a later edit. Either is
  skipped, with `skipped` in the answer, when its field no longer holds what
  the operation left there. A skipped operation leaves the log.
- **No redo.** Not in the spec, and the toast covers the common slip.
- **The trash** is `OUTPUT_DIR/.trash/<stem>/`, one folder per take holding
  all its files and a `trashed.json` (`deleted_at`, `reason`: `deleted` or
  `pruned`). Files are moved with `rename`, inside one filesystem.
- **Restoring** refuses if a take of the same name has appeared since (409),
  and stars the take, per the spec.
- **Emptying:** a janitor at startup and every 10 minutes removes trash older
  than 7 days, and, while free space is under `MIN_FREE_GB`, the oldest
  trash first. Every place that refuses to write for low disk (a save, a
  cut, a phone recording) runs the same emptying first.
- **Deleting no longer asks.** It moves to the trash and the toast offers
  *Undo*. *Delete forever* in *Recently deleted* still asks.
- **Several takes at once:** a long press on a row starts select mode. A bar
  at the bottom carries *Star*, *Delete* and *Export*, and *Done*. Export is
  `GET /api/export?file=…&file=…`, a stored (not deflated) zip streamed
  without temporary files, of each take's WAV, `.meta.json`, `.mid` and
  manifest.
- **The take header** gains ↶ *Undo* (disabled when there's nothing to undo;
  its tip names the next step, e.g. "Undo: rename"). Ctrl/⌘-Z does the same.

## Tasks

1. `internal/audio/history.go`: `Op`, `DiffMeta`, `RecordHistory`,
   `UndoOp`, the 50-entry `<stem>.history.json`. Tests.
2. `internal/audio/trash.go`: `TrashTake`, `RestoreTake`, `ListTrash`,
   `PurgeTrashed`, `EmptyTrash`, `EnsureFree`; `RemoveTake` and pruning go
   through the trash; `takeFiles` lists a take's files once. Tests.
3. API: history on PATCH and the flag endpoints, `undo` in their answers and
   in `GET /api/take`; `POST /api/take/undo`; `GET /api/trash`,
   `POST /api/trash/restore`, `DELETE /api/trash`; `GET /api/export`. Tests.
4. Web: a shared toast with an action (`lib/toast.js`); the take header's
   Undo; toasts with Undo for deleting a flag and clearing the selection;
   list delete without a confirm; *Recently deleted*; select mode.
5. Docs: guide §5 as built, api.md, architecture.md; the service worker.
6. Verify: Go and node tests, Playwright against `--demo`.
