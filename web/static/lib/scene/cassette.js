// web/static/lib/scene/cassette.js
// The cassette's model.
//
// State the page sets: `played`, how far through the take the tape is (0 to
// 1, from its <audio>, or by hand on the bench), and `playing`. The view is
// what the face draws from: `played`, held to the tape, and `spinning`,
// whether the hubs turn.
//
// The hubs turn in CSS today (.cassette.playing .cas-spin), at the speed
// they always have; the packs and the lit bars follow `played` exactly, so
// there is nothing here to ease. When the shelf hands a cassette to the deck
// (R2), its lift and the hubs' angle belong here.

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

export class CassetteModel {
  constructor() {
    this.view = Object.freeze({ played: 0, spinning: false });
  }

  step(state) {
    const played = clamp01(state.played);
    const spinning = !!state.playing;
    if (played !== this.view.played || spinning !== this.view.spinning) {
      this.view = Object.freeze({ played, spinning });
    }
    return false; // nothing of its own to move: the page's clock moves it
  }
}
