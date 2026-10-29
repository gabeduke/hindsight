# 0047. The bar's keys live in its zones, and ▶ never moves

**Date:** 2026-10-24 (cead7f93).

## Decision

The bar is one shape in fixed zones (the deck, the transport, the verb, the
modes, the end, the strip). A key goes in the markup, in its slot, saying in
`data-for` (and `data-mini`) which sources it shows for. ▶ never moves,
between rooms or sources; J1.13 fails if it does, or if the bar runs off a
tablet. ▾ only opens a menu, and the bar folds by its grabber.

## Why

The bar once had 232 selectors in 14 sections of `styles.css`, hid its keys
with `:not()` lists and `!important`, and ran off a tablet's right edge.

## What it rules out

A key appended by a script; a key shown or hidden by a `:not()` list; a ▾
that does anything but open a menu.

## See

`docs/architecture/bar.md`
