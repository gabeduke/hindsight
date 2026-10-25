// J2.7 Find last month's take: the search, Sort ▾ and a filter chip on the
// List, a month's All › on the shelf wall, and Shelf | List remembered on
// this device. docs/flows.md#j27, docs/plan/the-studio-space.md ("The
// library").
const state = () => {
  const b = document.body.classList;
  const rows = [...document.querySelectorAll('#takes .take.spine:not(.folded)')].filter((r) => r.getClientRects().length);
  return {
    list: b.contains('room-rack'),
    search: b.contains('room-search'),
    rows: rows.map((r) => r.dataset.name),
    months: [...document.querySelectorAll('#takes .shelf-month')].filter((h) => h.getClientRects().length).map((h) => h.textContent),
    field: document.getElementById('shelf-q')?.value ?? null,
    stored: localStorage.getItem('hindsight.library'),
  };
};

export default {
  id: 'J2.7',
  title: 'Find last month’s take: search, Sort, a filter, a month’s shelf',
  profiles: ['tablet', 'desktop', 'phone'],
  checksMenus: ['#shelf-sort-menu'],
  async run(t) {
    const { page, api } = t;
    const phone = t.profile === 'phone';
    // One demo for every profile's run: each names its take a word of its own.
    const word = { tablet: 'Bridge', desktop: 'Coda', phone: 'Outro' }[t.profile] || 'Bridge';
    const d = new Date();
    const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 10, 20, 15);
    const old = await t.given(`a take kept last month, named ${word} idea`, async () => {
      const k = await api.keep(4);
      await api.patch(`/api/take?file=${encodeURIComponent(k.name)}`, { label: `${word} idea` });
      return api.age(k.name, lastMonth);
    });
    const starred = await t.given('a starred take from today', async () => {
      const k = await api.keep(4);
      await api.patch(`/api/take?file=${encodeURIComponent(k.name)}`, { starred: true });
      return k;
    });
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await page.locator('#shelf-q').waitFor({ state: 'visible' });
    const now = () => page.evaluate(state);
    const row = (name) => page.locator(`#takes .take.spine[data-name="${name}"]`);

    // The search: what is printed on a spine finds it, in the List, right
    // under the field -- above where the keyboard comes up.
    await t.step('tap the search', () => t.tap(page.locator('#shelf-q')));
    await t.step('type a word printed on its spine', () => page.keyboard.type(word.toLowerCase()));
    const found = await t.poll((name) => {
      const rows = [...document.querySelectorAll('#takes .take.spine:not(.folded)')].filter((r) => r.getClientRects().length);
      return document.body.classList.contains('room-search') && rows.length === 1 && rows[0].dataset.name === name;
    }, old.name);
    let s = await now();
    t.expect('the List opens with the take alone in it', found, s);
    const where = await row(old.name).boundingBox();
    const height = page.viewportSize().height;
    t.expect('it sits right under the field, above where the keyboard comes up', where && where.y + where.height < height * 0.55,
      { bottom: where && Math.round(where.y + where.height), screen: height });
    const field = await page.locator('#shelf-q').boundingBox();
    t.expect('the field stays where it was, pinned', field && field.y >= 0 && field.y < 160, field);

    await t.step('tap the take found', () => t.tap(row(old.name)));
    const plays = await t.poll((name) => document.getElementById('np')?.dataset.source === 'take'
      && document.getElementById('np-play')?.classList.contains('playing') && document.getElementById('np-name')?.textContent.trim() === name, `${word} idea`);
    t.expect('it plays in the bar, under the name on its spine', plays);

    await t.step('Cancel', () => t.tap(page.locator('.room-search-done')));
    const back = await t.poll((list) => !document.body.classList.contains('room-search') && document.getElementById('shelf-q')?.value === ''
      && document.body.classList.contains('room-rack') === list, phone);
    t.expect('the search empties and the room is as it was', back, await now());

    // Shelf | List: the List, remembered on this device.
    if (!phone) {
      await t.step('tap List', () => t.tap(page.locator('#shelf-view button[data-show="list"]')));
      const listed = await t.poll(() => document.body.classList.contains('room-rack') && localStorage.getItem('hindsight.library') === 'list');
      t.expect('the List shows, and this device remembers it', listed, await now());
      await t.step('reload', () => page.reload());
      await page.locator('#takes .take.spine').first().waitFor({ state: 'visible' });
      s = await now();
      t.expect('it opens on the List again', s.list, s);
    }

    // Sort ▾ and a filter chip change the List.
    await t.step('tap Sort ▾', () => t.tap(page.locator('#shelf-sort')));
    await t.step('tap Oldest', () => t.tap(page.locator('#shelf-sort-menu [data-sort="oldest"]')));
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const last = months[lastMonth.getMonth()];
    const oldest = await t.poll((m) => [...document.querySelectorAll('#takes .shelf-month')].filter((h) => h.getClientRects().length)[0]?.textContent.startsWith(m), last);
    s = await now();
    const made = new Map((await api.takes()).map((x) => [x.name, new Date(x.created)]));
    t.expect('the oldest come first, under last month', oldest && made.get(s.rows[0])?.getMonth() === lastMonth.getMonth() && s.rows.indexOf(old.name) < s.rows.indexOf(starred.name), s);
    await t.step('tap ★', () => t.tap(page.locator('#shelf-filters [data-filter="starred"]')));
    const stars = (await api.takes()).filter((x) => x.starred).map((x) => x.name);
    const onlyStarred = await t.poll((names) => {
      const rows = [...document.querySelectorAll('#takes .take.spine:not(.folded)')].filter((r) => r.getClientRects().length).map((r) => r.dataset.name);
      return rows.length > 0 && rows.every((n) => names.includes(n));
    }, stars);
    s = await now();
    t.expect('only the starred takes are left', onlyStarred && s.rows.includes(starred.name) && !s.rows.includes(old.name), { stars, rows: s.rows });
    await t.step('tap ★ again', () => t.tap(page.locator('#shelf-filters [data-filter="starred"]')));

    // The wall: a month's All › opens the List to that month.
    await t.step('tap Shelf', () => t.tap(page.locator('#shelf-view button[data-show="shelf"]')));
    const walled = await t.poll(() => !document.body.classList.contains('room-rack') && localStorage.getItem('hindsight.library') === 'shelf');
    t.expect('the wall shows, and this device remembers it', walled, await now());
    const month = page.locator('.room-shelf-month', { has: page.locator(`.room-cassette[data-key="take:${old.name}"]`) });
    await month.locator('.room-all').scrollIntoViewIfNeeded();
    await t.step('tap All › on last month’s shelf', () => t.tap(month.locator('.room-all')));
    const opened = await t.poll(() => document.body.classList.contains('room-rack')
      && [...document.querySelectorAll('#takes .take.spine:not(.folded)')].some((r) => r.getClientRects().length));
    s = await now();
    t.expect('the List shows that month alone', opened && s.rows.includes(old.name) && s.rows.every((n) => made.get(n)?.getMonth() === lastMonth.getMonth()), s);
    await t.step('tap ‹ The room', () => t.tap(page.locator('.room-rack-back')));
    const walls = await t.poll(() => !document.body.classList.contains('room-rack'));
    t.expect('back on the wall', walls, await now());
  },
};
