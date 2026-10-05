# Cuts and mixdowns fold into their take — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stop cuts and mixdowns from crowding the shelf.

- A cut folds into the take it was cut from.
- Mixdowns of one tape fold into the newest of them.
- Both are reached from the cassette panel.
- *Save as take* asks for a name first.

**Architecture:**
- `fold(takes)` is a pure function in `lib/shelf.js`. It decides which takes
  are spines and which are folded into each.
- `shelve()` runs it after the filters. The main page runs it before
  `newest()`.
- `TakesList` keeps a hidden row for each folded take, right after its spine,
  so the shared player and Delete with Undo keep working.
- The panel (`lib/shelf-detail.js`) lists a spine's cuts and earlier mixes.
- One Go change: a mixdown's sidecar records `tape_id`.

**Tech stack:** vanilla ES modules, CSS (one `styles.css`), `node --test`,
Playwright smoke scripts, Go 1.23.

**Spec:** `docs/superpowers/specs/2026-10-05-take-families-design.md`

## Global constraints

- **Delivery.** Two PRs. After its final review, each one is fast-forwarded
  into local `main` and deployed (memory: restyle-merge-deploy-each):
  - fast-forward with `git fetch . <branch>:main`, after checking with
    `gh api repos/gabeduke/hindsight/commits/main` that GitHub's `main` hasn't
    moved;
  - `make pi-status`, then `make deploy-dry` (read its `*deleting` lines), then
    `make deploy` (PR 1, which has Go changes and restarts the Pi) or
    `make deploy-static` (PR 2).

  Don't open a GitHub PR. Pushing `main` cuts a release; ask first.
- **The transport bar is in flight** (`docs/superpowers/plans/2026-10-05-transport-bar.md`,
  PRs 2–5). Before starting each PR, branch from the current local `main`.
  If a bar PR lands first, rebase.
- **Every new `data-tip`** gets a row in `web/static/lib/help/tips.js`, and
  the same row, in the same order, in the table in `docs/guide.md` §9.
  `help.test.js` fails otherwise.
- **`:hover`** only inside `@media (hover: hover)` (`styles.test.js`).
- **Text contrast** is 4.5:1 or more in both schemes, the stickers on the
  J-card included.
- **The service worker.** `CACHE` goes up by one in each PR (v29 now). A new
  file under `web/static/lib/` joins `SHELL` in `web/static/sw.js`.
- **JS tests:** `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js' 'web/static/lib/bar/*.test.js'`.
- **Go:** `gofmt -l .` is empty; `go vet ./...` and `go test -race ./...`
  pass.
- **The demo, for every check by hand:**

  ```bash
  TAPE=true RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight-families TAPE_DIR=/tmp/hindsight-families-tapes PORT=15393 CGO_ENABLED=0 go run ./cmd/hindsight --demo
  ```

  Use a port of your own; other sessions' demos hold 15173 and 15391 (memory:
  demo port collisions).

## Review focus

- **No take becomes unreachable.** Every take in `/api/jams` is either a spine
  or listed in its spine's panel, under every filter, sort and search. A
  property-style test in `shelf.test.js` checks that `shelf` plus `under`
  covers the input exactly.
- **A poll never rebuilds under a finger.** The panel's lists keep the
  signature guard that `renderTags` uses.
- **Deleting an original never deletes a cut.**
- **Hidden rows cost nothing until played.** No waveform fetch happens for a
  folded take until its line is pressed (check the network log on the demo).

---

## File map (PR 1)

