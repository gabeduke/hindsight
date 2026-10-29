// The phone recorder: records the phone's mic, or an input plugged into the
// phone, straight into Hindsight. One per page (phoneRecorder), on the
// page's #phone-sheet: Capture's ● Phone, the Studio's, the tape's menu
// (Record from this phone…) and the mini player's ● (lib/bar/phone-key.js)
// all drive the same one, so they all show the one recording.
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
export const VOICE_PROCESSING_OFF = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

export const INPUT_KEY = 'phone.input';

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

/**
 * canRecordHere says whether this page can open the mic, and if not, why.
 * secure is the hub's HTTPS address for this Hindsight (status.hub.url), if
 * it has one; the sheet links it under the message.
 */
export function canRecordHere(win = globalThis, secure = '') {
  if (!win.isSecureContext) {
    if (secure) return 'The microphone only works on a secure page. Open Hindsight at its secure address to record from this phone:';
    return 'The microphone only works on a secure page. Open Hindsight at its HTTPS address — the tailscale one from the install guide — to record from this phone.';
  }
  if (!win.navigator?.mediaDevices?.getUserMedia || typeof win.AudioWorkletNode === 'undefined') {
    return 'This browser can’t record here. Try Safari on an iPhone or Chrome on Android.';
  }
  return '';
}

const recorders = new WeakMap();
const waiting = new WeakMap(); // doc → what onPhoneRecorder is waiting to hand it to

/**
 * phoneRecorder is the page's one recorder, on `sheet` (the page's
 * #phone-sheet), made on the first call. Answers null on a page without the
 * sheet. Its `toast` is the first caller's; a later `secureURL` is added to
 * the ones it asks (status.hub.url: each room has the Pi's status).
 */
export function phoneRecorder(doc = globalThis.document, { sheet = doc?.getElementById?.('phone-sheet'), toast = () => {}, secureURL = null } = {}) {
  if (!sheet) return null;
  let r = recorders.get(sheet);
  if (!r) {
    r = makeRecorder(doc, sheet, toast);
    recorders.set(sheet, r);
    const fns = waiting.get(doc) || [];
    waiting.delete(doc);
    for (const fn of fns) fn(r);
  }
  if (secureURL) r.secureFrom(secureURL);
  return r;
}

/**
 * onPhoneRecorder hands `fn` the page's recorder: now, if a room has made
 * it, or as soon as one does. For the keys that show a recording started
 * from anywhere (the mini player's ●, the Studio's), without making it.
 */
export function onPhoneRecorder(doc, fn) {
  const sheet = doc?.getElementById?.('phone-sheet');
  const r = sheet && recorders.get(sheet);
  if (r) { fn(r); return; }
  if (!waiting.has(doc)) waiting.set(doc, []);
  waiting.get(doc).push(fn);
}

/**
 * initPhone wires a room's ● Phone `button` to the page's recorder: a tap
 * opens the sheet, and the key shows the recording (● REC 0:12) wherever it
 * was started. `onSaved(name)` hears each take it saves.
 */
export function initPhone({ button, sheet, toast, onSaved, secureURL }) {
  const r = phoneRecorder(button?.ownerDocument || globalThis.document, { sheet, toast, secureURL });
  if (!r) return null;
  if (button) r.addButton(button);
  if (onSaved) r.onSaved(onSaved);
  return r;
}

