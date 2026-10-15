// web/static/lib/play/fake-dom.js
// A stand-in document, just big enough to build the instrument strip in a
// test (startStrip, mountStrip): elements with children, attributes, classes,
// listeners, and the few selectors the strip uses. Not shipped (nothing in
// the app imports it); the tests do.

class ClassList {
  constructor(el) { this.el = el; }
  list() { return String(this.el.className || '').split(/\s+/).filter(Boolean); }
  add(...c) { this.el.className = [...new Set([...this.list(), ...c])].join(' '); }
  remove(...c) { this.el.className = this.list().filter((x) => !c.includes(x)).join(' '); }
  contains(c) { return this.list().includes(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : !!force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

class Text {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parent = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  remove() { if (this.parent) this.parent.nodes.splice(this.parent.nodes.indexOf(this), 1); this.parent = null; }
}

// One simple selector: tag, .class, #id, [attr] or [attr="v"], chained (button.x[data-pad="keep"]).
function matches(el, sel) {
  const re = /([#.]?[\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
  let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1]) {
      const t = m[1];
      if (t[0] === '.') { if (!el.classList.contains(t.slice(1))) return false; }
      else if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
      else if (el.tagName.toLowerCase() !== t.toLowerCase()) return false;
    } else if (m[3] === undefined ? !el.hasAttribute(m[2]) : el.getAttribute(m[2]) !== m[3]) return false;
  }
  return any;
}

export class FakeEl {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.nodes = [];
    this.parent = null;
    this.attrs = new Map();
    this.className = '';
    this.id = '';
    // dataset.pad is the attribute data-pad, as in a page.
    const kebab = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    this.dataset = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' && this.attrs.has(kebab(k)) ? this.attrs.get(kebab(k)) : undefined),
      set: (_t, k, v) => { this.attrs.set(kebab(k), String(v)); return true; },
      deleteProperty: (_t, k) => { this.attrs.delete(kebab(k)); return true; },
    });
    this.style = {};
    this.hidden = false;
    this.title = '';
    this.disabled = false;
    this.listeners = new Map();
    this.classList = new ClassList(this);
  }

  set innerHTML(html) { this.replaceChildren(...parseHTML(this.ownerDocument, html).nodes); }
  get innerHTML() { return ''; }
  /** children are the elements; nodes also hold the text. */
  get children() { return this.nodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.nodes.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.nodes) c.parent = null; this.nodes = []; if (v !== '' && v != null) this.append(String(v)); }
  get firstChild() { return this.nodes[0] || null; }
  get lastChild() { return this.nodes[this.nodes.length - 1] || null; }
  get childElementCount() { return this.nodes.filter((c) => c.nodeType === 1).length; }
  get parentElement() { return this.parent; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === this.ownerDocument.documentElement || e === this.ownerDocument.body; }

  // A fragment (a template's cloned content) puts in its children, not itself.
  _flat(nodes) { return nodes.flatMap((n) => (n && n.isFragment ? [...n.nodes] : [n])); }
  _adopt(n) {
    const node = typeof n === 'string' ? new Text(n) : n;
    node.remove?.();
    node.parent = this;
    return node;
  }
  append(...nodes) { for (const n of this._flat(nodes)) this.nodes.push(this._adopt(n)); }
  appendChild(n) { this.append(n); return n; }
  prepend(...nodes) { this.nodes.unshift(...this._flat(nodes).map((n) => this._adopt(n))); }
  replaceChildren(...nodes) { for (const c of this.nodes) c.parent = null; this.nodes = []; this.append(...nodes); }
  before(...nodes) {
    const p = this.parent;
    if (!p) return;
    const i = p.nodes.indexOf(this);
    p.nodes.splice(i, 0, ...p._flat(nodes).map((n) => p._adopt(n)));
  }
  after(...nodes) {
    const p = this.parent;
    if (!p) return;
    const i = p.nodes.indexOf(this);
    p.nodes.splice(i + 1, 0, ...p._flat(nodes).map((n) => p._adopt(n)));
  }
  remove() { if (this.parent) this.parent.nodes.splice(this.parent.nodes.indexOf(this), 1); this.parent = null; }

  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }

  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(e) {
    for (const fn of [...(this.listeners.get(e.type) || [])]) fn(e);
    return !e.defaultPrevented;
  }
  /** listenerCount says how many listeners hear `type`, for a test that one went. */
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }

  descendants() { return this.nodes.flatMap((c) => (c.nodeType === 1 ? [c, ...c.descendants()] : [])); }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    // "a b" is b somewhere inside a (no child combinator, which the strip does not use).
    const hit = (e, tokens) => {
      if (!matches(e, tokens[tokens.length - 1])) return false;
      let up = e.parent;
      for (let i = tokens.length - 2; i >= 0; i--) {
        while (up && !(up.nodeType === 1 && matches(up, tokens[i]))) up = up.parent;
        if (!up) return false;
        up = up.parent;
      }
      return true;
    };
    return this.descendants().filter((e) => parts.some((p) => hit(e, p.split(/\s+/))));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let e = this; e; e = e.parent) if (e.nodeType === 1 && matches(e, sel)) return e; return null; }
  contains(n) { for (let e = n; e; e = e.parent) if (e === this) return true; return false; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  focus() {}
  blur() {}
  /** cloneNode copies the tree, not its listeners. */
  cloneNode(deep = false) {
    const c = new FakeEl(this.tagName, this.ownerDocument);
    for (const [k, v] of this.attrs) c.setAttribute(k, v);
    c.className = this.className;
    c.id = this.id;
    c.hidden = this.hidden;
    c.isFragment = this.isFragment;
    if (deep) for (const k of this.nodes) c.append(k.nodeType === 1 ? k.cloneNode(true) : k.data);
    if (this.content) c.content = this.content.cloneNode(true);
    return c;
  }
}

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

/**
 * parseHTML builds `html` (a page's own markup, templates and all) into
 * elements of `doc`, answering a holder of them. A <template> keeps its
 * inside in `.content`, which cloneNode(true) copies, as the page's script
 * does.
 */
export function parseHTML(doc, html) {
  const root = new FakeEl('div', doc);
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { stack[stack.length - 1].append(m[5]); continue; }
    if (!m[2]) continue; // a comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
      }
      continue;
    }
    const el = new FakeEl(tag, doc);
    for (const a of m[3].matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) el.setAttribute(a[1], a[2] ?? a[3] ?? '');
    if (el.hasAttribute('hidden')) el.hidden = true;
    stack[stack.length - 1].append(el);
    if (tag === 'template') {
      // its markup is its .content, not its children; a closing tag ends it
      el.content = new FakeEl('template', doc);
      el.content.isFragment = true;
      stack.push(el.content);
    } else if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

/** fakeDoc is a document: a body, getElementById over what is attached, and createElement. */
export function fakeDoc() {
  const doc = {};
  doc.createElement = (t) => new FakeEl(t, doc);
  doc.createElementNS = (_ns, t) => new FakeEl(t, doc);
  doc.createTextNode = (t) => new Text(t);
  doc.documentElement = new FakeEl('html', doc);
  doc.body = new FakeEl('body', doc);
  doc.documentElement.append(doc.body);
  doc.getElementById = (id) => doc.documentElement.descendants().find((e) => e.id === id) || null;
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  const hear = new FakeEl('doc', doc);
  for (const m of ['addEventListener', 'removeEventListener', 'dispatchEvent', 'listenerCount']) doc[m] = (...a) => hear[m](...a);
  return doc;
}