| File | What changes |
|---|---|
| `internal/audio/meta.go` | `Meta.TapeID` (`tape_id`, optional) |
| `internal/audio/save.go` | `Take.TapeID`, filled from the sidecar |
| `internal/tape/mixdown.go` | `runMixdown` takes the tape's id and writes it to the sidecar |
| `internal/tape/mixdown_test.go` | Asserts `tape_id` |
| `docs/api.md` | `tape_id` on the take listing |
| `web/static/lib/shelf.js` | `fold()`; `shelve()` folds after filtering, and its groups carry `members` |
| `web/static/lib/shelf.test.js` | `fold` and `shelve` cases |
| `web/static/lib/takes.js` | Hidden member rows after their spine; stickers; counts; step order; the NEW sticker on the spine; the delete toast |
| `web/static/lib/shelf-detail.js` | Lineage line, ‹ back key, Cuts and Earlier mixes lists |
| `web/static/lib/shelf-page.js` | Picking a member; the page's fold for the panel; `shownNames` only counts spines |
| `web/static/app.js` | The main page folds before `newest()` |
| `web/static/styles.css` | The stickers; the panel's lists |
| `web/static/lib/help/tips.js`, `docs/guide.md` | Tips for the lists and the back key; §3.1, §8.6 and §9 |
| `scripts/smoke-takes.mjs` | Family checks |
| `web/static/sw.js` | `CACHE` v30 |

---

## PR 1: families (branch `claude/take-families-1`)

### Task 1: Mixdowns record their tape

**Files:**
- Modify: `internal/audio/meta.go`, `internal/audio/save.go`, `internal/tape/mixdown.go`, `docs/api.md`
- Test: `internal/tape/mixdown_test.go`

- [ ] **Step 1: Write the failing test.** In `mixdown_test.go`, at the
  assertion near line 127 (`meta.Label != "song" || meta.Origin != …`), also
  require `meta.TapeID == <the tape's id>`. Use the id of the tape the test
  creates.
- [ ] **Step 2: Run it and watch it fail:** `go test ./internal/tape -run Mixdown`.
  It fails to compile: `Meta` has no `TapeID`.
- [ ] **Step 3: The field.** In `Meta` (`internal/audio/meta.go`), after
  `Origin`:

  ```go
  // TapeID is the tape a mixdown was made from (OriginTape only), so the
  // shelf can fold one tape's mixdowns together. Empty on every other take,
  // and on mixdowns made before the field existed. Optional and additive, so
  // it needs no MetaVersion bump.
  TapeID string `json:"tape_id,omitempty"`
  ```

  Add `TapeID string \`json:"tape_id,omitempty"\`` to `Take` in `save.go`
  after `Origin`, and `t.TapeID = m.TapeID` beside `t.Origin = …` in the
  function that fills a `Take` from its sidecar (near `save.go:773`).
- [ ] **Step 4: Write it.** `StartMixdown` calls
  `go e.runMixdown(m.ID, t.Name, t.Grid, from, to-from)`. Change it to pass
  `t.ID` after `m.ID`, and change `runMixdown`'s signature to
  `(id uint64, tapeID, name string, grid *Grid, passFrom, frames int64)`. In
  the `UpdateMeta` callback, after `m.Origin = audio.OriginTape`, add
  `m.TapeID = tapeID`.
- [ ] **Step 5: Run it and watch it pass:** `go test -race ./internal/...`.
- [ ] **Step 6: Document it.** In `docs/api.md`'s take listing (near line
  360), add `"tape_id": "…"` to the example. Add one sentence under it:
  "`tape_id` is present only on a mixdown, and names the tape it was mixed
  from."
- [ ] **Step 7: Commit:** `git commit -m "Mixdown: the sidecar names its tape (tape_id)"`

### Task 2: `fold()`, pure

**Files:**
- Modify: `web/static/lib/shelf.js`
- Test: `web/static/lib/shelf.test.js`

**Interfaces:**
- **Produces:** `fold(takes)` → `{ shelf, cuts, mixes, under }`:
  - `shelf`: the spines, in input order;
  - `cuts`: `Map<spine name, Take[]>`, oldest first;
  - `mixes`: `Map<spine name, Take[]>`, earlier mixes, newest first;
  - `under`: `Map<member name, spine name>`.
- **Consumes:** `when` (already in `shelf.js`).

- [ ] **Step 1: Write the failing tests.** Append to `shelf.test.js`, and add
  `fold` to its import:

