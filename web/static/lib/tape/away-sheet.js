// web/static/lib/tape/away-sheet.js
// Overdub on this device: the tape page's sheet for playing the tape on a
// phone, tablet or laptop -- away from the rig, with the jam room quiet --
// and recording a part over it that goes back onto the tape where it was
// played.
//
//   1. The Pi renders the loop (or the whole tape) as one file
//      (GET /api/tapes/listen); this page plays it, round and round, through
//      its own audio context.
//   2. Record opens the same recorder the main page's Phone button uses: an
//      AudioWorklet streaming to /api/phone, so the take is on the Pi as it's
//      played and nothing lives only on the phone. The worklet says the
//      context frame its first sample was recorded at.
//   3. On Stop, away.js works out what to keep -- the last full pass, as a
//      punch keeps -- from where the tape was in the context's clock and the
//      round trip; POST /api/tapes/drop places it.
//
// The round trip -- a frame leaving the context, to the sound of playing
// along with it coming back in -- is the browser's guess until Calibrate
// measures it: clicks through the speaker, heard through the mic.

import { Uploader } from '../phone/uploader.js';
import { wsURL, canRecordHere, meterWidth, fmtClock, VOICE_PROCESSING_OFF, INPUT_KEY } from '../phone/recorder.js';
import { holdScreen } from '../wakelock.js';
import { keptSpan, onsets, roundTrip, guessRoundTrip } from './away.js';

const RT_KEY = 'tape.away.rt'; // {seconds, how}: this device's round trip, as last measured or set

// When the calibration's clicks play, in seconds from the first.
const CLICKS = [0, 0.43, 1.01, 1.47, 2.12, 2.61];

function readRT() {
  try {
    const v = JSON.parse(localStorage.getItem(RT_KEY) || 'null');
    if (v && typeof v.seconds === 'number' && v.seconds >= 0 && v.seconds < 1) return v;
  } catch { /* private mode, or junk */ }
  return null;
}

