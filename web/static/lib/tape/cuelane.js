// web/static/lib/tape/cuelane.js
// The Cue Lane (docs/architecture/tape.md, The cue lane):
// Staging swimlane above track 1 in the Studio, where GRAB lands. Its clips
// are pads: a tap launches one on the next bar line (⇧: at once) and a
// second tap stops it, on the Pi (internal/tape/cuelive.go), its ring
// counting to the bar line meanwhile; a hold (or a right click) opens its
// drawer above the bar (lib/buffer/buffer.js), where Loop, Toss and the rest
// are; a drag puts it down on tracks 1-4. Solo leaves the lane alone in the
// output.

import { say, named } from '../rooms/words.js';
import { pressMachine, CUE_PRESS } from '../ui/press.js';
import { Loop } from '../objects/motion.js';
import { ringOf } from '../buffer/cueclip.js';

/**
 * frameAtX computes the timeline frame for an x coordinate given the viewport bounds.
 */
export function frameAtX(x, left, width, from, to) {
  if (width <= 0) return from;
  const pct = Math.max(0, Math.min(1, (x - left) / width));
  return Math.round(from + pct * (to - from));
}

/**
 * trackAtY identifies the target track (1-based index) given the pointer y and track rects.
 */
export function trackAtY(y, trackRects) {
  for (let i = 0; i < trackRects.length; i++) {
    const r = trackRects[i];
    if (y >= r.top && y <= r.bottom) {
      return i + 1;
    }
  }
  return null;
}

/**
 * formatClipLen formats a clip's length in seconds.
 */
export function formatClipLen(frames, sampleRate = 48000) {
  const secs = frames / sampleRate;
  return secs >= 10 ? `${Math.round(secs)}s` : `${secs.toFixed(1)}s`;
}

/**
 * mountCueLane mounts the cue lane into the given container. getPos is
 * where the tape is heard now, for the ring of a clip waiting for its bar
 * line; a hold on a clip says `hindsight:cue-select`, and the drawer says
 * which is open with `hindsight:cue-selected`.
 */
