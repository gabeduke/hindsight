# 0044. The header is one frame on every page

**Date:** 2026-10-25 (52ed57f5).

## Decision

The header is three zones (what you're working on; Studio | Listening Room,
centred; the tools), laid out by one rule set in `css/chrome.css` and by no
page of its own. A room's context goes in the start zone through the header
slot; its ↶ ↷ before ☰. The tempo, where it plays and the alignment are on
the bar's display, not the header. `styles.test.js` and J5.1 hold it.

## Why

Four blocks of per-page overrides once moved the room switch per page, so it
sat top left in the rooms and top centre on Open and Capture, and a tap
where it usually was landed on the brand.

## What it rules out

A rule outside `css/chrome.css` that places the header, or one there for a
single page.

## See

`docs/architecture/shell.md`, *The frame*
