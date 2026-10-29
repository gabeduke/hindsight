# 0035. A per-device flag hides markup, not CSS

**Date:** In AGENTS.md since 2026-10-14 (d60edc35).

## Decision

A flagged feature's rules are written knowing they ship to everyone:
`styles.css` is on every page of every kit, so the rules go live the day the
feature merges, flag or not.

## Why

The `.play` sheet reached every kit with Play mode switched off.

## What it rules out

Relying on a flag to keep a rule from reaching kits that never turned it on.
