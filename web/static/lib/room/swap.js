// web/static/lib/room/swap.js
// Putting a tape on the deck (docs/superpowers/specs/2026-10-15-listening-room-design.md,
// "The hi-fi"). A tape plays on the Pi through OUT, which means loading it:
// the same tape the Studio has. So when the Studio's tape is busy -- playing,
// counting in, recording, armed, or mixing down -- the room asks before it
// takes it away: "Studio is using “Tuesday groove”. Swap it?"
//
// The fetches and the question are passed in, so the rule is tested here.

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

/** cutQuestion is what it asks before cutting a record of the Studio's tape while it's in use. */
export function cutQuestion(name) {
  return `Studio is using “${name || 'its tape'}”. Cutting a record plays it from the top. Go ahead?`;
}

async function getJSON(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/**
 * loadTape puts tape `id` on the Pi's deck, asking first (`ask(question,
 * kind)`, kind 'swap' or 'cut', which answers true to go ahead) when another tape is loaded and busy.
 * Answers {loaded, already, live}: loaded false when the answer was no;
 * already when it was the loaded tape before; live, that tape's state,
 * when it was. It throws the Pi's words when the load is refused.
 */
export async function loadTape(id, { fetchImpl = globalThis.fetch, ask } = {}) {
  const list = await getJSON(fetchImpl, '/api/tapes');
  if (list.loaded) {
    const s = await getJSON(fetchImpl, `/api/tapes/state?id=${encodeURIComponent(list.loaded)}`);
    if (list.loaded === id) return { loaded: true, already: true, live: s.live || null, name: s.tape && s.tape.name };
    if (studioBusy(s.live) && !(await ask?.(swapQuestion(s.tape && s.tape.name), 'swap'))) return { loaded: false, already: false };
  }
  const res = await fetchImpl(`/api/tapes/load?id=${encodeURIComponent(id)}`, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return { loaded: true, already: false, live: null };
}

/**
 * readyToCut gets tape `id` on the deck for a mixdown, asking first whenever
 * the Studio's tape is busy: another tape is swapped (loadTape), and this
 * one -- already on the deck, playing, armed or recording -- would be taken
 * over by the mixdown and played from the top. Answers true to go ahead.
 */
export async function readyToCut(id, { fetchImpl = globalThis.fetch, ask } = {}) {
  const r = await loadTape(id, { fetchImpl, ask });
  if (!r.loaded) return false;
  if (r.already && studioBusy(r.live)) return !!(await ask?.(cutQuestion(r.name), 'cut'));
  return true;
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
