// web/static/lib/rooms/studio.js
// The Studio's own parts on the tape page (docs/superpowers/specs/2026-10-15-rooms-design.md,
// step 1): the feed above the lanes -- the ring as the ribbon, the L/R
// meters, KEEP, Flag now, Phone and Capture's readouts -- and under the
// lanes the input diagnostic.
//
// They are Capture's parts, moved, so that nothing Capture has is out of
// reach while `/` sends the tape on to the Studio: the markup is tape.html's
// templates, and the modules that draw them are Capture's own (the ribbon,
// the meters, the live socket, the phone recorder, Settings, Releases). Only
// mount.js loads this.
//
// The tape page knows nothing about it, and it nothing about the tape page:
// it adds itself around the lanes and asks the Pi for what Capture asks.

import { connectLive } from '../live.js';
import { onResume, timedFetch } from '../link.js';
import { Meters, tierPhrase, captureTiers, frameLevels, readouts, heldError } from '../meter.js';
import { VUMeters } from '../objects/vu.js';
import { Ribbon } from '../objects/ribbon.js';
import { toast } from '../toast.js';
import { restoreTake } from '../trash.js';
import { initSettings } from '../settings.js';
import { initUpdate } from '../update.js';
import { initWakeLock } from '../wakelock.js';
import { initPhone } from '../phone/recorder.js';
import { keepTake, takeBack, flagNow } from './keep.js';
import { takeTitle } from './takename.js';
import { named } from './words.js';
import { mountBuffer } from '../buffer/buffer.js';
import { bindStudioKeys } from './keys.js';
import { keepLabel, keepAria, feedKeepLength, selectionKeepLength } from './keeplabel.js';
import { pageCarry, resumeAt } from '../bar/carry.js';
import { feedSource } from '../bar/feed-source.js';

const STATUS_MS = 2000;

