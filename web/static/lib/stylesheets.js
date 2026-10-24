// web/static/lib/stylesheets.js
// The stylesheets as the tests read them: which a page links and in what
// order, the text of one file or of a page's whole cascade, every rule with
// the at-rules it sits in, a block by its braces, a section by its header,
// and the tokens of either scheme.
//
// Eighteen test files once read styles.css by path, with eight copies of a
// brace matcher between them; a matcher that slips (a brace in a comment, a
// comma inside :is()) passes a test that should fail, in one file and not
// the next. They share this one now, and it has tests of its own.
//
// Node only -- it reads the disk. No page imports it, so it is not in
// sw.js's SHELL.
import { readFileSync } from 'node:fs';

const STATIC = new URL('../', import.meta.url); // web/static/

/**
 * scan is `css` twice over, each the same length as `css` so an index or a
 * line number in one is the same in the others: `plain` has its comments
 * blanked to spaces (newlines kept), and `shape` has its strings blanked as
 * well, so a brace, a semicolon or a comma found in `shape` is CSS's own.
 */
function scan(css) {
  let plain = '', shape = '';
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  for (let i = 0; i < css.length;) {
    if (css.startsWith('/*', i)) {
      const end = comment(css, i);
      plain += blank(css.slice(i, end));
      shape += blank(css.slice(i, end));
      i = end;
    } else if (css[i] === '"' || css[i] === "'") {
      const { end, closed } = string(css, i);
      plain += css.slice(i, end);
      shape += css[i] + blank(css.slice(i + 1, closed ? end - 1 : end)) + (closed ? css[i] : '');
      i = end;
    } else {
      plain += css[i];
      shape += css[i];
      i++;
    }
  }
  return { plain, shape };
}
/** comment is where the comment opening at `i` ends (past its close, or the text's end). */
function comment(css, i) {
  const end = css.indexOf('*/', i + 2);
  return end < 0 ? css.length : end + 2;
}
/** string is where the string opening at `i` ends: past its quote, or (unclosed) at its line's end. */
function string(css, i) {
  let j = i + 1;
  while (j < css.length && css[j] !== css[i] && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
  const closed = css[j] === css[i];
  return { end: closed ? j + 1 : Math.min(j, css.length), closed };
}

/** stripComments is `css` without its comments (a string that looks like one is kept). */
export function stripComments(css) {
  let out = '';
  for (let i = 0; i < css.length;) {
    if (css.startsWith('/*', i)) i = comment(css, i);
    else if (css[i] === '"' || css[i] === "'") {
      const { end } = string(css, i);
      out += css.slice(i, end);
      i = end;
    } else out += css[i++];
  }
  return out;
}

/** fileCss is one stylesheet under web/static ('styles.css' or '/styles.css'), as text. */
export function fileCss(name, { comments = true } = {}) {
  const text = readFileSync(new URL(name.replace(/^\//, ''), STATIC), 'utf8');
  return comments ? text : stripComments(text);
}

/** linksOf is the stylesheets `page` (under web/static) links, as their hrefs, in <link> order. */
export function linksOf(page) {
  return linksIn(readFileSync(new URL(page.replace(/^\//, ''), STATIC), 'utf8'));
}

/** linksIn is the stylesheets a page's markup links, as their hrefs, in order; a commented-out one is not linked. */
export function linksIn(html) {
  const out = [];
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) out.push(href[1]);
  }
  return out;
}

/** cssOf is every stylesheet `page` links, one after another in link order: the page's cascade. */
export function cssOf(page = 'shell.html', { comments = true } = {}) {
  const files = linksOf(page);
  if (!files.length) throw new Error(`${page} links no stylesheet`);
  return files.map((f) => fileCss(f, { comments })).join('\n');
}

/** splitList splits a selector (or any) list at its top-level commas: not inside :is(), [..] or a string. */
export function splitList(list) {
  const { shape } = scan(list);
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < shape.length; i++) {
    const c = shape[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(from, i)); from = i + 1; }
  }
  out.push(list.slice(from));
  return out.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * decls is a rule's body as [{ prop, value, important }], in order, a
 * semicolon inside url(), a function or a string not ending one. The value
 * has its whitespace collapsed and its !important taken off.
 */
export function decls(body) {
  const { plain, shape } = scan(body);
  const out = [];
  let depth = 0, from = 0;
  const take = (to) => {
    const d = plain.slice(from, to);
    const k = d.indexOf(':');
    if (k > 0) {
      let value = d.slice(k + 1).trim().replace(/\s+/g, ' ');
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/\s*!\s*important$/i, '');
      out.push({ prop: d.slice(0, k).trim(), value, important });
    }
  };
  for (let i = 0; i < shape.length; i++) {
    const c = shape[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { take(i); from = i + 1; }
  }
  take(shape.length);
  return out;
}

/**
 * rules is every style rule in `css`, in order:
 *   { sel: ['.a', '.b :is(.c, .d)'], body, media, at, line, file }
 * sel is the selector list split at its top-level commas (whitespace
 * collapsed); body the text between the braces, comments blanked; at the
 * at-rules it sits in, outermost first ('@media (min-width: 700px)',
 * '@supports …'); media the conditions of the @media among them, joined by
 * ' / ' when one sits in another ('' for none); line the line its selector
 * starts on, in `css`; file whatever the caller passed. A keyframe's steps
 * and @font-face are not style rules, and are left out -- the steps come
 * too with `keyframes` (their at-rules end in the @keyframes).
 */
export function rules(css, { file, keyframes = false } = {}) {
  const { plain, shape } = scan(css);
  const out = [];
  const stack = [];
  let from = 0;
  // Line numbers by counting newlines once, up to each rule's start.
  let line = 1, counted = 0;
  const lineAt = (i) => {
    for (; counted < i; counted++) if (css[counted] === '\n') line++;
    return line;
  };
  for (let i = 0; i < shape.length; i++) {
    const c = shape[i];
    if (c === '{') {
      const raw = plain.slice(from, i);
      const lead = raw.length - raw.trimStart().length;
      stack.push({ head: raw.trim().replace(/\s+/g, ' '), open: i, line: lineAt(from + lead) });
      from = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top && !top.head.startsWith('@') && (keyframes || !stack.some((s) => /^@(-[a-z]+-)?keyframes\b/i.test(s.head)))) {
        const at = stack.filter((s) => s.head.startsWith('@')).map((s) => s.head);
        const media = at.filter((a) => /^@media\b/i.test(a)).map((a) => a.replace(/^@media\s*/i, '')).join(' / ');
        out.push({ sel: splitList(top.head), body: plain.slice(top.open + 1, i), media, at, line: top.line, file });
      }
      from = i + 1;
    } else if (c === ';') from = i + 1;
  }
  return out;
}

/**
 * block is the text inside the first block that opens at or after `at` (an
 * index into `css`, or a string to find in it), matched brace for brace; a
 * brace in a comment or a string doesn't count. It throws when there is no
 * such block, or it never closes.
 */
export function block(css, at) {
  const from = typeof at === 'number' ? at : css.indexOf(at);
  if (from < 0) throw new Error(`no block at ${JSON.stringify(at)}`);
  const { shape } = scan(css);
  const open = shape.indexOf('{', from);
  if (open < 0) throw new Error(`no block after ${JSON.stringify(at)}`);
  let depth = 0;
  for (let i = open; i < shape.length; i++) {
    if (shape[i] === '{') depth++;
    else if (shape[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`the block at ${JSON.stringify(at)} never closes`);
}

/**
 * section is one section of a stylesheet: from its header comment (`head`,
 * as it starts: '/* ---------- Rooms P2:') to the next header of four dashes
 * or more, or the file's end, with its comments stripped. It throws when
 * there is no such header.
 */
export function section(css, head) {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no section ${JSON.stringify(head)}`);
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  return stripComments(css.slice(start, next < 0 ? undefined : start + 1 + next));
}

const DARK = /^@media \(prefers-color-scheme: dark\)$/i;

/**
 * tokens is the custom properties a scheme gives :root, as { '--name':
 * value }: 'light' is every :root outside an at-rule; 'dark' is those and
 * the dark block's, in the order the cascade takes them (a later rule wins).
 * With `only`, 'dark' is the dark block's alone: the tokens that follow the
 * scheme.
 */
export function tokens(css, { scheme = 'light', only = false } = {}) {
  if (scheme !== 'light' && scheme !== 'dark') throw new Error(`no scheme ${scheme}`);
  const out = {};
  for (const r of rules(css)) {
    if (r.sel.length !== 1 || r.sel[0] !== ':root') continue;
    const light = r.at.length === 0;
    const dark = r.at.length === 1 && DARK.test(r.at[0]);
    if (scheme === 'light' ? !light : !(dark || (light && !only))) continue;
    for (const d of decls(r.body)) if (d.prop.startsWith('--')) out[d.prop] = d.value;
  }
  return out;
}
