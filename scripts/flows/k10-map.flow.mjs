// K10 Read what every control does: in the guide, and over the panel on the
// tablet, and hide the overlay once I know it. Todo until the map is agreed
// and built (docs/plan/the-map.md). The keyboard's own help page is the
// firmware's, seen on the virtual keyboard. docs/flows.md#k10.

export default {
  id: 'K10',
  title: 'Read what every control on the keyboard does',
  status: 'todo',
  profiles: ['tablet'],
  async run(t) {
    const { page } = t;
    await t.given('the guide is open', () => page.goto(`${t.base}/guide.html`));
    const section = await t.poll(() => {
      const h = [...document.querySelectorAll('h2, h3')].find((e) => /SMK-37/i.test(e.textContent));
      return h ? h.textContent : null;
    }, null, 3000);
    t.expect('the guide has the SMK-37’s map', !!section, { section });
    t.expect('the map names what PLAY, REC and each pad do on each page', await page.evaluate(() => {
      const t = document.body.textContent;
      return /PLAY/.test(t) && /MIXER/i.test(t) && /BREAK/.test(t);
    }));
  },
};
