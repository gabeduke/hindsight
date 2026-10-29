# 0051. The UI architecture guardrails

**Date:** 2026-10-16 (56267dce, the two rooms).

## Decision

Views read structured state from controllers and models and call controller
methods; visual objects come from `lib/objects/` and `lib/scene/`;
playheads, reels and counters step on the shared ticker and park when
paused; what a room replaces is hidden from the first paint; shell views
mount in `shell.html` and route listeners, polls and ticker steps through
`ctx`. `web/static/lib/architecture.test.js` holds them.

## Why

The rooms began as a proof of concept, and the guardrails name its shortcuts
so they don't come back: the shelf reading the bar by 2 Hz DOM scraping,
`.click()` on hidden legacy controls, reels turned by `@keyframes
room-spin` and the cassette's hubs by a CSS spin at one speed whatever the
packs (`architecture.test.js`, Guardrails 1, 2 and 2b), and a page flashing what a room
replaces before an async class hid it.

## What it rules out

DOM scraping, synthetic clicks, bespoke reel markup or spins, a room hidden
only after an `import()` or a `fetch()`.
