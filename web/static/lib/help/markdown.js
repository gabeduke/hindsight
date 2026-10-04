// web/static/lib/help/markdown.js
// A small Markdown renderer for the guide page: headings (with ids for
// links), paragraphs, nested lists, tables, fenced code, quotes, rules, and
// inline code, bold, italics and links. Enough for docs/guide.md, with no
// build step and no dependency. Everything is escaped before any markup is
// added, so the guide can't inject HTML even by accident.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** slug is a heading's id: "4. The take page" -> "4-the-take-page". */
export function slug(text) {
  return text.toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** inline renders one line's inline markup: code, links, bold, italics. */
export function inline(text) {
  // Code spans first, held aside so nothing inside them is touched.
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label, href) => {
    // Only plain relative links, anchors and http(s): no javascript: and the like.
    const safe = /^(https?:\/\/|\/|#|\.{0,2}\/?[\w.-])/.test(href) && !/^\s*javascript:/i.test(href);
    // Links between docs point at the guide where it makes sense, else at
    // the repository's copy.
    let h = href;
    if (/^superpowers\//.test(h) || /^\.\.\//.test(h) || /\.md(#|$)/.test(h)) {
      h = `https://github.com/gabeduke/hindsight/blob/main/docs/${h.replace(/^\.\.\//, '')}`;
    }
    return safe ? `<a href="${h}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** renderMarkdown turns Markdown into HTML. */
export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    // Fenced code
    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    // Headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="${slug(h[2])}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // Rule
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // Table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push('<div class="table-wrap"><table><thead><tr>'
        + head.map((c) => `<th>${inline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>');
      continue;
    }
    // Quote
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }
    // Lists, nested by indentation
    if (listItem.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = listItem.exec(l);
        if (m) {
          items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        } else if (!isBlank(l) && items.length && /^\s+\S/.test(l)) {
          items[items.length - 1].text += ` ${l.trim()}`; // a wrapped continuation
          i++;
        } else if (isBlank(l) && i + 1 < lines.length && listItem.test(lines[i + 1])) {
          i++;
        } else {
          break;
        }
      }
      out.push(renderList(items, 0, items.length));
      continue;
    }
    // Paragraph: until a blank line or the start of another block
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|\s*```|\s*\||\s*>)/.test(lines[i]) && !listItem.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function renderList(items, from, to) {
  const base = items[from].indent;
  const tag = items[from].ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let k = from;
  while (k < to) {
    const it = items[k];
    let end = k + 1;
    while (end < to && items[end].indent > base) end++;
    html += `<li>${inline(it.text)}`;
    if (end > k + 1) html += renderList(items, k + 1, end);
    html += '</li>';
    k = end;
  }
  return `${html}</${tag}>`;
}
