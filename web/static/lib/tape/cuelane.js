// web/static/lib/tape/cuelane.js
// The Cue Lane (docs/plan/shell-roadmap.md):
// Staging swimlane above track 1 in the Studio. A tap on a clip launches it
// on the next bar line (⇧: at once) and a second tap stops it, on the Pi
// (internal/tape/cuelive.go); a drag puts it down on tracks 1-4. Solo leaves
// the lane alone in the output; ⟲ loops a clip.

import { say, named } from '../rooms/words.js';

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
 * mountCueLane mounts the cue lane into the given container.
 */
export function mountCueLane({ container, getTape, getLaneView, onEdit, onLaunch, onToast, signal }) {
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
  // A press on a clip: a tap if it lets go where it went down, a drag once
  // it has moved further than a finger wobbles.
  let press = null;
  const DRAG_PX = 8;

  function onPointerDown(e, clip) {
    if (e.target.closest('button')) return; // let buttons handle their own clicks
    e.preventDefault();
    press = { clip, chip: e.currentTarget, x: e.clientX, y: e.clientY };
    window.addEventListener('pointermove', onPressMove, signal ? { signal } : undefined);
    window.addEventListener('pointerup', onPressUp, signal ? { signal } : undefined);
    window.addEventListener('pointercancel', endPress, signal ? { signal } : undefined);
  }

  function endPress() {
    press = null;
    window.removeEventListener('pointermove', onPressMove);
    window.removeEventListener('pointerup', onPressUp);
    window.removeEventListener('pointercancel', endPress);
  }

  function onPressMove(e) {
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
    const { clip, chip } = press;
    endPress();
    startDrag(e, clip, chip);
  }

  function onPressUp(e) {
    if (!press) return;
    const { clip } = press;
    endPress();
    onLaunch?.(clip, { now: !!e.shiftKey });
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

  // The chips are built when the lane's parts change, not on every poll:
  // a press or a drag keeps the element it went down on. What plays only
  // lights them (mark).
  let built = null;
  function mark(chip, clip, playing, queued) {
    const on = playing.has(clip.id);
    chip.classList.toggle('playing', on);
    chip.classList.toggle('queued', queued.has(clip.id));
    chip.setAttribute('aria-pressed', String(on));
    chip.setAttribute('aria-label', `${clip.name || clip.file}: ${on ? 'playing; tap to stop it on the next bar' : 'tap to launch it on the next bar'}`);
  }

  // live is the Pi's live.cue: {playing: [ids], queued: [ids]}, or null.
  function update(cue = { solo: false, clips: [] }, live = null) {
    currentCue = cue || { solo: false, clips: [] };
    const playing = new Set(live?.playing || []);
    const queued = new Set(live?.queued || []);
    const clips = currentCue.clips || [];

    soloBtn.setAttribute('aria-pressed', String(!!currentCue.solo));
    countEl.textContent = String(clips.length);

    const key = JSON.stringify([clips, getTape?.()?.sample_rate]);
    if (key === built) {
      for (const clip of clips) {
        const chip = listEl.querySelector(`.cue-clip-chip[data-id="${CSS.escape(clip.id)}"]`);
        if (chip) mark(chip, clip, playing, queued);
      }
      return;
    }
    built = key;

    if (clips.length === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = '';

    const sr = getTape?.()?.sample_rate || 48000;

    for (const clip of clips) {
      const chip = document.createElement('div');
      chip.className = 'cue-clip-chip';
      chip.dataset.id = clip.id;
      chip.setAttribute('role', 'button');
      mark(chip, clip, playing, queued);

      chip.innerHTML = `
        <span class="cue-clip-grip" aria-hidden="true">⋮⋮</span>
        <span class="cue-clip-name" title="${clip.name || clip.file}">${clip.name || clip.file}</span>
        <span class="cue-clip-len">${formatClipLen(clip.frames, sr)}</span>
        <button class="chip cue-clip-loop" type="button" aria-pressed="${clip.loop ? 'true' : 'false'}" title="Toggle loop" aria-label="Toggle loop">⟲</button>
        <button class="cue-clip-remove" type="button" title="Remove" aria-label="Remove">×</button>
      `;

      chip.addEventListener('pointerdown', (e) => onPointerDown(e, clip));

      const loopBtn = chip.querySelector('.cue-clip-loop');
      loopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // cue-set writes every field it's given: send the clip whole.
        onEdit?.('cue-set', { cue_clip: { ...clip, loop: !clip.loop } });
      });

      const removeBtn = chip.querySelector('.cue-clip-remove');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onEdit?.('cue-remove', { clip: clip.id });
      });

      listEl.appendChild(chip);
    }
  }

  function destroy() {
    built = null;
    endPress();
    cleanupDrag();
    container.innerHTML = '';
  }

  return { update, destroy };
}
