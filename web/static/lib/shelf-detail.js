// web/static/lib/shelf-detail.js
// The takes page's detail pane, on a screen wide enough for it: the take
// picked in the rack as a cassette (lib/cassette.js) -- its name and star,
// its bars with its selection, Play, the way into the take page, its downloads, Delete, and
// its flags. It plays through the list row's own player (TakesList.player),
// so the pane and the row never play over each other.
//
// A spine with a family (lib/shelf.js fold) lists the takes folded into it:
// its cuts, and its tape's earlier mixdowns. Pressing one shows it here, with
// a ‹ key back to the spine.

import { CassetteFace } from '/lib/cassette.js';
import { flagChips, parseBpm, tagOf, tapeName } from '/lib/shelf.js';
import { tagStore } from '/lib/tags.js';
import { openTagManager } from '/lib/tags-dialog.js';

const stamp = (t) => t.name.replace(/^jam_|\.wav$/g, '');
const fmtTime = (s) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
};

// clockOf is when a take was made, as a mix's line says it: the time today,
// the day and time before that.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

export class TakeDetail {
  /** takes is the page's TakesList; onToast shows a toast; onBack closes the
   *  pane when it's a phone's sheet (its "‹ Takes" key shows only then);
   *  onPick(name) picks a take from the pane (a family's line, its ‹, or a
   *  cut's original); isShown(name) says whether a take can be picked. */
  constructor(root, { takes, onToast, onBack, onPick, isShown }) {
    this.root = root;
    this.takes = takes;
    this.onToast = onToast;
    this.onPick = onPick;
    this.isShown = isShown || (() => false);
    this.name = null;
    this.ws = null;
    this.ac = null;
    this.gen = 0;
    root.innerHTML = `
      <button class="icon-btn sheet-back" type="button" aria-label="Back to the takes">‹ Takes</button>
      <button class="icon-btn detail-up" type="button" data-tip="detail-up" hidden></button>
      <div class="detail-head">
        <button class="star" type="button" aria-pressed="false" aria-label="Star this take" data-tip="star">★</button>
        <h2 class="detail-name"><button class="detail-rename" type="button" data-tip="rename"></button></h2>
        <input class="take-name-input detail-name-input" type="text" maxlength="120" aria-label="Name this take" hidden>
        <span class="detail-meta"><button class="detail-bpm" type="button" data-tip="bpm"></button><input class="take-bpm-input detail-bpm-input" type="text" inputmode="decimal" maxlength="7" aria-label="Tempo in beats per minute" hidden><span class="detail-meta-rest"></span></span>
      </div>
      <p class="detail-from" hidden></p>
      <div class="detail-tags" role="group" aria-label="Tag" data-tip="tag-pick"></div>
      <div class="detail-cassette"></div>
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
      <div class="detail-flags"></div>
      <section class="detail-family detail-cuts" data-tip="detail-cuts" aria-label="Cuts" hidden>
        <h3 class="detail-family-h">Cuts</h3><ol class="detail-family-list"></ol>
      </section>
      <section class="detail-family detail-mixes" data-tip="detail-mixes" aria-label="Earlier mixes" hidden>
        <h3 class="detail-family-h">Earlier mixes</h3><ol class="detail-family-list"></ol>
      </section>
      <a class="detail-crate" href="/tape.html" data-tip="detail-crate" hidden></a>`;
    this.el = (sel) => root.querySelector(sel);
    this.el('.sheet-back').addEventListener('click', () => onBack?.());
    // A family's line, a cut's original, or ‹ picks that take. The button
    // pressed is gone or hidden after, so focus goes to the new take's ‹ (or
    // its name), at the top of the pane.
    root.addEventListener('click', (e) => {
      const b = e.target.closest('.detail-member, .detail-source, .detail-up');
      if (!b?.dataset.name) return;
      onPick?.(b.dataset.name);
      const up = this.el('.detail-up');
      (up.hidden ? this.el('.detail-rename') : up).focus({ preventScroll: true });
      root.scrollTop = 0;
    });
    // A tag renamed or recolored: the chips, and the cassette's stripe.
    tagStore.subscribe(() => { if (this.take) { this.renderTags(); this.ws?.setTake(this.take); } });
    this.el('.detail-play').addEventListener('click', () => this.player?.toggle());
    this.el('.detail-delete').addEventListener('click', () => { if (this.name) takes.deleteByName(this.name); });
    this.el('.star').addEventListener('click', async () => {
      const t = this.take;
      if (!t) return;
      try { await takes.patchTake(t.name, { starred: !t.starred }); } catch (e) { onToast?.(`Could not star: ${e.message}`, 'bad'); }
    });
    // Rename and tempo, here rather than on the spines: the heading and the
    // tempo turn into fields, Enter or leaving saves, Escape puts them back.
    this.editor(this.el('.detail-rename'), this.el('.detail-name-input'), {
      value: (t) => t.label || '',
      placeholder: (t) => stamp(t),
      save: async (t, raw) => {
        const label = raw.trim();
        if (label === (t.label || '')) return;
        try { await takes.patchTake(t.name, { label }); } catch (e) { onToast?.(`Could not rename: ${e.message}`, 'bad'); }
      },
    });
    this.editor(this.el('.detail-bpm'), this.el('.detail-bpm-input'), {
      value: (t) => (t.bpm == null ? '' : String(t.bpm)),
      placeholder: () => 'bpm',
      save: async (t, raw) => {
        const parsed = parseBpm(raw);
        if (!parsed.ok) { onToast?.('Tempo must be a number above 0', 'bad'); return; }
        if (parsed.value === (t.bpm ?? null)) return;
        try { await takes.patchTake(t.name, { bpm: parsed.value }); } catch (e) { onToast?.(`Could not set tempo: ${e.message}`, 'bad'); }
      },
    });
    // A flag seeks the take to it.
    this.el('.detail-flags').addEventListener('click', (e) => {
      const b = e.target.closest('.detail-flag');
      const a = this.player?.audio;
      if (!b || !a || !this.take) return;
      a.currentTime = Number(b.dataset.frame) / (this.take.sample_rate || 48000);
      if (a.paused) this.player.toggle();
    });
  }

