// Level meters, plus the shared dB and duration formatting helpers.
//
// The scrolling canvas visualiser that used to live here was replaced by the
// buffer ribbon (lib/objects/ribbon.js): it could only ever show the ~9s that arrived
// while the page was open, and a dashcam is something you open after the
// moment.

const FLOOR_DB = -60;

function dbToFrac(db) {
  if (!isFinite(db) || db <= FLOOR_DB) return 0;
  return Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
}

/**
 * Maps a linear amplitude onto the same -60..0 dBFS scale the meters and the
 * buffer ribbon use, keeping the sign so a min/max pair still straddles the
 * centre line.
 *
 * Stored peaks are linear because that is what the audio actually is, and what
 * trim and any offline analysis want. Drawing them linearly is the mistake:
 * the MAIN bus sits around -25 dBFS, which is 5% of full scale, so a real take
 * renders as a one-pixel band while the same signal fills more than half the
 * ribbon. Same lesson the envelope already learned -- below about -20 dBFS,
 * linear amplitude looks like silence.
 */
function ampToFrac(v) {
  const a = Math.abs(v);
  if (a <= 0) return 0;
  // log10(0) is -Infinity, which dbToFrac already floors to 0.
  const f = dbToFrac(20 * Math.log10(a));
  return v < 0 ? -f : f;
}

/** Renders a row of DOM level meters and keeps them updated. */
export class Meters {
  constructor(container, { labels, selected = [] }) {
    this.container = container;
    this.rows = labels.map((label, i) => {
      const row = document.createElement('div');
      row.className = 'meter' + (selected.includes(i) ? ' sel' : '');
      row.innerHTML =
        '<span class="lbl"></span>' +
        '<span class="bar"><span class="fill"></span><span class="peak"></span></span>' +
        '<span class="val">–</span>';
      row.querySelector('.lbl').textContent = label;
      container.appendChild(row);
      return {
        row,
        fill: row.querySelector('.fill'),
        peak: row.querySelector('.peak'),
        val: row.querySelector('.val'),
      };
    });
  }

  update(rms, peak, clip) {
    this.rows.forEach((r, i) => {
      const db = rms?.[i] ?? FLOOR_DB;
      const pk = peak?.[i] ?? FLOOR_DB;
      r.fill.style.width = (dbToFrac(db) * 100).toFixed(1) + '%';
      r.peak.style.left = (dbToFrac(pk) * 100).toFixed(1) + '%';
      r.val.textContent = db <= FLOOR_DB ? '−∞' : db.toFixed(1);
      r.row.classList.toggle('clip', !!clip?.[i]);
    });
  }
}

/** Format a duration in seconds the way the capture tiers and stats read. */
export function fmtDur(s) {
  if (s >= 60) {
    const m = s / 60;
    return Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
  }
  return `${s}s`;
}

/**
 * tierPhrase is what the Capture key catches, in words: "the last 30
 * seconds". 0 is the whole ring, `ringSeconds` long.
 */
export function tierPhrase(seconds, ringSeconds) {
  const s = seconds === 0 ? ringSeconds : seconds;
  if (s < 60) return `the last ${s} seconds`;
  if (s === 60) return 'the last minute';
  const m = s / 60;
  return `the last ${Number.isInteger(m) ? m : m.toFixed(1)} minutes`;
}

/**
 * captureTiers is what the Capture key (and the Studio's Keep) offers for a
 * ring this long: 30 s, 2 m and 7 m where the ring holds them, then the whole
 * ring, as {s, label}. 0 is the whole ring.
 */
export function captureTiers(ringSeconds) {
  const opts = [];
  if (ringSeconds >= 30) opts.push({ s: 30, label: '30s' });
  if (ringSeconds >= 120) opts.push({ s: 120, label: '2m' });
  if (ringSeconds >= 420) opts.push({ s: 420, label: '7m' });
  opts.push({ s: 0, label: `Full ${fmtDur(ringSeconds)}` });
  return opts;
}

/**
 * frameLevels picks a live frame's (lib/live.js) levels for the saved
 * channels (0-based): the latest bin's RMS, the peak and the clip flag, each
 * an array in the channels' order, at the floor where the frame says nothing.
 */
