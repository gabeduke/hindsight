// The stream's bookkeeping on the page: which output frame and tape
// position the speaker is playing, from the packets' stamps. The worklet
// plays the audio; this knows what it is.

const HEADER = 24;

export function parsePacket(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER || (buf.byteLength - HEADER) % 4) return null;
  const v = new DataView(buf);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'HSTR' || v.getUint8(4) !== 1) return null;
  return {
    frame: Number(v.getBigUint64(8, true)),
    pos: Number(v.getBigInt64(16, true)),
    playing: (v.getUint8(5) & 1) === 1,
    pcm: new Int16Array(buf, HEADER),
  };
}

// StampLog keeps each packet's stamp against the stream index of its first
// frame: how many frames had been queued to the worklet before it.
export class StampLog {
  constructor(max = 512) { this.max = max; this.marks = []; }

  add(index, { frame, pos, playing }) {
    this.marks.push({ index, frame, pos, playing });
    if (this.marks.length > this.max) this.marks.splice(0, this.marks.length - this.max);
  }

  clear() { this.marks = []; }

  // at is the stamp for stream index i, run on from the packet it's in.
  at(i, loop) {
    let m = null;
    for (let k = this.marks.length - 1; k >= 0; k--) if (this.marks[k].index <= i) { m = this.marks[k]; break; }
    if (!m) return null;
    const d = i - m.index;
    if (!m.playing) return { frame: m.frame + d, pos: m.pos, playing: false };
    let pos = m.pos + d;
    if (loop && loop.on && m.pos < loop.out && pos >= loop.out) pos = loop.in + (pos - loop.out);
    return { frame: m.frame + d, pos, playing: true };
  }
}

export function heardIndex({ rd, at }, now, rate, latencyS) {
  return rd + Math.round((now - at) * rate) - Math.round(latencyS * rate);
}

export function nextBackoff(ms) { return Math.min(5000, ms ? ms * 2 : 500); }
