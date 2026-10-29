# 0002. Two nouns, takes and tapes; a tap plays

**Date:** 2026-10-15 (the flow spec, 4586ecdc; decisions A and B).

## Decision

There are two nouns: a **take** is anything you kept, a **tape** is what you
build on. A tap on a take plays it, anywhere, in the bar, and it keeps
playing as you move around; Open is the one page to dig in; the bar is the
only transport. The other words are retired (a clip on a track is a part,
the clipboard is the buffer, the ring is the feed, a flag is a note, Mix
down and Cut a record are BOUNCE), and `lib/rooms/words.test.js` holds the
retired list.

## Gabe's words

*"we have takes, clips, tapes, and records which is confusing … we should
just be able to listen to a file and if need then we can dive in to make
notes."*

## Why

Takes, clips, tapes, records and the crate had all been on screen, each
managed separately, and getting from something you heard to listening to it
again went through several of them.

## What it rules out

A third noun on screen; a tap that opens a page instead of playing; a second
transport in a room or on a page; a retired word coming back.

## See

`docs/architecture/rooms.md`, *Vocabulary*
