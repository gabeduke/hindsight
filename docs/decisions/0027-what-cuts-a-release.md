# 0027. Only a change to what a kit runs cuts a release

**Date:** 2026-10-14 (0231ae02).

## Decision

`paths` in `release.yml` is an allow-list of what ships: `cmd/`,
`internal/`, `go.mod`, `go.sum`, `web/`, `deploy/` (not the hub's manifests
in `deploy/hub`, apart from its Dockerfile) and `docs/guide.md`, which the
binary embeds. A merge touching none of them cuts nothing. A release ships
twice over: the hub is redeployed at once and every kit's Update button
offers it, so a merge of code is a deployment. A new file that ships goes on
the list; `scripts/test-release-scripts.sh` fails if the archive packs
anything the list doesn't cover.

## Why

Every merge used to cut a release unless all its files were on an ignore
list, so a doc, a dev script, the Makefile or AGENTS.md put a version on
everyone's Pi with nothing new in it. The risk of an allow-list is the quiet
failure: a shipped file that stops releasing, a change that builds and never
ships.

## What it rules out

A shipped path outside the allow-list; treating a code merge as anything
less than a deployment.
