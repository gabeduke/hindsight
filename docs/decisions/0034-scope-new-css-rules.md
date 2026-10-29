# 0034. Scope a new CSS rule to the thing you are adding

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

A new rule's selector is scoped to the new thing. If a class is already in
use, say so in a comment and reuse its styling.

## Why

A bare `.set-note` rule added for one sheet reached every existing settings
note. Then Play mode's overlay rule, a bare `.play`, reached the Takes
page's Play buttons and turned one into a blank sheet over a phone's whole
screen.

## What it rules out

A bare class selector for a new component.
