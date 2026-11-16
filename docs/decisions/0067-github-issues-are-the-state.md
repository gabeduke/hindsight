# 0067. GitHub issues are the state; no handoff file

**Date:** 2026-11-16.

## Decision

What is open lives in the repo's issues and pull requests: the backlog is
issues, work in progress is open PRs, history is `git log`. A session starts
from the issue it is given and leaves what it learnt on that issue as a
comment. No session reads or writes a `STATE.md`, tracked or local, and no
hook asks for one. A bug, a thing waiting on Gabe at the rig or a next step
is an issue (label `bug`, `needs-gabe`, or an `effort:` size).

## Why

The untracked root `STATE.md` reached 1,387 lines and `docs/plan/STATE.md`
422: every session paid to read them, most of what they held was history
`git log` already has, and two agents appending to one file lost each
other's notes. An issue is read only when it is the task, can be worked on
by several sessions at once, and carries its own discussion.

## What it rules out

A handoff file; a hook that blocks a stop until one is updated; home network
details in an issue (the repo is public: 0029). Specs stay in `docs/plan/`
(0057), each with an issue that links it.
