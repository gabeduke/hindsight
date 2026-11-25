# 0030. Any change under web/static bumps the service worker cache

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

Any change under `web/static/` bumps `CACHE` in `web/static/sw.js`
(`hindsight-shell-vNN`), and a file added to `lib/` is added to `SHELL`.
`paths.test.js` resolves every module specifier, `<script src>`, stylesheet
link and shell entry against the disk: run it after moving a module. The
`SHELL` half is enforced by that test; no test checks the `CACHE` bump, so
review does.

## Why

Without the bump, phones keep serving the old shell. `caches.addAll` rejects
as a whole, so one stale entry in `SHELL` costs the entire offline cache
rather than one file. Moving a module one directory deeper breaks every
relative import inside it (`./theme.js` → `../theme.js`), and nothing fails
until a browser loads a blank page; the test exists because that was once
caught by hand.

## What it rules out

A static change shipped without the bump; a module imported by a cached page
but missing from `SHELL`; trusting the unit tests to catch a broken import.
