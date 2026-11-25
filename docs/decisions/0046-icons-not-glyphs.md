# 0046. A key's picture is an icon from the sprite

**Date:** 2026-10-24 (178fb62f).

## Decision

A key's picture is a symbol in `web/static/icons/ui.svg`, drawn through
`lib/ui/icons.js` (`icon`, `setIcon`) or the same `<svg class="i …">`
markup; a new one is a `<symbol>` and a name in `ICONS`. Any change to the
sprite moves its address (`SPRITE`'s `?v=`, a hash of the file) in
`icons.js`, `sw.js`'s `SHELL` and every `<use>`. A test reads a key's
state, never its picture.

`icons.test.js` enforces it for scripts (the glyphs they still type are
counted in `TYPED` and only go down) and for the header's, the bar's and
the ruler's keys in markup. Glyphs in other markup keys (the buffer's ✕,
the nudges' ◂ ▸) are not counted yet.

## Why

Each platform drew unicode glyphs in a fallback font of its own, and the
bar's ✎ ran off a tablet in CI's fonts. A browser keeps the SVG a `<use>`
names by its URL, even across a reload, so a symbol new to the old address
drew a blank key.

## What it rules out

A unicode glyph as a key's picture; a sprite change at the same address; a
test that reads a glyph.

## See

`docs/architecture/css-and-motion.md`, *Icons*
