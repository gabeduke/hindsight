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

**Amended 2026-11-14** (the calm Studio's decision 5, built as its step
7b): the display has two keys, not three: what plays (the source), and
how, its tempo over where it plays. The output's key of its own went: in
the Studio with the tape the tempo's key opens the tempo's panel, whose
last row opens the Output sheet, and anywhere else it opens the Output
sheet itself. The bar is the one owner of that key's press. Why: Gabe
called the Studio "so damn cluttered", and the calm Studio counts every
key at rest (its decision 1 puts the tempo and where it plays one tap away,
not always there); no journey of his counts where the tape plays, so in
the Studio it can be a row away, and one key on every room's bar is
saved. The deck kept its width, so ▶ did not move.

## Why

The bar once had 232 selectors in 14 sections of `styles.css`, hid its keys
with `:not()` lists and `!important`, and ran off a tablet's right edge.

## What it rules out

A key appended by a script; a key shown or hidden by a `:not()` list; a ▾
that does anything but open a menu; a key of the rooms' bar written into
`shell.html`.

## See

`docs/architecture/bar.md`
