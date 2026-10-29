# 0032. Materials in objects.css, scheme tokens in styles.css

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

`web/static/objects.css` holds materials, what the objects are made of
(oxide, paper, plastic, metal, the VU faces); every token in it is the same
in both schemes, which is why it has no dark block. A token that follows the
scheme belongs in `styles.css` next to its dark value.
`lib/objects/materials.test.js` fails if one lands in the wrong file.

## Why

A scheme token in the materials file has no dark value, and that mistake is
invisible until someone opens the app at night.

## What it rules out

A dark block in `objects.css`; a scheme-dependent token without its dark
value.
