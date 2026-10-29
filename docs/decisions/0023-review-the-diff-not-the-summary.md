# 0023. Review the diff, not the summary

**Date:** 2026-10-26 (d8188577).

## Decision

Before a merge, someone who did not write the change reads the diff against
AGENTS.md: a fresh agent given the code and the rules, not the author's
account of it.

## Why

Written with [decision 0020](0020-build-the-interface-first.md). A reviewer given the author's account checks the
account, not the code.

## What it rules out

Merging on the author's report alone; a reviewer handed the author's
conclusion instead of the code.
