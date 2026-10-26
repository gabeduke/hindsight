// Takes list.
//
// The bug that made previews feel broken: the old UI rebuilt the whole table
// with `tbody.innerHTML = ''` every 5 seconds, destroying whatever <audio>
// element was mid-playback. Nothing here ever replaces the container's
// contents wholesale — rows are keyed by filename and patched in place, the
// list is skipped entirely when the server's ETag is unchanged, and polling
// pauses outright while something is playing.

import { RowWave } from '/lib/wave/rowwave.js';
import { flagRequest } from '/lib/flags.js';
import { restoreTake } from '/lib/trash.js';
import { undoSkipped } from '/lib/toast.js';
import { withClient } from '/lib/client.js';
import { timedFetch } from '/lib/link.js';
import { onSchemeChange } from '/lib/theme.js';
import { stripeFor, STRIPES } from '/lib/objects/cassette-geom.js';
import { tagStore } from '/lib/tags.js';
import { parseBpm, tagOf, familyCounts, familySticker, cutsBack, freedBy } from '/lib/shelf.js';
import { takeTitle } from '/lib/rooms/takename.js';
import { icon } from '/lib/ui/icons.js';
import { GESTURE } from '/lib/ui/press.js';

/** setStripe puts one printed stripe on a spine, in place of the one it wore. */
function setStripe(el, n) {
  for (let i = 1; i <= STRIPES; i++) if (i !== n) el.classList.remove(`stripe-${i}`);
  el.classList.add(`stripe-${n}`);
}

// How long a press on a row is held to start selecting several takes.
const SELECT_HOLD_MS = GESTURE.HOLD.select;

const fmtTime = (s) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
};

