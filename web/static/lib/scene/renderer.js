// web/static/lib/scene/renderer.js
// What a renderer is. There is no base class: a renderer is anything with
// these five methods, so a DOM one (dom.js, today), an SVG one and a WebGL
// one can draw the same scene, and a test can stand one in with an object
// literal.
//
//   mount(el, scene)  Build its DOM, SVG or WebGL canvas in `el`, and join
//                     the scene with scene.attach(this), which returns the
//                     function that leaves it again.
//   frame(dt)         Draw. Called from the scene's ticker after every model
//                     has stepped, so it reads this frame's views:
//                     obj.view, and obj.state where the drawing needs it.
//   hit(x, y)         The id of the object under viewport point (x, y), or
//                     null: how a pointer finds an object.
//   twin(id)          The real <button> laid over that object, for focus,
//                     keys and screen readers. A DOM object is its own
//                     markup, so the DOM renderer returns the element that
//                     takes its input (the cassette's window, the ribbon),
//                     and null for a picture that takes none.
//   destroy()         Leave the scene and take down what mount() built.
//
// The rules every renderer keeps (docs/superpowers/specs/
// 2026-10-15-scene-contract-design.md):
//
// 1. Motion comes from the models. A renderer never computes motion, and
//    never writes state: the scene throws if it calls set() while drawing.
// 2. Every interactive object has a DOM twin. WebGL draws over accessible
//    markup and never replaces it; a 3D renderer moves each twin to its
//    object's projected position every frame.
// 3. Drop frames, never input. Picks and drags go through hit() and the
//    twins, never through the draw loop.
// 4. Reduced motion is the ticker's job: it passes dt = Infinity and the
//    models land. A renderer never reads the media query.
// 5. Park when still. The scene asks for frames only while a model moves; a
//    renderer with something new to draw that isn't motion -- a resize, a
//    font arriving -- asks for one frame (the DOM renderer's invalidate()).
// 6. Big assets stay out of the shell's cache, in their own versioned cache.
// 7. No bundler, no CDN.

/** RENDERER_METHODS are what a renderer has; isRenderer checks a candidate for them. */
export const RENDERER_METHODS = Object.freeze(['mount', 'frame', 'hit', 'twin', 'destroy']);

export function isRenderer(r) {
  return !!r && RENDERER_METHODS.every((m) => typeof r[m] === 'function');
}