  // editor swaps a button for its field while editing.
  editor(btn, input, { value, placeholder, save }) {
    let editing = null; // the take being edited, as it was when editing began
    let refocus = false;
    const end = async (commit) => {
      if (!editing) return;
      const take = editing;
      editing = null;
      input.hidden = true;
      btn.hidden = false;
      // Back to the button after Enter or Escape; a Tab or a click elsewhere
      // goes where it was going.
      if (refocus) btn.focus();
      refocus = false;
      if (commit) await save(take, input.value);
    };
    btn.addEventListener('click', () => {
      if (!this.take) return;
      editing = this.take;
      input.value = value(this.take);
      input.placeholder = placeholder(this.take);
      btn.hidden = true;
      input.hidden = false;
      input.focus();
      input.select();
    });
    input.addEventListener('blur', () => end(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); refocus = true; input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); refocus = true; end(false); }
    });
  }

  /** show puts a take in the pane, or empties it for null. family is
   *  {spine, cuts, mixes} from lib/shelf.js familyOf, when it has one. */
  async show(t, family = null) {
    this.take = t;
    this.root.hidden = !t;
    if (!t) { this.gen++; this.loading = false; this.unmount(); this.name = null; return; }
    this.renderFamily(t, family);
    const sr = t.sample_rate || 48000;
    const star = this.el('.star');
    star.setAttribute('aria-pressed', String(!!t.starred));
    star.classList.toggle('on', !!t.starred);
    const rename = this.el('.detail-rename');
    rename.textContent = t.label || stamp(t);
    rename.classList.toggle('unlabelled', !t.label);
    const len = t.trim ? `${fmtTime((t.trim.end_frame - t.trim.start_frame) / sr)} of ${fmtTime(t.duration_seconds)}` : fmtTime(t.duration_seconds);
    const bpm = this.el('.detail-bpm');
    bpm.textContent = t.bpm == null ? '+ bpm' : `${t.bpm.toFixed(1)} bpm`;
    bpm.classList.toggle('unset', t.bpm == null);
    this.el('.detail-meta-rest').textContent = ' · ' + [len, `${(t.size_mb || 0).toFixed(1)} MB`, t.has_midi ? 'MIDI' : null].filter(Boolean).join(' · ');
    this.renderTags();
    this.el('.detail-sel').textContent = t.trim ? `selection ${fmtTime(t.trim.start_frame / sr)} – ${fmtTime(t.trim.end_frame / sr)}` : '';
    this.el('.detail-open').href = `/wave.html?file=${encodeURIComponent(t.name)}`;
    this.el('.detail-wav').href = `/api/download?file=${encodeURIComponent(t.name)}&dl=1`;
    const midi = this.el('.detail-midi');
    midi.hidden = !t.has_midi;
    if (t.has_midi) midi.href = `/api/download?file=${encodeURIComponent(t.midi_name)}&dl=1`;
    this.el('.detail-flags').replaceChildren(...flagChips(t).map((f) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'detail-flag';
      c.dataset.frame = String(f.frame);
      c.setAttribute('aria-label', `Play from ${f.label} at ${f.at}`);
      c.innerHTML = '<span aria-hidden="true">⚑</span><span class="flag-name"></span><span class="flag-at"></span>';
      c.querySelector('.flag-name').textContent = f.label;
      c.querySelector('.flag-at').textContent = f.at;
      return c;
    }));
    // The same take, drawn: just its selection. The same take, not drawn yet
    // (its preview was still encoding): try again below.
    if (t.name === this.name && this.ws) { this.ws.setTake(t); this.ws.setSelection(t.trim, (t.duration_seconds || 0) * sr); return; }
    if (t.name === this.name && this.loading) return;

    // A different take: draw it from its row's player.
    this.unmount();
    this.name = t.name;
    // Only the latest call draws: a slow load for an earlier pick (or the
    // same pick asked for twice) must not mount a second cassette.
    const gen = ++this.gen;
    this.loading = true;
    const p = await this.takes.player(t.name);
    if (gen !== this.gen) return;
    this.loading = false;
    this.unmount();
    this.player = p;
    const box = this.el('.detail-cassette');
    box.textContent = p ? '' : (t.has_preview ? 'waveform unavailable' : 'waveform pending…');
    box.classList.toggle('pending', !p);
    // No player yet: the next show() -- the next poll -- tries again.
    if (!p) return;
    this.ws = new CassetteFace({ container: box, peaks: p.peaks, duration: p.peaks.duration || t.duration_seconds, audio: p.audio, take: t });
    this.ws.setSelection(t.trim, (t.duration_seconds || 0) * sr);
    // The button follows the shared player, whichever view started it.
    this.ac = new AbortController();
    const label = () => { this.el('.detail-play').textContent = p.audio.paused ? 'Play' : 'Pause'; };
    for (const ev of ['play', 'pause', 'ended']) p.audio.addEventListener(ev, label, { signal: this.ac.signal });
    label();
  }

  /** renderFamily draws where the take sits in its family: the ‹ key back to
   *  the spine it's folded into, where it came from, and -- on the spine --
   *  the lines for its cuts and its tape's earlier mixes. */
  renderFamily(t, family) {
    const spine = family?.spine || t;
    const cuts = family?.cuts || [], mixes = family?.mixes || [];
    const src = t.source ? this.takes.all.find((x) => x.name === t.source.name) : null;
    const kept = this.crate?.get(t.name) || 0;
    const sig = JSON.stringify([t.name, t.source?.name, !!src, src?.label, this.isShown(t.source?.name || ''), spine.name, spine.label,
      [...cuts, ...mixes].map((m) => [m.name, m.label, m.duration_seconds]), kept]);
    if (sig === this.familySig) return; // a poll must not rebuild what's under a finger
    this.familySig = sig;

    const up = this.el('.detail-up');
    up.hidden = spine.name === t.name;
    up.dataset.name = spine.name;
    up.textContent = `‹ ${spine.label || stamp(spine)}`;
    up.setAttribute('aria-label', `Back to ${spine.label || stamp(spine)}`);

    // Where it came from: a cut's original (picked, or opened when a filter
    // hides it), or which of its tape's mixdowns this is.
    const from = this.el('.detail-from');
    from.replaceChildren();
    const tapeMixes = spine.origin === 'tape' ? [spine, ...mixes] : [];
    // The tape's name, from the label most of its mixdowns wear: one renamed
    // "final?" doesn't rename the tape, or every other mix.
    const tape = tapeName(tapeMixes);
    if (t.source) {
      const name = src ? src.label || stamp(src) : stamp({ name: t.source.name });
      from.append('Cut from ');
      if (src && this.isShown(src.name)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'detail-source';
        b.dataset.name = src.name;
        b.dataset.tip = 'source';
        b.textContent = `${name} ›`;
        from.append(b);
      } else if (src) {
        const a = document.createElement('a');
        a.className = 'detail-source';
        a.href = `/wave.html?file=${encodeURIComponent(src.name)}`;
        a.dataset.tip = 'source';
        a.textContent = `${name} ›`;
        from.append(a);
      } else {
        from.append(`${name}, which was deleted`);
      }
    } else if (tapeMixes.length > 1 && t.origin === 'tape') {
      const k = tapeMixes.length - tapeMixes.findIndex((m) => m.name === t.name);
      from.append(`Mix ${k} of ${tapeMixes.length} · ${tape || 'its tape'}`);
    }
    from.hidden = !from.childNodes.length;

    const sr = (x) => x.sample_rate || 48000;
    const line = (m, mark, name, span) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'detail-member';
      b.dataset.name = m.name;
      const parts = [['dm-mark', mark], ['dm-name', name], ['dm-span', span], ['dm-len', fmtTime(m.duration_seconds)]];
      for (const [cls, text] of parts) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        if (cls === 'dm-mark') s.setAttribute('aria-hidden', 'true');
        b.append(s);
      }
      li.append(b);
      return li;
    };
    const onSpine = spine.name === t.name;
    const cutBox = this.el('.detail-cuts');
    cutBox.hidden = !onSpine || !cuts.length;
    cutBox.querySelector('.detail-family-list').replaceChildren(...(onSpine ? cuts : []).map((c) => {
      const s = c.source;
      const span = s ? `${fmtTime(s.start_frame / sr(c))}–${fmtTime(s.end_frame / sr(c))}` : '';
      return line(c, '✂', c.label || stamp(c), span);
    }));
    // The clips kept from it on the crate: a link to them on the tape page.
    const crate = this.el('.detail-crate');
    crate.hidden = !kept;
    crate.textContent = `◫ ${kept} clip${kept === 1 ? '' : 's'} kept`;
    crate.href = `/tape.html?crate=${encodeURIComponent(t.name)}`;
    const mixBox = this.el('.detail-mixes');
    mixBox.hidden = !onSpine || !mixes.length;
    mixBox.querySelector('.detail-family-list').replaceChildren(...(onSpine ? mixes : []).map((m, i) => {
      const k = mixes.length - i;
      // Its number always; its own name too, if it's been given one.
      const own = m.label && m.label !== tape;
      return line(m, '◎', own ? `mix ${k} · ${m.label}` : `mix ${k}`, clockOf(m.created));
    }));
  }

  /** setCrate takes how many clips have been kept from each take (a Map of
   *  take name → count), for the pane's ◫ line. */
  setCrate(counts) {
    this.crate = counts;
    this.familySig = null;
  }

  /** renderTags draws the tag chips: one per tag, the take's lit; a press
   *  gives the take that tag, or takes it off if it already wears it. */
  renderTags() {
    const t = this.take, box = this.el('.detail-tags');
    if (!t) return;
    const own = tagOf(t, tagStore.list);
    const sig = `${t.name}|${own?.id}|${tagStore.list.map((g) => `${g.id}:${g.name}:${g.color}`).join(',')}`;
    if (sig === this.tagSig) return; // a poll must not rebuild what's under a finger
    this.tagSig = sig;
    const chips = tagStore.list.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tag-chip stripe-${g.color}`;
      b.setAttribute('aria-pressed', String(g.id === own?.id));
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, g.name);
      b.addEventListener('click', async () => {
        try { await this.takes.patchTake(t.name, { tag: g.id === own?.id ? '' : g.id }); }
        catch (e) { this.onToast?.(`Could not tag: ${e.message}`, 'bad'); }
      });
      return b;
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'chip tag-edit-btn';
    edit.textContent = tagStore.list.length ? 'Edit tags' : '+ New tag';
    edit.addEventListener('click', () => openTagManager({ onToast: this.onToast }));
    box.replaceChildren(...chips, edit);
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
