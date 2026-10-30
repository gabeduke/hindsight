// web/static/lib/ui/reveal.js
// What a bar or a sheet floating over the foot of a phone's page would
// cover is brought into sight above it by scrolling the page, never by
// moving the sheet: a tapped clip's lane under its clip bar or the
// inspector (lib/tape/page.js), the cue lane and the armed track under a
// cue clip's drawer (lib/buffer/buffer.js).

/**
 * revealAbove scrolls `win` until each of `els` is `gap` px above `cover`'s
 * top, and no further than keeps the topmost of them `gap` px under
 * `ceiling` (a line from the top of the screen, a pinned header's foot; by
 * default none). What is in sight already doesn't move. Answers how far it
 * scrolled.
 */
export function revealAbove(els, cover, { win = globalThis, ceiling = -Infinity, gap = 8, reduced = false } = {}) {
  const boxes = els.filter(Boolean).map((e) => e.getBoundingClientRect());
  if (!boxes.length || !cover) return 0;
  const over = Math.max(...boxes.map((b) => b.bottom)) + gap - cover.getBoundingClientRect().top;
  const room = Math.min(...boxes.map((b) => b.top)) - gap - ceiling;
  const by = Math.min(over, room);
  if (!(by > 0)) return 0;
  win.scrollBy({ top: by, behavior: reduced ? 'auto' : 'smooth' });
  return by;
}