export function frameLevels(f, channels) {
  const last = f.bins?.[f.bins.length - 1];
  return {
    rms: channels.map((c) => last?.rms?.[c] ?? FLOOR_DB),
    peak: channels.map((c) => f.peak?.[c] ?? FLOOR_DB),
    clip: channels.map((c) => f.clip?.[c] ?? false),
  };
}

/**
 * lampState is the Studio's feed lamp's colour from the readouts (readouts,
 * below): red for the ring's trouble or a readout gone bad, amber while
 * it waits or a readout warns, green while it records, and dark before the
 * Pi has answered.
 */
export function lampState(r) {
  if (!r) return 'none';
  const levels = [r.disk?.level, r.xruns?.level, r.tempo?.level];
  if (r.health?.state === 'bad' || levels.includes('bad')) return 'bad';
  if (r.health?.state === 'wait' || levels.includes('warn')) return 'warn';
  return 'ok';
}

/**
 * readouts is Capture's monitor in words, from /api/status: the ring's
 * health, disk free, dropped buffers, the MIDI clock's tempo and the MIDI
 * devices open. Each reading has a level -- '', 'warn' or 'bad' -- for its
 * colour. Capture's tiles and the Studio's line both draw it.
 */
export function readouts(s) {
  const healthy = !!s.capture_healthy;
  // An interface that's switched off, or still booting, isn't an error: the
  // Pi keeps trying and picks it up the moment it appears.
  const waiting = !healthy && !!s.capture_waiting;
  // The status is short; device errors are long ("Illegal combination of
  // I/O devices" and friends), so the full text is the detail, for a toast,
  // which has the width for it, and for a title.
  const detail = healthy ? '' : (s.last_error || '');
  const free = s.disk_free_gb;
  // Which MIDI devices are open right now. The Orchid can enumerate as a
  // power sink rather than a MIDI device if it is connected before it has
  // booted; this line is how you tell, from the couch, that it did not.
  const devs = (s.midi_devices || []).filter((d) => d.connected);
  return {
    health: {
      state: healthy ? 'ok' : waiting ? 'wait' : 'bad',
      text: healthy ? 'recording' : waiting ? 'waiting for the interface' : (detail ? 'capture error' : 'no capture'),
      detail,
      // What is worth a toast: an error, not an interface that's off.
      error: detail && !waiting ? detail : '',
    },
    // No decimal past 100 GB: Capture's tile is 78px at 390px wide and
    // "128.4 GB" clips there, while a tenth of a gigabyte means nothing on a
    // "do I have room" readout. Only reachable on a bigger card than this
    // Pi has.
    disk: {
      text: `${free >= 100 ? free.toFixed(0) : free.toFixed(1)} GB`,
      level: free < s.min_free_gb ? 'bad' : free < s.min_free_gb * 3 ? 'warn' : '',
    },
    xruns: { text: String(s.xruns), level: s.xruns > 0 ? 'warn' : '' },
    // A dash means "no defensible reading", which covers three real states:
    // the EP unplugged, the EP present with clock-send switched off (it
    // ships off, and that looks exactly like firmware that cannot send
    // clock), and a room that has been quiet too briefly to fill two quarter
    // notes.
    tempo: { text: s.midi_bpm == null ? '\u2013' : s.midi_bpm.toFixed(1), level: s.midi_connected ? '' : 'warn' },
    midi: devs.length ? devs.map((d) => (d.clock ? `${d.name} (clock)` : d.name)).join(', ') : 'none',
  };
}

export const CAPTURE_ERR_HOLD_MS = 3500;

/**
 * heldError decides when a capture error is toasted: once it has stood for
 * `hold` ms -- switching the interface off first reads as a stalled stream,
 * then as waiting, and the stall on the way there is not worth a red toast --
 * and once per failure, so a 2-second poll does not re-toast it forever. A
 * recovery clears it, so a repeat failure toasts again. `prev` is the last
 * state ({text, since, shown}); the answer is the next one, and the text to
 * toast now, if any.
 */
export function heldError(prev, text, now, hold = CAPTURE_ERR_HOLD_MS) {
  if (text !== prev.text) return { state: { text, since: now, shown: false }, show: '' };
  if (text && !prev.shown && now - prev.since >= hold) return { state: { ...prev, shown: true }, show: text };
  return { state: prev, show: '' };
}

export { FLOOR_DB, dbToFrac, ampToFrac };
