// The phone recorder: a sheet on the main page that records the phone's mic,
// or an input plugged into the phone, straight into Hindsight.
//
// Opening the sheet asks for the input and starts a meter, so the level can
// be checked before anything is recorded. Record streams the audio to the Pi
// as it's played (see uploader.js); Stop waits for the Pi to finish the take
// and puts it in the list. While recording, the screen is held awake even on
// battery, because a locked phone stops the recording.

import { Uploader } from './uploader.js';
import { holdScreen } from '../wakelock.js';

// Phone browsers clean up the mic for calls by default -- echo cancellation,
// noise suppression, automatic gain -- which pumps and gates music. Ask for
// all three off; a plugged-in input mostly sidesteps them either way.
const VOICE_PROCESSING_OFF = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

const INPUT_KEY = 'phone.input';

/** wsURL is the /api/phone address on this page's host. */
export function wsURL(loc = location) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/api/phone`;
}

/** meterWidth maps a peak (0..1) onto a 60 dB meter, 0..1. */
export function meterWidth(peak) {
  if (!(peak > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 60) / 60));
}

/** fmtClock is m:ss for the elapsed time. */
export function fmtClock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** canRecordHere says whether this page can open the mic, and if not, why. */
export function canRecordHere(win = globalThis) {
  if (!win.isSecureContext) {
    return 'The microphone only works on a secure page. Open Hindsight at its HTTPS address — the tailscale one from the install guide — to record from this phone.';
  }
  if (!win.navigator?.mediaDevices?.getUserMedia || typeof win.AudioWorkletNode === 'undefined') {
    return 'This browser can’t record here. Try Safari on an iPhone or Chrome on Android.';
  }
  return '';
}

export function initPhone({ button, sheet, toast, onSaved }) {
  const q = (id) => document.getElementById(id);
  const ui = {
    insecure: q('phone-insecure'),
    controls: q('phone-controls'),
    input: q('phone-input'),
    barL: q('phone-bar-l'),
    barR: q('phone-bar-r'),
    time: q('phone-time'),
    state: q('phone-state'),
    note: q('phone-note'),
    close: q('phone-close'),
    rec: q('phone-rec'),
  };
  const buttonLabel = button.innerHTML;

  // closed: no mic. monitor: the sheet is open, metering. recording. saving:
  // Stop was pressed (or the Pi ended it) and the take is being finished.
  // A recording carries on with the sheet closed; the Phone button then
  // shows it and reopens the sheet.
  let mode = 'closed';
  let stream = null;
  let ctx = null;
  let node = null;
  let uploader = null;   // the current recording's; an older one finishing is not "ours"
  let lock = null;
  let timer = 0;
  let recordedFrames = 0;
  let recordStart = 0;   // performance.now() at Record
  let reportedGap = 0;   // seconds of missing audio already reported
  let flushed = null;    // resolves when the worklet has sent its last chunk
  let monitorToken = 0;  // so an older startMonitor can't install its audio over a newer one

  button.addEventListener('click', open);
  ui.close.addEventListener('click', () => hide());
  ui.rec.addEventListener('click', () => (mode === 'recording' ? stop() : record()));
  ui.input.addEventListener('change', () => {
    try { localStorage.setItem(INPUT_KEY, ui.input.value); } catch { /* private mode */ }
    if (mode === 'monitor') startMonitor(ui.input.value);
  });
  // Escape or the back gesture just hides the sheet. While recording that's
  // harmless -- the recording carries on -- and otherwise the mic is let go.
  sheet.addEventListener('close', () => {
    if (mode === 'monitor') teardown();
  });
  window.addEventListener('beforeunload', (e) => {
    if (mode === 'recording' || mode === 'saving') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    // iOS can leave the context "interrupted" or suspended after a call or
    // an app switch.
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (mode === 'recording') reportGap();
  });

  function setState(text) { ui.state.textContent = text; }

  function showSheet() {
    if (sheet.open) return;
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }

  function hide() {
    if (mode === 'monitor' || mode === 'closed') teardown();
    if (sheet.open) sheet.close();
  }

  function updateButton() {
    button.classList.toggle('recording', mode === 'recording' || mode === 'saving');
    if (mode === 'recording') button.textContent = `● REC ${fmtClock(recordedFrames / (ctx?.sampleRate || 48000))}`;
    else if (mode === 'saving') button.textContent = 'Saving…';
    else button.innerHTML = buttonLabel;
  }

  async function open() {
    if (mode === 'recording' || mode === 'saving') { showSheet(); return; }
    showSheet();
    const why = canRecordHere(window);
    ui.insecure.hidden = !why;
    ui.insecure.textContent = why;
    ui.controls.hidden = !!why;
    ui.rec.hidden = !!why;
    if (why) return;
    mode = 'monitor';
    ui.time.textContent = '0:00';
    ui.rec.textContent = 'Record';
    ui.close.textContent = 'Close';
    ui.rec.disabled = true;
    ui.note.textContent = 'Keep this page open while recording: locking the phone or switching apps pauses it.';
    let saved = '';
    try { saved = localStorage.getItem(INPUT_KEY) || ''; } catch { /* fine */ }
    await startMonitor(saved);
  }

  async function startMonitor(deviceId) {
    const token = ++monitorToken;
    const current = () => token === monitorToken && mode === 'monitor';
    stopAudio();
    ui.rec.disabled = true;
    setState('Opening the input…');
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...VOICE_PROCESSING_OFF, deviceId: { exact: deviceId } } : VOICE_PROCESSING_OFF,
      });
    } catch (e) {
      if (!current()) return;
      if (deviceId) return startMonitor(''); // the saved input is gone: use the default
      setState(e && e.name === 'NotAllowedError'
        ? 'Microphone access was refused. Allow it in the browser’s settings for this site.'
        : 'No input to record from.');
      return;
    }
    if (!current()) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    await listInputs(s);
    let graph;
    try {
      graph = await buildGraph(s);
    } catch (e) {
      if (current()) setState(`Could not start audio: ${e.message || e}`);
      return;
    }
    if (!current()) { graph.ctx.close().catch(() => {}); return; }
    ctx = graph.ctx;
    node = graph.node;
    node.port.onmessage = (e) => onWorklet(e.data);
    ui.rec.disabled = false;
    const rate = ctx.sampleRate;
    setState(`Ready · ${rate / 1000} kHz${rate === 48000 ? '' : ', converted to 48 on the Pi'}`);
  }

  // The device list only has labels once the page may use the mic.
  async function listInputs(s) {
    const current = s.getAudioTracks()[0]?.getSettings?.().deviceId || '';
    let devices = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* keep empty */ }
    ui.input.replaceChildren();
    devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Input ${i + 1}`;
      if (d.deviceId === current) o.selected = true;
      ui.input.appendChild(o);
    });
    ui.input.disabled = devices.length < 2;
  }

  async function buildGraph(s) {
    // 48 kHz if the browser will convert to it; some won't with a mic at
    // another rate, and then the Pi converts instead.
    let c;
    let src;
    try {
      c = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      src = c.createMediaStreamSource(s);
    } catch {
      try { await c?.close(); } catch { /* fine */ }
      c = new AudioContext({ latencyHint: 'playback' });
      src = c.createMediaStreamSource(s);
    }
    try {
      await c.audioWorklet.addModule('/lib/phone/worklet.js');
      const n = new AudioWorkletNode(c, 'hindsight-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit', // a mono mic arrives as dual mono
        channelInterpretation: 'speakers',
        processorOptions: { chunkFrames: Math.round(c.sampleRate / 10) },
      });
      // Connected through a muted gain so the browser keeps pulling audio
      // through the worklet; nothing is heard.
      const sink = c.createGain();
      sink.gain.value = 0;
      src.connect(n);
      n.connect(sink);
      sink.connect(c.destination);
      await c.resume();
      return { ctx: c, node: n };
    } catch (e) {
      c.close().catch(() => {});
      throw e;
    }
  }

  function onWorklet(d) {
    if (d.peak) {
      ui.barL.style.width = `${(meterWidth(d.peak[0]) * 100).toFixed(1)}%`;
      ui.barR.style.width = `${(meterWidth(d.peak[1]) * 100).toFixed(1)}%`;
      ui.barL.classList.toggle('clip', d.peak[0] >= 0.99);
      ui.barR.classList.toggle('clip', d.peak[1] >= 0.99);
    } else if (d.pcm) {
      recordedFrames += d.pcm.length / 2;
      uploader?.push(d.pcm);
    } else if (d.done) {
      flushed?.();
    }
  }

  // A phone that locked, or a switch to another app, pauses the audio; the
  // take skips that stretch. Say so when the page comes back.
  function reportGap() {
    const wall = (performance.now() - recordStart) / 1000;
    const missing = wall - recordedFrames / ctx.sampleRate - reportedGap;
    if (missing > 1.5) {
      reportedGap += missing;
      toast(`The recording paused while the page was hidden — about ${Math.round(missing)} s are missing`, 'warn', 8000);
    }
  }

  function record() {
    if (mode !== 'monitor' || !ctx) return;
    mode = 'recording';
    recordedFrames = 0;
    reportedGap = 0;
    recordStart = performance.now();
    ui.input.disabled = true;
    ui.close.textContent = 'Hide';
    ui.rec.textContent = 'Stop';
    ui.rec.classList.add('recording');
    const u = new Uploader({
      url: wsURL(),
      rate: ctx.sampleRate,
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
          stopCapture().then(() => done(result, u));
        }
      },
    });
    uploader = u;
    u.start();
    node.port.postMessage({ cmd: 'record' });
    lock = holdScreen({
      onChange: (held) => {
        if (u !== uploader) return;
        ui.note.textContent = held
          ? 'Screen kept awake while recording. Keep this page open: switching apps pauses the recording.'
          : 'Couldn’t keep the screen awake — don’t let the phone lock, or the recording pauses.';
      },
    });
    timer = setInterval(() => {
      ui.time.textContent = fmtClock(recordedFrames / ctx.sampleRate);
      updateButton();
      if (u.state === 'reconnecting') setState(`Reconnecting… ${Math.round(u.pendingSeconds)} s waiting to send`);
    }, 250);
    updateButton();
  }

  // stopCapture stops the worklet and waits for its last partial chunk.
  function stopCapture() {
    clearInterval(timer);
    return new Promise((resolve) => {
      flushed = resolve;
      node?.port.postMessage({ cmd: 'stop' });
      setTimeout(resolve, 1000); // a worklet that never answers can't hang Stop
    });
  }

  async function stop() {
    if (mode !== 'recording') return;
    const u = uploader;
    mode = 'saving';
    ui.rec.disabled = true;
    setState('Saving…');
    updateButton();
    await stopCapture();
    // A Pi that's unreachable keeps this on "Saving…" -- the uploader keeps
    // trying while the page is open -- but say what's happening.
    setTimeout(() => {
      if (u === uploader && mode === 'saving') setState('Still sending to the Pi. It keeps trying while this page is open.');
    }, 10000);
    done(await u.stop(), u);
  }

  function done(result, u) {
    if (result.error) {
      toast(`Recording failed: ${result.error}`, 'bad', 8000);
    } else if (result.name) {
      const why = { disk: ' — the Pi’s disk is nearly full', limit: ' — three hours is the limit' }[result.reason] || '';
      toast(`Saved the phone take · ${fmtClock(result.seconds)}${result.partial ? ' (partial)' : ''}${why}`,
        result.reason === 'stop' && !result.partial ? 'ok' : 'warn', 7000);
      onSaved?.(result.name);
    } else if (result.reason === 'error') {
      toast('The Pi couldn’t finish the take. What reached it is recovered when it next restarts.', 'bad', 9000);
    } else {
      toast('Nothing was recorded', 'warn');
    }
    if (u === uploader) {
      teardown();
      if (sheet.open) sheet.close();
    }
  }

  function stopAudio() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (node) node.port.onmessage = null;
    node = null;
    ctx?.close().catch(() => {});
    ctx = null;
  }

  function teardown() {
    clearInterval(timer);
    lock?.release();
    lock = null;
    uploader = null;
    monitorToken++;
    stopAudio();
    mode = 'closed';
    ui.input.disabled = false;
    ui.close.textContent = 'Close';
    ui.rec.disabled = false;
    ui.rec.textContent = 'Record';
    ui.rec.classList.remove('recording');
    ui.barL.style.width = '0%';
    ui.barR.style.width = '0%';
    updateButton();
  }
}