function makeRecorder(document, sheet, toast) {
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
  // The rooms' ● Phone keys, each with its own label to go back to.
  const buttons = new Map();
  const savedFns = new Set();
  const changeFns = new Set();
  const secures = [];
  const secureURL = () => secures.map((f) => f()).find(Boolean) || '';

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

  ui.close.addEventListener('click', () => hide());
  ui.rec.addEventListener('click', () => (mode === 'recording' ? stop() : record()));
  ui.input.addEventListener('change', () => setInput(ui.input.value));
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

  const seconds = () => recordedFrames / (ctx?.sampleRate || 48000);

  function updateButton() {
    // lib/settings.js reads this before a reload: a reload would end the recording.
    document.documentElement.dataset.phoneBusy = mode === 'recording' || mode === 'saving' ? '1' : '0';
    const busy = mode === 'recording' || mode === 'saving';
    for (const [button, label] of buttons) {
      button.classList.toggle('recording', busy);
      if (mode === 'recording') button.textContent = `● REC ${fmtClock(seconds())}`;
      else if (mode === 'saving') button.textContent = 'Saving…';
      else button.innerHTML = label;
    }
    const now = { mode, seconds: mode === 'recording' || mode === 'saving' ? seconds() : 0 };
    for (const fn of changeFns) fn(now);
  }

  async function open() {
    if (mode === 'recording' || mode === 'saving') { showSheet(); return; }
    showSheet();
    if (!explain()) return;
    await monitor();
  }

  // explain says, on the sheet, why this page can't record, if it can't.
  // Answers whether it can.
  function explain() {
    const secure = window.isSecureContext ? '' : secureURL();
    const why = canRecordHere(window, secure);
    ui.insecure.hidden = !why;
    ui.insecure.textContent = why;
    if (why && secure) {
      const a = document.createElement('a');
      a.href = secure;
      a.textContent = secure;
      ui.insecure.append(' ', a);
    }
    ui.controls.hidden = !!why;
    ui.rec.hidden = !!why;
    return !why;
  }

  // monitor opens the input and its meter: ready to record.
  async function monitor() {
    mode = 'monitor';
    ui.time.textContent = '0:00';
    ui.rec.textContent = 'Record';
    ui.close.textContent = 'Close';
    ui.rec.disabled = true;
    ui.note.textContent = 'Keep this page open while recording: locking the phone or switching apps pauses it.';
    await startMonitor(savedInput());
  }

  function savedInput() {
    try { return localStorage.getItem(INPUT_KEY) || ''; } catch { return ''; }
  }

  // setInput is the input to record from, kept for the next time on this
  // phone; while metering, the meter moves to it.
  function setInput(id) {
    try { localStorage.setItem(INPUT_KEY, id); } catch { /* private mode */ }
    if (ui.input.value !== id) ui.input.value = id;
    if (mode === 'monitor') startMonitor(id);
  }

  // quick is the mini player's ●: record now from the input kept, with the
  // sheet down (its meter is a tap away), or stop. What can't start -- a
  // page that isn't secure, a refused or missing input -- opens the sheet,
  // which says why.
  async function quick() {
    if (mode === 'recording') { stop(); return; }
    if (mode === 'saving') { showSheet(); return; }
    if (!explain()) { showSheet(); return; }
    if (mode === 'closed') await monitor();
    if (mode === 'monitor' && ctx) record();
    else showSheet();
  }

  // inputs lists the phone's inputs, by name once the page may use the mic.
  async function inputs() {
    let devices = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* none */ }
    return devices.map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
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
      for (const fn of savedFns) fn(result.name);
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

  return {
    /** open shows the sheet: the input, its meter and Record. */
    open,
    /** quick records now, or stops (the mini player's ●). */
    quick,
    stop,
    inputs,
    /** input is the input kept for this phone ('' for the default). */
    input: savedInput,
    setInput,
    /** state is { mode: 'closed' | 'monitor' | 'recording' | 'saving', seconds }. */
    state: () => ({ mode, seconds: mode === 'recording' || mode === 'saving' ? seconds() : 0 }),
    /** onChange(fn) hears each change of state, and the time while it records; answers its off. */
    onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
    onSaved(fn) { savedFns.add(fn); },
    secureFrom(fn) { secures.push(fn); },
    addButton(button) {
      if (buttons.has(button)) return;
      buttons.set(button, button.innerHTML);
      button.addEventListener('click', open);
      updateButton();
    },
  };
}
