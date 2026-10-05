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
//      punch keeps -- from where the tape was on the context's clock and the
//      round trip; POST /api/tapes/drop places it, naming the loop it was
//      played over, which must still be the tape's.
//
// The round trip -- a frame leaving the context, to the sound of playing
// along with it coming back in -- is the browser's guess until Calibrate
// measures it: clicks through the speaker, heard through the mic.

import { Uploader } from '../phone/uploader.js';
import { wsURL, canRecordHere, meterWidth, fmtClock, VOICE_PROCESSING_OFF, INPUT_KEY } from '../phone/recorder.js';
import { holdScreen } from '../wakelock.js';
import { keptSpan, onsets, roundTrip, guessRoundTrip } from './away.js';

const RT_KEY = 'tape.away.rt'; // {seconds, how}: this device's round trip, as last measured or set

// When the calibration's clicks play, in seconds from the first: unevenly
// spaced, so a noise that repeats on its own can't line up with all of
// them, and far enough apart that a round trip up to CAL_MAX can't be taken
// for the next click's.
const CLICKS = [0, 0.93, 1.97, 2.88, 3.95, 4.86];
const CAL_MAX = 0.85;

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
 * with the drop's answer and what was kept, and answers a line saying so;
 * onUndo undoes it. onPlay runs as this page starts playing the tape (to
 * listen or record), so a stream playing here can go quiet.
 */
