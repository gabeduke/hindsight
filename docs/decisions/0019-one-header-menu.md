# 0019. The header's one menu, top right

**Date:** 2026-10-22 (Gabe; d00abae8).

## Decision

Settings, the rig, help mode, the guide and Releases are the header's one
menu, ☰ (`lib/nav.js` `mountHeaderTools`), last in the tools, top right on
every page. A new app-wide tool goes in the menu, never beside ☰. ☰ means
that menu and nothing else; a tab or a key gets an icon of its own.

## Gabe's words

*"moving unnecessary buttons into drawers or menus and focusing on the
handful of main user flows."*

## Why

One menu keeps the header to one row on a tablet, and the Studio's on a
phone ([0059](0059-the-studio-on-one-screen.md)). It came from the
usability review of 2026-10-22, where ☰ replaced four keys and a chip.

## What it rules out

A tool button beside ☰; ☰ used as the icon of a list or a tab; a rule that
hides ☰ or one of its items (`styles.test.js`).
