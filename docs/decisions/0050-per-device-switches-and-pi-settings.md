# 0050. Per-device switches and the Pi's settings

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

A per-device switch (localStorage, this browser only) is one line in
`web/static/lib/device-prefs.js`; it saves as it is clicked and has no Save
and no Restart. The Pi's settings come from `/api/settings`, are shared by
everyone who opens the app and apply on restart.

## Why

A per-device switch is not the Pi's: a preview one person turns on for their
own phone does not belong in what everyone who opens the app shares.

## What it rules out

A one-device preview in `/api/settings`; a per-device switch with a Save
button.