```js
// --- families: cuts and mixdowns fold into a spine ---------------------------

const cutOf = (name, created, from, extra = {}) =>
  take(name, created, { source: { name: `jam_${from}.wav`, start_frame: 0, end_frame: 1 }, ...extra });
const mixOf = (name, created, tape_id, label = 'Night tape') => take(name, created, { origin: 'tape', tape_id, label });
const names = (l) => l.map((t) => t.name.replace(/^jam_|\.wav$/g, ''));

test('fold: nothing to fold leaves the list as it is', () => {
  const f = fold([take('a', at(2026, 10, 4, 10)), take('b', at(2026, 10, 4, 9))]);
  assert.deepEqual(names(f.shelf), ['a', 'b']);
  assert.equal(f.cuts.size + f.mixes.size + f.under.size, 0);
});

test('fold: cuts fold into their original, oldest first', () => {
  const f = fold([cutOf('c2', at(2026, 10, 4, 12), 'jam'), take('jam', at(2026, 10, 4, 10)), cutOf('c1', at(2026, 10, 4, 11), 'jam')]);
  assert.deepEqual(names(f.shelf), ['jam']);
  assert.deepEqual(names(f.cuts.get('jam_jam.wav')), ['c1', 'c2']);
  assert.equal(f.under.get('jam_c2.wav'), 'jam_jam.wav');
});

test('fold: a cut of a cut folds into the first take, in either order', () => {
  const jam = take('jam', at(2026, 10, 4, 10)), c = cutOf('c', at(2026, 10, 4, 11), 'jam'), cc = cutOf('cc', at(2026, 10, 4, 12), 'c');
  for (const l of [[cc, c, jam], [jam, c, cc]]) {
    const f = fold(l);
    assert.deepEqual(names(f.shelf), ['jam']);
    assert.deepEqual(names(f.cuts.get('jam_jam.wav')), ['c', 'cc']);
  }
});

test('fold: a cut whose original is not in the list stands on the shelf', () => {
  const f = fold([cutOf('c', at(2026, 10, 4, 11), 'gone'), cutOf('cc', at(2026, 10, 4, 12), 'c')]);
  assert.deepEqual(names(f.shelf), ['c']);
  assert.deepEqual(names(f.cuts.get('jam_c.wav')), ['cc']);
});

test('fold: one tape\'s mixdowns fold into the newest, the rest newest first', () => {
  const f = fold([
    mixOf('m1', at(2026, 10, 4, 19, 58), 't1'), mixOf('m3', at(2026, 10, 4, 20, 55), 't1'),
    mixOf('m2', at(2026, 10, 4, 20, 31), 't1'), mixOf('x', at(2026, 10, 4, 20), 't2'),
  ]);
  assert.deepEqual(names(f.shelf), ['m3', 'x']);
  assert.deepEqual(names(f.mixes.get('jam_m3.wav')), ['m2', 'm1']);
  assert.equal(f.mixes.has('jam_x.wav'), false);
});

test('fold: mixdowns from before tape_id group by label; a renamed one with an id stays with its tape', () => {
  const old = fold([mixOf('a1', at(2026, 10, 1), undefined), mixOf('a2', at(2026, 10, 2), undefined), mixOf('b', at(2026, 10, 2, 13), undefined, 'Day tape')]);
  assert.deepEqual(names(old.shelf), ['a2', 'b']);
  const renamed = fold([mixOf('m1', at(2026, 10, 4, 10), 't1', 'final?'), mixOf('m2', at(2026, 10, 4, 11), 't1')]);
  assert.deepEqual(names(renamed.shelf), ['m2']);
});

test('fold: a cut of an earlier mix folds into the mix that stands in', () => {
  const f = fold([mixOf('m1', at(2026, 10, 4, 10), 't1'), mixOf('m2', at(2026, 10, 4, 11), 't1'), cutOf('c', at(2026, 10, 4, 12), 'm1')]);
  assert.deepEqual(names(f.shelf), ['m2']);
  assert.deepEqual(names(f.cuts.get('jam_m2.wav')), ['c']);
  assert.deepEqual(names(f.mixes.get('jam_m2.wav')), ['m1']);
});

test('fold: a lineage that loops leaves its takes on the shelf', () => {
  const f = fold([cutOf('a', at(2026, 10, 4, 10), 'b'), cutOf('b', at(2026, 10, 4, 11), 'a')]);
  assert.deepEqual(names(f.shelf), ['a', 'b']);
});

test('fold: every take is a spine or a member, exactly once', () => {
  const l = [
    take('jam', at(2026, 10, 4, 10)), cutOf('c', at(2026, 10, 4, 11), 'jam'), cutOf('cc', at(2026, 10, 4, 12), 'c'),
    cutOf('lost', at(2026, 10, 4, 12), 'gone'), mixOf('m1', at(2026, 10, 4, 13), 't1'), mixOf('m2', at(2026, 10, 4, 14), 't1'),
    cutOf('mc', at(2026, 10, 4, 15), 'm1'), take('phone', at(2026, 10, 4, 16), { origin: 'phone' }),
  ];
  const f = fold(l);
  const all = [...f.shelf.map((t) => t.name), ...f.under.keys()].sort();
  assert.deepEqual(all, l.map((t) => t.name).sort());
  const members = [...f.cuts.values(), ...f.mixes.values()].flat().map((t) => t.name).sort();
  assert.deepEqual(members, [...f.under.keys()].sort());
});
```

