# 0026. Go changes merge only after they've run

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

Go changes that could not be built and tested (in a cloud sandbox that
blocks the module proxy, say) are built and tested on a machine with a
working toolchain before they merge.

## Why

Cloud agent sandboxes generally block the Go module proxy, so `go build` and
`go test ./...` fail there on downloads, not on the code, and a change that
was never compiled looks the same as one that passed.

## What it rules out

Merging Go on the strength of the JS tests and `gofmt` alone.
