# 0065. Export always offers Download

**Date:** 2026-10-30, a call taken for Gabe and built as recommended
(`e9ed03b7`, PR #237): Gabe may overrule it.

## Decision

Exporting from the Studio always offers Download: the mix as an MP3, a
clip as a WAV, saved to a folder on a computer. Share sits beside it
where the browser can share.

## Why

Share alone left a computer with no way to keep the file; Download is
offered whatever the device; the pointer only sets which key comes first.

## What it rules out

An export that offers only what the browser's share sheet does.

## See

`docs/architecture/take-page.md` (the `wave/share` row names the callers),
`docs/architecture/rooms.md`; J3.3 in `docs/flows.md` covers Share.
