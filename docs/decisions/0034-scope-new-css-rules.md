# 0034. Scope a new CSS rule to the thing you are adding

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

A new rule's selector is scoped to the new thing. If a class is already in
use, say so in a comment and reuse its styling. A per-device flag hides
markup, not CSS: `styles.css` is on every page of every kit, so a flagged
feature's rules ship to everyone the day it merges, flag or not, and are
scoped like any other.

## Why

A bare `.set-note` rule added for one sheet reached every existing settings
note. Then Play mode's overlay rule, a bare `.play`, reached the Takes
page's Play buttons and turned one into a blank sheet over a phone's whole
screen, on every kit, with Play mode switched off (2026-10-14; Play mode
was retired on 2026-10-30).

## What it rules out

A bare class selector for a new component; relying on a flag to keep a rule
from reaching kits that never turned it on.