- [ ] **Step 2: Run them and watch them fail:** `node --test web/static/lib/shelf.test.js`
  fails, because `fold` isn't exported.
- [ ] **Step 3: Write `fold`** in `shelf.js`, after `matches`. This is the
  code proven against the cases above in a scratch run on 2026-10-05:

```js
const atMs = (t) => { const w = when(t); return Number.isNaN(w) ? -Infinity : w; };
const isMix = (t) => t.origin === 'tape';
// A tape's mixdowns share its id; ones made before tape_id share its name.
const tapeKey = (t) => (t.tape_id ? `id:${t.tape_id}` : `label:${t.label || ''}`);

/**
 * fold decides which takes stand on the shelf. A cut folds into the take it
 * was cut from (the first one up its line that is in `takes`); mixdowns of
 * one tape fold into the newest of them. `shelf` keeps the input's order;
 * `cuts` (oldest first) and `mixes` (newest first) are keyed by the spine
 * they fold into; `under` maps each folded take to that spine.
 */
export function fold(takes) {
  const byName = new Map(takes.map((t) => [t.name, t]));
  const newestMix = new Map();
  for (const t of takes) {
    if (!isMix(t)) continue;
    const k = tapeKey(t), cur = newestMix.get(k);
    if (!cur || atMs(t) > atMs(cur) || (atMs(t) === atMs(cur) && t.name > cur.name)) newestMix.set(k, t);
  }
  const mixUnder = new Map();
  for (const t of takes) {
    const s = isMix(t) && newestMix.get(tapeKey(t));
    if (s && s !== t) mixUnder.set(t.name, s);
  }
  // Up the line to the first take, then to the mix that stands in for it.
  // A line that loops (no real list has one) leaves the take on the shelf.
  const spineOf = (t) => {
    const seen = new Set([t.name]);
    let cur = t;
    for (;;) {
      const up = mixUnder.get(cur.name) || (cur.source && byName.get(cur.source.name));
      if (!up) return cur;
      if (seen.has(up.name)) return t;
      seen.add(up.name);
      cur = up;
    }
  };
  const under = new Map([...mixUnder].map(([n, s]) => [n, s.name]));
  for (const t of takes) {
    if (!t.source) continue;
    const s = spineOf(t);
    if (s !== t) under.set(t.name, s.name);
  }
  const cuts = new Map(), mixes = new Map();
  for (const t of takes) {
    const s = under.get(t.name);
    if (!s) continue;
    const m = t.source ? cuts : mixes;
    if (!m.has(s)) m.set(s, []);
    m.get(s).push(t);
  }
  for (const l of cuts.values()) l.sort((a, b) => atMs(a) - atMs(b));
  for (const l of mixes.values()) l.sort((a, b) => atMs(b) - atMs(a));
  return { shelf: takes.filter((t) => !under.has(t.name)), cuts, mixes, under };
}
```

