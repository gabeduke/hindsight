// web/static/lib/update.js
// Updating, from the header's Releases button (lib/nav.js), which shows the
// running version and "Update to v…" when there's a newer release; and from
// the Settings sheet's about line (lib/settings.js), which asks for this
// sheet with the `hindsight:releases` event -- a phone's header has no room
// for Releases.
//
// GET /api/update says whether a newer release is out (and is a 404 where
// updates aren't set up, so none of this shows). It's asked when the page
// loads, every hour while it stays open, and on coming back to the tab --
// but not where /api/status says there is no updater (`updates: false`): a
// 404 is logged in red on every load whatever a page does with it.
//
// Releases, or the Update line, opens a sheet listing every release the
// button can install (GET /api/update/releases, from the first with the
// updater up). Pick one and the sheet says what moving to it brings in, or,
// going back, takes out: each release's notes between the running version
// and the pick. Then it asks -- installing restarts Hindsight, and the ring
// starts empty -- POSTs, and follows the install: the updater's own steps
// while Hindsight is up, "Restarting…" while it isn't, and a reload once
// /api/status reports the new version. If the install rolled back, it says
// so and stays.

import { toast } from './toast.js';

const POLL_MS = 1500;
const GIVE_UP_MS = 10 * 60 * 1000;
const RECHECK_MS = 60 * 60 * 1000;
const RECHECK_ON_RETURN_MS = 10 * 60 * 1000;
const SEEN_KEY = 'hindsight.updateSeen';

/**
 * versionParts is a version's numbers: v2026.10.09.3 is [2026, 10, 9, 3].
 * What follows "-" or "+" (git describe's commits and hash, on a deploy.sh
 * build) is set aside; anything that isn't a release is null.
 */
export function versionParts(v) {
  if (typeof v !== 'string' || !v.startsWith('v')) return null;
  const base = v.slice(1).split(/[-+]/)[0];
  const parts = base.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  return parts.length && parts.every(Number.isFinite) ? parts : null;
}

