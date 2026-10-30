// The components' harness page (scripts/components.mjs): one component,
// mounted alone on fixture models inside a real shell view's ctx, in a page
// that links styles.css, objects.css and its own stylesheet and nothing
// else. Served by the harness's server at /__components/page.js; never
// shipped (nothing under scripts/ is).
//
// What to mount is in the page's address: ?spec=<JSON> with the
// component's id, its root's id, the fixtures by noun (paths under
// testdata/protocol/), the props it is handed (keys whose press is
// recorded), and the verbs the fixture refuses. When it is up,
// window.__harness is {mounted, pressed, said}; a mount that throws leaves
// {failed} instead.

import { mountComponent } from '/lib/components/mount.js';
import { fixture, fixtureModels } from '/lib/models/fixture.js';
import { createView } from '/lib/shell/view.js';
import { createLayers } from '/lib/ui/layers.js';

const harness = { mounted: false, pressed: [], said: [], failed: null };
window.__harness = harness;

try {
  const spec = JSON.parse(new URLSearchParams(location.search).get('spec'));
  const def = (await import(`/lib/components/${spec.id}/index.js`)).default;
  const snapshots = {};
  for (const [noun, file] of Object.entries(spec.fixtures || {})) {
    const res = await fetch(`/__fixtures/${file}`);
    if (!res.ok) throw new Error(`no fixture ${file}`);
    snapshots[noun] = await res.json();
  }
  const fx = fixture(snapshots, { refuse: spec.refuse || {} });
  const toast = (words) => { harness.said.push(String(words)); };
  const made = fixtureModels(fx, def.needs, { onError: toast });
  await made.ready;
  const props = Object.fromEntries((spec.props || []).map((k) => [k, () => { harness.pressed.push(k); }]));
  const view = createView({
    id: 'harness',
    mount(ctx) {
      const root = document.getElementById(spec.rootId);
      const c = mountComponent(def, root, made.models, ctx, props);
      harness.component = c;
      return { show: () => c.show(), hide: () => c.hide() };
    },
  }, {
    root: document.getElementById('stage'),
    shared: { layers: createLayers(), toast, go: () => {} },
  });
  await view.show();
  harness.fixture = fx;
  harness.mounted = true;
} catch (e) {
  harness.failed = String(e?.stack || e);
  throw e;
}
