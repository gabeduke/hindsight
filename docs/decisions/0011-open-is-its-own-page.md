# 0011. Open is its own page, for now

**Date:** 2026-10-15 (the flow spec, question 1, answered by Gabe).

## Decision

Open (`wave.html`) is a page of its own, outside the shell. An iPhone needs
one ▶ after the page change; the bigger build, Open inside the shell, waits
until that tap is tried on his iPhone and grates. The Rig should become a
shell view next (leaving for it stops this device's tape about 6 s later).

## Why

Bringing Open into the shell is a large change for a cost (one tap on an
iPhone) not yet shown to matter.

## What it rules out

Treating Open as a shell view in the meantime: it has its own stack of
layers and no tape source.

## See

`docs/architecture/shell.md`, *The shell*; `docs/architecture/take-page.md`