/** cmpVersion is -1, 0 or 1 by number, or null if either isn't a release. */
export function cmpVersion(a, b) {
  const x = versionParts(a), y = versionParts(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] || 0, q = y[i] || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** ahead says a version is a release plus commits (deploy.sh's stamp). */
const ahead = (v) => typeof v === 'string' && /^v[\d.]+[-+]/.test(v);

/** buttonLabel is the footer's words for an update: a release over a build
 * that isn't one is an install, not an update. */
export function buttonLabel(info) {
  if (!info || !info.available || !info.latest) return '';
  return versionParts(info.running) ? `Update to ${info.latest}` : `Install ${info.latest}`;
}

/**
 * plan is what moving from `running` to `target` means: {action, way,
 * groups, note}. `releases` is GET /api/update/releases' list. Going forward
 * brings in every release after the running one up to the target; going back
 * takes out every release after the target up to the running one. groups is
 * [{tag, changes}], newest first. action is the key's words, '' when there's
 * nothing to do.
 */
export function plan(releases, running, target) {
  const c = cmpVersion(target, running);
  const between = (lo, hi) => releases.filter((r) => cmpVersion(r.tag, lo) > 0 && cmpVersion(r.tag, hi) <= 0)
    .map((r) => ({ tag: r.tag, changes: r.changes || [] }));
  if (c === null) {
    // A build that isn't a release: no way to tell what's in it.
    const self = releases.find((r) => r.tag === target);
    return { action: `Install ${target}`, way: 'install', groups: self ? [{ tag: self.tag, changes: self.changes || [] }] : [],
      note: 'What’s running now isn’t a release, so this is what the release itself changed.' };
  }
  if (c > 0) return { action: `Update to ${target}`, way: 'forward', groups: between(running, target), note: '' };
  if (c < 0) return { action: `Go back to ${target}`, way: 'back', groups: between(target, running), note: '' };
  if (ahead(running)) {
    return { action: `Go back to ${target}`, way: 'back', groups: [],
      note: `What’s running is ${target} plus commits deployed by hand; this goes back to the release.` };
  }
  return { action: '', way: 'same', groups: [], note: 'This is what’s running.' };
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
  if (status && status.version === tag) return { done: true, ok: true, text: `Now on ${tag}` };
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

/**
 * shortDate is when a release came out, 'Fri 9 Oct · 10:55' in the viewer's
 * time and words: no year (the tag has it), and the day apart from the time,
 * so a narrow row breaks between them rather than cutting the time off.
 * `opts` ({locale, timeZone}) is for the tests.
 */
export function shortDate(iso, opts = {}) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const tz = opts.timeZone ? { timeZone: opts.timeZone } : {};
  const day = d.toLocaleDateString(opts.locale, { weekday: 'short', day: 'numeric', month: 'short', ...tz });
  const time = d.toLocaleTimeString(opts.locale, { hour: '2-digit', minute: '2-digit', ...tz });
  return `${day} · ${time}`;
}

/**
 * askAboutUpdates says whether to ask GET /api/update, from /api/status:
 * not where the Pi says it has no updater. A Pi from before the field, or a
 * status that did not come, is asked as ever, so a real failure still shows.
 */
export function askAboutUpdates(status) {
  return !(status && status.updates === false);
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // text, never markup: notes come from GitHub
  return n;
};

const wiredUpdates = new WeakSet();

function ensureUpdateSheet(doc = document) {
  let sheet = doc.getElementById('update-sheet');
  if (sheet || !doc.body || typeof doc.createElement !== 'function' || doc.body.classList?.contains('tape-page')) return sheet;
  sheet = doc.createElement('dialog');
  sheet.className = 'sheet';
  sheet.id = 'update-sheet';
  sheet.setAttribute('aria-labelledby', 'update-title');
  sheet.innerHTML = `<div class="sheet-inner update-inner">
    <h3 id="update-title" class="update-title">Releases</h3>
    <div class="release-list" role="radiogroup" aria-labelledby="update-title"></div>
    <div class="release-changes" aria-live="polite"></div>
    <p class="update-text" hidden>Hindsight restarts to install it, so the feed starts empty: what it's holding now is gone. Keep anything you want from it first.</p>
    <p class="update-progress" role="status" hidden></p>
    <div class="sheet-actions">
      <button class="icon-btn update-cancel" type="button">Cancel</button>
      <button class="icon-btn primary update-go" type="button" hidden>Update</button>
    </div>
  </div>`;
  doc.body.append(sheet);
  return sheet;
}

/** RELEASES_EVENT is what the Settings sheet's Releases sends to open this sheet. */
export const RELEASES_EVENT = 'hindsight:releases';

/**
 * initUpdate wires the header's Releases button and the sheet it opens, and
 * opens the same sheet on RELEASES_EVENT.
 */
export async function initUpdate() {
  const appbarBtn = document.getElementById ? document.getElementById('appbar-releases-btn') : null;
  const sheet = document.getElementById('update-sheet') || (appbarBtn ? ensureUpdateSheet(document) : null);
  if (!sheet || !appbarBtn) return;
  if (wiredUpdates.has(sheet)) return;
  wiredUpdates.add(sheet);

  const st = await getJSON('/api/status');
  if (!askAboutUpdates(st)) {
    if (typeof sheet.querySelector === 'function') {
      if (st?.version) appbarBtn.textContent = st.version;
      const title = sheet.querySelector('.update-title');
      const listEl = sheet.querySelector('.release-list');
      const changesEl = sheet.querySelector('.release-changes');
      const text = sheet.querySelector('.update-text');
      const progress = sheet.querySelector('.update-progress');
      const go = sheet.querySelector('.update-go');
      const cancel = sheet.querySelector('.update-cancel');
      cancel?.addEventListener('click', () => sheet.close());
      const showRunning = () => {
        if (!sheet.open) sheet.showModal();
        if (title) title.textContent = 'Releases';
        if (listEl) {
          listEl.hidden = false;
          listEl.replaceChildren(el('p', 'release-note', `Running ${st?.version || 'local build'}. Updates are managed on kits with the updater service.`));
        }
        if (changesEl) changesEl.hidden = true;
        if (go) go.hidden = true;
        if (text) text.hidden = true;
        if (progress) progress.hidden = true;
        if (cancel) cancel.textContent = 'Close';
      };
      appbarBtn.addEventListener('click', showRunning);
      document.addEventListener(RELEASES_EVENT, showRunning);
    }
    return;
  }

  const $ = (sel) => sheet.querySelector(sel);
  const title = $('.update-title');
  const listEl = $('.release-list');
  const changesEl = $('.release-changes');
  const text = $('.update-text');
  const progress = $('.update-progress');
  const go = $('.update-go');
  const cancel = $('.update-cancel');
  let releases = [];
  let picked = '';
  let info = { running: st?.version || '', latest: '', available: false };
  let following = false;

  if (st?.version) appbarBtn.textContent = st.version;
  cancel.addEventListener('click', () => sheet.close());
  const openPick = () => open(info.available && info.latest ? info.latest : info.running);
  appbarBtn.addEventListener('click', openPick);
  document.addEventListener(RELEASES_EVENT, openPick);
  const fetched = await getJSON('/api/update');
  if (!fetched) return; // 404: an older Pi with no updater, or the Pi isn't answering
  info = fetched;

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

  const showButton = () => {
    const label = buttonLabel(info);
    appbarBtn.textContent = label || info.running || 'Releases';
    appbarBtn.classList.toggle('has-update', !!label);
  };
  showButton();

  // Asked again every hour while the page stays open, and on coming back to
  // it, so a page left on the stand finds a release merged since.
  let checked = Date.now();
  const recheck = async () => {
    if (following) return;
    checked = Date.now();
    const next = await getJSON('/api/update');
    if (next) { info = next; showButton(); }
  };
  setInterval(recheck, RECHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - checked > RECHECK_ON_RETURN_MS) recheck();
  });

  function choose(tag) {
    picked = tag;
    for (const row of listEl.querySelectorAll('.release-row')) {
      const on = row.dataset.tag === tag;
      row.setAttribute('aria-checked', String(on));
      row.tabIndex = on ? 0 : -1;
    }
    const p = plan(releases, info.running, tag);
    // The list marks the releases the move passes over, from the running
    // one to the pick: green going forward, amber going back.
    const span = new Set(p.groups.map((g) => g.tag));
    listEl.dataset.way = p.way;
    for (const row of listEl.querySelectorAll('.release-row')) row.classList.toggle('in-plan', span.has(row.dataset.tag));
    changesEl.replaceChildren();
    if (p.groups.length) {
      changesEl.append(el('h4', 'release-changes-head', p.way === 'back' ? 'This takes out' : 'This brings in'));
      for (const g of p.groups) {
        // A card a release: its tag and date, then its notes, each marked
        // + for what comes in or − for what goes.
        const sec = el('section', 'release-group' + (p.way === 'back' ? ' out' : ''));
        const head = el('div', 'release-group-head');
        head.append(el('span', 'release-group-tag', g.tag));
        const when = shortDate(releases.find((r) => r.tag === g.tag)?.date);
        if (when) head.append(el('span', 'release-group-date', when));
        sec.append(head);
        const ul = el('ul');
        if (g.changes.length) for (const c of g.changes) ul.append(el('li', null, c));
        else ul.append(el('li', 'none', 'No notes for this release'));
        sec.append(ul);
        changesEl.append(sec);
      }
    }
    if (p.note) changesEl.append(el('p', 'release-note', p.note));
    // A new pick reads from its head, not from where the last one was scrolled.
    changesEl.scrollTop = 0;
    go.hidden = !p.action;
    go.textContent = p.action || 'Update';
    go.disabled = false;
    text.hidden = !p.action;
    progress.hidden = true;
    progress.classList.remove('bad');
  }

  function drawList() {
    listEl.replaceChildren();
    if (!releases.length) {
      listEl.append(el('p', 'release-note', 'No releases to show yet.'));
      return;
    }
    for (const r of releases) {
      const row = el('button', 'release-row');
      row.type = 'button';
      row.setAttribute('role', 'radio');
      row.dataset.tag = r.tag;
      // A lamp for the pick, then the tag over its date, then a badge.
      const led = el('span', 'release-led');
      led.setAttribute('aria-hidden', 'true');
      const what = el('span', 'release-what');
      what.append(el('span', 'release-tag', r.tag));
      const when = shortDate(r.date);
      if (when) what.append(el('span', 'release-date', when));
      row.append(led, what);
      // A deploy.sh build (v…-2-gabc1234) is running its release plus commits.
      if (cmpVersion(r.tag, info.running) === 0) row.append(el('span', 'release-badge running', r.tag === info.running ? 'running' : 'running +'));
      else if (r.tag === releases[0].tag) row.append(el('span', 'release-badge', 'latest'));
      row.addEventListener('click', () => choose(r.tag));
      listEl.append(row);
    }
  }

  // Arrow keys move the pick, as in any radio group.
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = releases.findIndex((r) => r.tag === picked);
    const j = Math.max(0, Math.min(releases.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (j !== i) { choose(releases[j].tag); listEl.querySelector(`[data-tag="${releases[j].tag}"]`)?.focus(); }
    e.preventDefault();
  });

  async function open(preferred) {
    if (following) { if (!sheet.open) sheet.showModal(); return; }
    title.textContent = 'Releases';
    listEl.hidden = false;
    changesEl.hidden = false;
    listEl.replaceChildren(el('p', 'release-note', 'Asking GitHub…'));
    changesEl.replaceChildren();
    go.hidden = true;
    text.hidden = true;
    progress.hidden = true;
    cancel.textContent = 'Cancel';
    if (!sheet.open) sheet.showModal();
    const resp = await getJSON('/api/update/releases');
    if (!resp || resp.error) {
      // The list failed but the latest is known: offer that alone, as the
      // Update line promised, rather than only an error.
      if (preferred && preferred === info.latest) {
        releases = [{ tag: info.latest, date: '', changes: [] }];
        drawList();
        choose(info.latest);
        changesEl.append(el('p', 'release-note bad', cap(((resp && resp.error) || 'Couldn’t list the releases') + ': its notes aren’t shown')));
        return;
      }
      listEl.replaceChildren(el('p', 'release-note bad', cap((resp && resp.error) || 'Couldn’t reach Hindsight')));
      return;
    }
    releases = resp.releases || [];
    drawList();
    const first = releases.find((r) => r.tag === preferred) || releases.find((r) => cmpVersion(r.tag, info.running) === 0) || releases[0];
    if (first) choose(first.tag);
  }

  go.addEventListener('click', async () => {
    go.disabled = true;
    const tag = picked;
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

  // While it installs: no Cancel, only Close (the update goes on regardless),
  // and the sheet says where it's got to.
  async function follow(tag, since) {
    const started = Date.now(); // this device's clock, for giving up only
    title.textContent = `Installing ${tag}`;
    listEl.hidden = true;
    changesEl.hidden = true;
    text.hidden = true;
    go.hidden = true;
    cancel.textContent = 'Close';
    progress.hidden = false;
    progress.classList.remove('bad');
    progress.textContent = 'Starting the update…';
    while (Date.now() - started < GIVE_UP_MS) {
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
          title.textContent = `Couldn’t install ${tag}`;
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
