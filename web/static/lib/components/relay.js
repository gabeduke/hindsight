// web/static/lib/components/relay.js
// A mediator a surface makes and hands a component in its props, so the
// rest of the page can press what the component draws without the
// component answering anything from its mount (docs/architecture/
// components.md, *Reaching a component*): the shell makes the Transport's
// tapeKeys relay, the Transport provides its ●, Catch and click to it, and
// the Studio presses them through ctx.tapeKeys (decision D4 of the
// Transport's extraction). The contract (mount.js) is unchanged: this is
// its own "a callback the surface passed in".

/**
 * relay makes a mediator for the methods `names`. Answers { api, provide }:
 * `api` is what the page is handed, each name a method that calls the
 * provided one's and answers what it answers (undefined while nothing is
 * provided); provide(impl) is the component's, and answers a way to take
 * it back (a later provide replaces it, and the earlier one's off does
 * nothing then).
 */
export function relay(names) {
  let impl = null;
  const api = Object.freeze(Object.fromEntries(names.map((n) => [n, (...args) => impl?.[n]?.(...args)])));
  return Object.freeze({
    api,
    provide(it) {
      impl = it;
      return () => { if (impl === it) impl = null; };
    },
  });
}