- [ ] **Step 4: Run them and watch them pass.**
- [ ] **Step 5: Commit:** `git commit -m "Shelf: fold cuts into their original, and a tape's mixdowns into its newest"`

### Task 3: `shelve()` folds after filtering

**Files:**
- Modify: `web/static/lib/shelf.js`
- Test: `web/static/lib/shelf.test.js`

**Interfaces:**
- **Produces:** `shelve(takes, opts, now)` → groups as today, with spines only
  in each group's `takes`, plus `members: Map<spine name, Take[]>`. Each
  member list is the spine's cuts, then its earlier mixes.
- **Produces:** `familyOf(f, name)` → `{ spine, cuts, mixes }`. `spine` is
  the take on the shelf for `name`, which may be `name` itself. `cuts` and
  `mixes` are arrays, empty when there are none. The panel uses it.

- [ ] **Step 1: Write the failing tests:**

```js
test('shelve: a cut folds into its original, on the original\'s day', () => {
  const jam = take('2026-10-03_210000', at(2026, 10, 3, 21), { label: 'Tuesday jam' });
  const riff = cutOf('2026-10-04_101500', at(2026, 10, 4, 10, 15), '2026-10-03_210000', { label: 'Tuesday jam · 0:42–1:10' });
  const g = shelve([riff, jam], {}, NOW);
  assert.equal(g.length, 1);
  assert.match(g[0].label, /^YESTERDAY/);
  assert.deepEqual(g[0].takes.map((t) => t.name), [jam.name]);
  assert.deepEqual(g[0].members.get(jam.name).map((t) => t.name), [riff.name]);
});

test('shelve: a filter the original fails leaves the cut on its own, on its own day', () => {
  const jam = take('2026-10-03_210000', at(2026, 10, 3, 21));
  const riff = cutOf('2026-10-04_101500', at(2026, 10, 4, 10, 15), '2026-10-03_210000', { starred: true });
  const g = shelve([riff, jam], { starred: true }, NOW);
  assert.deepEqual(g.flatMap((x) => x.takes).map((t) => t.name), [riff.name]);
  assert.match(g[0].label, /^TODAY/);
});

test('shelve: longest and tag sorts place a family by its spine', () => {
  const jam = take('jam', at(2026, 10, 4, 10), { duration_seconds: 900, tag: 'g1' });
  const riff = cutOf('riff', at(2026, 10, 4, 11), 'jam', { duration_seconds: 28, tag: 'g2' });
  const short = take('short', at(2026, 10, 4, 12), { duration_seconds: 60 });
  const long = shelve([riff, jam, short], { sort: 'longest' }, NOW);
  assert.deepEqual(names(long[0].takes), ['jam', 'short']);
  const tags = [{ id: 'g1', name: 'Keep', color: 'red' }, { id: 'g2', name: 'Riffs', color: 'blue' }];
  const byTag = shelve([riff, jam, short], { sort: 'tag', tags }, NOW);
  assert.deepEqual(byTag.map((x) => x.label), ['KEEP', 'UNTAGGED']);
  assert.deepEqual(names(byTag[0].members.get(jam.name)), ['riff']);
});

test('familyOf names a member\'s spine and lists a spine\'s family', () => {
  const jam = take('jam', at(2026, 10, 4, 10)), c = cutOf('c', at(2026, 10, 4, 11), 'jam');
  const f = fold([jam, c]);
  assert.equal(familyOf(f, c.name).spine.name, jam.name);
  assert.deepEqual(names(familyOf(f, jam.name).cuts), ['c']);
  assert.deepEqual(familyOf(f, jam.name).mixes, []);
});
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Write it.**
  - Run against a scratch copy of `shelf.js` on 2026-10-05: all 35 tests in
    the file passed.
  - Add the two helpers after `fold`:

```js
/** membersOf is each spine's folded takes: its cuts, then its earlier mixes. */
export function membersOf(f, spines) {
  const m = new Map();
  for (const t of spines) {
    const l = [...(f.cuts.get(t.name) || []), ...(f.mixes.get(t.name) || [])];
    if (l.length) m.set(t.name, l);
  }
  return m;
}

