// web/static/lib/scene/prop.js
// A prop: a thing in a scene that stands where it is put -- a chair, a lamp,
// a shelf unit. Its state is where it is and what it is made of (the
// Listening Room's ROOM.objects entries, lib/room/space.js); its view is that
// state, as it is. Nothing moves it yet, so its step never asks for another
// frame -- a scene full of props parks at once. When something does move one
// (a door, a chair pushed back), its motion goes here.

export class PropModel {
  constructor() { this.view = null; }
  step(state) {
    if (this.view === state) return false;
    this.view = state;
    return false;
  }
}
