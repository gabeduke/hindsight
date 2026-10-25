// J3.2 Bounce: the tape becomes a take on the shelf, from the tape's name,
// which is its menu (docs/plan/the-studio-space.md, "The name is the menu;
// ⋯ goes"): the tapes and New tape; Rename…, Duplicate; the mix and the
// bounces; Record from this phone…; Delete this tape… last, in red. Then
// the tape goes, from the same menu: the confirm sheet names it and what's
// on it (never the browser's prompt), and the most recent other tape opens
// in its place. docs/flows.md#j32
export default {
  id: 'J3.2',
  title: 'Bounce the tape to a take, from its name, then delete it',
  checksMenus: ['#tape-menu'], // the layout checks see the tape's menu open
  async run(t) {
    const { page, api } = t;
    const other = await t.given('another tape', () => api.tape('Jam on the cue lane'));
    const tape = await t.given('a fresh tape', () => api.tape('Bounce'));
    await t.given('15s of the jam in the feed', () => api.ringHas(15));
    // Something on the tape to bounce: a grab dropped on track 1.
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await t.given('a grab dropped on track 1', async () => {
      await t.tap(page.locator('.buffer-grab-key').first());
      await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000);
      await t.tap(page.locator('#buffer-drop'));
      await page.locator('#toasts .toast').filter({ hasText: /Dropped/ }).first().waitFor({ timeout: 8000 });
    });
    const before = (await api.takes()).length;

    // The header has no ⋯: what acts on the tape is in its name's menu.
    t.expect('no ⋯ beside the name', await page.evaluate(() => !document.getElementById('tape-more')));
    await t.step('tap the tape’s name', () => t.tap(page.locator('#tape-name')));
    const menu = await t.poll(() => {
      const m = document.getElementById('tape-menu');
      if (!m || m.hidden || m.dataset.state !== 'open') return null;
      const rows = [...m.children].filter((e) => e.getBoundingClientRect().height > 0);
      const groups = [[]];
      for (const e of rows) {
        if (e.classList.contains('menu-divider')) groups.push([]);
        else if (e.classList.contains('tape-row')) groups.at(-1).push(`${e.getAttribute('aria-checked') === 'true' ? '✓ ' : ''}${e.querySelector('.menu-word').textContent}`);
        else if (e.classList.contains('menu-item')) groups.at(-1).push(e.querySelector('.menu-word').textContent);
      }
      const r = m.getBoundingClientRect();
      // It waits for the tapes the Pi lists.
      return groups[0].some((w) => w.startsWith('✓ ')) ? { groups, on: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, last: rows.at(-1)?.classList.contains('danger') } : null;
    });
    t.expect('its menu: the tapes, this one ticked, and New tape; Rename…, Duplicate; the mix and the bounces; Record from this phone…; Delete this tape… last, red',
      !!menu && menu.on && menu.last && menu.groups[0].includes('✓ Bounce') && menu.groups[0].includes(other.name) && menu.groups[0].at(-1) === 'New tape'
      && JSON.stringify(menu.groups.slice(1)) === JSON.stringify([
        ['Rename…', 'Duplicate'],
        ['Share the mix', 'Bounce the loop', 'Bounce the whole tape', 'Export stems', 'Play the last bounce'],
        ['Record from this phone…'],
        ['Delete this tape…'],
      ]), menu);
    await t.step('tap Bounce the whole tape', () => t.tap(page.locator('#tape-mixdown-all')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Bounced/ }).first();
    t.expect('a "Bounced as a take" toast', await toast.waitFor({ timeout: 20_000 }).then(() => true, () => false));
    const take = await api.until(async () => (await api.takes()).length > before, 'the bounce on the shelf', 20_000).catch(() => false);
    t.expect('the bounce is a take on the shelf', take);

    // Done with it: Delete this tape…, asked first in the sheet.
    await t.wait(600);
    await t.step('tap the tape’s name again', () => t.tap(page.locator('#tape-name')));
    await t.poll(() => document.getElementById('tape-menu')?.dataset.state === 'open');
    await t.step('tap Delete this tape…', () => t.tap(page.locator('#tape-delete')));
    const asked = await t.poll(() => {
      const d = document.getElementById('confirm');
      return d?.open && { title: document.getElementById('confirm-title').textContent, line: document.getElementById('confirm-name').textContent };
    });
    t.expect('the confirm sheet asks, by the tape’s name and what is on it', !!asked && asked.title === 'Delete “Bounce”?'
      && /^1 part, \d+ bars?\. This can’t be undone\.$/.test(asked.line), asked);
    // The Pi lists its tapes newest first: the one changed last, after this.
    const next = (await api.get('/api/tapes')).tapes.find((x) => x.id !== tape.id);
    await t.step('tap Delete', () => t.tap(page.locator('#confirm button[value="delete"]')));
    const gone = await api.until(async () => {
      const list = (await api.get('/api/tapes')).tapes;
      return !list.some((x) => x.id === tape.id) ? list : null;
    }, 'the tape to go', 8000).catch(() => null);
    t.expect('the tape is gone from the Pi', !!gone);
    const now = await t.poll((want) => document.getElementById('tape-name-text')?.textContent === want && want, next?.name, 8000);
    t.expect('the most recent other tape is open in its place', !!next && now === next.name && (await api.get('/api/tapes')).loaded === next.id, { now, next: next?.name });
    t.expect('the bounce stays on the shelf', (await api.takes()).length > before);
  },
};
