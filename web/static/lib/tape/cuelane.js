// web/static/lib/tape/cuelane.js
// The Cue Lane (docs/plan/shell-roadmap.md):
// Staging swimlane above track 1 in the Studio. Clips placed here can be
// auditioned/soloed, loop-toggled, and dragged down onto tracks 1-4.

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
export function mountCueLane({ container, getTape, getLaneView, onEdit, onToast, signal }) {
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

  function onPointerDown(e, clip) {
    if (e.target.closest('button')) return; // let buttons handle their own clicks
    e.preventDefault();

    const chip = e.currentTarget;
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

  function update(cue = { solo: false, clips: [] }) {
    currentCue = cue || { solo: false, clips: [] };
    const clips = currentCue.clips || [];

    soloBtn.setAttribute('aria-pressed', String(!!currentCue.solo));
    countEl.textContent = String(clips.length);

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
        onEdit?.('cue-set', { clip: clip.id, cue_clip: { loop: !clip.loop } });
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
    cleanupDrag();
    container.innerHTML = '';
  }

  return { update, destroy };
}
