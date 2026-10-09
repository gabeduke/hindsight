# Motion between pages, and sheets settling in

**Date:** 2026-10-09 · **Status:** proposed to Gabe · **Repo:** `hindsight`

## Why

The keys already give under a finger, the VU needles swing, the reels turn and
a fresh cassette slides onto the shelf. What was left were the seams:

- **Tabs were hard cuts.** Capture, Takes and Tape are three documents. A tab
  went to a blank page, then the new one drew in. In the installed app,
  that's the one moment that feels like a website.
- **Sheets popped.** A confirm, *Rename*, the phone recorder and the
  inspector appeared whole, and the room behind them went dim in a single
  frame.
- **Capture had no feel in the hand.** On a stand or in a pocket the toast is
  easy to miss, and the key's glow only shows if you're looking.

## What

- **Page to page: a cross-document view transition.**
  - The page underneath crossfades in 160 ms.
  - The tabs (`.appnav`, named `tabs`) stay put.
  - The lit tab (`tab-lit`) slides from the old tab to the new one in 280 ms,
    its words crossing over as it goes. On a wide screen that's the dark
    pill; on a phone it's the bar over the tab.
  - The opt-in, `@view-transition { navigation: auto }`, is an inline
    `<style>` in each page's `<head>`. In `styles.css` Chromium often hadn't
    parsed it by the new page's first paint and skipped the transition.
    Inline, it held every time in testing: Capture ↔ Takes ↔ Tape and the
    guide, in both directions.
  - A browser without view transitions navigates as before. iOS has them
    from Safari 18.2.
- **Sheets rise as they open.**
  - A `dialog.sheet` fades and rises 14 px in 220 ms.
  - Its backdrop fades in with it.
  - The inspector slides in from where it lives: from the right on a wide
    screen, up from the foot on a phone. It doesn't replay when the player
    closes over it.
  - Only opening is animated. A sheet closes at once, so a tap on what's
    behind it never waits on an animation.
- **A tab gives a little under the thumb:** `scale(.96)` on `:active`.
- **Capture is felt.**
  - It gives one 10 ms tick as it's pressed.
  - It gives two short ticks as soon as the save succeeds, with the toast.
  - This uses `navigator.vibrate`, as the gestures already do. Android only;
    iOS has no vibrate.
- **Reduced motion turns all of it off:**
  - The opt-in and the sheet keyframes sit in
    `@media (prefers-reduced-motion: no-preference)`.
  - The press's transition joins the existing reduced-motion rule for keys.
  - Haptics aren't motion, so they stay.
- **Cache v60.** This PR is stacked on the cassette icon PR, which is v59.
  Merge that PR first.

## Checked

- Frames at a tenth of normal speed, through CDP's `Animation.setPlaybackRate`:
  - the pill sliding on desktop and on a phone;
  - the phone sheet mid-rise;
  - computed `animation-name` on the inspector and a sheet at 1280 and 390 px,
    and `none` with reduced motion.
- 580 JS tests and `go test ./...` pass.

## Not done, worth a look later

- **A sliding thumb in the segmented controls** (30s / 2m / Full, ½× 1× 2×).
  Today the lit key swaps in place.
- **Closing animations for sheets,** with `transition-behavior:
  allow-discrete`. This needs care with the inspector's refill.
- **A sweep over the ribbon** showing the span that Capture just took.
- **A dark launch splash.** The manifest can't follow the scheme, so a phone
  in dark mode flashes the light deck for a moment.
