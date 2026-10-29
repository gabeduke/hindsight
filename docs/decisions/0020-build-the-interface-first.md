# 0020. Build the interface first, or stop and say so

**Date:** 2026-10-26 (d8188577).

## Decision

If a change needs a model, a controller method or a shared helper that
doesn't exist yet, add it first (its own commit, or its own PR if it is
large) and then use it. If that is more than the task can carry, stop and
report what is missing. Never ship the feature around it.

## Why

Most of the rules in AGENTS.md were written after a feature reached around
an interface instead of through it: six menus with five ways to be placed,
eleven holds with four thresholds, eight copies of one brace matcher in
eighteen test files. Each shortcut was quicker that day, and each one was
paid for again, with interest, in the pass that cleaned it up.

## What it rules out

Reading state back out of the DOM; a `setTimeout` to win a race; copying a
helper instead of moving it somewhere both can import; `!important`; a
`catch` that swallows; a second way to do what `lib/ui/` already does.
