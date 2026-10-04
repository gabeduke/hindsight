// web/static/lib/shelf-detail.js
// The takes page's detail pane, on a screen wide enough for it: the take
// picked in the list, large -- its name and star, its waveform with its
// selection, Play, the way into the take page, its downloads, Delete, and
// its flags. It plays through the list row's own player (TakesList.player),
// so the pane and the row never play over each other.

import { RowWave } from '/lib/wave/rowwave.js';
import { flagChips } from '/lib/shelf.js';

const stamp = (t) => t.name.replace(/^jam_|\.wav$/g, '');
const fmtTime = (s) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
};

export class TakeDetail {
  /** takes is the page's TakesList; onToast shows a toast. */
  constructor(root, { takes, onToast }) {
    this.root = root;
    this.takes = takes;
    this.onToast = onToast;
    this.name = null;
    this.ws = null;
    this.ac = null;
    root.innerHTML = `
      <div class="detail-head">
        <button class="star" type="button" aria-pressed="false" aria-label="Star this take" data-tip="star">★</button>
        <h2 class="detail-name"></h2>
        <span class="detail-meta"></span>
      </div>
      <div class="detail-wave wave"></div>
      <div class="detail-actions">
        <button class="icon-btn play detail-play" type="button" data-tip="play">Play</button>
        <span class="detail-sel"></span>
        <span class="appbar-spacer"></span>
        <a class="icon-btn primary detail-open" data-tip="open">Open the take ›</a>
      </div>
      <div class="detail-more">
        <a class="icon-btn detail-wav" download data-tip="dl-wav">Download WAV</a>
        <a class="icon-btn detail-midi" download data-tip="dl-midi">Download MIDI</a>
        <span class="appbar-spacer"></span>
        <button class="icon-btn danger detail-delete" type="button" data-tip="delete">Delete</button>
      </div>
      <div class="detail-flags"></div>`;
    this.el = (sel) => root.querySelector(sel);
    this.el('.detail-play').addEventListener('click', () => this.player?.toggle());
    this.el('.detail-delete').addEventListener('click', () => { if (this.name) takes.deleteByName(this.name); });
    this.el('.star').addEventListener('click', async () => {
      const t = this.take;
      if (!t) return;
      try { await takes.patchTake(t.name, { starred: !t.starred }); } catch (e) { onToast?.(`Could not star: ${e.message}`, 'bad'); }
    });
  }

  /** show puts a take in the pane, or empties it for null. */
  async show(t) {
    this.take = t;
    this.root.hidden = !t;
    if (!t) { this.unmount(); this.name = null; return; }
    const sr = t.sample_rate || 48000;
    const star = this.el('.star');
    star.setAttribute('aria-pressed', String(!!t.starred));
    star.classList.toggle('on', !!t.starred);
    this.el('.detail-name').textContent = t.label || stamp(t);
    const len = t.trim ? `${fmtTime((t.trim.end_frame - t.trim.start_frame) / sr)} of ${fmtTime(t.duration_seconds)}` : fmtTime(t.duration_seconds);
    this.el('.detail-meta').textContent = [t.bpm == null ? null : `${t.bpm.toFixed(1)} bpm`, len, `${(t.size_mb || 0).toFixed(1)} MB`, t.has_midi ? 'MIDI' : null].filter(Boolean).join(' · ');
    this.el('.detail-sel').textContent = t.trim ? `selection ${fmtTime(t.trim.start_frame / sr)} – ${fmtTime(t.trim.end_frame / sr)}` : '';
    this.el('.detail-open').href = `/wave.html?file=${encodeURIComponent(t.name)}`;
    this.el('.detail-wav').href = `/api/download?file=${encodeURIComponent(t.name)}&dl=1`;
    const midi = this.el('.detail-midi');
    midi.hidden = !t.has_midi;
    if (t.has_midi) midi.href = `/api/download?file=${encodeURIComponent(t.midi_name)}&dl=1`;
    this.el('.detail-flags').replaceChildren(...flagChips(t).map((f) => {
      const c = document.createElement('span');
      c.className = 'detail-flag';
      c.innerHTML = '<span aria-hidden="true">⚑</span><span class="flag-name"></span><span class="flag-at"></span>';
      c.querySelector('.flag-name').textContent = f.label;
      c.querySelector('.flag-at').textContent = f.at;
      return c;
    }));
    if (t.name === this.name) { this.ws?.setSelection(t.trim, (t.duration_seconds || 0) * sr); return; }

    // A different take: draw it from its row's player.
    this.unmount();
    this.name = t.name;
    const name = t.name;
    const p = await this.takes.player(name);
    if (this.name !== name) return; // picked another meanwhile
    this.player = p;
    const box = this.el('.detail-wave');
    box.textContent = p ? '' : 'waveform pending…';
    box.classList.toggle('pending', !p);
    if (!p) return;
    this.ws = new RowWave({ container: box, peaks: p.peaks, duration: p.peaks.duration || t.duration_seconds, audio: p.audio });
    this.ws.setSelection(t.trim, (t.duration_seconds || 0) * sr);
    // The button follows the shared player, whichever view started it.
    this.ac = new AbortController();
    const label = () => { this.el('.detail-play').textContent = p.audio.paused ? 'Play' : 'Pause'; };
    for (const ev of ['play', 'pause', 'ended']) p.audio.addEventListener(ev, label, { signal: this.ac.signal });
    label();
  }

  unmount() {
    this.ac?.abort();
    this.ac = null;
    // Not destroy(): that pauses the audio, which the row still owns.
    this.ws?.detach();
    this.ws = null;
    this.player = null;
    this.el('.detail-play').textContent = 'Play';
  }
}
