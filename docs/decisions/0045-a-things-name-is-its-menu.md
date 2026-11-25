# 0045. A thing's name is its menu

**Date:** 2026-10-25 (52ed57f5); narrowed to the header on 2026-11-24.

## Decision

In the header, what acts on the thing you're working on (the tape in the
Studio, the take on Open) goes in its name's menu, on `lib/ui/menu.js`,
never in a ⋯ key beside the name. A row that destroys is last, red, after a
line; one that can't be undone asks in `#confirm` first, never
`window.prompt`. How the Studio is shown is ⌗'s View menu beside the ruler.

It says nothing about rows in a list (the Listening Room's List, the
shelf): a per-row action menu there is a `menu()` and follows
[0056](0056-one-menu.md).

## Why

A ⋯ beside the tape's name in the header once split the tape's actions from
its list of tapes, a third menu beside ☰.

## What it rules out

A second key beside the header's name; `window.prompt` for a destructive
confirm.

## See

`docs/architecture/shell.md`, *The frame*
