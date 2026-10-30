// web/static/lib/components/display/index.js
// The display's keys (docs/architecture/components.md, *The display*): the
// tempo, what plays and where it plays, each a value over its legend,
// amber on the LCD's black, for the tape the transport holds. A value has a
// short form and a long one (96 / 96 BPM · 4 BARS), and which shows is the
// component's own width's to say (css/display.css), never the page's.
//
// The first component on the contract (lib/components/mount.js), built for
// the harness (scripts/components.mjs). The bar still draws its own three
// keys (#np-tempo, #np-source, #np-output in shell.html, lib/bar/bar.js)
// until the Transport's extraction mounts this in their place.
//
// A key opens what the surface says it does (props.tempo, props.source,
// props.output, each handed the key it was pressed on); a key the surface
// gives nothing to do is disabled. The words are lib/bar/display.js's.

import { tapeDisplay } from '../../bar/display.js';
import { icon } from '../../ui/icons.js';

const chev = icon('down', { size: 8, cls: 'lcd-chev' });

const TEMPLATE = `<button class="lcd-key lcd-tempo" type="button" data-part="tempo">`
  + `<span class="lcd-val"><span class="lcd-short" data-part="tempo-short"></span><span class="lcd-long" data-part="tempo-long"></span></span>`
  + `<span class="lcd-leg"><span class="lcd-short">BPM</span><span class="lcd-long">TEMPO</span>${chev}</span></button>`
  + `<button class="lcd-key lcd-source" type="button" data-part="source">`
  + `<span class="lcd-val"><span class="lcd-short" data-part="source-short"></span><span class="lcd-long" data-part="source-long"></span></span>`
  + `<span class="lcd-leg">SOURCE${chev}</span></button>`
  + `<button class="lcd-key lcd-output" type="button" data-part="output">`
  + `<span class="lcd-val" data-part="output-val"></span>`
  + `<span class="lcd-leg">OUT${chev}</span></button>`;

/** KEYS are the display's keys, by the part each is named for. */
export const KEYS = Object.freeze(['tempo', 'source', 'output']);

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
    for (const k of KEYS) {
      const key = keys[k];
      key.id = cx.id(k);
      const run = cx.props[k];
      key.disabled = typeof run !== 'function';
      key.addEventListener('click', () => run?.(key));
    }
    const text = {
      'tempo-short': part('tempo-short'), 'tempo-long': part('tempo-long'),
      'source-short': part('source-short'), 'source-long': part('source-long'),
      'output-val': part('output-val'),
    };
    const put = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    const say = (el, v) => { if (el.getAttribute('aria-label') !== v) el.setAttribute('aria-label', v); };
    cx.watch(transport, (s) => {
      const d = words(s);
      put(text['tempo-short'], d.tempo.short);
      put(text['tempo-long'], d.tempo.long);
      put(text['source-short'], d.source.short);
      put(text['source-long'], d.source.long);
      put(text['output-val'], d.out);
      say(keys.tempo, d.said.tempo);
      say(keys.source, d.said.source);
      say(keys.output, d.said.out);
    });
    return {};
  },
};
