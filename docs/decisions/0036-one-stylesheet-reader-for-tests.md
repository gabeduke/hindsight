# 0036. Tests read the stylesheets through one reader

**Date:** 2026-10-24 (b2bf82b3).

## Decision

A test reads the stylesheets through `web/static/lib/stylesheets.js`
(`cssOf`, `fileCss`, `rules`, `block`, `section`, `tokens`), never with a
brace matcher of its own, and reads a page's CSS through `cssOf(page)`,
never `fileCss('styles.css')` alone. It is node-only, so it stays out of
`sw.js`'s `SHELL` (which a test checks; the rest is kept by review).

## Why

Eighteen test files once had eight copies of one brace matcher, and a copy
that slips passes a test that should fail. A test reading `styles.css` alone
stops seeing a rule the day the rule moves to its place's stylesheet.

## What it rules out

A regex or brace matcher over CSS in a test file.
