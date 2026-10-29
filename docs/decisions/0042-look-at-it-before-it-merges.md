# 0042. A UI change is looked at in a browser before it merges

**Date:** 2026-10-14 (d60edc35).

## Decision

A UI change is looked at in a browser, against the demo, before it merges:
at phone and desktop size, in both schemes, with its flag on and off.

## Why

Play mode merged having never been rendered, because the sandbox it was
built in couldn't run the server. The first look found that it couldn't open
at all (its overlay shared the ▶ key's id), that its keys moved the record
track on the Pi, and a full-screen blank sheet on phones. The node tests
passed throughout: they test logic, and none of them can see a page.

## What it rules out

Merging UI on green unit tests alone.
