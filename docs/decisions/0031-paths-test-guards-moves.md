# 0031. Moving a file under lib/ runs paths.test.js

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

After moving a module, run `paths.test.js`.

## Why

Moving a module one directory deeper breaks every relative import inside it
(`./theme.js` → `../theme.js`) and nothing fails until a browser loads a
blank page. The test exists because that mistake was made and caught by
hand.

## What it rules out

Trusting the unit tests to catch a broken import.
