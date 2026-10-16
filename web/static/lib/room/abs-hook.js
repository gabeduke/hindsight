// web/static/lib/room/abs-hook.js
// For tests only (nothing in the app imports it): the page scripts name each
// other by absolute path -- `import … from '/lib/shelf.js'` -- which a browser
// resolves against the site and Node does not. Importing this first teaches
// Node's loader that /lib/… is web/static/lib/…, so a test can load the real
// lib/takes.js and lib/shelf-detail.js and run them on stand-ins:
//
//   import './abs-hook.js';
//   const { TakesList } = await import('../takes.js');
//
// (A static import of takes.js would be resolved before this ran.)
import { register } from 'node:module';

const root = new URL('../../', import.meta.url).href; // web/static/
register(`data:text/javascript,${encodeURIComponent(
  `export async function resolve(spec, ctx, next) { return next(spec.startsWith('/lib/') ? ${JSON.stringify(root)} + spec.slice(1) : spec, ctx); }`,
)}`);