/** familyOf is the spine a take is on, and that spine's cuts and earlier mixes. */
export function familyOf(f, name) {
  const spineName = f.under.get(name) || name;
  const spine = f.shelf.find((t) => t.name === spineName) || null;
  return { spine, cuts: f.cuts.get(spineName) || [], mixes: f.mixes.get(spineName) || [] };
}
```

  - Split `shelve`: today's body, from the `sort` checks down, becomes
    `shelveGroups(shown, opts, now)`. `shelve` becomes:

```js
export function shelve(takes, opts = {}, now = Date.now()) {
  const f = fold(takes.filter((t) => matches(t, opts)));
  if (!f.shelf.length) return [];
  return shelveGroups(f.shelf, opts, now).map((g) => ({ ...g, members: membersOf(f, g.takes) }));
}
```

  - Add `fold` and `familyOf` to the test file's import.
- [ ] **Step 4: Run the whole node suite.** The existing `shelve` tests must
  still pass unchanged.
- [ ] **Step 5: Commit:** `git commit -m "Shelf: group the spines; each group carries its folded takes"`

### Task 4: The list keeps folded takes as hidden rows

**Files:**
- Modify: `web/static/lib/takes.js`

- [ ] **Step 1: Members after their spine.**
  - In `render(groups)`, after placing a spine's row, place the row of each
    take in `g.members?.get(t.name) || []`. Create it if needed, call
    `updateRow`, and mark it `row.el.hidden = true` and
    `row.el.classList.add('folded')`.
  - A spine's row is `hidden = false` and loses `folded`. A take moves
    between the two when its original is deleted or restored.
  - Add member names to `seen`, so the rows survive the sweep.
  - Push them to `shown` only for the step order (next step), not to
    `shownCount`.
- [ ] **Step 2: Counts and order.**
  - `shownCount` is the number of spines.
  - With `stepOrder: 'shown'`, the order saved to `hindsight.order` is each
    spine followed by its members, so the take page's ▸ visits a family in
    turn.
- [ ] **Step 3: The sticker.**
  - `updateRow(row, t, fam)` takes `{cuts, mixes}` counts from `render`.
  - On a spine, it keeps one `<span class="spine-fold" aria-hidden="true">`
    after `.take-meta`, reading `✂3`, `MIX ×4`, or `✂2 · MIX ×4`. The MIX
    count includes the spine itself.
  - It appends "3 cuts" and "4 mixes" to the spine's `aria-label`.
  - Nothing is drawn when there's no family.
- [ ] **Step 4: NEW on the spine.** Dropped while building: only `app.js`
  marks a take fresh, after a capture, and a capture never folds.
- [ ] **Step 5: Select mode.** Select all and the selection count skip
  `.folded` rows. Check `enterSelect`, `renderSelect` and the Select all
  handler.
- [ ] **Step 6: The delete toast.** `updateRow` keeps the spine's counts on
  `row.family`, and `deleteTake(row)` reads them. With cuts, the toast adds
  `cutsBack(n)` from `lib/shelf.js`: " · its 3 cuts are back on the shelf"
  ("its cut is back" for one). `bulkDelete` counts before the delete
  re-renders, and says "their". The Undo is unchanged.
- [ ] **Step 7: Run the node suite, then check by hand on the demo:**
  - make a cut;
  - the shelf shows one spine with ✂1;
  - the hidden row is in the DOM;
  - no `/api/peaks` request goes out for it.
- [ ] **Step 8: Commit:** `git commit -m "Takes list: folded takes ride hidden behind their spine, which wears the count"`

### Task 5: The takes page and the panel

**Files:**
- Modify: `web/static/lib/shelf-page.js`, `web/static/lib/shelf-detail.js`

- [ ] **Step 1: The page's fold.**
  - In `shelf-page.js`, keep the last fold: wrap `shape` so it also stores
    `fam = fold(takes.all.filter((t) => matches(t, opts)))`, with the same
    `opts` it passes to `shelve`.
  - `shownNames()` selects `.take:not(.folded)`.
  - `pick(name)`:
    - lights the row of `familyOf(fam, name).spine`;
    - shows `name` in the panel;
    - passes the family to `detail.show(t, family)`.
  - In `syncPick`, a picked member whose spine is shown stays picked.
- [ ] **Step 2: The panel's markup.** In `TakeDetail`'s constructor, add:
  - above `.detail-head`: `<button class="icon-btn detail-up" type="button" data-tip="detail-up" hidden></button>`;
  - after `.detail-meta`: `<p class="detail-from" hidden></p>`;
  - after `.detail-flags`: `<section class="detail-family" hidden><h3 class="detail-family-h"></h3><ol class="detail-family-list"></ol></section>`,
    once for Cuts (`data-tip="detail-cuts"`) and once for Earlier mixes
    (`data-tip="detail-mixes"`).
- [ ] **Step 3: `show(t, family)`.**
  - **`.detail-up`:** "‹ *spine name*" when `t` is a member; pressing it calls
    the page's `onPick(spine.name)` (a new constructor option).
  - **`.detail-from`:**
    - For a cut: "Cut from " plus a button with the source's label or stamp,
      then " ›". It picks the source when the source is in `takes.all`, and
      opens `/wave.html?file=…` otherwise.
    - For a mix in a family of more than one: "Mix *k* of *n* · *spine label*".
  - **The lists:** shown only when `t` is the spine.
    - A cut's line: a button with "✂", its name, its span in the original
      ("0:42–1:10", from `source.start_frame`, `source.end_frame` and the
      take's `sample_rate`) and its length.
    - A mix's line: its label if the owner changed it from the spine's,
      otherwise "mix *k* · HH:MM", then its length.
    - Pressing a line calls `onPick(name)`.
    - Guard the rebuild with a signature, as `renderTags` does, so a poll that
      changes nothing doesn't rebuild under a finger.
- [ ] **Step 4: Delete.** The panel's Delete passes
  `{ cuts: family.cuts.length }` when `t` is the spine. After deleting a
  member, the pick goes back to its spine.
- [ ] **Step 5: The phone's sheet.** It's the same panel. Check that ‹ (up)
  and the existing "‹ Takes" (sheet back) both work, and that they read
  differently.
- [ ] **Step 6: Check by hand on the demo** at 1470 × 900 and 390 × 844:
  - cut twice, mix a tape down three times (`TAPE=true`);
  - check the stickers, the lists, a line, ‹, Cut from;
  - delete the jam: the cuts are on the shelf, then Undo;
  - Starred filter on a starred cut.
- [ ] **Step 7: Commit:** `git commit -m "Takes page: the cassette panel lists a take's cuts and earlier mixes"`

### Task 6: The main page folds

**Files:**
- Modify: `web/static/app.js`

- [ ] **Step 1: Fold first.**
  - Change `shape` to
    `(all) => { const f = fold(all); const top = newest(f.shelf, shelfCount()); return [{ label: '', takes: top, members: membersOf(f, top) }]; }`.
  - `membersOf` is a small export from `shelf.js`, shared with `shelve`.
  - The main page shows no panel, so hidden member rows only matter for the
    count, but they keep `render` the same on both pages.
- [ ] **Step 2: Check by hand:**
  - a cut made from an older take doesn't push a spine off the main shelf;
  - a capture still appears first;
  - ◂ ▸ step through every take.
- [ ] **Step 3: Commit:** `git commit -m "Main page: the shelf is the newest spines"`

### Task 7: The look, the tips and the guide

**Files:**
- Modify: `web/static/styles.css`, `web/static/lib/help/tips.js`, `docs/guide.md`

- [ ] **Step 1: The sticker.**
  - `.spine-fold` is printed on the J-card like `.take-meta`, in the
    card's ink, in tabular figures, and never wraps.
  - On the narrowest spine (390 px), it sits before the length and the name
    gives way first.
  - Check contrast on every tag stripe, in both schemes.
- [ ] **Step 2: The panel.**
  - `.detail-family-list` uses the flag chips' row rhythm.
  - Each line is a full-width button, at least 44 px high, with the name on
    the left and the span and length on the right.
  - `.detail-up` sits above the name, styled like `.sheet-back`.
- [ ] **Step 3: Tips.** Add `detail-up`, `detail-cuts` and `detail-mixes` to
  `tips.js`, and the same three rows, in the same order, to the guide's §9
  table.
- [ ] **Step 4: The guide.**
  - §3.1: a paragraph on families: the stickers, the panel's lists, deleting
    an original, and filters seeing every take.
  - `[demo]` checks:
    - cut twice and see ✂2;
    - delete the original and see the cuts come out;
    - Undo.
  - §8.6: a mixdown joins its tape's earlier mixes, behind the newest.
  - §4, the *Save as take* bullet: "It folds into this take on the shelf."
- [ ] **Step 5: Run the node suite** (`help.test.js` and `styles.test.js`
  included).
- [ ] **Step 6: Commit:** `git commit -m "Families: the look, the tips and the guide"`

### Task 8: The smoke test follows families

**Files:**
- Modify: `scripts/smoke-takes.mjs`

- [ ] **Step 1: Set-up.** If the demo has no take with `source`, cut two
  regions of the newest take with `POST /api/cut`.
- [ ] **Step 2: Checks:**
  - one spine wears `✂2`;
  - picking it lists two cuts;
  - pressing the first puts it in the panel, with ‹;
  - ‹ goes back;
  - deleting the original shows both cuts as spines, and the toast's Undo
    folds them in again;
  - no `.folded` row is selectable in select mode.
- [ ] **Step 3: Run it against the demo:**
  `HINDSIGHT_URL=http://127.0.0.1:15393 node scripts/smoke-takes.mjs`.
