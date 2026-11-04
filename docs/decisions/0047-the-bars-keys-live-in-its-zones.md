# 0047. The bar's keys live in its zones, and ▶ never moves

**Date:** 2026-10-24 (cead7f93).

## Decision

The bar is one shape in fixed zones (the deck, the transport, the verb, the
modes, the end, the strip). A key goes in the markup, in its slot, saying in
`data-for` (and `data-mini`) which sources it shows for. ▶ never moves,
between rooms or sources; J1.13 fails if it does, or if the bar runs off a
tablet. ▾ only opens a menu, and the bar folds by its grabber.

**Amended 2026-11-03** (the Transport's extraction, step 5g; agreed with
Gabe in call 1): in the rooms the bar's markup is the Transport's template
(`lib/components/transport/index.js`), not `shell.html`, whose `#np` is
an empty root the shell's boot mounts the component on. A new key goes in
that template, in its slot, named by `data-part` (the component gives it
its id through `cx.id`), and in `wave.html` too while Open keeps its own
bar.

## Why

The bar once had 232 selectors in 14 sections of `styles.css`, hid its keys
with `:not()` lists and `!important`, and ran off a tablet's right edge.

## What it rules out

A key appended by a script; a key shown or hidden by a `:not()` list; a ▾
that does anything but open a menu; a key of the rooms' bar written into
`shell.html`.

## See

`docs/architecture/bar.md`
