// web/static/lib/shell/views/room.js
// The Listening Room as a shell view (docs/architecture.md, The shell,
// step 4): the takes shelf and the rack under it, mounted once by the shell
// and driven through ctx so its polls, frame loops and global listeners go
// quiet while another room is shown.

import { TakesList } from '/lib/takes.js';
import { TrashList } from '/lib/trash.js';
import { toast as defaultToast, takeNextToast } from '/lib/toast.js';
import { shelve, tagCounts, fold, familyOf, matches } from '/lib/shelf.js';
import { tagStore } from '/lib/tags.js';
import { openTagManager } from '/lib/tags-dialog.js';
import { named } from '/lib/rooms/words.js';
import { TakeDetail } from '/lib/shelf-detail.js';
import { takesFinder } from '/lib/bar/engine.js';
import { timedFetch } from '/lib/link.js';
import { spanOf, firstOf, nextOf, doneAt } from '/lib/playall.js';
import { holdScreen } from '/lib/wakelock.js';
import { start as startRoom, BODY as ROOM_BODY } from '/lib/room/mount.js';

const $ = (id) => document.getElementById(id);

export const roomView = {
  id: 'room',
  title: 'Takes — Hindsight',
  name: 'Listening Room',
  // With the doorway's own (lib/room/mount.js BODY): the room, not the rack.
  bodyClass: ['shelf-page', ROOM_BODY.doorway],
  help: 'takes',
  // Mounted out of sight once the first room is up (router.js prewarm), so
  // the first turn to it is a reveal, not a mount and a module to load.
  prewarm: true,
  mount(ctx) {
    const headerEl = document.getElementById('header-room');
    if (headerEl) {
      headerEl.hidden = false;
      ctx.headerSlot.add(headerEl);
    }
    const toast = ctx.toast || defaultToast;
    const np = ctx.engine.bar;

    // This view is the Listening Room seen from the doorway (lib/room/doorway.js):
    // the rack is still here, under the room, doing what it does, and the room
    // asks it through the handle at the foot. A tap on a take there plays it in
    // the bar and a hold selects it.
    // What the room hears of: the list, and the selection.
    const roomHooks = { change: new Set(), selected: new Set() };
    const roomChanged = () => { for (const f of roomHooks.change) f(); };
    // The room's month box, opened to the rack: only that month's families.
    let roomFilter = null;

    // What the shelf shows, remembered per device. Never the search: a search
    // left in from last week would hide takes without saying why.
    const VIEW_KEY = 'hindsight.shelf';
    const view = { query: '', starred: false, midi: false, phone: false, tape: false, sort: 'newest', tag: '' };
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      for (const k of ['starred', 'midi', 'phone', 'tape']) view[k] = saved[k] === true;
      if (saved.sort === 'longest' || saved.sort === 'tag') view.sort = saved.sort;
      if (typeof saved.tag === 'string') view.tag = saved.tag;
    } catch { /* fine */ }
    function saveView() {
      try {
        const { starred, midi, phone, tape, sort, tag } = view;
        localStorage.setItem(VIEW_KEY, JSON.stringify({ starred, midi, phone, tape, sort, tag }));
      } catch { /* private mode */ }
    }

    // Asks before something that can't be undone: deleting from the trash, or
    // emptying it. Deleting a take doesn't ask; it goes to the trash.
    function confirmForever(title, name) {
      const dlg = $('confirm');
      return new Promise((resolve) => {
        if (typeof dlg.showModal !== 'function') {
          resolve(window.confirm(`${title} ${name}`));
          return;
        }
        $('confirm-title').textContent = title;
        $('confirm-name').textContent = name;
        dlg.returnValue = 'cancel';
        dlg.addEventListener('close', () => resolve(dlg.returnValue === 'delete'), { once: true });
        dlg.showModal();
      });
    }

    const trash = new TrashList($('trash'), {
      onToast: toast,
      onConfirm: confirmForever,
      onRestored: () => poll(true),
    });
    let trashTimer = 0;
    // What the shelf folded on its last draw (lib/shelf.js fold).
    let fam = fold([]);
    const takes = new TakesList($('takes'), $('takes-empty'), {
      onToast: toast,
      onListChange: () => {
        clearTimeout(trashTimer);
        trashTimer = setTimeout(() => trash.refresh(), 150);
        renderCounts();
        renderTagFilters();
        syncPick();
        renderPlayAll();
      },
      selectBar: $('select-bar'),
      // Select mode, however it starts (Select, a hold) or ends (Done, Escape):
      // Play all stops, and its key is off while it lasts.
      onSelectChange: () => { stopPlayAll({ pause: true }); renderPlayAll(); },
      // The Listening Room's: its spines follow the selection; a hold selects with
      // a finger or a pen, not a mouse; a family's takes are rows of the List.
      onSelected: () => { for (const f of roomHooks.selected) f(); },
      touchHold: true,
      showFolded: true,
      shape: (every) => {
        // The take on the deck stays in a month's box while the box is open: its
        // row is its player, and a row the rack drops stops playing.
        const all = roomFilter ? every.filter((t) => roomFilter(t) || (np && t.name === np.takeName)) : every;
        const opts = { ...view, tags: tagStore.list, tag: shownTag() };
        // The same fold the shelf is drawn from, for the pane's families.
        fam = fold(all.filter((t) => matches(t, opts)));
        return shelve(all, opts);
      },
      spines: true,
      audioFor: (t) => np.audioFor(t),
    });
    $('select-btn').addEventListener('click', () => (takes.selecting ? takes.exitSelect() : takes.enterSelect()));

    // --- the view: search, filters, sort --------------------------------------

    // The tag filter in force: one a tag was deleted from can't hide every take.
    function shownTag() {
      if (view.tag === '' || view.tag === 'none') return view.tag;
      return tagStore.list.some((g) => g.id === view.tag) ? view.tag : '';
    }

    // One chip per tag with how many takes wear it, the untagged, and the way
    // into the tag manager. Pressing the lit chip turns the filter off.
    function renderTagFilters() {
      const box = $('shelf-tags'), list = tagStore.list, on = shownTag();
      const n = tagCounts(takes.all, list);
      // A poll that changes nothing must not rebuild the chips under a finger.
      const sig = JSON.stringify([list, n, on]);
      if (sig === renderTagFilters.sig) return;
      renderTagFilters.sig = sig;
      const chip = (cls, label, pressed, run) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.setAttribute('aria-pressed', String(pressed));
        if (typeof label === 'string') b.textContent = label; else b.append(...label);
        b.addEventListener('click', run);
        return b;
      };
      const pickTag = (id) => { view.tag = view.tag === id ? '' : id; saveView(); renderTagFilters(); reshape(); };
      const els = list.map((g) => {
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.setAttribute('aria-hidden', 'true');
        const count = document.createElement('span');
        count.className = 'tag-n';
        count.textContent = String(n[g.id]);
        return chip(`icon-btn toggle tag-chip stripe-${g.color}`, [dot, g.name, ' ', count], on === g.id, () => pickTag(g.id));
      });
      if (list.length) els.push(chip('icon-btn toggle', `Untagged ${n['']}`, on === 'none', () => pickTag('none')));
      const edit = chip('chip tag-edit-btn', list.length ? 'Edit tags' : '+ Tags', false, () => openTagManager({ onToast: toast }));
      edit.setAttribute('data-tip', 'tags-edit');
      els.push(edit);
      box.replaceChildren(...els);
    }
    // After the list's own subscription has reshaped the shelf: a tag deleted, or
    // the tags loading under a saved tag filter, can fold the picked take.
    tagStore.subscribe(() => { renderTagFilters(); syncPick(); roomChanged(); });

    function renderControls() {
      for (const b of $('shelf-filters').querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(view[b.dataset.filter]));
      }
      for (const b of $('shelf-sort').querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.sort === view.sort));
      }
      renderTagFilters();
    }

    function reshape() {
      takes.reshape();
      renderCounts();
      syncPick();
      renderPlayAll(); // nothing shown: nothing to play
    }

    // --- the detail pane, on a wide screen ------------------------------------

    const wideMQ = matchMedia('(min-width: 1100px)');
    const wide = { get matches() { return false; }, addEventListener: (type, fn) => wideMQ.addEventListener(type, fn) };
    // Its phone sheet (the cassette over the page, with ‹ Takes and a history
    // entry of its own) went with the spine's sheet in F5a: nothing opens it.
    const detail = new TakeDetail($('take-detail'), {
      takes, onToast: toast, onPick: (name) => pick(name), isShown: (name) => present(name),
    });
    let picked = null;
    let pickedSpine = null;

    const shownNames = () => [...$('takes').querySelectorAll('.take:not(.folded)')].map((e) => e.dataset.name);
    const spineOf = (name) => (name && fam.under.get(name)) || name;
    const present = (name) => !!name && takes.rows.has(name) && (fam.under.has(name) || shownNames().includes(name));

    function showDetail(name) {
      const t = (name && takes.all.find((x) => x.name === name)) || null;
      detail.show(t, t ? familyOf(fam, t.name) : null);
    }

    function pick(name) {
      picked = name;
      pickedSpine = spineOf(name);
      for (const [n, row] of takes.rows) {
        const on = n === pickedSpine;
        row.el.classList.toggle('picked', on);
        row.el.setAttribute('aria-current', on ? 'true' : 'false');
        row.ws?.setPicked?.(on);
      }
      showDetail(wide.matches ? picked : null);
    }

    // --- Play all ------------------------------------------------------------------
    let playAll = null; // { name, audio, span, prev, watch, moving, off, lock }
    const playNames = () => shownNames();

    function renderPlayAll() {
      const b = $('play-all');
      b.textContent = playAll ? '■ Stop' : '▶ Play all';
      b.disabled = !playAll && (takes.selecting || !shownNames().length);
      for (const [n, row] of takes.rows) row.el.classList.toggle('play-all', !!playAll && n === playAll.name);
      roomChanged();
    }

    function stopPlayAll({ pause = false } = {}) {
      const r = playAll;
      if (!r) return;
      playAll = null;
      r.watch?.stop();
      r.off?.abort();
      r.lock?.release();
      if (pause && r.audio && !r.audio.paused) r.audio.pause();
      renderPlayAll();
    }

    function moveOn(r) {
      r.moving = true;
      r.off?.abort();
      r.watch?.stop();
      if (r.audio && !r.audio.paused) r.audio.pause();
      const next = nextOf(playNames(), r.name);
      if (next) playAllFrom(next); else stopPlayAll();
    }

    async function playAllFrom(name) {
      const r = playAll;
      try {
        const t = takes.all.find((x) => x.name === name);
        const was = { picked, bar: np.takeName, ejected: np.ejected };
        const p = t && await takes.player(name);
        if (playAll !== r) return;
        if (picked !== was.picked || np.takeName !== was.bar || np.ejected !== was.ejected) return stopPlayAll();
        if (!p) {
          const next = nextOf(playNames(), name);
          return next ? playAllFrom(next) : stopPlayAll();
        }
        r.name = name;
        r.span = spanOf(t);
        r.audio = p.audio;
        pick(name);
        np.loadTake(t, p);
        renderPlayAll();
        takes.rows.get(name)?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const a = p.audio;
        a.currentTime = r.span.from;
        r.prev = r.span.from;
        try {
          await a.play();
        } catch (e) {
          if (playAll !== r) return;
          if (e.name === 'NotAllowedError') {
            stopPlayAll();
            toast('This browser wants a tap to play each take: ▶ Play all goes on from here', 'warn');
            return;
          }
          toast(`Skipped ${named(t.label || name)}: it wouldn't play`, 'warn');
          moveOn(r);
          return;
        }
        if (playAll !== r) return;
        r.moving = false;
        r.off = new AbortController();
        const check = () => {
          if (playAll !== r || r.moving) return;
          if (picked !== r.name || np.takeName !== r.name || np.looping) return stopPlayAll();
          if (a.error) { moveOn(r); return; }
          const now = a.currentTime;
          const done = doneAt(r.span, r.prev, now, a.ended);
          r.prev = now;
          if (done) { moveOn(r); return; }
          if (a.paused) stopPlayAll();
        };
        const sig = { signal: r.off.signal };
        for (const ev of ['timeupdate', 'pause', 'ended', 'error']) a.addEventListener(ev, check, sig);
        a.addEventListener('seeked', () => { r.prev = a.currentTime; }, sig);
        r.watch?.stop();
        r.watch = ctx.loop(() => { check(); return playAll === r && !r.moving; });
        r.watch.start();
      } catch (e) {
        if (playAll === r) {
          stopPlayAll();
          toast(`Play all stopped: ${e.message}`, 'bad');
        }
      }
    }

    $('play-all').addEventListener('click', () => {
      if (playAll) { stopPlayAll({ pause: true }); return; }
      const first = firstOf(playNames(), pickedSpine);
      if (!first) return;
      playAll = { name: first, moving: true, lock: holdScreen() };
      renderPlayAll();
      playAllFrom(first);
    });

    const kept = () => (present(picked) ? picked : present(pickedSpine) ? pickedSpine : null);

    function syncPick() {
      if (!wide.matches) { pick(kept()); return; }
      pick(kept() || shownNames()[0] || null);
    }

    wide.addEventListener('change', syncPick);

    $('shelf-filters').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter]');
      if (!b) return;
      view[b.dataset.filter] = !view[b.dataset.filter];
      saveView();
      renderControls();
      reshape();
    });
    $('shelf-sort').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sort]');
      if (!b || b.dataset.sort === view.sort) return;
      view.sort = b.dataset.sort;
      saveView();
      renderControls();
      reshape();
    });
    let searchTimer = 0;
    $('shelf-q').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { view.query = e.target.value; reshape(); }, 120);
    });

    // --- counts and space ------------------------------------------------------

    let diskFree = null;
    const fmtGB = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

    function renderCounts() {
      const all = takes.all;
      $('shelf-count').textContent = String(takes.shownCount);
      const used = all.reduce((sum, t) => sum + (t.size_mb || 0), 0);
      const parts = [`${all.length} ${all.length === 1 ? 'take' : 'takes'}`, fmtGB(used)];
      if (diskFree != null) parts.push(`${diskFree >= 100 ? diskFree.toFixed(0) : diskFree.toFixed(1)} GB free`);
      $('shelf-store').textContent = parts.join(' · ');
      $('takes-empty').textContent = all.length
        ? 'No takes match. Turn a filter off, or clear the search.'
        : 'No takes yet. Capture one on the main page.';
    }

    async function pollStatus() {
      try {
        const res = await timedFetch('/api/status', { cache: 'no-store' });
        if (!res.ok) return;
        diskFree = (await res.json()).disk_free_gb ?? null;
        renderCounts();
      } catch { /* the next tick retries */ }
    }

    // --- the list --------------------------------------------------------------

    const SCROLL_KEY = 'hindsight.shelf.scroll';
    let restoreScroll = null;
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.type === 'back_forward') restoreScroll = Number(sessionStorage.getItem(SCROLL_KEY)) || null;
    } catch { /* fine */ }
    ctx.on(window, 'pagehide', () => {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* fine */ }
    });

    async function poll(force = false) {
      if (!force && (takes.isPlaying() || playAll)) return;
      try {
        await takes.refresh();
        ctx.link?.ok('takes');
        if (restoreScroll != null) { window.scrollTo(0, restoreScroll); restoreScroll = null; }
      } catch { ctx.link?.fail('takes'); }
    }

    function showNextToast() {
      const next = takeNextToast();
      if (!next) return;
      const opts = next.restore ? { action: { label: 'Undo', run: () => takes.restore([next.restore]) } } : {};
      toast(next.msg, next.kind || 'ok', opts);
    }

    ctx.on(window, 'pageshow', (e) => {
      if (!e.persisted) return;
      showNextToast();
      poll(true);
    });

    let roomInst = null;
    ctx.engine.setFind?.(takesFinder(takes));
    ctx.engine.setOnNote?.((f) => roomInst?.openSketchbook?.(f.take, f));

    renderControls();
    showNextToast();
    ctx.every(() => poll(), 5000);
    ctx.every(pollStatus, 15000);

    // --- the Listening Room ----------------------------------------------------
    const ready = startRoom('doorway', {
      takes, toast, tapes: ctx.tapes,
      get np() { return np; },
      barSlot: ctx.barSlot,
      go: (u) => ctx.go(u),
      openSketchbook: (name, f) => roomInst?.openSketchbook?.(name, f),
      opts: () => ({ ...view, tags: tagStore.list, tag: shownTag() }),
      pick: (name) => pick(name),
      rack: $('takes'),
      selectBar: $('select-bar'),
      setFilter: (fn) => { roomFilter = fn; reshape(); },
      clearFilter: () => {
        view.query = '';
        $('shelf-q').value = '';
        for (const k of ['starred', 'midi', 'phone', 'tape']) view[k] = false;
        view.tag = '';
        saveView();
        renderControls();
        reshape();
      },
      onChange: (fn) => roomHooks.change.add(fn),
      onSelected: (fn) => roomHooks.selected.add(fn),
      poll: () => poll(true),
    })?.then((inst) => { roomInst = inst; }).catch((e) => console.error('The Listening Room could not start:', e));

    return {
      ready,
      show({ first }) {
        if (!first) {
          showNextToast();
          roomInst?.render?.();
          roomInst?.renderPlaces?.();
        }
      },
      hide() {
        if (takes.selecting) takes.exitSelect();
        roomInst?.hide?.();
      },
      destroy() {
        stopPlayAll();
        roomInst?.destroy?.();
      },
    };
  },
};
