// web/static/lib/update.js
// The Update button, at the foot of Capture: "Hindsight v… · Update to v…".
//
// GET /api/update says whether a newer release is out (and is a 404 where
// updates aren't set up, so the button never shows). Update asks first --
// installing restarts Hindsight, and the ring starts empty -- then POSTs,
// and follows the install: the updater's own steps while Hindsight is up,
// "Restarting…" while it isn't, and a reload once /api/status reports the
// new version. If the install rolled back, it says so and stays.

import { toast } from './toast.js';

const POLL_MS = 1500;
const GIVE_UP_MS = 10 * 60 * 1000;
const SEEN_KEY = 'hindsight.updateSeen';

/** buttonLabel is the footer's words for an update: a release over a dev
 * build is an install, not an update. */
export function buttonLabel(info) {
  if (!info || !info.available || !info.latest) return '';
  return info.running === 'dev' ? `Install ${info.latest}` : `Update to ${info.latest}`;
}

/**
 * phase is where an update to `tag`, started at `since` (ms), has got to:
 * {done, ok, text}. `info` is GET /api/update's answer, or null while
 * Hindsight isn't answering; `status` is /api/status's, or null likewise.
 * The updater's state file outlives a run, so a state written before
 * `since`, or for another tag, is last time's and doesn't count. `since` is
 * the Pi's clock (POST /api/update's answer), like the stamps it's compared
 * with: a phone's clock needn't agree with the Pi's.
 */
export function phase(tag, since, info, status) {
  if (status && status.version === tag) return { done: true, ok: true, text: `Updated to ${tag}` };
  const u = info && info.update;
  const ours = u && u.tag === tag && Date.parse(u.at) >= since;
  if (ours && (u.state === 'rolled_back' || u.state === 'failed')) {
    return { done: true, ok: false, text: u.message || 'The update failed' };
  }
  if (!info && !status) return { done: false, text: 'Restarting…' };
  if (ours && u.message) return { done: false, text: cap(u.message) + '…' };
  return { done: false, text: 'Starting the update…' };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * initUpdate wires the footer and the sheet on the Capture page. Returns
 * nothing; on an install without the updater it does nothing at all.
 */
export async function initUpdate() {
  const about = document.querySelector('.about');
  const btn = document.getElementById('update-btn');
  const sheet = document.getElementById('update-sheet');
  if (!about || !btn || !sheet) return;

  let info;
  try {
    const r = await fetch('/api/update', { cache: 'no-store' });
    if (!r.ok) return; // 404: no updater here
    info = await r.json();
  } catch {
    return;
  }

  // A rolled-back or failed update from another device, or from before a
  // reload, is said once.
  const u = info.update;
  if (u && (u.state === 'rolled_back' || u.state === 'failed')) {
    let seen = '';
    try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch { /* fine */ }
    if (seen !== u.at && Date.now() - Date.parse(u.at) < 24 * 3600 * 1000) {
      toast(`Update to ${u.tag}: ${u.message}`, 'warn', 9000);
      try { localStorage.setItem(SEEN_KEY, u.at); } catch { /* fine */ }
    }
  }

  const label = buttonLabel(info);
  if (!label) return;
  btn.textContent = label;
  btn.hidden = false;
  about.classList.add('has-update');

  const $ = (sel) => sheet.querySelector(sel);
  const title = $('.update-title');
  const text = $('.update-text');
  const progress = $('.update-progress');
  const notes = $('.update-notes');
  const go = $('.update-go');
  const cancel = $('.update-cancel');
  let following = false;

  const reset = () => {
    title.textContent = label + '?';
    text.hidden = false;
    progress.hidden = true;
    progress.classList.remove('bad');
    go.hidden = false;
    go.disabled = false;
    cancel.textContent = 'Cancel';
    notes.hidden = !info.notes;
    if (info.notes) notes.href = info.notes;
  };

  btn.addEventListener('click', () => {
    if (following) { sheet.showModal(); return; }
    reset();
    sheet.showModal();
  });
  cancel.addEventListener('click', () => sheet.close());

  go.addEventListener('click', async () => {
    go.disabled = true;
    const tag = info.latest;
    let res;
    try {
      res = await fetch('/api/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      });
    } catch {
      res = null;
    }
    if (!res || res.status !== 202) {
      const body = res ? await res.json().catch(() => ({})) : {};
      progress.hidden = false;
      progress.classList.add('bad');
      progress.textContent = cap(body.error || 'Couldn’t reach Hindsight');
      go.disabled = false;
      return;
    }
    const ok = await res.json().catch(() => ({}));
    following = true;
    // The Pi's own clock, for telling this run's steps from the last one's.
    const since = Date.parse(ok.since);
    follow(tag, Number.isFinite(since) ? since : 0);
  });

  // While it installs: no going back to Cancel, only Close (the update goes
  // on regardless), and the sheet says where it's got to.
  async function follow(tag, since) {
    title.textContent = `Updating to ${tag}`;
    text.hidden = true;
    go.hidden = true;
    cancel.textContent = 'Close';
    progress.hidden = false;
    progress.textContent = 'Starting the update…';
    while (Date.now() - since < GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const [i, s] = await Promise.all([getJSON('/api/update'), getJSON('/api/status')]);
      const p = phase(tag, since, i, s);
      progress.textContent = p.text;
      if (p.done) {
        following = false;
        if (p.ok) {
          try { navigator.vibrate?.([12, 70, 12]); } catch { /* no haptics here */ }
          setTimeout(() => location.reload(), 900);
        } else {
          title.textContent = `Couldn’t update to ${tag}`;
          progress.classList.add('bad');
          if (!sheet.open) sheet.showModal();
        }
        return;
      }
    }
    following = false;
    progress.classList.add('bad');
    progress.textContent = 'It hasn’t come back after ten minutes. Check the Pi: journalctl _SYSTEMD_USER_UNIT=hindsight-update@' + tag + '.service';
  }
}
