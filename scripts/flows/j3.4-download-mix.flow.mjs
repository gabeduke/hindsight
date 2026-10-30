// J3.4 Download the mix to a folder: the tape's name → Download the mix
// renders the whole tape as an MP3 on the Pi and saves it as a download, in
// a browser that can also share files (Chrome on a Mac over the kit's HTTPS
// address, where a share sheet alone left no way to keep the file: it lists
// apps, never a folder). With a mouse Download the mix comes first and Share
// the mix… beside it; on a touch screen Share first. A clip's inspector
// downloads its WAV the same way. docs/flows.md#j34
import { readFileSync } from 'node:fs';

const mp3 = (b) => b.length > 1024 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

// shown is a container's rows (or keys) a person can see, by their words.
const shown = (sel) => [...document.querySelectorAll(sel)]
  .filter((e) => e.getBoundingClientRect().height > 0)
  .map((e) => (e.querySelector('.menu-word') ?? e).textContent.trim());

export default {
  id: 'J3.4',
  title: 'Download the mix from a computer',
  profiles: ['desktop', 'tablet'],
  checksMenus: ['#tape-menu'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Laptop mix'));
    const take = await t.given('a take on the shelf', () => api.keep(20));
    const st = await api.tapeState();
    const q = `id=${encodeURIComponent(tape.id)}`;
    const bar = st.grid.frames / st.grid.bars;
    const to = Math.min(Math.round(2 * bar), Math.floor(take.duration_seconds * take.sample_rate));
    await t.given('the take\'s first 2 bars on track 1', () => api.post(`/api/tapes/drop?${q}`, { take: take.name, from: 0, to, track: 1, at: st.loop.in }));
    // As Chrome on a Mac over HTTPS: it can share files. What the sheet is
    // handed is kept, so the flow can say nothing went there.
    await t.given('a browser that can share files', () => page.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = (d) => !!d && Array.isArray(d.files);
      navigator.share = async (d) => { window.__shared.push(d.files[0].name); };
    }));

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#tape-name').waitFor({ state: 'visible' });
    const mouse = await page.evaluate(() => matchMedia('(pointer: fine)').matches);
    await t.step('tap the tape’s name', () => t.tap(page.locator('#tape-name')));
    await t.poll(() => document.getElementById('tape-menu')?.dataset.state === 'open');
    const rows = await page.evaluate(shown, '#tape-menu .menu-item');
    const dl = rows.indexOf('Download the mix'), sh = rows.indexOf('Share the mix…');
    t.expect(mouse ? 'its menu has Download the mix, then Share the mix… beside it' : 'its menu has Share the mix…, then Download the mix beside it',
      dl >= 0 && sh >= 0 && (mouse ? sh === dl + 1 : dl === sh + 1), rows);

    const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await t.step('tap Download the mix', () => t.tap(page.locator('#tape-dl-mix')));
    const got = await download;
    const day = new Date().toLocaleDateString('en-CA'); // the Pi's day, as YYYY-MM-DD
    t.expect('the browser downloads it, named after the tape and the day', got?.suggestedFilename() === `Laptop mix ${day}.mp3`, got?.suggestedFilename());
    const bytes = got ? readFileSync(await got.path()) : Buffer.alloc(0);
    t.expect('it is an MP3', mp3(bytes), { size: bytes.length, head: [...bytes.subarray(0, 4)] });
    t.expect('nothing went to the share sheet', (await page.evaluate(() => window.__shared.length)) === 0);

    // A clip, from its inspector: Download as WAV, and Share as WAV… beside it.
    // Its first bar on screen: the lanes show the loop and a bar either side
    // (geometry.js editView) until something pans them.
    await t.step(mouse ? 'double-click the part on track 1' : 'double-tap the part on track 1', async () => {
      const r = await page.locator('.tt-lane').first().boundingBox();
      const from = Math.max(0, st.loop.in - bar), span = st.loop.out + bar - from;
      const x = r.x + ((st.loop.in + bar / 2 - from) / span) * r.width, y = r.y + r.height / 2;
      if (mouse) return page.mouse.dblclick(x, y);
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(80);
      return page.touchscreen.tap(x, y);
    });
    t.expect('its inspector opens', await t.poll(() => document.getElementById('clip-sheet')?.open));
    const keys = await page.evaluate(shown, '#clip-download, #clip-share');
    const kd = keys.indexOf('Download as WAV'), ks = keys.indexOf('Share as WAV…');
    t.expect(mouse ? 'Download as WAV, then Share as WAV… beside it' : 'Share as WAV…, then Download as WAV beside it',
      kd >= 0 && ks >= 0 && (mouse ? ks === kd + 1 : kd === ks + 1), keys);
    const wav = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await t.step('tap Download as WAV', () => t.tap(page.locator('#clip-download')));
    const w = await wav;
    const head = w ? readFileSync(await w.path()).subarray(0, 4).toString('latin1') : '';
    t.expect('the browser downloads the clip as a WAV', /\.wav$/.test(w?.suggestedFilename() ?? '') && head === 'RIFF', { name: w?.suggestedFilename(), head });
    t.expect('still nothing went to the share sheet', (await page.evaluate(() => window.__shared.length)) === 0);
  },
};