function writeRT(v) {
  try { localStorage.setItem(RT_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

/**
 * initAway wires the sheet. getTape answers { id, tape, track, replace }:
 * the loaded tape, and where a part goes. onPlaced runs after a part lands,
 * with the drop's answer.
 */
export function initAway({ button, sheet, toast, getTape, onPlaced, api }) {
  const q = (id) => document.getElementById(id);
  const ui = {
    what: q('away-what'),
    span: q('away-span'),
    click: q('away-click'),
    insecure: q('away-insecure'),
    mic: q('away-mic'),
    input: q('away-input'),
    meter: q('away-meter'),
    rt: q('away-rt'),
    cal: q('away-cal'),
    less: q('away-rt-less'),
    more: q('away-rt-more'),
    state: q('away-state'),
    time: q('away-time'),
    play: q('away-play'),
    rec: q('away-rec'),
    close: q('away-close'),
  };

  let ctx = null;
  let stream = null;
  let node = null;           // the recorder worklet
  let micToken = 0;
  let buffer = null;         // the tape, decoded
  let listen = null;         // { from, frames, loop } as the Pi sent it
  let loadToken = 0;
  let src = null;            // what's playing
  let t0 = 0;                // the context time the file's first frame played
  let mode = 'closed';       // closed | ready | recording | saving | calibrating
  let uploader = null;
  let startedFrame = null;   // the context frame of the recording's first sample
  let recFrames = 0;
  let flushed = null;
  let calib = null;          // { chunks, frames } while calibrating
  let lock = null;
  let timer = 0;
  let all = false;
  let click = false;

  button.addEventListener('click', open);
  ui.close.addEventListener('click', () => sheet.close());
  sheet.addEventListener('cancel', (e) => { if (busy()) e.preventDefault(); });
  sheet.addEventListener('close', teardown);
  ui.play.addEventListener('click', () => (src ? stopPlay() : play()));
  ui.rec.addEventListener('click', () => (mode === 'recording' ? stopRec() : record()));
  ui.cal.addEventListener('click', calibrate);
  ui.less.addEventListener('click', () => nudge(-0.005));
  ui.more.addEventListener('click', () => nudge(0.005));
  ui.click.addEventListener('click', () => { click = !click; reload(); });
  for (const b of ui.span.querySelectorAll('button')) {
    b.addEventListener('click', () => { all = b.dataset.span === 'all'; reload(); });
  }
  ui.input.addEventListener('change', () => {
    try { localStorage.setItem(INPUT_KEY, ui.input.value); } catch { /* private mode */ }
    openMic(ui.input.value);
  });

  function busy() { return mode === 'recording' || mode === 'saving' || mode === 'calibrating'; }

  function setState(s) { ui.state.textContent = s; }

  async function open() {
    const t = getTape();
    if (!t || !t.tape) return;
    mode = 'ready';
    sheet.showModal();
    render();
    // The context starts on this tap: a browser only lets audio start from
    // a gesture.
    ensureCtx();
    reload();
    const why = canRecordHere();
    ui.insecure.hidden = !why;
    ui.insecure.textContent = why;
    ui.mic.hidden = !!why;
    if (!why) {
      let saved = '';
      try { saved = localStorage.getItem(INPUT_KEY) || ''; } catch { /* private mode */ }
      openMic(saved);
    }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    ctx.resume().catch(() => {});
    return ctx;
  }

  // reload fetches the tape as it is now: the loop or the whole tape, with
  // or without the click.
  async function reload() {
    if (busy()) return;
    stopPlay();
    const token = ++loadToken;
    buffer = null;
    render();
    const t = getTape();
    setState('Getting the tape from the Pi…');
    try {
      const res = await fetch(`/api/tapes/listen?id=${encodeURIComponent(t.id)}&all=${all ? 1 : 0}&click=${click ? 1 : 0}`, { cache: 'no-store' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const meta = {
        from: Number(res.headers.get('X-Tape-From')),
        frames: Number(res.headers.get('X-Tape-Frames')),
        loop: res.headers.get('X-Tape-Loop') === 'true',
      };
      const data = await res.arrayBuffer();
      const decoded = await ensureCtx().decodeAudioData(data);
      if (token !== loadToken) return;
      buffer = decoded;
      listen = meta;
      setState('');
    } catch (e) {
      if (token !== loadToken) return;
      setState(`Couldn’t get the tape: ${e.message || e}`);
    }
    render();
  }

  async function openMic(deviceId) {
    const token = ++micToken;
    const current = () => token === micToken && mode !== 'closed';
    stopMic();
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...VOICE_PROCESSING_OFF, deviceId: { exact: deviceId } } : VOICE_PROCESSING_OFF,
      });
    } catch (e) {
      if (!current()) return;
      if (deviceId) return openMic('');
      ui.insecure.hidden = false;
      ui.insecure.textContent = e && e.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in the browser’s settings for this site to record; you can still listen.'
        : 'No input to record from. You can still listen.';
      render();
      return;
    }
    if (!current()) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    await listInputs(s);
    try {
      const c = ensureCtx();
      await c.audioWorklet.addModule('/lib/phone/worklet.js');
      if (!current()) { s.getTracks().forEach((t) => t.stop()); return; }
      const n = new AudioWorkletNode(c, 'hindsight-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { chunkFrames: Math.round(c.sampleRate / 10) },
      });
      const mute = c.createGain();
      mute.gain.value = 0;
      c.createMediaStreamSource(s).connect(n);
      n.connect(mute);
      mute.connect(c.destination);
      n.port.onmessage = (e) => onWorklet(e.data);
      node = n;
    } catch (e) {
      if (current()) setState(`Could not start the microphone: ${e.message || e}`);
    }
    render();
  }

  async function listInputs(s) {
    const cur = s.getAudioTracks()[0]?.getSettings?.().deviceId || '';
    let devices = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* none */ }
    ui.input.replaceChildren(...devices.map((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Input ${i + 1}`;
      o.selected = d.deviceId === cur;
      return o;
    }));
    ui.input.disabled = devices.length < 2;
  }

  function onWorklet(d) {
    if (d.peak) {
      ui.meter.style.width = `${(meterWidth(Math.max(d.peak[0], d.peak[1])) * 100).toFixed(1)}%`;
    } else if (d.started !== undefined) {
      startedFrame = d.started;
    } else if (d.pcm) {
      if (calib) {
        calib.chunks.push(d.pcm);
      } else if (uploader) {
        recFrames += d.pcm.length / 2;
        uploader.push(d.pcm);
      }
    } else if (d.done) {
      flushed?.();
    }
  }

  // rt is the round trip in use: as calibrated or set, or the browser's
  // guess.
  function rt() {
    const saved = readRT();
    if (saved) return saved;
    const settings = stream?.getAudioTracks()[0]?.getSettings?.() || {};
    return { seconds: ctx ? guessRoundTrip(ctx, settings) : 0.05, how: 'guessed' };
  }

  function nudge(d) {
    const cur = rt();
    writeRT({ seconds: Math.max(0, Math.min(0.9, Math.round((cur.seconds + d) * 1000) / 1000)), how: 'set' });
    render();
  }

  function play() {
    if (!buffer || src) return;
    const c = ensureCtx();
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.loop = listen.loop;
    s.connect(c.destination);
    t0 = c.currentTime + 0.1;
    s.start(t0);
    s.onended = () => {
      if (src !== s) return;
      src = null;
      // The whole tape played out: a recording over it ends with it.
      if (mode === 'recording') stopRec();
      render();
    };
    src = s;
    render();
  }

  function stopPlay() {
    const s = src;
    src = null;
    if (s) { try { s.stop(); } catch { /* not started */ } }
    render();
  }

  function record() {
    if (mode !== 'ready' || !node || !buffer) return;
    if (!src) play();
    const c = ctx;
    mode = 'recording';
    recFrames = 0;
    startedFrame = null;
    const u = new Uploader({
      url: wsURL(),
      rate: c.sampleRate,
      onState: (s, info) => {
        if (u !== uploader) return;
        if (info?.warning) toast(info.warning, 'warn', 6000);
        if (s === 'recording') setState('Recording · streaming to the Pi');
        else if (s === 'connecting') setState('Connecting to the Pi…');
        else if (s === 'reconnecting') setState(`Reconnecting… ${Math.round(u.pendingSeconds)} s waiting to send`);
      },
      onEnd: (result) => {
        if (u === uploader && mode === 'recording') {
          mode = 'saving';
          stopCapture().then(() => finish(result));
        }
      },
    });
    uploader = u;
    u.start();
    node.port.postMessage({ cmd: 'record' });
    lock = holdScreen({ onChange: () => {} });
    timer = setInterval(() => { ui.time.textContent = fmtClock(recFrames / c.sampleRate); }, 250);
    render();
  }

  function stopCapture() {
    clearInterval(timer);
    return new Promise((resolve) => {
      flushed = resolve;
      node?.port.postMessage({ cmd: 'stop' });
      setTimeout(resolve, 1000);
    });
  }

  async function stopRec() {
    if (mode !== 'recording') return;
    mode = 'saving';
    setState('Saving…');
    render();
    await stopCapture();
    stopPlay();
    finish(await uploader.stop());
  }

  async function finish(result) {
    const c = ctx;
    const recStart = startedFrame === null ? null : startedFrame / c.sampleRate;
    const heard = recFrames / c.sampleRate;
    uploader = null;
    lock?.release();
    lock = null;
    mode = 'ready';
    render();
    if (result.error || !result.name) {
      toast(result.error ? `The recording failed: ${result.error}` : 'Nothing was recorded', result.error ? 'bad' : 'warn');
      setState('');
      return;
    }
    // A stretch lost on the way -- the page hidden, the Pi gone a while --
    // and the take no longer lines up with the tape.
    if (recStart === null || result.partial || Math.abs(result.seconds - heard) > 0.25) {
      toast('Some of the recording went missing, so it can’t be lined up with the tape. It’s saved as a take.', 'warn', 9000);
      setState('');
      return;
    }
    const t = getTape();
    const k = keptSpan({ t0, rt: rt().seconds, recStart, seconds: result.seconds, listen, grid: t.tape.grid, sr: 48000 });
    if (!k) {
      toast('Not a whole bar was played over the tape. The recording is saved as a take.', 'warn', 8000);
      setState('');
      return;
    }
    try {
      const d = await api(`/api/tapes/drop?id=${encodeURIComponent(t.id)}`, {
        method: 'POST',
        body: { take: result.name, from: k.from, to: k.to, track: t.track, at: k.at, wrap: k.wrap, replace: t.replace, source: 'phone' },
      });
      setState('');
      onPlaced(d, { ...k, track: t.track });
    } catch (e) {
      toast(`Couldn’t put it on the tape: ${e.message}. It’s saved as a take.`, 'bad', 9000);
      setState('');
    }
  }

  // calibrate plays six clicks through the speaker and listens for them.
  // They're unevenly spaced, so a noise that repeats on its own -- a beep
  // every half second -- can't line up with all of them.
  async function calibrate() {
    if (mode !== 'ready' || !node) return;
    stopPlay();
    const c = ctx;
    mode = 'calibrating';
    calib = { chunks: [] };
    startedFrame = null;
    setState('Listening for six clicks — take headphones off and keep quiet…');
    render();
    node.port.postMessage({ cmd: 'record' });
    const first = c.currentTime + 0.4;
    const times = [];
    for (const off of CLICKS) {
      const at = first + off;
      times.push(at);
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = 2000;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.8, at + 0.001);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      o.connect(g);
      g.connect(c.destination);
      o.start(at);
      o.stop(at + 0.04);
    }
    await new Promise((r) => setTimeout(r, (first - c.currentTime + CLICKS[CLICKS.length - 1] + 0.6) * 1000));
    await stopCapture();
    const chunks = calib.chunks;
    calib = null;
    mode = 'ready';
    if (startedFrame === null) {
      setState('');
      toast('The microphone didn’t start; try again', 'warn');
      render();
      return;
    }
    const n = chunks.reduce((a, b) => a + b.length / 2, 0);
    const mono = new Float32Array(n);
    let k = 0;
    for (const ch of chunks) for (let i = 0; i < ch.length; i += 2) mono[k++] = (ch[i] + ch[i + 1]) / 2;
    const start = startedFrame / c.sampleRate;
    const r = roundTrip(times.map((t) => t - start), onsets(mono, c.sampleRate));
    if (r === null) {
      setState('');
      toast('Couldn’t hear the clicks clearly. Take headphones off, turn the volume up, and try again somewhere quiet.', 'warn', 9000);
    } else {
      writeRT({ seconds: Math.round(r * 1000) / 1000, how: 'calibrated' });
      setState('');
      toast(`Calibrated: a round trip of ${Math.round(r * 1000)} ms`, 'ok');
    }
    render();
  }

  function render() {
    const t = getTape();
    const tape = t && t.tape;
    const bars = tape && tape.grid && listen ? listen.frames / (tape.grid.frames / tape.grid.bars) : 0;
    const what = !buffer ? '' : listen.loop
      ? `the loop${bars ? ` (${Math.round(bars * 10) / 10} bar${Math.round(bars * 10) === 10 ? '' : 's'})` : ''}, round and round`
      : 'the whole tape, once';
    ui.what.textContent = t ? `Plays ${what || 'the tape'} here — the jam room stays quiet — and records you over it onto track ${t.track}${t.replace ? ', replacing what’s there' : ''}.` : '';
    for (const b of ui.span.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String((b.dataset.span === 'all') === all));
      b.disabled = busy();
    }
    ui.click.setAttribute('aria-pressed', String(click));
    ui.click.disabled = busy() || !(tape && tape.grid);
    const r = rt();
    ui.rt.textContent = `${Math.round(r.seconds * 1000)} ms (${r.how})`;
    ui.cal.disabled = mode !== 'ready' || !node;
    ui.less.disabled = ui.more.disabled = busy();
    ui.play.textContent = src ? '■ Stop' : '▶ Listen';
    ui.play.disabled = !buffer || busy();
    ui.rec.textContent = mode === 'recording' ? '■ Stop and keep' : '● Record';
    ui.rec.classList.toggle('recording', mode === 'recording');
    ui.rec.disabled = !(mode === 'recording' || (mode === 'ready' && node && buffer));
    ui.close.disabled = busy();
    ui.input.disabled = busy() || ui.input.options.length < 2;
    if (mode !== 'recording') ui.time.textContent = '';
  }

  function stopMic() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (node) { node.port.onmessage = null; try { node.disconnect(); } catch { /* gone */ } }
    node = null;
  }

  function teardown() {
    if (mode === 'closed') return;
    loadToken++;
    micToken++;
    clearInterval(timer);
    if (uploader) uploader.abandon();
    uploader = null;
    lock?.release();
    lock = null;
    stopPlay();
    stopMic();
    ctx?.close().catch(() => {});
    ctx = null;
    buffer = null;
    mode = 'closed';
  }
}
