# Reverse and share a clip — step 7c of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md), phase 2's *clip
properties: reverse, and share as WAV*; the API's `GET /api/tapes/clip`.
**Checks:** [guide](../../guide.md) §8.5. **Branch:** `tape-reverse`,
stacked on `tape-clock`. The last of phase 2's list.

## Decisions taken while building

- **Reverse writes a reversed copy** of the clip's window and overhang to
  the pool, rather than teaching the renderer and every edit to read a clip
  backwards. Split, lift, slide, join and the crossfades all keep reading
  forwards. The cost is the clip's audio once more on disk.
- **Turning it back needs no file:** the clip remembers the original file
  and where the reversed one ends in it, so a reversed clip that was split
  or trimmed turns back to exactly its part of the original.
- **It's an edit:** `{op: "reverse"}` on `/api/tapes/edit`, one undo step.
- **Share as WAV is the part, not the mix:** the clip's audio at its own
  level, declicked, 16-bit for phones and messaging apps. Up to a minute
  goes to the share sheet; longer, or a phone that can't share files,
  downloads.

## Tasks

1. `audio.ReverseWAVSpan`. Test.
2. `reverse` in `edit.go`; `Clip.Reversed`; `share.go`. Tests.
3. `GET /api/tapes/clip`. Test.
4. The clip sheet's *Reverse* / *Play forwards* and *Share as WAV*; tips.
5. Docs.
