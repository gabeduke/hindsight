# 0029. The repo is public: no home network details

**Date:** In AGENTS.md since 2026-10-14 (dd374012).

## Decision

No tracked file carries home network details: no LAN or tailnet address, no
tailnet or MagicDNS name, in code, docs, comments or commit messages. The
deploy target lives in the untracked `deploy.local.env`; docs say
`<pi-host>`; screenshots are taken against the demo on localhost.

## Why

The history was squashed once to get them out.

## What it rules out

A real hostname in a doc, a comment, a commit message or a screenshot's URL
bar.
