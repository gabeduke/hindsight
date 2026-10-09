# The cassette icon

**Date:** 2026-10-09 · **Status:** proposed to Gabe · **Repo:** `hindsight`

## Why

The old icon, green bars on navy, came from before the deck look. Nothing else
in the app is green-on-navy: the brand mark in the bar and the home-screen
icon were the only things that didn't look like Hindsight.

## What

- **The icon is a take, as the shelf draws one.** It's a cassette in black
  plastic, with a J-card label in cream and a `--stripe-1` orange stripe, a
  title scrawled in marker, the two reels in the window, and the take's
  waveform in `--wave` teal between them. The colours are the cassette's own
  tokens from `styles.css`.
- **There are three cuts of one drawing,** in `web/static/icons/`:

  | File | Used for |
  | --- | --- |
  | `icon.svg` | A rounded square with transparent corners and a hairline of light round the edge, so the black shell still has an edge on a dark home screen. It's the manifest's `any` icon, and `icon-192.png` and `icon-512.png` are rendered from it. |
  | `icon-full.svg` | Full bleed, with the cassette shrunk to 76% so it sits inside the maskable safe zone. `icon-maskable-512.png` and `apple-touch-icon.png` are rendered from it. iOS and Android round it themselves. |
  | `icon-small.svg` | Fewer, heavier parts: no screws, teeth, scrawl or waveform. It's the SVG favicon and the brand mark in the bar, and `favicon-32.png` is rendered from it. At 24–32 px, the detailed cut turns to mud. |

- **The scripts:** `scripts/icons/icon.mjs` writes the SVGs, and
  `scripts/icons/render.mjs` renders the PNGs in Chromium, with Playwright as
  in `scripts/screenshots.mjs`. To change the icon, change `icon.mjs` and run
  both.
- **The service worker** caches `icon-small.svg` and `favicon-32.png` with
  the shell, so the bar's mark draws offline. The cache goes to v59.

## Not changed

- `theme_color` and `background_color`, or the splash. The splash is still the
  light deck. A manifest can't follow the colour scheme, so a phone in dark
  mode flashes light for a moment on launch, as it did before.
