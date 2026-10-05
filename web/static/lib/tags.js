// web/static/lib/tags.js
// The tags: named colors a take is sorted by. One list for the whole rig,
// kept on the server (GET/PUT /api/tags), so a rename on the phone shows on
// the laptop. This is the one copy the page holds; the shelf, the spines and
// the cassette all read it, and `subscribe` tells them when it changes.

class TagStore {
  constructor() {
    this.list = [];
    this.loaded = false;
    this.subs = new Set();
    this.pending = null;
  }

  /** subscribe calls fn(list) whenever the list changes; returns the way to stop. */
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  set(list) {
    this.list = list;
    this.loaded = true;
    for (const fn of this.subs) fn(list);
  }

  /** load fetches the list once; later calls share that fetch. */
  load() {
    if (this.loaded) return Promise.resolve(this.list);
    this.pending ||= fetch('/api/tags', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((j) => { this.set(Array.isArray(j.tags) ? j.tags : []); return this.list; })
      .catch(() => this.list)
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  /** save replaces the list on the server and adopts what it kept. Throws its reason. */
  async save(list) {
    const res = await fetch('/api/tags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: list.map(({ id, name, color }) => ({ id, name, color })) }),
    });
    if (!res.ok) throw new Error(await res.json().then((j) => j.error).catch(() => res.statusText));
    const j = await res.json();
    this.set(j.tags);
    return j.tags;
  }
}

export const tagStore = new TagStore();
export const MAX_TAGS = 24;
export const TAG_COLORS = 8;
