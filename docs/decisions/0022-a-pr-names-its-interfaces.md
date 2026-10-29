# 0022. A pull request names the interfaces it touches

**Date:** 2026-10-26 (d8188577).

## Decision

A pull request names each interface it touches: the module, what it exports,
who calls it, and whether that changed. A change to one goes in the
architecture docs (`docs/architecture/`) in the same pull request.

## Why

Written with [decision 0020](0020-build-the-interface-first.md): shortcuts around an interface were paid for in
the pass that cleaned them up, and a later tidy-up is where an interface's
write-up goes missing.

## What it rules out

Leaving the write-up for later; an interface change hidden in a feature's diff.
