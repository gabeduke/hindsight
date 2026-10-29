# 0049. A take is called one way: takeTitle

**Date:** 2026-10-25 (239db511).

## Decision

Wherever a person reads it, a take is named by `takeTitle`
(`lib/rooms/takename.js`): its name, or the time on its spine. Never its
file or its date stamp on screen (Open's page is the one still to move, in
Open's pass).

## Why

One take once had four names (the time on its spine, its date stamp in the
bar and Recently deleted, its file on Capture), and a search for what a
spine said found nothing.

## What it rules out

A take's file name or date stamp on screen.

## See

`docs/architecture/rooms.md`, *Vocabulary*
