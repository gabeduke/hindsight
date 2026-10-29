# 0033. A stylesheet per place

**Date:** 2026-10-24 (`the-studio-space.md`, *Under the hood*).

## Decision

The CSS splits into one file per place, each listed in `sw.js` and checked
by ratchet tests; `css/chrome.css` (the header on every page, and a phone's
tabs), `css/bar.css` (the bar) and `css/rooms-motion.css` so far, the rest
as their places are rebuilt. A page links the ones it shows, after
`styles.css`. A test reads them through `cssOf(page)`, never
`fileCss('styles.css')` alone.

## Why

The bar once had 232 selectors in 14 sections of `styles.css`, hid its keys
with `:not()` lists and `!important`, and ran off a tablet's right edge;
four blocks of per-page overrides moved the header's room switch per page. A
test reading `styles.css` alone stops seeing a rule the day the rule moves.

## What it rules out

A place's rules spread across `styles.css`; a stylesheet missing from
`SHELL`; a test that reads one file by name.

## See

`docs/architecture/css-and-motion.md`, *The stylesheets*
