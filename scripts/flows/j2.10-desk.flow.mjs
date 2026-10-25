// J2.10 The desk in front of you holds still: from the Studio to the
// Listening Room and back, the header and the bar keep their place and
// their size -- before the switch, on every frame of the camera's turn, and
// after it. Todo until the bar has one shape in both rooms
// (the-studio-space.md, step 4): at 1000 px and wider the Listening Room
// still draws the bar as a dock of its own. The header already holds still
// (J2.2 checks it), and on a phone so does the bar. docs/flows.md#j210
import { watchDesk, desk, rects, same, during } from './desk.mjs';

export default {
  id: 'J2.10',
  title: 'The header and the bar hold still as the camera turns between rooms',
  status: 'todo',
  profiles: ['tablet', 'desktop', 'phone'],
  async run(t) {
    const { page } = t;
    await watchDesk(page);
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('.appnav a[data-tab="room"]').waitFor({ state: 'visible' });
    await page.locator('#np').waitFor({ state: 'visible' }); // the bar, once the tape is in it
    for (const [tab, path, name] of [['room', /takes\.html/, 'the Listening Room'], ['studio', /tape\.html/, 'the Studio']]) {
      const before = await rects(page);
      await desk(page);
      await t.step(`turn to ${name}`, () => t.tap(page.locator(`.appnav a[data-tab="${tab}"]`)));
      await page.waitForURL(path);
      await t.wait(1200);
      const after = await rects(page);
      const seen = await desk(page);
      for (const [part, word] of [['appbar', 'header'], ['np', 'bar']]) {
        const d = during(seen.samples, part);
        t.expect(`the ${word} keeps its place and size: before, through the turn and after`,
          d.frames > 0 && same(before[part], after[part]) && d.laidOut.every((r) => same(r, before[part]))
            && d.drawn.every((x) => x.flat && same(x.box, before[part])),
          { before: before[part], after: after[part], frames: d.frames, drawn: d.drawn.slice(0, 2).map((x) => x.box) });
      }
    }
  },
};
