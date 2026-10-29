# 0055. One way to close things

**Date:** 2026-10-24 (bff2b72a).

## Decision

A menu, popover, sheet, drawer or selection opens on the page's stack
(`lib/ui/layers.js`; `ctx.layers` in a view) with an `onClose` that puts it
away, and closes with `layer.close()`. Back and Escape close it in turn; a
press outside closes a menu; a switch of rooms closes the menus. A handler
that keeps Escape for itself calls `preventDefault()`.
`architecture.test.js` fails on a `pushState` outside the router and the
stack, and lists in `OWN_HISTORY` the ones still their own.

## Why

With both a CloseWatcher and a history entry for one layer, Back takes two
presses; Back should keep closing things in one order (bff2b72a).

## What it rules out

A history entry or an Escape ladder of a component's own.

## See

`docs/architecture/shell.md`, *One way to close things*
