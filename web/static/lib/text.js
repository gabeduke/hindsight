// web/static/lib/text.js
// Writing text that changes often: a counter every frame, a meter's
// reading a hundred times a second.

/**
 * setText puts `v` in `el`, and does nothing if it's there already. Text
 * that changes is written into the element's own text node rather than
 * replacing it: `textContent =` takes the node out and puts a new one in,
 * and a child put in or taken out makes the browser look again at every
 * :has() rule whose subject is above it -- styles.css has `body:has(…)`
 * rules, so that was a style recalculation of most of the page for each
 * digit of the bar's counter, each frame the tape played (1.6 ms a write on
 * a desktop, ~150 times what writing the node costs). Becoming empty, or
 * not, still goes through textContent, so :empty sees it as it did. Text
 * written in place is spared only while no :has() in the stylesheets tests
 * :empty; text.test.js holds them to that.
 */
export function setText(el, v) {
  const s = String(v);
  const n = el.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling && s && n.data) {
    if (n.data !== s) n.data = s;
    return;
  }
  if (el.textContent !== s) el.textContent = s;
}
