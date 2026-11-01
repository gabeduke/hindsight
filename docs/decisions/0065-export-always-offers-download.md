# 0065. Export always offers Download

**Date:** 2026-10-30, a call taken for Gabe and built as recommended
(`e9ed03b7`, PR #237): Gabe may overrule it.

## Decision

Exporting from the Studio always offers Download: the mix as an MP3, a
clip as a WAV, saved to a folder on a computer. Share sits beside it
where the browser can share.

## Why

Share alone left a computer with no way to keep the file; Share is a
phone's route, Download a computer's, and neither hides the other.

## What it rules out

An export that offers only what the browser's share sheet does; Download
shown only on a computer, where a phone might want it too.

## See

`docs/architecture/` for the export callers (named in the PR's review
fixes, `01d85e80`); J3.3 in `docs/flows.md`.
