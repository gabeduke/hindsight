# 0024. CI names every test directory

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

The `node --test` globs in `.github/workflows/ci.yml` name each directory
under `web/static/lib/` one by one, so a new directory with tests is added
to them, and to the list in AGENTS.md. `paths.test.js` fails when a
directory with tests is missing from `ci.yml`'s globs.

## Why

A new directory's tests were invisible to CI until it was listed: a whole
suite sat in the repo, passing locally, and silently never ran on a PR.

## What it rules out

A directory of tests that only runs locally.
