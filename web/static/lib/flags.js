// Per-flag requests: one flag per request, addressed by id, so two devices
// editing a take's flags can no longer undo each other. The old way -- PATCH
// the take with its whole flag list -- let a page that had been open a while
// overwrite a flag added since from somewhere else.
//
// Every call resolves to the server's answer, {flag, flags, cue_error?}:
// `flags` is the take's whole list as it now stands, which is what the
// caller should redraw from.
//
// A new flag's id is made here, not by the server, so the page can label,
// move or delete a flag the moment it appears rather than waiting for the
// POST to answer. And the requests for one take go out one after another:
// a label sent straight after an add must not reach the server first, and
// each answer must be newer than the last one the page redrew from.

/** A fresh flag id, the same shape the server makes: "r" and eight hex. */
export function newFlagId() {
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return 'r' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

import { withClient } from './client.js';

const queues = new Map(); // file -> the promise the next request waits for

export function flagRequest(file, op, args = {}, fetchImpl = globalThis.fetch) {
  const prev = queues.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => send(file, op, args, fetchImpl));
  const tail = run.catch(() => {});
  queues.set(file, tail);
  tail.then(() => { if (queues.get(file) === tail) queues.delete(file); });
  return run;
}

async function send(file, op, { id, frame, label } = {}, fetchImpl) {
  let url = `/api/take/flags?file=${encodeURIComponent(file)}`;
  let method;
  let body = null;
  switch (op) {
    case 'add':
      method = 'POST';
      body = { id: id || newFlagId(), frame };
      if (label != null) body.label = label;
      break;
    case 'edit':
      method = 'PATCH';
      url += `&id=${encodeURIComponent(id)}`;
      body = {};
      if (frame != null) body.frame = frame;
      if (label != null) body.label = label;
      break;
    case 'remove':
      method = 'DELETE';
      url += `&id=${encodeURIComponent(id)}`;
      break;
    default:
      throw new Error(`unknown flag op: ${op}`);
  }
  // The device header is what lets this device's Undo find its own changes.
  const init = { method, headers: withClient() };
  if (body) {
    init.headers = withClient({ 'Content-Type': 'application/json' });
    init.body = JSON.stringify(body);
  }
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `status ${res.status}`);
  }
  return res.json();
}

// asFlags turns a server list into the shape the pages keep: every flag with
// an id, a frame and a string label.
export function asFlags(list) {
  return (list || []).map((f) => ({ id: f.id, frame: f.frame, label: f.label || '' }));
}
