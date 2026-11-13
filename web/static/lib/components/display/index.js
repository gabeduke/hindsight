// web/static/lib/components/display/index.js
// The display's keys (docs/architecture/components.md, *The display*): two,
// each a value over its legend, amber on the LCD's black, for the tape the
// transport holds -- the tempo over where it plays (with no tempo, where it
// plays over OUT: the calm Studio's decision 5), and what plays. A value
// has a short form and a long one (96 BPM / 96 BPM · 4 BARS), and which
// shows is the component's own width's to say (css/display.css), never the
// page's.
//
// The first component on the contract (lib/components/mount.js), built for
// the harness (scripts/components.mjs). The bar, the Transport, still draws
// its own two keys (#np-tempo, #np-source: its template,
// lib/components/transport/index.js, and bar.js) until it mounts this in
// their place (decision 6, step 5h: docs/plan/STATE.md).
//
// A key opens what the surface says it does, handed the key it was pressed
// on: the source's, props.source; the tempo's, props.tempo (the tempo's
// panel, in the Studio) where the surface hands one, else props.output
// (the Output sheet). A key the surface gives nothing to do is disabled.
// The words are lib/bar/display.js's.

import { tapeDisplay, tempoLabel } from '../../bar/display.js';
import { icon } from '../../ui/icons.js';

const chev = icon('down', { size: 8, cls: 'lcd-chev' });

const TEMPLATE = `<button class="lcd-key lcd-tempo" type="button" data-part="tempo">`
  + `<span class="lcd-val"><span class="lcd-short" data-part="tempo-short"></span><span class="lcd-long" data-part="tempo-long"></span></span>`
  + `<span class="lcd-leg"><span class="lcd-plays" data-part="tempo-leg"></span>${chev}</span></button>`
  + `<button class="lcd-key lcd-source" type="button" data-part="source">`
  + `<span class="lcd-val"><span class="lcd-short" data-part="source-short"></span><span class="lcd-long" data-part="source-long"></span></span>`
  + `<span class="lcd-leg">SOURCE${chev}</span></button>`;

/** KEYS are the display's keys, by the part each is named for. */
export const KEYS = Object.freeze(['tempo', 'source']);

/** words is what the keys say for transport snapshot `s`: tapeDisplay's, for its tape and where it plays. */
export function words(s) {
  return tapeDisplay(s?.tape ?? null, s?.live?.output_mode ?? null);
}

export default {
  id: 'display',
  root: 'lcd-keys',
  needs: ['transport'],
  css: 'css/display.css',
  mount(root, { transport }, cx) {
    root.innerHTML = TEMPLATE;
    const part = (name) => root.querySelector(`[data-part="${name}"]`);
    const keys = Object.fromEntries(KEYS.map((k) => [k, part(k)]));
    const fn = (name) => (typeof cx.props[name] === 'function' ? cx.props[name] : null);
    // What a press on each opens: the tempo's panel, else the Output sheet.
    const runs = { tempo: fn('tempo') || fn('output'), source: fn('source') };
    const opens = fn('tempo') ? 'tempo' : fn('output') ? 'output' : null;
    for (const k of KEYS) {
      const key = keys[k];
      key.id = cx.id(k);
      key.disabled = !runs[k];
      key.addEventListener('click', () => runs[k]?.(key));
    }
    const text = Object.fromEntries(['tempo-short', 'tempo-long', 'tempo-leg', 'source-short', 'source-long'].map((p) => [p, part(p)]));
    const put = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    const say = (el, v) => { if (el.getAttribute('aria-label') !== v) el.setAttribute('aria-label', v); };
    cx.watch(transport, (s) => {
      const d = words(s);
      put(text['tempo-short'], d.tempo.short);
      put(text['tempo-long'], d.tempo.long);
      put(text['tempo-leg'], d.tempo.leg);
      put(text['source-short'], d.source.short);
      put(text['source-long'], d.source.long);
      say(keys.tempo, tempoLabel(d, opens));
      say(keys.source, d.said.source);
    });
    return {};
  },
};
