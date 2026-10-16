// web/static/lib/help/guide-page.js
// The guide page around the rendered Markdown: each numbered part in a
// section of its own, its number on a plate, and a contents list -- a
// sticky bar that opens on a phone or a tablet, a column beside the text on
// a wide screen -- that follows where you've read to.
//
// sectionize and contents work on the renderer's HTML as a string, so they
// are tested without a browser; initGuidePage is the DOM around them.

// The renderer's headings: <h2 id="…">…</h2>, never nested.
const HEADING = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g;
// "3. The main page", "8.10 Taking the tape upstairs".
const NUMBERED = /^(\d+(?:\.\d+)*\.?)\s+/;

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * sectionize wraps everything from one h2 up to the next in a
 * <section class="part">, what comes before the first in
 * <header class="cover">, and puts a numbered heading's number on a plate.
 * The heading's words and id are unchanged, so every link still lands.
 */
export function sectionize(html) {
  const plated = html.replace(HEADING, (all, level, id, inner) => {
    const m = NUMBERED.exec(inner);
    if (!m) return all;
    return `<h${level} id="${id}"><span class="num">${m[1]}</span> ${inner.slice(m[0].length)}</h${level}>`;
  });
  const parts = plated.split(/(?=<h2 id=")/);
  const cover = parts[0].startsWith('<h2 ') ? '' : parts.shift();
  return (cover ? `<header class="cover">${cover}</header>` : '')
    + parts.map((p) => `<section class="part" aria-labelledby="${/^<h2 id="([^"]+)"/.exec(p)[1]}">${p}</section>`).join('');
}

/** contents is the guide's h2 and h3 headings, in order: [{id, level, num, title}]. */
export function contents(html) {
  return [...html.matchAll(HEADING)].map(([, level, id, inner]) => {
    const t = text(inner).trim();
    const m = NUMBERED.exec(t);
    return { id, level: Number(level), num: m ? m[1].replace(/\.$/, '') : '', title: m ? t.slice(m[0].length) : t };
  });
}

/**
 * current is the id of the heading being read: the last whose top has gone
 * past `line` (px from the top of the screen), or the first if none has.
 * `tops` is [{id, top}] in document order.
 */
export function current(tops, line) {
  let at = tops.length ? tops[0].id : '';
  for (const t of tops) if (t.top <= line) at = t.id;
  return at;
}

const WIDE = '(min-width: 1100px)';

/** initGuidePage fills `nav` with the contents of the guide in `article`. */
export function initGuidePage(article, nav) {
  const items = contents(article.innerHTML);
  if (!nav || !items.length) return;
  const details = nav.querySelector('details');
  const list = nav.querySelector('ol');
  const now = nav.querySelector('.toc-now');
  list.replaceChildren(...items.map((it) => {
    const li = document.createElement('li');
    li.className = `lv${it.level}`;
    const a = document.createElement('a');
    a.href = `#${it.id}`;
    a.dataset.id = it.id;
    if (it.num) {
      const n = document.createElement('span');
      n.className = 'toc-num';
      n.textContent = it.num;
      a.append(n);
    }
    a.append(document.createTextNode(it.title));
    li.append(a);
    return li;
  }));
  nav.hidden = false;

  // Open beside the text on a wide screen; a bar to open on anything else.
  const wide = matchMedia(WIDE);
  const fit = () => { details.open = wide.matches; };
  fit();
  wide.addEventListener('change', fit);
  // Picking a part closes the list where it covers the text.
  list.addEventListener('click', (e) => {
    if (e.target.closest('a') && !wide.matches) details.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && details.open && !wide.matches) { details.open = false; details.querySelector('summary').focus(); }
  });

  const heads = items.map((it) => document.getElementById(it.id)).filter(Boolean);
  const links = new Map([...list.querySelectorAll('a')].map((a) => [a.dataset.id, a]));
  let shown = '';
  const spy = () => {
    const line = nav.getBoundingClientRect().bottom + 24;
    const id = current(heads.map((h) => ({ id: h.id, top: h.getBoundingClientRect().top })), line);
    if (id === shown) return;
    links.get(shown)?.removeAttribute('aria-current');
    shown = id;
    const a = links.get(id);
    if (!a) return;
    a.setAttribute('aria-current', 'location');
    // The bar says which part you're in.
    const it = items.find((x) => x.id === id);
    now.textContent = it ? `${it.num ? `${it.num} ` : ''}${it.title}` : '';
    // The column keeps the part in view. Scrolled by hand, not with
    // scrollIntoView, which could move the page as well.
    const box = list.getBoundingClientRect(), r = a.getBoundingClientRect();
    if (r.top < box.top) list.scrollTop -= box.top - r.top + 8;
    else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom + 8;
  };
  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; spy(); });
  }, { passive: true });
  addEventListener('resize', spy);
  spy();
}
