// web/static/lib/rooms/studio.js
// The Studio's own parts on the tape page (docs/superpowers/specs/2026-10-15-rooms-design.md,
// step 1): the feed above the lanes -- the ring as the ribbon, the L/R
// meters, and KEEP -- and the about line, with Settings, at the page's foot.
//
// They are Capture's parts, moved: the markup is tape.html's templates, and
// the modules that draw them are Capture's own (the ribbon, the VU meters,
// the live socket, Settings, Releases). Only mount.js loads this, and only
// with the flag on.
//
// The tape page knows nothing about it, and it nothing about the tape page:
// it adds itself around the lanes and asks the Pi for what Capture asks.

import { connectLive } from '../live.js';
import { onResume, timedFetch } from '../link.js';
import { Meters, tierPhrase, captureTiers, frameLevels } from '../meter.js';
import { VUMeters } from '../objects/vu.js';
import { Ribbon } from '../objects/ribbon.js';
import { toast } from '../toast.js';
import { restoreTake } from '../trash.js';
import { initSettings } from '../settings.js';
import { initUpdate } from '../update.js';
import { initWakeLock } from '../wakelock.js';
import { keepTake, takeBack } from './keep.js';

const STATUS_MS = 2000;

/**
 * mountStudio puts the feed at the top of the tape page's main, the about
 * line under main and their sheets in the body, then drives them. It
 * returns null if the page lacks the templates (it isn't the tape page).
 */
