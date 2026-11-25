# 0041. Never hide the only route to something

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

No rule hides a control that is the only way to something. `styles.test.js`
fails if any rule hides ☰, any of its items (Settings, Releases, the guide,
the rig), or the Settings sheet's first line (`aboutLine`), which carries
them too.

## Why

In 2026-10, the about line on the old Capture page was `display: none` in one window shape; it
carried the only Settings button anywhere in the app, so that shape had no
way in at all.

## What it rules out

Hiding a sole route at a window size to save room.
