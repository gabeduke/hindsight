// web/static/lib/room/swap.js
// Putting a tape on the deck (docs/superpowers/specs/2026-10-15-listening-room-design.md,
// "The hi-fi"). A tape plays on the Pi through OUT, which means loading it:
// the same tape the Studio has. So when the Studio's tape is busy -- playing,
// counting in, recording, armed, or mixing down -- the room asks before it
// takes it away: "Studio is using “Tuesday groove”. Swap it?"
//
// The fetches and the question are passed in, so the rule is tested here.

import { forTheTape } from '../bar/carry.js';

/**
 * studioBusy says whether the Studio's tape is in use, from its live state:
 * playing or counting in, a track recording or armed, or a mixdown that
 * hasn't finished.
 */
export function studioBusy(live) {
  if (!live) return false;
  if (live.playing || live.count_in > 0) return true;
  if (live.record && (live.record.state === 'on' || live.record.state === 'armed')) return true;
  const md = live.mixdown;
  return !!(md && (md.state === 'playing' || md.state === 'tail' || md.state === 'saving'));
}

/** recording says whether a press of ▶ would record: a track on, or armed. */
export function recording(live) {
  return !!(live && live.record && (live.record.state === 'on' || live.record.state === 'armed'));
}

/** swapQuestion is what the room asks. */
export function swapQuestion(name) {
  return `Studio is using “${name || 'its tape'}”. Swap it?`;
}

async function getJSON(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/**
 * loadTape puts tape `id` on the Pi's deck, asking first (`ask(question)`,
 * which answers true to go ahead) when another tape is loaded and busy.
 * Answers {loaded, already, live}: loaded false when the answer was no;
 * already when it was the loaded tape before; live, that tape's state,
 * when it was. It throws the Pi's words when the load is refused.
 */
export async function loadTape(id, { fetchImpl = globalThis.fetch, ask } = {}) {
  const list = await getJSON(fetchImpl, '/api/tapes');
  if (list.loaded) {
    const s = await getJSON(fetchImpl, `/api/tapes/state?id=${encodeURIComponent(list.loaded)}`);
    if (list.loaded === id) return { loaded: true, already: true, live: s.live || null, name: s.tape && s.tape.name };
    if (studioBusy(s.live) && !(await ask?.(swapQuestion(s.tape && s.tape.name)))) return { loaded: false, already: false };
  }
  const res = await fetchImpl(`/api/tapes/load?id=${encodeURIComponent(id)}`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return { loaded: true, already: false, live: null };
}

/**
 * wireOpenInStudio makes `button` Open in the Studio: load tape `id()` on the
 * deck (asking first, as loadTape does) and go to the Studio for the tape --
 * saying so first, so the bar's take does not go along (bar/carry.js). A
 * refusal stays here, said with `toast`. `before` runs as it is pressed.
 */
export function wireOpenInStudio(button, { id, ask, toast, before, forTape = forTheTape, go = (u) => { location.href = u; }, load = loadTape }) {
  button.addEventListener('click', async () => {
    const tape = id();
    if (!tape) return;
    before?.();
    try {
      const r = await load(tape, { ask });
      if (r.loaded) { forTape(); go('/tape.html'); }
    } catch (e) {
      toast(`Couldn’t load it in the Studio: ${e.message}`, 'bad');
    }
  });
}

/**
 * putTapeOn loads tape `id` (asking first, as loadTape does) and plays it --
 * unless it was already loaded and playing, or a press of ▶ would record on
 * it. Answers what loadTape did, with `played`.
 */
export async function putTapeOn(id, { fetchImpl = globalThis.fetch, ask } = {}) {
  const r = await loadTape(id, { fetchImpl, ask });
  if (!r.loaded) return { ...r, played: false };
  if (r.already && (recording(r.live) || (r.live && (r.live.playing || r.live.count_in > 0)))) return { ...r, played: false };
  const res = await fetchImpl(`/api/tapes/transport?id=${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'play' }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return { ...r, played: true };
}
