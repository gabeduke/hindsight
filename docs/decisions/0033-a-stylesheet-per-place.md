# 0033. A stylesheet per place

**Date:** 2026-10-24 (`the-studio-space.md`, *Under the hood*).

## Decision

The CSS splits into one file per place under `css/`, each listed in
`sw.js`'s `SHELL` and checked by ratchet tests: today `chrome.css` (the
header on every page, and a phone's tabs), `bar.css` (the bar),
`display.css`, `notes.css` and `rooms-motion.css`, the rest as their places
are rebuilt. A page links the ones it shows, after `styles.css`. How a test
reads them is [0036](0036-one-stylesheet-reader-for-tests.md).

## Why

The bar once had 232 selectors in 14 sections of `styles.css`, hid its keys
with `:not()` lists and `!important`, and ran off a tablet's right edge;
four blocks of per-page overrides moved the header's room switch per page.

## What it rules out

A place's rules spread across `styles.css`; a stylesheet missing from
`SHELL`.

## See

`docs/architecture/css-and-motion.md`, *The stylesheets*
