// web/static/lib/tape/catch.js
// When CATCH can go, and why not. The page used to grey the key and say
// nothing: it lights after one whole pass of the loop, and the last 1, 2 or
// 4 bars -- which don't wait for a pass -- were only in a track's sheet.
// Pure: the page asks, and puts what it answers on the key, its tip and the
// toast a tap on it gives (page.js, renderCatch).

/** CATCH_BARS are the last bars the key's menu offers, as the track's sheet does. */
export const CATCH_BARS = [1, 2, 4];

const loopSeconds = (tape) => {
  const { loop, sample_rate: sr } = tape || {};
  return loop && sr && loop.out > loop.in ? Math.round((loop.out - loop.in) / sr) : 0;
};

/**
 * catchState says what CATCH can do now, from the Pi's live state and the
 * tape. {ready, why}: the key can take the last pass, or `why` it can't, in
 * words to act on. {bars, barsWhy}: the last bars can be taken, or why not.
 * `phoneOut`: the tape is playing on this phone, heard late: the key stays
 * pressable and the jam-room sheet says what's wrong, as ● Rec does.
 * `armed`: some track is armed. Catch lands on it, so with none the key's
 * second line says "arm a track", as it did before it said why it waited:
 * a person who disarmed everything is told that, not only to press ▶.
 * A Catch that waits for a pass says "after one pass" (the flow spec's
 * *CATCH · after one pass*).
 */
export function catchState({ live, tape, phoneOut = false, armed = true }) {
  if (phoneOut) return { ready: true, why: '', short: '', bars: false, barsWhy: 'Catch needs the jam room' };
  if (!live) {
    return { ready: false, why: 'The Pi has not answered yet.', short: 'waiting', bars: false, barsWhy: 'The Pi has not answered yet.' };
  }
  const lined = live.aligned !== 'none';
  const playing = !!live.playing;
  const barsWhy = !lined ? 'Press ▶ first: Catch lines what it hears up with what the tape played.'
    : !tape || !tape.grid ? 'The tape has no tempo yet.' : '';
  const bars = !barsWhy;
  if ((live.cycles || []).length && lined) return { ready: true, why: '', short: '', bars, barsWhy };
  const secs = loopSeconds(tape);
  const length = secs ? ` (about ${secs} s here)` : '';
  // `short` is what the key's second line can hold.
  let why, short;
  if (!lined) {
    short = playing ? 'lining up' : 'press ▶';
    why = playing
      ? 'Catch is lining up what it hears with what the tape played: give it a few seconds of the tape playing.'
      : 'Press ▶ and let the tape play: Catch lines what it hears up with what it played.';
  } else if (tape && tape.loop && !tape.loop.on) {
    short = 'loop is off';
    why = 'The loop is off, and Catch takes a whole pass of it: turn the loop on and let it go round once.';
  } else if (!playing) {
    short = 'press ▶';
    why = `Press ▶: Catch takes the last whole pass of the loop${length}.`;
  } else {
    short = 'after one pass';
    why = `Catch takes the last whole pass of the loop, so it waits for one to finish${length}.`;
  }
  if (!armed) {
    short = 'arm a track';
    why = `Arm a track first: Catch lands on the armed track. ${why}`;
  }
  return { ready: false, why, short, bars, barsWhy };
}

/**
 * catchSub is the key's second line: what it catches and where it goes
 * ("last pass → 2", "→ 2, 3" for several armed), or why it waits, or that
 * no track is armed. `armed` are the armed tracks.
 */
export function catchSub(cs, { armed = [], phoneOut = false } = {}) {
  if (phoneOut) return 'jam room only';
  if (!cs.ready) return cs.short;
  if (!armed.length) return 'arm a track';
  return `last pass → ${armed.join(', ')}`;
}

/**
 * catchMini is catchSub for the phone's mini bar, where the key may grow only
 * a few pixels before the transport window beside it loses its bar number:
 * nine characters or fewer, for any number of tracks armed. "last pass → 2"
 * is "→ 2", "after one pass" is "in 1 pass", "loop is off" is "loop off",
 * "arm a track" is "arm track"; tracks too many to list are a range ("→ 1–4")
 * or, if they are not a run, a count ("→ 5 trk"). Anything else is as
 * catchSub said it. (The full line is the expanded player's, and the key's
 * tip and label say it in full.)
 */
export function catchMini(sub) {
  const m = /^last pass → (\d+(?:, \d+)*)$/.exec(sub);
  if (m) {
    const ns = m[1].split(', ').map(Number);
    const list = `→ ${ns.join(', ')}`;
    if (list.length <= 9) return list;
    const run = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
    return run ? `→ ${ns[0]}–${ns[ns.length - 1]}` : `→ ${ns.length} trk`;
  }
  return sub
    .replace('after one pass', 'in 1 pass')
    .replace('loop is off', 'loop off')
    .replace('arm a track', 'arm track')
    .replace('jam room only', 'jam room');
}