const fmtSize = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`);

export class TakesList {
  /**
   * onToast(msg, kind, opts) shows a toast; onListChange() runs after the
   * list re-renders (a prune or a delete also changed the trash);
   * selectBar is the bar select mode shows, with #select-count, #sel-star,
   * #sel-export, #sel-delete and #sel-done inside.
   *
   * shape(takes) decides what is shown: groups of takes, each under a
   * heading ({label, takes}); an empty label draws no heading. By default
   * every take, in the server's order, under none. A group's `members` (a
   * Map, from lib/shelf.js) names the takes folded into each of its spines:
   * they get rows too, hidden, right after their spine, so the cassette pane
   * can play and delete them like any other. The take page's ◂ ▸ step
   * through what is shown, each spine's folded takes after it, or with
   * stepOrder 'all' through every take.
   *
   * onSelected() runs whenever the selection changes; touchHold makes a hold
   * select with a finger or a pen only (a mouse selects with ⇧-click and the
   * Select key); showFolded draws a spine's folded takes as rows under it
   * instead of hiding them (the Listening Room's List). All three are the
   * rooms': the defaults are the list as it was.
   *
   * spines draws each take as a cassette spine: on the takes page (the
   * rack) for picking, its controls on the picked take's cassette; with
   * spineAction 'play' (the main page's shelf), a press plays or pauses it.
   *
   * The Listening Room's List (lib/shell/views/room.js) also asks for
   * openKey, a › at each row's end that opens the take on its page, and
   * newFor, how long (ms) a take wears the NEW sticker after it was made.
   */
  constructor(container, emptyEl, { onToast, onListChange, onSelectChange, onSelected, touchHold = false, showFolded = false, selectBar, shape, stepOrder = 'shown', spines = false, spineAction = 'pick', onSpineHold, onPlay, onEnded, audioFor = null, openKey = false, newFor = 0 }) {
    // A take starting, and playing to its end: the page's now-playing bar hears of both.
    // Settles with the first list the Pi answers (bar/handoff.js waits for it).
    this.loaded = new Promise((resolve) => { this.markLoaded = resolve; });
    this.onPlay = onPlay;
    this.audioFor = audioFor;
    this.onSelectChange = onSelectChange; // select mode began or ended
    // The Listening Room (lib/room): the selection changed in any way, so its
    // spines can follow it; a hold selects with a finger or a pen only, not a
    // mouse; and a spine's folded takes are rows of the list, shown.
    this.onSelected = onSelected;
    this.touchHold = touchHold;
    this.showFolded = showFolded;
    this.onEnded = onEnded;
    this.spines = spines;
    this.spineAction = spineAction;
    this.openKey = openKey;
    this.newFor = newFor;
    if (spines && spineAction === 'play') {
      const act = (row) => {
        const r = row && this.rows.get(row.dataset.name);
        if (!r) return;
        // Pressed before its preview is ready: say so, rather than nothing.
        if (!r.data.has_preview) { this.onToast?.('Still encoding — a moment', 'warn'); return; }
        this.togglePlay(r);
      };
      // A hold opens the take where it can be named and edited
      // (onSpineHold); the release that ends it doesn't also play.
      let hold = 0, at = null, held = false;
      container.addEventListener('pointerdown', (e) => {
        const row = e.target.closest('.take.spine');
        if (!row || !onSpineHold || e.button > 0) return;
        at = { x: e.clientX, y: e.clientY };
        held = false;
        hold = setTimeout(() => { held = true; onSpineHold(row.dataset.name); }, SELECT_HOLD_MS);
      });
      container.addEventListener('pointermove', (e) => { if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > GESTURE.SLOP_PX) clearTimeout(hold); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) container.addEventListener(ev, () => { clearTimeout(hold); at = null; });
      container.addEventListener('contextmenu', (e) => { if (e.target.closest('.take.spine') && onSpineHold) e.preventDefault(); });
      container.addEventListener('click', (e) => { if (held) { held = false; return; } act(e.target.closest('.take.spine')); });
      container.addEventListener('keydown', (e) => {
        if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList?.contains('spine')) return;
        e.preventDefault();
        act(e.target);
      });
    }
    this.container = container;
    this.emptyEl = emptyEl;
    this.onToast = onToast;
    this.onListChange = onListChange;
    this.shape = shape || ((takes) => [{ label: '', takes }]);
    this.stepOrder = stepOrder;
    this.all = []; // every take, as the server last listed them
    this.shownCount = 0;
    /** @type {Map<string, HTMLElement>} heading label -> heading */
    this.headings = new Map();

    // Select mode: several takes at once (see enterSelect).
    this.selecting = false;
    this.selected = new Set();
    this.swallowClick = false;
    this.bar = selectBar || null;
    if (this.bar) {
      this.bar.querySelector('#sel-done').addEventListener('click', () => this.exitSelect());
      this.bar.querySelector('#sel-star').addEventListener('click', () => this.bulkStar());
      this.bar.querySelector('#sel-delete').addEventListener('click', () => this.bulkDelete());
      this.bar.querySelector('#sel-export').addEventListener('click', () => this.bulkExport());
      // In the Listening Room a dialog that is open (Tag, or the tag manager under it)
      // owns Escape: it closes and the selection stays.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !this.selecting) return;
        if (this.touchHold && document.querySelector('dialog[open]')) return;
        this.exitSelect();
      });
    }

    /** @type {Map<string, object>} name -> row state */
    this.rows = new Map();
    // Row waveforms are canvases: repaint them when the device turns dark or
    // light.
    onSchemeChange(() => { for (const row of this.rows.values()) row.ws?.draw(); });
    this.etag = null;
    this.playing = null; // name of the currently playing take
    this.fresh = null;
    this.reorderDeferred = false; // a render held back a move; see render()

    // A tag renamed, recolored or dropped changes the stripes, and what a
    // tag filter or a sort by tag shows.
    tagStore.subscribe(() => this.reshape());
    tagStore.load();

    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const name = e.target.dataset.name;
          const row = this.rows.get(name);
          if (row) this.mountWave(row);
          this.io.unobserve(e.target);
        }
      },
      { rootMargin: '160px' }
    );
  }

  /** True while audio is playing, so the caller can hold off polling. */
  isPlaying() {
    return this.playing !== null;
  }

  markFresh(name) {
    this.fresh = name;
  }

  // Same shape as confirmDelete below: drop the ETag and re-fetch. Metadata
  // writes are rare and user-initiated, the server owns ordering, and starring
  // reorders the list.
  async patchTake(name, patch) {
    const res = await fetch(`/api/take?file=${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: withClient({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const msg = await res.json().then((j) => j.error).catch(() => res.statusText);
      throw new Error(msg);
    }
    const body = await res.json().catch(() => ({}));
    // The write has landed. A failure past this point is a stale list, not a
    // failed write, and must not be thrown to a caller whose catch says
    // "could not star" — the next poll reconciles.
    this.etag = null;
    try {
      await this.refresh();
    } catch { /* next poll picks it up */ }
    return body;
  }

  async refresh() {
    const headers = {};
    if (this.etag) headers['If-None-Match'] = this.etag;

    const res = await timedFetch('/api/jams', { headers, cache: 'no-store' });
    if (res.status === 304) { this.markLoaded(); return; }
    if (!res.ok) throw new Error(`takes: HTTP ${res.status}`);

    this.etag = res.headers.get('ETag');
    const takes = await res.json();
    this.all = Array.isArray(takes) ? takes : [];
    this.reshape();
    this.onListChange?.();
    this.markLoaded();
  }

  /** reshape re-renders the last list through shape, without a fetch. */
  reshape() {
    this.render(this.shape(this.all));
  }

  render(groups) {
    const seen = new Set();
    const seenHeadings = new Set();
    const shown = [];
    this.reorderDeferred = false;

    // Keep DOM order matching the groups without touching other nodes. A row
    // being renamed is left where it is. Moving a node blurs any focused
    // input inside it, and the blur handler commits — so a poll that
    // reordered the list would silently save half a name the user never
    // confirmed. The move is deferred to endEdit instead.
    let pos = 0;
    const place = (node, editing) => {
      const at = this.container.children[pos++];
      if (at === node) return;
      if (editing) this.reorderDeferred = true;
      else this.container.insertBefore(node, at ?? null);
    };

    // The take page's ◂ ▸ order: each spine, then the takes folded into it.
    const order = [];
    const rowFor = (t) => {
      let row = this.rows.get(t.name);
      if (!row) {
        row = this.createRow(t);
        this.rows.set(t.name, row);
      }
      return row;
    };

    for (const g of groups) {
      if (g.label) {
        let h = this.headings.get(g.label);
        if (!h) {
          h = document.createElement('h3');
          // A month's name over its days, or a day's (lib/shelf.js shelve).
          h.className = g.kind === 'month' ? 'shelf-month' : 'shelf-day';
          h.textContent = g.label;
          this.headings.set(g.label, h);
        }
        seenHeadings.add(g.label);
        place(h, false);
      }
      for (const t of g.takes) {
        seen.add(t.name);
        shown.push(t.name);
        order.push(t.name);
        const members = g.members?.get(t.name) || [];
        const row = rowFor(t);
        // Hidden before updateRow, which mounts a waveform only on a row in view.
        row.el.hidden = false;
        row.el.classList.remove('folded');
        this.updateRow(row, t, { ...familyCounts(members), freed: freedBy(t.name, members) });
        place(row.el, row.editing || row.editingBpm);
        for (const m of members) {
          seen.add(m.name);
          order.push(m.name);
          const mr = rowFor(m);
          mr.el.hidden = !this.showFolded;
          mr.el.classList.add('folded');
          // Off the shelf, as a take leaving it was: not selected, not playing
          // with no control in sight. (Shown, it is a line of the list like
          // any other, and stays as it is.)
          if (!this.showFolded) {
            this.selected.delete(m.name);
            if (this.playing === m.name) mr.ws?.pause();
          }
          this.updateRow(mr, m, { ...NO_FAMILY, freed: freedBy(m.name, members) });
          place(mr.el, mr.editing || mr.editingBpm);
        }
      }
    }

    for (const [label, h] of this.headings) {
      if (seenHeadings.has(label)) continue;
      h.remove();
      this.headings.delete(label);
    }
    for (const [name, row] of this.rows) {
      if (seen.has(name)) continue;
      // Being renamed: keep it, or a new take arriving would take the input
      // away mid-word. endEdit re-renders, and it goes then.
      if (row.editing || row.editingBpm) { this.reorderDeferred = true; continue; }
      this.destroyRow(row);
      this.rows.delete(name);
      this.selected.delete(name);
    }
    if (this.selecting) this.renderSelect();

    this.shownCount = shown.length;
    this.emptyEl.hidden = shown.length > 0;
    // The take page's ◂ ▸ step through the takes in this order.
    const steps = this.stepOrder === 'all' ? this.all.map((t) => t.name) : order;
    try { sessionStorage.setItem('hindsight.order', JSON.stringify(steps)); } catch { /* fine */ }
  }

  // A cassette spine: the case edge, and on its J-card the side-A band, the
  // name, a star when starred, the length, printed bars and an LED. The row's
  // controls are all here, hidden and out of the tab order, so the code that
  // keeps a row up to date runs unchanged; the picked take's cassette is
  // where they're used.
  spineHTML() {
    return `
      <span class="take-check" aria-hidden="true"></span>
      <span class="spine-card">
        <span class="spine-side" aria-hidden="true">A</span>
        <div class="take-head" aria-hidden="true">
          <button class="star" type="button" aria-pressed="false" tabindex="-1">★</button>
          <button class="take-name" type="button" tabindex="-1"></button>
          <input class="take-name-input" type="text" maxlength="120" hidden tabindex="-1">
          <span class="take-info">
            <button class="take-bpm" type="button" tabindex="-1"></button>
            <input class="take-bpm-input" type="text" inputmode="decimal" maxlength="7" hidden tabindex="-1">
            <span class="take-meta"></span>
          </span>
        </div>
        <div class="wave pending" aria-hidden="true"></div>
        <span class="spine-led" aria-hidden="true"></span>
      </span>${this.openKey ? `
      <a class="spine-open" data-tip="open">${icon('right', { size: 20 })}</a>` : ''}
      <div class="take-actions" hidden>
        <button class="icon-btn play" type="button">Play</button>
        <a class="icon-btn open">Open</a>
        <a class="icon-btn dl" download>WAV</a>
        <a class="icon-btn midi" download hidden>MIDI</a>
        <button class="icon-btn danger del" type="button">Delete</button>
      </div>`;
  }

  createRow(t) {
    const el = document.createElement('article');
    el.className = 'take';
    el.dataset.name = t.name;
    el.innerHTML = this.spines ? this.spineHTML() : `
      <span class="take-check" aria-hidden="true"></span>
      <div class="take-head">
        <button class="star" type="button" aria-pressed="false" aria-label="Star this take" data-tip="star">★</button>
        <button class="take-name" type="button" data-tip="rename"></button>
        <input class="take-name-input" type="text" maxlength="120" hidden>
        <span class="take-info">
          <button class="take-bpm" type="button" data-tip="bpm"></button>
          <input class="take-bpm-input" type="text" inputmode="decimal" maxlength="7" hidden>
          <span class="take-meta"></span>
        </span>
      </div>
      <div class="wave pending">waveform pending…</div>
      <div class="take-actions">
        <button class="icon-btn play" type="button" data-tip="play">Play</button>
        <a class="icon-btn open" data-tip="open">Open</a>
        <a class="icon-btn dl" download data-tip="dl-wav">WAV</a>
        <a class="icon-btn midi" download hidden data-tip="dl-midi">MIDI</a>
        <button class="icon-btn danger del" type="button" data-tip="delete">Delete</button>
      </div>`;

    if (this.spines) {
      // The spine is the control: its parts are print on the J-card.
      el.classList.add('spine', 'sinks'); // and it sinks under a finger (lib/ui/keys.js)
      if (this.openKey) el.classList.add('opens'); // its › beside it
      setStripe(el, stripeFor(t, tagStore.list));
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      if (this.spineAction === 'play') el.setAttribute('aria-pressed', 'false');
    }

    const row = {
      name: t.name,
      el,
      nameEl: el.querySelector('.take-name'),
      nameInput: el.querySelector('.take-name-input'),
      starBtn: el.querySelector('.star'),
      bpmEl: el.querySelector('.take-bpm'),
      bpmInput: el.querySelector('.take-bpm-input'),
      editingBpm: false,
      editing: false,
      metaEl: el.querySelector('.take-meta'),
      waveEl: el.querySelector('.wave'),
      playBtn: el.querySelector('.play'),
      openEl: el.querySelector('.open'),
      dlEl: el.querySelector('.dl'),
      midiEl: el.querySelector('.midi'),
      delBtn: el.querySelector('.del'),
      openKey: el.querySelector('.spine-open'),
      ws: null,
      audio: null,
      mounting: false,
      waveUnavailable: false,
      data: t,
    };

    row.playBtn.addEventListener('click', () => this.togglePlay(row));
    row.delBtn.addEventListener('click', () => this.deleteTake(row));
    this.wireSelect(row);

    // Attached once, here, rather than in mountWave: mountWave can run more
    // than once for a row (it's guarded, but callers don't know that), and a
    // second listener would turn one dblclick into two flags. row.waveEl is
    // the same element across a wave's whole life, mounted or not.
    //
    // This is a *double*-click, not a click: a single click on the wave
    // seeks the playhead (RowWave), so a click here would both seek and
    // permanently write a flag -- there would be no way left to scrub a take
    // without marking it. Do not "simplify" this back to click.
    row.waveEl.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('take-flag')) return; // the tick's own click opens its editor
      if (!row.ws) return; // no mounted waveform to flag against (pending/unavailable placeholders)
      const t = row.data;
      const duration = t.duration_seconds || 0;
      if (!duration) return; // a take whose WAV header could not be read has no frame axis
      const r = row.waveEl.getBoundingClientRect();
      const frac = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.999999);
      const frame = Math.floor(frac * duration * (t.sample_rate || 48000));
      this.flagOp(row, 'add', { frame });
    });

    row.starBtn.addEventListener('click', async () => {
      const next = !row.data.starred;
      row.starBtn.disabled = true;
      try {
        await this.patchTake(row.name, { starred: next });
      } catch (err) {
        this.onToast?.(`Could not star: ${err.message}`, 'bad');
      } finally {
        row.starBtn.disabled = false;
      }
    });

    const beginEdit = () => {
      row.editing = true;
      row.nameInput.value = row.data.label || '';
      row.nameInput.placeholder = takeTitle({ name: row.data.name });
      row.nameEl.hidden = true;
      row.nameInput.hidden = false;
      row.nameInput.focus();
      row.nameInput.select();
    };

    const endEdit = async (commit) => {
      if (!row.editing) return;
      row.editing = false;
      row.nameInput.hidden = true;
      row.nameEl.hidden = false;

      const label = commit ? row.nameInput.value.trim() : null;
      if (commit && label !== (row.data.label || '')) {
        try {
          // patchTake re-fetches, which also flushes any deferred reorder.
          await this.patchTake(row.name, { label });
          return;
        } catch (err) {
          this.onToast?.(`Could not rename: ${err.message}`, 'bad');
        }
      }

      // Nothing was written, so nothing has re-rendered: put the list back in
      // server order if this edit held a move back.
      if (this.reorderDeferred) {
        this.etag = null;
        try {
          await this.refresh();
        } catch { /* next poll picks it up */ }
      }
    };

    row.nameEl.addEventListener('click', beginEdit);
    row.nameInput.addEventListener('blur', () => endEdit(true));
    row.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        row.nameInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        endEdit(false);
      }
    });

    const beginBpmEdit = () => {
      row.editingBpm = true;
      row.bpmInput.value = row.data.bpm == null ? '' : String(row.data.bpm);
      row.bpmInput.placeholder = 'bpm';
      row.bpmEl.hidden = true;
      row.bpmInput.hidden = false;
      row.bpmInput.focus();
      row.bpmInput.select();
    };

    const endBpmEdit = async (commit) => {
      if (!row.editingBpm) return;
      row.editingBpm = false;
      row.bpmInput.hidden = true;
      row.bpmEl.hidden = false;
      if (!commit) return;

      // Empty clears the field; see parseBpm.
      const parsed = parseBpm(row.bpmInput.value);
      if (!parsed.ok) {
        this.onToast?.('Tempo must be a number above 0', 'bad');
        return;
      }
      const next = parsed.value;
      const before = row.data.bpm ?? null;
      if (next === before) return;

      try {
        await this.patchTake(row.name, { bpm: next });
      } catch (err) {
        this.onToast?.(`Could not set tempo: ${err.message}`, 'bad');
      }
    };

    row.bpmEl.addEventListener('click', beginBpmEdit);
    row.bpmInput.addEventListener('blur', () => endBpmEdit(true));
    row.bpmInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        row.bpmInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        endBpmEdit(false);
      }
    });

    if (this.fresh === t.name) {
      el.classList.add('fresh');
      this.fresh = null;
      setTimeout(() => el.classList.remove('fresh'), 1400);
      // A new cassette on the shelf wears a sticker for a while (the
      // Listening Room's for a day: newFor, in updateRow).
      if (this.spines && !this.newFor) {
        const tag = document.createElement('span');
        tag.className = 'spine-new';
        tag.setAttribute('aria-hidden', 'true');
        tag.textContent = 'NEW';
        el.append(tag);
        setTimeout(() => tag.remove(), 6000);
      }
    }

    this.io.observe(el);
    return row;
  }

  /** fam is {cuts, mixes, freed}: on a spine, how many takes are folded
   *  into it; for any take, how many of those were cut from it, which come
   *  back onto the shelf if it's deleted. */
  updateRow(row, t, fam = NO_FAMILY) {
    row.data = t;
    row.family = fam;
    if (this.spines) setStripe(row.el, stripeFor(t, tagStore.list));
    row.starBtn.setAttribute('aria-pressed', t.starred ? 'true' : 'false');
    row.starBtn.classList.toggle('on', !!t.starred);
    // Skip while the user is mid-edit so a poll cannot overwrite what they
    // are typing.
    if (!row.editing) {
      // What the take is called everywhere (lib/rooms/takename.js): its name,
      // or the time a never-named take was caught.
      row.nameEl.textContent = takeTitle(t);
      row.nameEl.classList.toggle('unlabelled', !t.label);
    }
    // Skip while the user is mid-edit so a poll cannot overwrite what they are
    // typing -- the same reason the label is guarded above.
    if (!row.editingBpm) {
      row.bpmEl.textContent = t.bpm == null ? '+ bpm' : `${t.bpm.toFixed(1)} bpm`;
      row.bpmEl.classList.toggle('unset', t.bpm == null);
    }
    // With a selection, its length "of" the take's, as the take page's header
    // says it.
    const sr = t.sample_rate || 48000;
    const len = t.trim ? `${fmtTime((t.trim.end_frame - t.trim.start_frame) / sr)} of ${fmtTime(t.duration_seconds)}` : fmtTime(t.duration_seconds);
    row.metaEl.textContent = this.spines ? fmtTime(t.duration_seconds) : `${len} · ${fmtSize(t.size_mb)}`;
    if (this.spines) {
      const name = takeTitle(t);
      const encoding = !t.has_preview;
      row.el.setAttribute('aria-label', [name, len, t.starred ? 'starred' : null, tagOf(t, tagStore.list)?.name,
        fam.cuts ? plural(fam.cuts, 'cut') : null, fam.mixes ? plural(fam.mixes, 'mix', 'mixes') : null,
        encoding ? 'still encoding' : null].filter(Boolean).join(', '));
      // The family's count, printed on the J-card beside the length.
      const sticker = familySticker(fam);
      if (sticker && !row.foldEl) {
        row.foldEl = document.createElement('span');
        row.foldEl.className = 'spine-fold';
        row.foldEl.setAttribute('aria-hidden', 'true');
        row.metaEl.after(row.foldEl);
      }
      if (row.foldEl) {
        row.foldEl.textContent = sticker;
        row.foldEl.hidden = !sticker;
      }
      row.el.classList.toggle('encoding', encoding);
      if (encoding && this.spineAction === 'play') row.el.setAttribute('aria-disabled', 'true');
      else row.el.removeAttribute('aria-disabled');
    }
    row.ws?.setSelection(t.trim, (t.duration_seconds || 0) * sr);
    row.dlEl.href = `/api/download?file=${encodeURIComponent(t.name)}&dl=1`;
    row.openEl.href = `/wave.html?file=${encodeURIComponent(t.name)}`;
    if (row.openKey) {
      row.openKey.setAttribute('href', `/wave.html?file=${encodeURIComponent(t.name)}`);
      row.openKey.setAttribute('aria-label', `Open ${takeTitle(t)}`);
    }
    // NEW, on a take made in the last newFor ms: the shelf's sticker, on its row.
    const made = Date.parse(t.created || '');
    const isNew = this.newFor > 0 && made <= Date.now() + 60000 && Date.now() - made < this.newFor;
    row.el.classList.toggle('is-new', isNew);
    if (isNew && !row.newEl) {
      row.newEl = document.createElement('span');
      row.newEl.className = 'spine-new';
      row.newEl.setAttribute('aria-hidden', 'true');
      row.newEl.textContent = 'NEW';
      row.el.append(row.newEl);
    }
    if (row.newEl) row.newEl.hidden = !isNew;
    // The .mid exists only when something was received during the take, so
    // the button appears only then rather than sitting disabled on every row.
    row.midiEl.hidden = !t.has_midi;
    if (t.has_midi) {
      row.midiEl.href = `/api/download?file=${encodeURIComponent(t.midi_name)}&dl=1`;
    }

    const ready = t.has_preview;
    row.playBtn.disabled = !ready;
    if (!ready) {
      row.playBtn.textContent = 'Encoding…';
    } else if (row.ws && this.playing === row.name) {
      row.playBtn.textContent = 'Pause';
    } else {
      row.playBtn.textContent = 'Play';
    }

    // The waveform can only mount once its sidecar exists. row.waveUnavailable
    // stops this from retrying forever once mountWave has already settled on
    // "no peaks data" -- see mountWave's failure path below.
    if (t.has_peaks && !row.ws && !row.mounting && !row.waveUnavailable && this.isVisible(row.el)) {
      this.mountWave(row);
    }

    this.renderFlags(row);
  }

  // Draws every flag on this take as a tick over the waveform, at
  // frame / (duration * sample_rate) of the container's width. Runs from
  // updateRow, so every refresh redraws the layer from row.data rather than
  // patching it incrementally -- there is never a stale tick left behind.
  renderFlags(row) {
    const t = row.data;
    let layer = row.waveEl.querySelector('.take-flags');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'take-flags';
      row.waveEl.appendChild(layer);
    }
    layer.textContent = '';

    // duration_seconds and sample_rate come from the WAV header, and are zero
    // when the server could not read it; without a frame axis there is nowhere
    // sane to draw a tick, so skip the take rather than divide by zero.
    const totalFrames = (t.duration_seconds || 0) * (t.sample_rate || 48000);
    if (!totalFrames) return;

    for (const f of t.flags || []) {
      const tick = document.createElement('div');
      tick.className = 'take-flag';
      tick.style.left = `${((f.frame / totalFrames) * 100).toFixed(3)}%`;
      tick.title = f.label ? `${f.label} — click to rename` : 'click to name';
      if (f.label) {
        const chip = document.createElement('span');
        chip.className = 'take-flag-label';
        chip.textContent = f.label;
        tick.appendChild(chip);
      }
      tick.addEventListener('click', (e) => {
        e.stopPropagation(); // the click is the tick's; adding a flag is a dblclick on the wave
        this.editFlag(row, f, tick);
      });
      layer.appendChild(tick);
    }
  }

  // Opens an inline editor on a tick: a text input for the flag's label and
  // a remove button. Enter or blur commits, Escape cancels. The editor lives
  // inside the tick so it is positioned at the flag; only one is open at a
  // time because any refresh redraws the whole layer.
  editFlag(row, flag, tick) {
    if (tick.querySelector('.take-flag-edit')) return;
    const box = document.createElement('div');
    box.className = 'take-flag-edit';
    // Flip the editor to the left of the tick near the right edge so it
    // stays inside the waveform.
    if (parseFloat(tick.style.left) > 65) box.classList.add('flip');
    box.innerHTML = `<input type="text" maxlength="120" placeholder="name this moment">
      <button type="button" class="take-flag-rm" title="Remove flag" aria-label="Remove flag">×</button>`;
    const input = box.querySelector('input');
    const rm = box.querySelector('.take-flag-rm');
    input.value = flag.label || '';
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const label = input.value.trim();
      box.remove();
      if (commit && label !== (flag.label || '')) {
        this.flagOp(row, 'edit', { id: flag.id, label });
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => setTimeout(() => finish(true), 0));
    // The remove button must beat the input's blur (which would commit and
    // trigger a refresh that removes the button before it can be clicked).
    rm.addEventListener('mousedown', (e) => e.preventDefault());
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      done = true;
      box.remove();
      this.flagOp(row, 'remove', { id: flag.id }, flag);
    });
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    tick.appendChild(box);
    input.focus();
    input.select();
  }

  // One flag per request, by id (see /lib/flags.js), then a fresh list: the
  // ticks redraw from the server's own answer rather than from what was just
  // clicked, and a flag added from another device since is kept.
  async flagOp(row, op, args, flag) {
    try {
      const body = await flagRequest(row.name, op, args);
      if (body.cue_error) {
        // The sidecar -- the source of truth -- saved fine; only the WAV's
        // cue chunk, a derived export, failed to update. Worth a toast, not a
        // thrown error that would read as the flag edit itself having failed.
        this.onToast?.(body.cue_error, 'bad');
      } else if (op === 'remove' && body.undo?.op) {
        const opId = body.undo.op;
        this.onToast?.(flag?.label ? `Flag "${flag.label}" deleted` : 'Flag deleted', 'ok', {
          action: { label: 'Undo', run: () => this.undoOp(row.name, opId) },
        });
      }
    } catch (e) {
      this.onToast?.(`Could not update flags: ${e.message}`, 'bad');
      return;
    }
    this.etag = null;
    try {
      await this.refresh();
    } catch { /* next poll picks it up */ }
  }

  isVisible(el) {
    // A folded take's row is hidden, and a hidden box measures 0,0 -- which
    // would read as in view and load every folded take's waveform.
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > -200 && r.top < window.innerHeight + 200;
  }

  // mountWave loads a row's waveform once; a second caller while it loads
  // (the detail pane, say) waits for the same load rather than missing it.
  mountWave(row) {
    if (row.ws) return Promise.resolve();
    if (!row.mountP) row.mountP = this.loadWave(row).finally(() => { row.mountP = null; });
    return row.mountP;
  }

  async loadWave(row) {
    if (row.ws || row.mounting) return;
    const t = row.data;
    if (!t.has_peaks || !t.has_preview) return;
    row.mounting = true;

    let peaks = null;
    try {
      const res = await fetch(`/api/peaks?file=${encodeURIComponent(t.name)}`);
      if (res.ok) peaks = await res.json();
    } catch { /* fall through to a plain player */ }

    if (!peaks?.data?.length) {
      row.mounting = false;
      // Settle here rather than retry: without waveUnavailable, row.ws stays
      // unset, so the next updateRow calls mountWave again, and its async
      // continuation wipes the flag layer renderFlags just redrew -- an
      // indefinite flicker rather than a one-time failure.
      row.waveUnavailable = true;
      row.waveEl.textContent = 'waveform unavailable';
      this.renderFlags(row); // textContent above just wiped the flag layer
      return;
    }

    // preload="none" keeps a phone from pulling the mp3 until you press play;
    // the waveform is drawn from the precomputed peaks alone. When the engine
    // already holds the take's audio, reuse that element so a rebuilt row and
    // two shelves never make two elements for one take.
    const audio = this.audioFor ? this.audioFor(t) : (() => {
      const a = new Audio();
      a.preload = 'none';
      a.src = `/api/download?file=${encodeURIComponent(t.preview_name)}`;
      return a;
    })();

    row.waveEl.classList.remove('pending');
    row.waveEl.textContent = '';

    // A row draws on the dB scale the meters use (draw.js drawColumns); a
    // spine prints bars from the take's own levels, as its cassette does
    // (RowWave look 'spine', lib/objects/cassette.js).
    const ws = new RowWave({ container: row.waveEl, peaks, duration: peaks.duration || t.duration_seconds, audio, look: this.spines ? 'spine' : 'row' });
    row.peaks = peaks;
    ws.setSelection(t.trim, (t.duration_seconds || 0) * (t.sample_rate || 48000));

    ws.on('play', () => {
      this.stopOthers(row.name);
      this.playing = row.name;
      row.playBtn.textContent = 'Pause';
      row.el.classList.add('playing');
      if (this.spineAction === 'play') row.el.setAttribute('aria-pressed', 'true');
      this.onPlay?.(row.name);
    });
    ws.on('pause', () => {
      if (this.playing === row.name) this.playing = null;
      row.playBtn.textContent = 'Play';
      row.el.classList.remove('playing');
      if (this.spineAction === 'play') row.el.setAttribute('aria-pressed', 'false');
    });
    ws.on('finish', () => {
      if (this.playing === row.name) this.playing = null;
      row.playBtn.textContent = 'Play';
      row.el.classList.remove('playing');
      if (this.spineAction === 'play') row.el.setAttribute('aria-pressed', 'false');
      this.onEnded?.(row.name);
    });
    ws.on('error', () => {
      this.onToast?.('Preview failed to load', 'bad');
      if (this.playing === row.name) this.playing = null;
      row.playBtn.textContent = 'Play';
      row.el.classList.remove('playing');
      if (this.spineAction === 'play') row.el.setAttribute('aria-pressed', 'false');
    });

    // row.waveEl.textContent was just cleared to give the wave an empty
    // container, which also erased any flag layer an earlier updateRow had
    // drawn into the "pending" placeholder. Redraw it now that the container
    // holds the wave, or existing flags would stay invisible until the next
    // poll.
    this.renderFlags(row);

    row.ws = ws;
    row.audio = audio;
    row.mounting = false;
    // A spine picked before its bars were drawn prints them picked.
    if (row.el.classList.contains('picked')) ws.setPicked?.(true);
  }

  stopOthers(except) {
    for (const [name, row] of this.rows) {
      if (name !== except && row.ws?.isPlaying()) row.ws.pause();
    }
  }

  async togglePlay(row) {
    if (!this.rows.has(row.name) && row.audio) {
      try {
        if (!row.audio.paused && !row.audio.ended) row.audio.pause();
        else await row.audio.play();
      } catch (e) {
        this.onToast?.(`Playback blocked: ${e.message}`, 'bad');
      }
      return;
    }
    if (!row.ws) {
      await this.mountWave(row);
      if (!row.ws) return;
    }
    try {
      await row.ws.playPause();
    } catch (e) {
      this.onToast?.(`Playback blocked: ${e.message}`, 'bad');
    }
  }

  // Undo one change a toast offered to undo, by its id: a later edit
  // elsewhere on the take doesn't change what this Undo means.
  async undoOp(name, op) {
    try {
      const res = await fetch(`/api/take/undo?file=${encodeURIComponent(name)}&op=${encodeURIComponent(op)}`, { method: 'POST', headers: withClient() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.skipped) this.onToast?.(undoSkipped(body.skipped), 'warn');
    } catch (e) {
      this.onToast?.(`Could not undo: ${e.message}`, 'bad');
    }
    this.etag = null;
    try { await this.refresh(); } catch { /* next poll */ }
  }

  // Delete goes to the trash, so it doesn't ask: the toast offers Undo, and
  // Recently deleted keeps it for a week.
  /**
   * player gives a second view of a take its row's player: the takes page's
   * detail pane draws the same audio, so Play there and Play in the row are
   * one player. Null when the take has no waveform yet.
   */
  async player(name) {
    const row = this.rows.get(name);
    if (!row) return null;
    await this.mountWave(row);
    if (!row.ws) return null;
    return { audio: row.audio, peaks: row.peaks, toggle: () => this.togglePlay(row) };
  }

  /** deleteByName deletes a shown take, with the row's Undo. */
  deleteByName(name) {
    const row = this.rows.get(name);
    if (row) this.deleteTake(row);
  }

  async deleteTake(row) {
    const name = row.data.name;
    const label = takeTitle(row.data, { day: true });
    const cuts = row.family?.freed || 0;
    try {
      await this.trash([name]);
    } catch (e) {
      this.onToast?.(`Delete failed: ${e.message}`, 'bad');
      return;
    }
    this.onToast?.(`Deleted ${label}${cutsBack(cuts)}`, 'ok', { action: { label: 'Undo', run: () => this.restore([name]) } });
  }

  async trash(names) {
    let failed = null;
    for (const name of names) {
      const res = await fetch(`/api/delete?file=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch((e) => ({ ok: false, status: e.message }));
      if (!res.ok) failed = `HTTP ${res.status}`;
    }
    this.etag = null; // force the next refresh to re-render
    try { await this.refresh(); } catch { /* next poll */ }
    if (failed) throw new Error(failed);
  }

  async restore(names) {
    let failed = null;
    for (const name of names) {
      try { await restoreTake(name); } catch (e) { failed = e.message; }
    }
    this.etag = null;
    try { await this.refresh(); } catch { /* next poll */ }
    if (failed) this.onToast?.(`Could not restore: ${failed}`, 'bad');
    else this.onToast?.(names.length === 1 ? 'Restored, starred' : `Restored ${names.length} takes, starred`);
  }

  // --- several takes at once --------------------------------------------------
  // A long press on a row, or Select in the list's header, starts select
  // mode: taps then pick rows instead of doing what they'd do, and a bar at
  // the bottom stars, exports or deletes what's picked.

  wireSelect(row) {
    // A page without a select bar (the main page) has no select mode: a hold
    // there must not swallow the next tap for a mode that can't start.
    if (!this.bar) return;
    const el = row.el;
    let hold = 0, at = null;
    const cancel = () => { clearTimeout(hold); hold = 0; at = null; };
    el.addEventListener('pointerdown', (e) => {
      if (this.selecting || e.button > 0) return;
      // A mouse never holds in the Listening Room: ⇧-click and Select are its way in.
      if (this.touchHold && e.pointerType === 'mouse') return;
      // Controls keep their own press; the waveform and the row's body don't.
      if (e.target.closest('button, a, input, .take-flag, .take-flag-edit')) return;
      at = { x: e.clientX, y: e.clientY };
      hold = setTimeout(() => {
        hold = 0;
        // The release that ends this hold must not also toggle, or seek;
        // wherever it lands, stop waiting for its click soon after.
        this.swallowClick = true;
        document.addEventListener('pointerup', () => setTimeout(() => { this.swallowClick = false; }, GESTURE.LIFT_GRACE_MS), { once: true, capture: true });
        try { navigator.vibrate?.(10); } catch { /* not everywhere */ }
        this.enterSelect(row.name);
      }, SELECT_HOLD_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > GESTURE.SLOP_PX) cancel();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, cancel);
    // In select mode a tap anywhere on a row picks it; nothing inside the row
    // sees it. Caught on the way down, before the row's own handlers.
    const swallow = (e) => {
      if (!this.selecting) return;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', swallow, true);
    el.addEventListener('pointerup', swallow, true);
    el.addEventListener('dblclick', swallow, true);
    el.addEventListener('click', (e) => {
      if (!this.selecting) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.swallowClick) { this.swallowClick = false; return; }
      this.toggleSelected(row.name);
    }, true);
    el.addEventListener('contextmenu', (e) => { if (hold || this.selecting) e.preventDefault(); });
  }

  enterSelect(name) {
    if (!this.bar) return;
    this.selecting = true;
    this.selected.clear();
    if (name) this.selected.add(name);
    for (const r of this.rows.values()) r.ws?.pause();
    this.renderSelect();
    this.onSelectChange?.(true);
  }

  exitSelect() {
    this.selecting = false;
    this.selected.clear();
    this.swallowClick = false;
    this.renderSelect();
    this.onSelectChange?.(false);
  }

  toggleSelected(name) {
    if (this.selected.has(name)) this.selected.delete(name);
    else this.selected.add(name);
    this.renderSelect();
  }

  renderSelect() {
    document.body.classList.toggle('selecting', this.selecting);
    for (const [name, r] of this.rows) {
      const on = this.selecting && this.selected.has(name);
      r.el.classList.toggle('selected', on);
      // A spine is a button, which says it's selected with aria-pressed;
      // aria-selected is for rows of a list, and isn't read on a button.
      if (this.spines) {
        if (this.selecting) r.el.setAttribute('aria-pressed', String(on));
        else r.el.removeAttribute('aria-pressed');
      } else {
        r.el.setAttribute('aria-selected', this.selecting ? String(on) : 'false');
      }
    }
    this.onSelected?.();
    if (!this.bar) return;
    this.bar.hidden = !this.selecting;
    const n = this.selected.size;
    this.bar.querySelector('#select-count').textContent = n ? `${n} selected` : 'Tap takes to select';
    for (const id of ['#sel-star', '#sel-export', '#sel-delete']) this.bar.querySelector(id).disabled = n === 0;
    const allStarred = n > 0 && [...this.selected].every((k) => this.rows.get(k)?.data.starred);
    const star = this.bar.querySelector('#sel-star');
    star.textContent = allStarred ? '☆' : '★';
    star.setAttribute('aria-label', allStarred ? 'Unstar' : 'Star');
    const sb = document.getElementById('select-btn');
    if (sb) sb.textContent = this.selecting ? 'Done' : 'Select';
  }

  async bulkStar() {
    const names = [...this.selected];
    const allStarred = names.every((k) => this.rows.get(k)?.data.starred);
    let failed = 0;
    for (const name of names) {
      const res = await fetch(`/api/take?file=${encodeURIComponent(name)}`, {
        method: 'PATCH', headers: withClient({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ starred: !allStarred }),
      }).catch(() => ({ ok: false }));
      if (!res.ok) failed++;
    }
    this.etag = null;
    try { await this.refresh(); } catch { /* next poll */ }
    if (failed) this.onToast?.(`Could not star ${failed} of them`, 'bad');
    this.renderSelect();
  }

  /**
   * bulkTag gives every selected take the tag `tagId` ('' takes it off): one
   * PATCH each, then one fresh list. A take that can't be written is counted,
   * the rest still are. The selection stays, so ★ or Export can follow.
   */
  async bulkTag(tagId) {
    const names = [...this.selected];
    if (!names.length) return;
    let failed = 0;
    for (const name of names) {
      const res = await fetch(`/api/take?file=${encodeURIComponent(name)}`, {
        method: 'PATCH', headers: withClient({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tag: tagId }),
      }).catch(() => ({ ok: false }));
      if (!res.ok) failed++;
    }
    this.etag = null;
    try { await this.refresh(); } catch { /* next poll */ }
    if (failed) this.onToast?.(`Could not tag ${failed} of them`, 'bad');
    this.renderSelect();
  }

  async bulkDelete() {
    const names = [...this.selected];
    if (!names.length) return;
    // Counted now: the delete's re-render folds nothing into these any more.
    const cuts = names.reduce((n, k) => n + (this.rows.get(k)?.family?.freed || 0), 0);
    this.exitSelect();
    try {
      await this.trash(names);
    } catch (e) {
      this.onToast?.(`Some could not be deleted: ${e.message}`, 'bad');
    }
    const msg = (names.length === 1 ? 'Deleted 1 take' : `Deleted ${names.length} takes`) + cutsBack(cuts, names.length > 1);
    this.onToast?.(msg, 'ok', { action: { label: 'Undo', run: () => this.restore(names) } });
  }

  // One zip, streamed by the Pi: a plain download link, not a fetch, so a
  // big export never sits in the phone's memory.
  bulkExport() {
    const names = [...this.selected];
    if (!names.length) return;
    const a = document.createElement('a');
    a.href = exportURL(names);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.onToast?.(names.length === 1 ? 'Exporting 1 take…' : `Exporting ${names.length} takes…`);
  }

  destroyRow(row) {
    if (this.playing === row.name) this.playing = null;
    try { row.ws?.destroy(); } catch {}
    this.io.unobserve(row.el);
    row.el.remove();
  }
}

const NO_FAMILY = { cuts: 0, mixes: 0, freed: 0 };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** exportURL is the zip of several takes: GET /api/export?file=…&file=…. */
export function exportURL(names) {
  return `/api/export?${names.map((n) => `file=${encodeURIComponent(n)}`).join('&')}`;
}
