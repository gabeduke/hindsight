# 0025. A new regression test has to fail against the unfixed code

**Date:** In AGENTS.md since 2026-10-14 (dd374012).

## Decision

Revert the fix, watch the test go red, put the fix back.

## Why

This project has shipped a test that could not fail, and found out only by
reverting.

## What it rules out

A regression test never seen red.
