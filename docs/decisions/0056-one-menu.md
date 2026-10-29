# 0056. One menu

**Date:** 2026-10-24 (d946c9f4).

## Decision

A menu, or a key's ▾ panel, is `menu()` or `splitKey()` (`lib/ui/menu.js`):
it opens on the stack, is placed beside its key by `place()`, moves the
keyboard along it, grows in and fades out, and its rows are `menuItem`s.
`architecture.test.js` fails on an `aria-haspopup` a script sets up outside
`menu.js`, and lists in `OWN_MENUS` the ones still their own, with why.

## Why

Six menus once had five ways to be placed, two to be dismissed, arrow keys
in some, and rows of 40 px beside rows of 48.

## What it rules out

A menu built by hand; a new entry on `OWN_MENUS` ([decision 0021](0021-exceptions-are-gabes-decision.md)).

## See

`docs/architecture/shell.md`, *Menus*