export function mountCueLane({ container, getTape, getLaneView, getPos = () => NaN, active = () => true, onEdit, onLaunch, onToast, signal }) {
  if (!container) return { update: () => {}, destroy: () => {} };

  container.innerHTML = `
    <div class="cue-head">
      <div class="cue-head-title">
        <span class="cue-tag">CUE</span>
        <span class="cue-count">0</span>
      </div>
      <button class="chip cue-solo" type="button" aria-pressed="false">Solo</button>
    </div>
    <div class="cue-lane">
      <span class="cue-empty">${say('Stage takes or parts here')}</span>
      <div class="cue-chip-list"></div>
    </div>
  `;

  const headEl = container.querySelector('.cue-head');
  const countEl = container.querySelector('.cue-count');
  const soloBtn = container.querySelector('.cue-solo');
  const laneEl = container.querySelector('.cue-lane');
  const emptyEl = container.querySelector('.cue-empty');
  const listEl = container.querySelector('.cue-chip-list');

  let currentCue = { solo: false, clips: [] };

  soloBtn.addEventListener('click', () => {
    onEdit?.('cue-solo', { solo: !currentCue.solo });
  }, signal ? { signal } : undefined);

  let activeDrag = null;
  // A press on a clip (CUE_PRESS): a tap launches it, a hold opens its
  // drawer, and once it has moved further than a finger wobbles it is a
  // drag. The click a drag ends on, back over its clip, is no tap.
  let press = null;
  let dragged = false;
  const DRAG_PX = CUE_PRESS.slop;
  const select = (clip) => document.dispatchEvent(new CustomEvent('hindsight:cue-select', { detail: { id: clip.id } }));

  function onPointerDown(e, clip, machine) {
    if (e.button > 0) return; // a right button is the drawer's (contextmenu), never a drag
    e.preventDefault();
    dragged = false;
    press = { clip, chip: e.currentTarget, x: e.clientX, y: e.clientY, machine };
    window.addEventListener('pointermove', onPressMove, signal ? { signal } : undefined);
    window.addEventListener('pointerup', endPress, signal ? { signal } : undefined);
    window.addEventListener('pointercancel', endPress, signal ? { signal } : undefined);
  }

  function endPress() {
    press = null;
    window.removeEventListener('pointermove', onPressMove);
    window.removeEventListener('pointerup', endPress);
    window.removeEventListener('pointercancel', endPress);
  }

  function onPressMove(e) {
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
    const { clip, chip, machine } = press;
    machine.cancel();
    endPress();
    dragged = true;
    startDrag(e, clip, chip);
  }

  function startDrag(e, clip, chip) {
    chip.classList.add('dragging');

    // Create drag ghost
    const ghost = document.createElement('div');
    ghost.className = 'cue-drag-ghost';
    ghost.textContent = clip.name || clip.file || say('part');
    ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
    document.body.appendChild(ghost);

    activeDrag = {
      clip,
      chip,
      ghost,
      targetTrack: null,
      targetAt: 0,
    };

    window.addEventListener('pointermove', onPointerMove, signal ? { signal } : undefined);
    window.addEventListener('pointerup', onPointerUp, signal ? { signal } : undefined);
    window.addEventListener('pointercancel', onPointerCancel, signal ? { signal } : undefined);
  }

  function onPointerMove(e) {
    if (!activeDrag) return;
    activeDrag.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;

    // Detect target track
    const tracks = document.querySelectorAll('.tape-track');
    const trackRects = Array.from(tracks).map((tr) => tr.getBoundingClientRect());
    const trNum = trackAtY(e.clientY, trackRects);

    tracks.forEach((tr, idx) => {
      tr.classList.toggle('drop-target', idx + 1 === trNum);
    });

    activeDrag.targetTrack = trNum;

    // Detect target timeline frame
    if (trNum && getLaneView) {
      const view = getLaneView();
      const laneCanvas = tracks[trNum - 1]?.querySelector('.tt-lane');
      if (laneCanvas && view) {
        const r = laneCanvas.getBoundingClientRect();
        activeDrag.targetAt = frameAtX(e.clientX, r.left, r.width, view.from, view.to);
      }
    }
  }

  function cleanupDrag() {
    if (!activeDrag) return;
    activeDrag.chip.classList.remove('dragging');
    activeDrag.ghost.remove();
    document.querySelectorAll('.tape-track').forEach((tr) => tr.classList.remove('drop-target'));
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerUp(e) {
    if (!activeDrag) return;
    const { clip, targetTrack, targetAt } = activeDrag;
    cleanupDrag();
    activeDrag = null;

    if (targetTrack && targetTrack >= 1 && targetTrack <= 4) {
      onEdit?.('cue-to-track', {
        clip: clip.id,
        track: targetTrack,
        at: Math.max(0, targetAt),
      });
      onToast?.(`Placed ${named(clip.name || clip.file || clip.id)} on track ${targetTrack}`, 'ok');
    }
  }

  function onPointerCancel() {
    cleanupDrag();
    activeDrag = null;
  }

  // The pads are built when the lane's parts change, not on every poll:
  // a press or a drag keeps the element it went down on. What plays, what
  // waits and which is open only light them (mark).
  let built = null;
  let open = '';
  let waiting = false;
  function mark(chip, clip, playing, queued) {
    const on = playing.has(clip.id);
    const wait = queued.has(clip.id);
    chip.classList.toggle('playing', on);
    chip.classList.toggle('queued', wait);
    chip.classList.toggle('open', clip.id === open);
    chip.setAttribute('aria-pressed', String(on));
    chip.setAttribute('aria-expanded', String(clip.id === open));
    const what = clip.name || clip.file;
    chip.setAttribute('aria-label', `${what}: ${on ? 'playing; tap to stop it on the next bar' : 'tap to launch it on the next bar'}; hold to open it`);
  }

  // The ring: while a pad waits for its bar line, its hand goes round the
  // bar, on the shared ticker, and parks when nothing waits or the Studio
  // is out of sight (the next poll that shows one waiting starts it again).
  const ring = new Loop(() => {
    const f = ringOf(getPos(), getTape?.()?.grid);
    for (const hand of listEl.querySelectorAll('.cue-pad.queued .cue-dial-hand')) {
      hand.style.transform = `rotate(${f == null ? 0 : (f * 360).toFixed(1)}deg)`;
    }
    return waiting && active();
  });

  // live is the Pi's live.cue: {playing: [ids], queued: [ids]}, or null.
  function update(cue = { solo: false, clips: [] }, live = null) {
    currentCue = cue || { solo: false, clips: [] };
    const playing = new Set(live?.playing || []);
    const queued = new Set(live?.queued || []);
    const clips = currentCue.clips || [];
    waiting = clips.some((c) => queued.has(c.id));
    if (waiting) ring.start();

    soloBtn.setAttribute('aria-pressed', String(!!currentCue.solo));
    countEl.textContent = String(clips.length);

    const key = JSON.stringify([clips.map((c) => [c.id, c.name, c.frames]), getTape?.()?.sample_rate]);
    if (key === built) {
      for (const clip of clips) {
        const chip = listEl.querySelector(`.cue-clip-chip[data-id="${CSS.escape(clip.id)}"]`);
        if (chip) mark(chip, clip, playing, queued);
      }
      return;
    }
    const first = built === null;
    built = key;

    if (clips.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }

    emptyEl.hidden = true;
    const had = new Set([...listEl.children].map((c) => c.dataset.id));
    listEl.innerHTML = '';

    const sr = getTape?.()?.sample_rate || 48000;

    for (const clip of clips) {
      const chip = document.createElement('div');
      chip.className = 'cue-clip-chip';
      chip.classList.add('cue-pad', 'sinks'); // a pad; it sinks under a finger (lib/ui/keys.js)
      // A clip that wasn't here a moment ago -- a GRAB -- comes in peeled
      // off the feed above it (styles.css, the cue lane).
      if (!first && !had.has(clip.id)) chip.classList.add('arriving');
      chip.dataset.id = clip.id;
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      mark(chip, clip, playing, queued);

      chip.innerHTML = `
        <span class="cue-dial" aria-hidden="true"><span class="cue-dial-hand"></span></span>
        <span class="cue-clip-name"></span>
        <span class="cue-clip-len">${formatClipLen(clip.frames, sr)}</span>
      `;
      chip.querySelector('.cue-clip-name').textContent = clip.name || clip.file;
      chip.addEventListener('animationend', () => chip.classList.remove('arriving'));

      // Each press asks for the clip as it is now: the lane is rebuilt
      // only when its parts change.
      const now = () => (currentCue.clips || []).find((c) => c.id === clip.id) || clip;
      const machine = pressMachine({
        ...CUE_PRESS,
        onTap: () => onLaunch?.(now(), { now: !!lastShift }),
        onHold: () => select(now()),
      });
      let lastShift = false;
      chip.addEventListener('pointerdown', (e) => { machine.down(e); onPointerDown(e, clip, machine); });
      chip.addEventListener('pointermove', machine.move);
      chip.addEventListener('pointerup', machine.up);
      for (const ev of ['pointercancel', 'pointerleave']) chip.addEventListener(ev, machine.cancel);
      chip.addEventListener('click', (e) => {
        if (dragged) { dragged = false; e.preventDefault(); return; }
        lastShift = !!e.shiftKey;
        machine.click(e);
      });
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chip.dispatchEvent(new MouseEvent('click', { shiftKey: e.shiftKey })); }
      });
      // A right click, or the keyboard's menu key: the drawer.
      chip.addEventListener('contextmenu', (e) => { e.preventDefault(); select(now()); });

      listEl.appendChild(chip);
    }
  }

  // Which clip the drawer is open on.
  const onSelected = (e) => {
    open = e.detail?.id || '';
    for (const chip of listEl.children) {
      chip.classList.toggle('open', chip.dataset.id === open);
      chip.setAttribute('aria-expanded', String(chip.dataset.id === open));
    }
  };
  document.addEventListener('hindsight:cue-selected', onSelected, signal ? { signal } : undefined);

  function destroy() {
    built = null;
    ring.stop();
    endPress();
    cleanupDrag();
    document.removeEventListener('hindsight:cue-selected', onSelected);
    container.innerHTML = '';
  }

  return { update, destroy };
}
