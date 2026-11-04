// web/static/lib/bar/press-light.js
// What a press on the keyboard lights, for its second (docs/architecture/push.md,
// *The keyboard's press*): the key it changed, in the press's role's colour
// (.kb-lit, styles.css), and a track's head for a Mixer press. Shared: the
// Transport's note over the bar's display (lib/components/transport/
// press-note.js) lights ▶ and ●, and the Studio (lib/tape/page.js) the head
// of the track a CATCH or DROP put a clip on (lightTrackHead).

const LIT_CLASS = 'kb-lit';

// What is lit, and the timer that puts it out, per element: a second press
// on the same key starts its second again.
const lights = new WeakMap();

/**
 * lightFor lights els in p's role for what is left of p's second
 * (p.ms): data-kb carries the role, and data-kb-track a Mixer press's
 * track, for its colour. env's timers are for tests.
 */
export function lightFor(els, p, env = {}) {
  const wait = env.setTimeout ?? setTimeout;
  const unwait = env.clearTimeout ?? clearTimeout;
  for (const el of els) {
    if (!el) continue;
    const was = lights.get(el);
    if (was) unwait(was);
    el.classList.add(LIT_CLASS);
    el.dataset.kb = p.role;
    if (p.track) el.dataset.kbTrack = String(p.track); else delete el.dataset.kbTrack;
    lights.set(el, wait(() => putOut(el), p.ms));
  }
}

function putOut(el) {
  lights.delete(el);
  el.classList.remove(LIT_CLASS);
  delete el.dataset.kb;
  delete el.dataset.kbTrack;
}

/**
 * lightTrackHead lights the head of the track p changed (p.track, 1 up),
 * among the Studio's lanes ({n, row}), when p lit a track: the Studio's own
 * part of a press (lib/tape/page.js). Answers the head lit, or null.
 */
export function lightTrackHead(lanes, p, env = {}) {
  if (!p || !p.lit.includes('track')) return null;
  const head = lanes.find((l) => l.n === p.track)?.row.querySelector('.tt-head') ?? null;
  if (head) lightFor([head], p, env);
  return head;
}