/**
 * mountStudio puts the feed at the top of the tape page's main, the input
 * diagnostic under main and their sheets in the body, then drives them. It
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
    len: $('studio-keep-len'),
    sub: $('studio-keep-sub'),
    viz: $('viz-wrap'),
    vu: $('vu'),
    meters: $('meters'),
    health: $('studio-health'),
    disk: $('stat-disk'),
    xruns: $('stat-xruns'),
    tempo: $('stat-tempo'),
    mark: $('mark-btn'),
    chanGrid: $('chan-grid'),
    chanSaving: $('chan-saving'),
    chanDevice: $('chan-device'),
    midi: $('midi-devices'),
  };

  let status = null;     // the last /api/status
  let reached = false;   // whether the last poll got one
  let seconds = 30;      // the length KEEP keeps; 0 is the whole ring
  let keeping = false;   // a KEEP on its way
  let vu = null;
  let bars = null;
  let chans = null;      // the input diagnostic's meters, one per channel
  let captureErr = { text: '', since: 0, shown: false }; // heldError's

  // A take kept, from KEEP or from the ribbon: Name it on the Listening
  // Room's shelf, or Undo, which puts it in Recently deleted with a Restore.
  const keptToast = (msg, name, title) => toast(msg, 'ok', {
    actions: [
      { label: 'Name it', run: () => location.assign(`/takes.html?take=${encodeURIComponent(name)}`) },
      { label: 'Undo', run: () => undoKeep(name, title) },
    ],
  });

  async function undoKeep(name, title) {
    try {
      await takeBack(name);
    } catch (e) {
      toast(`Could not undo it: ${e.message}`, 'bad');
      return;
    }
    toast(`Took back ${named(title || takeTitle(name))}: it’s in Recently deleted`, 'ok', {
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
    // A selection of the feed has two verbs, GRAB (the buffer's) and KEEP,
    // and KEEP says how much it keeps.
    keepWords: (seconds) => keepLabel(selectionKeepLength(seconds)),
  });

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

  // The meters: needles from 700 px, two bars on a phone (CSS picks); and
  // the diagnostic's, one per input, the saved ones lit.
  function buildMeters(s) {
    const labels = s.save_channels.length > 1 ? ['L', 'R'] : ['M'];
    vu?.destroy(); // off the ticker before its nodes go
    el.vu.replaceChildren();
    el.meters.replaceChildren();
    vu = new VUMeters(el.vu, { labels });
    bars = new Meters(el.meters, { labels, selected: [] });
    el.chanGrid.replaceChildren();
    chans = new Meters(el.chanGrid, {
      labels: Array.from({ length: s.channels }, (_, i) => String(i + 1)),
      selected: s.save_channels.map((c) => c - 1),
    });
    el.chanSaving.textContent = s.save_channels.join(' & ');
    el.chanDevice.textContent = s.device || 'no device';
  }

  // Capture's readouts, in the feed's line (lib/meter.js readouts); the
  // ring's trouble first, when there is some, and its full text in a toast
  // once it has stood a while, as Capture does.
  function paintReadouts(s) {
    const r = readouts(s);
    el.health.hidden = r.health.state === 'ok';
    el.health.textContent = r.health.text;
    el.health.title = r.health.detail;
    el.health.className = `studio-health ${r.health.state}`;
    for (const [node, v] of [[el.disk, r.disk], [el.xruns, r.xruns], [el.tempo, r.tempo]]) {
      node.textContent = v.text;
      node.className = v.level;
    }
    el.midi.textContent = r.midi;
    const held = heldError(captureErr, r.health.error, Date.now());
    captureErr = held.state;
    if (held.show) toast(held.show, 'bad', 8000);
  }

  function paintKeep() {
    const healthy = reached && !!status?.capture_healthy;
    const busy = keeping || !!status?.saving;
    el.keep.disabled = !healthy || busy;
    el.word.textContent = busy ? 'Keeping…' : status && !healthy ? 'No input' : 'Keep';
    // KEEP names what it keeps, on every screen: the sub-line that says it in
    // words has no room on a phone, the length beside the word does.
    const len = status && healthy && !busy ? feedKeepLength(seconds, status.ring_seconds) : '';
    el.len.textContent = len;
    if (len) el.keep.setAttribute('aria-label', keepAria(len));
    else el.keep.removeAttribute('aria-label');
    // And the instrument's pad: what K keeps (lib/play/strip.js listens).
    doc.dispatchEvent(new CustomEvent('hindsight:keeps', { detail: { feed: len } }));
    el.sub.textContent = status ? tierPhrase(seconds, status.ring_seconds) : '';
    el.sub.hidden = !healthy || busy;
  }

  function applyStatus(s) {
    const shape = !status || s.ring_seconds !== status.ring_seconds || s.channels !== status.channels
      || String(s.save_channels) !== String(status.save_channels);
    status = s;
    reached = true;
    if (shape) {
      buildTiers(s.ring_seconds);
      buildMeters(s);
    }
    el.viz.classList.toggle('stale', !s.capture_healthy);
    paintReadouts(s);
    // Not `healthy`: an interface can be off with a full buffer still in
    // memory, and marking a moment you can still keep is the point.
    el.mark.disabled = !s.buffered_seconds;
    // The diagnostic's levels from the status too, so it's live before the
    // socket's first frame.
    if (chans && s.channel_rms) chans.update(s.channel_rms, s.channel_rms, null);
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
      el.mark.disabled = true;
      paintKeep();
    }
  }

  async function mark() {
    el.mark.disabled = true;
    try {
      await flagNow();
      ribbon.poll(); // the new flag on the ribbon, without waiting
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      // The next status poll puts it right; this guards a second press.
      el.mark.disabled = !status?.buffered_seconds;
    }
  }
  el.mark.addEventListener('click', mark);

  async function keep() {
    // A tick as it goes and two when it's kept, as Capture's key does.
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    keeping = true;
    paintKeep();
    let kept = false;
    try {
      const body = await keepTake(seconds);
      const title = takeTitle(body.name, undefined, body.label);
      keptToast(`Kept ${named(takeTitle(body.name, body.seconds, body.label))}: it’s on the Listening Room’s shelf`, body.name, title);
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
      const last = f.bins?.[f.bins.length - 1];
      if (chans && last?.rms) chans.update(last.rms, f.peak, f.clip);
    },
  });

  // Recording from this phone, as on Capture: its take lands on the
  // Listening Room's shelf.
  initPhone({
    button: $('phone-btn'),
    sheet: $('phone-sheet'),
    toast,
    // The hub's HTTPS address, when there is a certificate for it.
    secureURL: () => (status?.hub?.cert_not_after && status.hub.url) || '',
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

  // The buffer (lib/buffer, step P2): GRAB beside KEEP, and what it grabs
  // between the feed and the lanes.
  const buffer = mountBuffer(doc, {
    feed: main.querySelector('.studio-feed'), head: main.querySelector('.studio-feed-head'), keysRow: main.querySelector('.studio-keys'), ribbon, toast,
  });

  // The Studio's verbs, after the buffer's (which claims KEEP while it's
  // open): CATCH presses the bar's Catch, KEEP keeps the feed. They come as
  // `hindsight:verb` from the instrument strip (lib/play), and from the
  // keys below.
  doc.addEventListener('hindsight:verb', (e) => {
    if (e.defaultPrevented) return;
    const v = e.detail?.verb;
    if (v === 'catch') {
      // Pressed while it waits for a pass, it says why (lib/tape/page.js).
      $('catch-pass')?.click();
    } else if (v === 'keep' && !el.keep.disabled) {
      keep();
    }
  });
  bindStudioKeys(doc);
  // The keys' new names, where a screen reader reads them.
  $('click')?.setAttribute('aria-keyshortcuts', 'M');
  $('catch-pass')?.setAttribute('aria-keyshortcuts', 'C');

  // Unified Media Player source switcher (Feed · Tape · Shelf) and seamless
  // continuation of a playing Shelf take when entering the Studio.
  const npEl = $('np');
  const npOwn = npEl?.querySelector('.np-own');
  if (npEl && npOwn && !npEl.querySelector('.np-source-switch')) {
    const carry = pageCarry();
    const carried = carry.peek();
    const feedSrc = feedSource();
    let shelfAudio = null;
    let activeKind = 'tape';
    const sw = doc.createElement('div');
    sw.className = 'seg np-source-switch';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Audio source');
    const btns = [
      ['feed', 'Feed'],
      ['tape', 'Tape'],
      ['take', 'Shelf'],
    ].map(([kind, label]) => {
      const b = doc.createElement('button');
      b.setAttribute('type', 'button');
      b.dataset.source = kind;
      b.textContent = label;
      sw.append(b);
      return b;
    });
    const syncSourceUI = () => {
      for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.source === activeKind));
      npEl.classList.toggle('np-feed', activeKind === 'feed');
      npEl.classList.toggle('np-take', activeKind === 'take');
    };
    if (carried && carried.take && carried.playing && typeof Audio === 'function') {
      try {
        shelfAudio = new Audio(`/api/preview?file=${encodeURIComponent(carried.take)}`);
        shelfAudio.loop = !!carried.loop;
        const at = resumeAt(carried, Date.now(), Infinity);
        const sr = carried.sr || 48000;
        shelfAudio.currentTime = (at ? at.playFrame : carried.frame) / sr;
        activeKind = 'take';
        shelfAudio.play().catch(() => {});
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('pagehide', () => {
            if (shelfAudio && activeKind === 'take') {
              carry.leave({
                take: carried.take,
                frame: Math.round((shelfAudio.currentTime || 0) * sr),
                sr,
                playing: !shelfAudio.paused && !shelfAudio.ended,
                loop: shelfAudio.loop,
              });
            }
          });
        }
      } catch { /* audio unavailable in test environment */ }
    }
    for (const b of btns) {
      b.addEventListener('click', () => {
        const kind = b.dataset.source;
        if (kind === 'feed') {
          if (shelfAudio && !shelfAudio.paused) shelfAudio.pause();
          activeKind = 'feed';
          feedSrc.toggle();
          syncSourceUI();
        } else if (kind === 'tape') {
          feedSrc.release();
          if (shelfAudio && !shelfAudio.paused) shelfAudio.pause();
          carry.drop();
          activeKind = 'tape';
          syncSourceUI();
        } else if (kind === 'take') {
          feedSrc.release();
          if (shelfAudio) {
            activeKind = 'take';
            shelfAudio.play().catch(() => {});
            syncSourceUI();
          } else if (typeof location !== 'undefined' && typeof location.assign === 'function') {
            location.assign('/takes.html');
          }
        }
      });
    }
    syncSourceUI();
    npOwn.before(sw);
  }

  return { ribbon, buffer };
}
