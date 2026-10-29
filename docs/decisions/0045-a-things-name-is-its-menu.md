# 0045. A thing's name is its menu

**Date:** 2026-10-25 (52ed57f5).

## Decision

What acts on a thing goes in its name's menu, on `lib/ui/menu.js`: the
tape's in the Studio, the take's on Open. A row that destroys is last, red,
after a line; one that can't be undone asks in `#confirm` first. How the
Studio is shown is ⌗'s View menu beside the ruler.

## Why

A ⋯ beside the tape's name once split the tape's actions from its list of
tapes, a third menu beside ☰.

## What it rules out

A ⋯ beside a name; `window.prompt` for a destructive confirm.

## See

`docs/architecture/shell.md`, *The frame*