export function mountStudio(doc = document) {
  const main = doc.querySelector('main.tape-main');
  const tpl = (id) => doc.getElementById(id)?.content;
  const feed = tpl('studio-feed-tpl'), foot = tpl('studio-foot-tpl'), sheets = tpl('studio-sheets-tpl');
  if (!main || !feed || !foot || !sheets) return null;
  main.prepend(feed.cloneNode(true));
  // The foot goes after main, not in it: main scrolls on a wide screen, and
  // lanes squeezed to their heads' height overflow it -- over anything at its
  // end. Between main and the dock it's always in view there; on a phone it
  // ends the page.
  main.after(foot.cloneNode(true));
  doc.body.append(sheets.cloneNode(true));

  const $ = (id) => doc.getElementById(id);
  const el = {
    seg: $('dur-seg'),
    keep: $('studio-keep'),
    word: $('studio-keep-word'),
    sub: $('studio-keep-sub'),
    viz: $('viz-wrap'),
    vu: $('vu'),
    meters: $('meters'),
    version: $('version'),
  };

  let status = null;     // the last /api/status
  let reached = false;   // whether the last poll got one
  let seconds = 30;      // the length KEEP keeps; 0 is the whole ring
  let keeping = false;   // a KEEP on its way
  let vu = null;
  let bars = null;

  // A take kept, from KEEP or from the ribbon: Name it on the Listening
  // Room's shelf, or Undo, which puts it in Recently deleted with a Restore.
  const keptToast = (msg, name) => toast(msg, 'ok', {
    actions: [
      { label: 'Name it', run: () => location.assign(`/takes.html?take=${encodeURIComponent(name)}`) },
      { label: 'Undo', run: () => undoKeep(name) },
    ],
  });

  async function undoKeep(name) {
    try {
      await takeBack(name);
    } catch (e) {
      toast(`Could not undo it: ${e.message}`, 'bad');
      return;
    }
    toast(`Took back ${name}: it’s in Recently deleted`, 'ok', {
      action: {
        label: 'Restore',
        run: async () => {
          try { await restoreTake(name); toast('Restored, starred'); } catch (e) { toast(`Could not restore: ${e.message}`, 'bad'); }
        },
      },
    });
  }

  const ribbon = new Ribbon(el.viz, {
    onToast: toast,
    onSavedToast: keptToast,
    selBar: $('rb-sel'),
    flagSheet: $('rb-flag-sheet'),
  });
  // The Studio has a tape: a span can be copied onto it, or kept in its crate.
  ribbon.offerCopy(true);

  // KEEP's lengths, as Capture's: 30 s, 2 m, 7 m that the ring holds, and all
  // of it. The ribbon shades the one chosen.
  function buildTiers(ringSeconds) {
    const opts = captureTiers(ringSeconds);
    if (!opts.some((o) => o.s === seconds)) seconds = opts[0].s;
    el.seg.replaceChildren(...opts.map((o) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      b.dataset.seconds = String(o.s);
      b.setAttribute('aria-pressed', String(o.s === seconds));
      b.addEventListener('click', () => {
        seconds = o.s;
        for (const other of el.seg.children) other.setAttribute('aria-pressed', String(Number(other.dataset.seconds) === seconds));
        ribbon.setSelected(seconds);
        paintKeep();
      });
      return b;
    }));
    ribbon.setSpans(opts.map((o) => o.s));
    ribbon.setSelected(seconds);
  }

  // The meters: needles from 700 px, two bars on a phone (CSS picks).
  function buildMeters(saveChannels) {
    const labels = saveChannels.length > 1 ? ['L', 'R'] : ['M'];
    vu?.destroy(); // off the ticker before its nodes go
    el.vu.replaceChildren();
    el.meters.replaceChildren();
    vu = new VUMeters(el.vu, { labels });
    bars = new Meters(el.meters, { labels, selected: [] });
  }

  function paintKeep() {
    const healthy = reached && !!status?.capture_healthy;
    const busy = keeping || !!status?.saving;
    el.keep.disabled = !healthy || busy;
    el.word.textContent = busy ? 'Keeping…' : status && !healthy ? 'No input' : 'Keep';
    el.sub.textContent = status ? tierPhrase(seconds, status.ring_seconds) : '';
    el.sub.hidden = !healthy || busy;
  }

  function applyStatus(s) {
    const shape = !status || s.ring_seconds !== status.ring_seconds || String(s.save_channels) !== String(status.save_channels);
    status = s;
    reached = true;
    if (shape) {
      buildTiers(s.ring_seconds);
      buildMeters(s.save_channels);
    }
    if (s.version) el.version.textContent = s.version;
    el.viz.classList.toggle('stale', !s.capture_healthy);
    paintKeep();
  }

  async function pollStatus() {
    try {
      const res = await timedFetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      applyStatus(await res.json());
    } catch {
      // The tape page says when the Pi can't be reached; KEEP just can't.
      reached = false;
      el.viz.classList.add('stale');
      paintKeep();
    }
  }

  async function keep() {
    // A tick as it goes and two when it's kept, as Capture's key does.
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    keeping = true;
    paintKeep();
    let kept = false;
    try {
      const body = await keepTake(seconds);
      keptToast(`Kept ${body.name}: it’s on the Listening Room’s shelf`, body.name);
      kept = true;
      try { navigator.vibrate?.([12, 70, 12]); } catch { /* no haptics here */ }
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      keeping = false;
      paintKeep();
      pollStatus();
      if (kept) {
        el.keep.classList.add('saved');
        setTimeout(() => el.keep.classList.remove('saved'), 1200);
      }
    }
  }
  el.keep.addEventListener('click', keep);

  connectLive({
    onFrame: (f) => {
      if (!status) return;
      const { rms, peak, clip } = frameLevels(f, status.save_channels.map((c) => c - 1));
      bars?.update(rms, peak, clip);
      vu?.update(rms, peak, clip);
    },
  });

  paintKeep();
  pollStatus();
  setInterval(() => { if (!doc.hidden) pollStatus(); }, STATUS_MS);
  onResume(() => pollStatus());

  initSettings();
  initUpdate();
  // The Studio is where a phone on a stand sits now, as Capture was: keep its
  // screen on while it charges.
  initWakeLock();
  // And it can be the installed app's first page: register the shell here
  // too, as app.js does (secure contexts only).
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  return { ribbon };
}