export function initAway({ button, sheet, toast, getTape, onPlaced, onUndo, api, onPlay = () => {} }) {
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
    kept: q('away-kept'),
    keptText: q('away-kept-text'),
    undo: q('away-undo'),
    play: q('away-play'),
    rec: q('away-rec'),
    close: q('away-close'),
  };

  let ctx = null;
  let rate = 48000;          // the context's rate, kept past its closing
  let stream = null;
  let micSource = null;
  let node = null;           // the recorder worklet
  let micToken = 0;
  let buffer = null;         // the tape, decoded
  let listen = null;         // { from, frames, loop } as the Pi sent it
  let loadToken = 0;
  let loading = null;        // the load's AbortController
  let src = null;            // what's playing
  let t0 = 0;                // the context time the file's first frame played
  let mode = 'closed';       // closed | ready | recording | saving | calibrating
  let closing = false;       // the sheet closed while something finishes
  let uploader = null;
  let startedFrame = null;   // the context frame of the recording's first sample
  let recFrames = 0;
  let flushed = null;
  let calib = null;          // { chunks } while calibrating
  let lock = null;
  let timer = 0;
  let all = false;
  let click = false;
  let recTape = null;        // the tape, track and loop a recording was made over

  button.addEventListener('click', open);
  ui.close.addEventListener('click', () => sheet.close());
  // Esc doesn't close the sheet mid-recording; and if it closes anyway (a
  // browser may insist), the recording is kept, not dropped.
  sheet.addEventListener('cancel', (e) => { if (mode === 'recording' || mode === 'calibrating') e.preventDefault(); });
  sheet.addEventListener('close', onClose);
  ui.play.addEventListener('click', () => { wake(); if (src) stopPlay(); else play(); });
  ui.rec.addEventListener('click', () => { wake(); if (mode === 'recording') stopRec(); else record(); });
  ui.cal.addEventListener('click', () => { wake(); calibrate(); });
  ui.less.addEventListener('click', () => nudge(-0.005));
  ui.more.addEventListener('click', () => nudge(0.005));
  ui.click.addEventListener('click', () => { click = !click; reload(); });
  ui.undo.addEventListener('click', () => { ui.kept.hidden = true; onUndo(); });
  for (const b of ui.span.querySelectorAll('button')) {
    b.addEventListener('click', () => { all = b.dataset.span === 'all'; reload(); });
  }
  ui.input.addEventListener('change', () => {
    try { localStorage.setItem(INPUT_KEY, ui.input.value); } catch { /* private mode */ }
    openMic(ui.input.value);
  });
  // A phone call, a lock or an app switch suspends the context; carry on
  // when the page is back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running' && mode !== 'closed') ctx.resume().catch(() => {});
  });
  window.addEventListener('beforeunload', (e) => {
    if (mode === 'recording' || mode === 'saving') { e.preventDefault(); e.returnValue = ''; }
  });

  function busy() { return mode === 'recording' || mode === 'saving' || mode === 'calibrating'; }

  function setState(s) { ui.state.textContent = s; }

  // wake makes sure the context runs: a browser only lets audio start from
  // a tap, and a suspended one has to be resumed from one.
  function wake() {
    const c = ensureCtx();
    if (c.state !== 'running') c.resume().catch(() => {});
  }

  function open() {
    const t = getTape();
    if (!t || !t.tape || mode !== 'closed') return;
    mode = 'ready';
    closing = false;
    all = !t.tape.loop.on;
    ui.kept.hidden = true;
    sheet.showModal();
    wake();
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
    render();
  }

  // ensureCtx makes the context, at the device's own rate: forcing 48 kHz
  // can't take a mic at another rate in some browsers, and the Pi converts
  // the take to 48 kHz anyway.
  function ensureCtx() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      rate = ctx.sampleRate;
    }
    return ctx;
  }

  // reload fetches the tape as it is now: the loop or the whole tape, with
  // or without the click. A newer one stops an older one's download.
  async function reload() {
    if (busy() || mode === 'closed') return;
    stopPlay();
    loading?.abort();
    const ac = new AbortController();
    loading = ac;
    const token = ++loadToken;
    const current = () => token === loadToken && mode !== 'closed';
    buffer = null;
    render();
    const t = getTape();
    setState('Getting the tape from the Pi…');
    try {
      const res = await fetch(`/api/tapes/listen?id=${encodeURIComponent(t.id)}&all=${all ? 1 : 0}&click=${click ? 1 : 0}`, { cache: 'no-store', signal: ac.signal });
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
      if (!current()) return;
      const decoded = await ensureCtx().decodeAudioData(data);
      if (!current()) return;
      buffer = decoded;
      listen = meta;
      setState('');
    } catch (e) {
      if (!current() || e.name === 'AbortError') return;
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
    if (!current()) return;
    try {
      const c = ensureCtx();
      await c.audioWorklet.addModule('/lib/phone/worklet.js');
      if (!current()) return;
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
      micSource = c.createMediaStreamSource(s);
      micSource.connect(n);
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
    writeRT({ seconds: Math.max(0, Math.min(0.9, Math.round((cur.seconds + d) * 10000) / 10000)), how: 'set' });
    render();
  }

  function play() {
    if (!buffer || src || mode === 'closed') return;
    onPlay();
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
      // The whole tape played out. What was played over its last moments
      // reaches the recording a round trip later: stop after that.
      if (mode === 'recording') setTimeout(() => { if (mode === 'recording') stopRec(); }, (rt().seconds + 0.25) * 1000);
      else releaseLock();
      render();
    };
    src = s;
    if (!lock) lock = holdScreen({ onChange: () => {} });
    render();
  }

  function stopPlay() {
    const s = src;
    src = null;
    if (s) { try { s.stop(); } catch { /* not started */ } }
    if (mode !== 'recording' && mode !== 'saving') releaseLock();
    render();
  }

  function releaseLock() {
    lock?.release();
    lock = null;
  }

  function record() {
    if (mode !== 'ready' || !node || !buffer) return;
    if (!src) play();
    const t = getTape();
    recTape = { id: t.id, track: t.track, replace: t.replace, grid: t.tape.grid, sr: t.tape.sample_rate || 48000, listen: { ...listen }, t0 };
    mode = 'recording';
    recFrames = 0;
    startedFrame = null;
    ui.kept.hidden = true;
    const u = new Uploader({
      url: wsURL(),
      rate,
      onState: (s, info) => {
        if (u !== uploader) return;
        if (info?.warning) toast(info.warning, 'warn', 6000);
        if (s === 'recording') setState('Recording · streaming to the Pi');
        else if (s === 'connecting') setState('Connecting to the Pi…');
        else if (s === 'reconnecting') setState(`Reconnecting… ${Math.round(u.pendingSeconds)} s waiting to send`);
      },
      onEnd: (result) => {
        // The Pi can end a recording itself: disk nearly full, three hours.
        if (u === uploader && mode === 'recording') {
          mode = 'saving';
          stopCapture().then(() => { stopPlay(); finish(result); });
        }
      },
    });
    uploader = u;
    u.start();
    node.port.postMessage({ cmd: 'record' });
    if (!lock) lock = holdScreen({ onChange: () => {} });
    timer = setInterval(() => { ui.time.textContent = fmtClock(recFrames / rate); }, 250);
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
    const u = uploader;
    setTimeout(() => {
      if (u === uploader && mode === 'saving') setState('Still sending to the Pi. It keeps trying while this page is open.');
    }, 10000);
    finish(await u.stop());
  }

  async function finish(result) {
    const r = recTape;
    const recStart = startedFrame === null ? null : startedFrame / rate;
    const heard = recFrames / rate;
    uploader = null;
    releaseLock();
    if (!closing) mode = 'ready';
    render();
    const done = (msg, kind, ms) => {
      if (msg) toast(msg, kind, ms);
      setState('');
      if (closing) teardown();
    };
    if (result.error) return done(`The recording failed: ${result.error}`, 'bad');
    if (!result.name || recFrames === 0) return done('Nothing was recorded', 'warn');
    // A stretch lost on the way -- the Pi gone a while -- and the take no
    // longer lines up with the tape.
    if (recStart === null || result.partial || Math.abs(result.seconds - heard) > 0.25) {
      return done('Some of the recording went missing, so it can’t be lined up with the tape. It’s saved as a take.', 'warn', 9000);
    }
    const k = keptSpan({ t0: r.t0, rt: rt().seconds, recStart, seconds: result.seconds, listen: r.listen, grid: r.grid, sr: r.sr });
    if (!k) return done('Not a whole bar was played over the tape. The recording is saved as a take.', 'warn', 8000);
    try {
      const body = { take: result.name, from: k.from, to: k.to, track: r.track, at: k.at, replace: r.replace, source: 'phone' };
      if (k.wrap) body.loop = { in: r.listen.from, out: r.listen.from + r.listen.frames };
      const d = await api(`/api/tapes/drop?id=${encodeURIComponent(r.id)}`, { method: 'POST', body });
      const text = onPlaced(d, { ...k, track: r.track, sr: r.sr });
      if (!closing) {
        ui.keptText.textContent = text;
        ui.kept.hidden = false;
      }
      done('');
    } catch (e) {
      done(e.status === 409
        ? 'The loop changed while you were playing, so the part can’t go back where it was. It’s saved as a take.'
        : `Couldn’t put it on the tape: ${e.message}. It’s saved as a take.`, 'bad', 9000);
    }
  }

  // calibrate plays clicks through the speaker and listens for them.
  async function calibrate() {
    if (mode !== 'ready' || !node) return;
    stopPlay();
    const c = ctx;
    mode = 'calibrating';
    calib = { chunks: [] };
    startedFrame = null;
    setState('Listening for six clicks. Headphones off, and quiet please…');
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
      g.gain.linearRampToValueAtTime(0.7, at + 0.001);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      o.connect(g);
      g.connect(c.destination);
      o.start(at);
      o.stop(at + 0.04);
    }
    await new Promise((res) => setTimeout(res, (first - c.currentTime + CLICKS[CLICKS.length - 1] + CAL_MAX + 0.1) * 1000));
    if (mode !== 'calibrating') return; // closed meanwhile
    await stopCapture();
    if (mode !== 'calibrating') return;
    const chunks = calib.chunks;
    calib = null;
    mode = 'ready';
    setState('');
    if (startedFrame === null) {
      toast('The microphone didn’t start; try again', 'warn');
      render();
      return;
    }
    const n = chunks.reduce((a, b) => a + b.length / 2, 0);
    const mono = new Float32Array(n);
    let k = 0;
    for (const ch of chunks) for (let i = 0; i < ch.length; i += 2) mono[k++] = (ch[i] + ch[i + 1]) / 2;
    const start = startedFrame / rate;
    const r = roundTrip(times.map((t) => t - start), onsets(mono, rate), { maxSeconds: CAL_MAX });
    if (r === null) {
      toast('Couldn’t hear the clicks clearly. Take headphones off, turn the volume up, and try again somewhere quiet.', 'warn', 9000);
    } else {
      writeRT({ seconds: Math.round(r * 10000) / 10000, how: 'calibrated' });
      toast(`Calibrated: a round trip of ${Math.round(r * 1000)} ms`, 'ok');
    }
    render();
  }

  function render() {
    const t = getTape();
    const tape = t && t.tape;
    const bars = tape && tape.grid && listen && buffer ? listen.frames / (tape.grid.frames / tape.grid.bars) : 0;
    const b10 = Math.round(bars * 10);
    const what = !buffer ? '' : listen.loop
      ? `the loop${bars ? ` (${b10 / 10} bar${b10 === 10 ? '' : 's'})` : ''}, round and round,`
      : 'the whole tape, once,';
    ui.what.textContent = t ? `Plays ${what || 'the tape'} here — the jam room stays quiet — and records you over it onto track ${t.track}${t.replace ? ', replacing what’s there' : ''}.` : '';
    const loopOn = !!(tape && tape.loop.on);
    for (const b of ui.span.querySelectorAll('button')) {
      const isAll = b.dataset.span === 'all';
      b.setAttribute('aria-pressed', String(isAll === (all || !loopOn)));
      b.disabled = busy() || (!isAll && !loopOn);
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
    ui.close.disabled = mode === 'recording' || mode === 'calibrating';
    ui.input.disabled = busy() || ui.input.options.length < 2;
    if (mode !== 'recording') ui.time.textContent = '';
  }

  // onClose: a recording is kept, a save carries on, and everything stops
  // once it's done.
  function onClose() {
    if (mode === 'recording') {
      closing = true;
      stopRec();
    } else if (mode === 'saving') {
      closing = true;
    } else if (mode !== 'closed') {
      teardown();
    }
  }

  function stopMic() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    try { micSource?.disconnect(); } catch { /* gone */ }
    micSource = null;
    if (node) { node.port.onmessage = null; try { node.disconnect(); } catch { /* gone */ } }
    node = null;
  }

  function teardown() {
    mode = 'closed';
    loadToken++;
    micToken++;
    loading?.abort();
    loading = null;
    clearInterval(timer);
    calib = null;
    releaseLock();
    stopPlay();
    stopMic();
    ctx?.close().catch(() => {});
    ctx = null;
    buffer = null;
    listen = null;
    closing = false;
  }
}
