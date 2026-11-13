// web/static/lib/tape/catch.js
// When CATCH can go, and why not. The page used to grey the key and say
// nothing: it lights after one whole pass of the loop, and the last 1, 2 or
// 4 bars -- which don't wait for a pass -- were only in a track's sheet.
// Pure: the page asks, and puts what it answers on ●'s menu, where Catch
// is, and on the toast C gives (lib/components/transport/tape-keys.js).

/** CATCH_BARS are the last bars ●'s menu offers, as the track's sheet does. */
export const CATCH_BARS = [1, 2, 4];

const loopSeconds = (tape) => {
  const { loop, sample_rate: sr } = tape || {};
  return loop && sr && loop.out > loop.in ? Math.round((loop.out - loop.in) / sr) : 0;
};

/**
 * catchState says what CATCH can do now, from the Pi's live state and the
 * tape. {ready, why}: the last pass can be taken, or `why` it can't, in
 * words to act on. {bars, barsWhy}: the last bars can be taken, or why not.
 * `phoneOut`: the tape is playing on this phone, heard late: the last pass
 * stays pressable and the jam-room sheet says what's wrong, as ● Rec does.
 * `armed`: some track is armed. Catch lands on it, so with none `why` says
 * to arm one first, then why it waits: a person who disarmed everything is
 * told that, not only to press ▶.
 */
export function catchState({ live, tape, phoneOut = false, armed = true }) {
  if (phoneOut) return { ready: true, why: '', bars: false, barsWhy: 'Catch needs the jam room' };
  if (!live) {
    return { ready: false, why: 'The Pi has not answered yet.', bars: false, barsWhy: 'The Pi has not answered yet.' };
  }
  const lined = live.aligned !== 'none';
  const playing = !!live.playing;
  const barsWhy = !lined ? 'Press ▶ first: Catch lines what it hears up with what the tape played.'
    : !tape || !tape.grid ? 'The tape has no tempo yet.' : '';
  const bars = !barsWhy;
  if ((live.cycles || []).length && lined) return { ready: true, why: '', bars, barsWhy };
  const secs = loopSeconds(tape);
  const length = secs ? ` (about ${secs} s here)` : '';
  let why;
  if (!lined) {
    why = playing
      ? 'Catch is lining up what it hears with what the tape played: give it a few seconds of the tape playing.'
      : 'Press ▶ and let the tape play: Catch lines what it hears up with what it played.';
  } else if (tape && tape.loop && !tape.loop.on) {
    why = 'The loop is off, and Catch takes a whole pass of it: turn the loop on and let it go round once.';
  } else if (!playing) {
    why = `Press ▶: Catch takes the last whole pass of the loop${length}.`;
  } else {
    why = `Catch takes the last whole pass of the loop, so it waits for one to finish${length}.`;
  }
  if (!armed) {
    why = `Arm a track first: Catch lands on the armed track. ${why}`;
  }
  return { ready: false, why, bars, barsWhy };
}

