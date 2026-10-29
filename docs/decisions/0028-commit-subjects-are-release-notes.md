# 0028. Commit subjects are the release notes

**Date:** In AGENTS.md since 2026-10-14 (dd374012).

## Decision

The `CHANGELOG.md` entry is every non-merge commit subject since the last
tag, and each kit's release picker shows those lines to whoever is deciding
whether to update. Subjects are written for that person.

## Why

The changelog is generated; nobody edits it, so what a commit says is what a
kit's owner reads.

## What it rules out

Subjects written for developers rather than for a kit's owner; editing
`CHANGELOG.md` by hand.