- [ ] **Step 4: Commit:** `git commit -m "Smoke: families on the takes page"`

### Task 9: Ship-ready

- [ ] **Step 1: The service worker.** Set `CACHE` to `'hindsight-shell-v30'`
  (or one above whatever `main` has by then). No new files under `lib/`.
- [ ] **Step 2: Everything.**
  - `gofmt -l .` is empty;
  - `go vet ./...` and `go test -race ./...` pass;
  - the node suite passes;
  - `smoke-takes.mjs` and `smoke-capture.mjs` pass.
- [ ] **Step 3: Screenshots for the review.**
  - The takes page with a family picked, at 390 × 844, 1024 × 600 and
    1470 × 900, light and dark.
  - Save them under `.superpowers/sdd/2026-10-05-take-families/pr1/`, and
    don't commit them.
- [ ] **Step 4: Commit:** `git commit -m "PR 1: cache v30"`
- [ ] **Step 5: Review, merge, deploy.**
  - Review with a fresh agent.
  - Fast-forward local `main` with `git fetch . claude/take-families-1:main`.
  - Run `make pi-status` and check that the rig is idle. A full deploy
    restarts the Pi and clears the ring.
  - Run `make deploy-dry` and read its `*deleting` lines, then `make deploy`.

---

## PR 2: name it when you save (scoped; detailed here when it starts)

- **`lib/wave/cut-label.js` (new):** `spanLabel(from, to, sampleRate)` and
  `cutLabelBase(label)`, ported from `internal/audio/cut.go`.
  - Tested on the same cases as the Go tests, plus "a label the owner typed
    that ends in ` · 1–2` is left alone".
- **The take page:** `#save-take` opens an inline name field in the editor bar.
  - It's pre-filled with `cutLabelBase(take.label || stem) + ' · ' + spanLabel(…)`
    and selected.
  - Enter or **Save** posts `/api/cut` with `label`; Escape cancels.
  - On a phone the field takes the bar's width.
- **The toast:** "Saved *name* · in *original* on the shelf", with the link to
  the new take.
- **Tips and guide:** a `save-name` tip; §4's *Save as take* bullet.
- `SHELL` gains `lib/wave/cut-label.js`; `CACHE` goes up by one;
  `make deploy-static`.
