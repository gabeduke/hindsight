// web/static/lib/tape/menu-fit.js
// Keeps a header menu on the screen. The tape page's menus are placed by CSS
// from their button -- the ⋯ menu right-aligned to it -- and the button is at
// a phone's left edge, so the menu ran off it. Pure: the page measures the
// open menu and applies what this answers (page.js, showMenu).

/**
 * menuShift is how far, in px, a menu whose box is {left, right} moves along
 * x to sit inside a screen `width` wide, `margin` from each edge: right if it
 * is off the left, left if it is off the right, 0 if it fits. One too wide
 * for the screen lines up on its left edge, which carries the words.
 */
export function menuShift({ left, right }, width, margin = 8) {
  if (right - left > width - 2 * margin) return margin - left;
  if (left < margin) return margin - left;
  if (right > width - margin) return width - margin - right;
  return 0;
}
