// Per-flag requests: one flag per request, addressed by id, so two devices
// editing a take's flags can no longer undo each other. The old way -- PATCH
// the take with its whole flag list -- let a page that had been open a while
// overwrite a flag added since from somewhere else.
//
// Every call resolves to the server's answer, {flag, flags, cue_error?}:
// `flags` is the take's whole list as it now stands, which is what the
// caller should redraw from.

export async function flagRequest(file, op, { id, frame, label } = {}, fetchImpl = globalThis.fetch) {
  let url = `/api/take/flags?file=${encodeURIComponent(file)}`;
  let method;
  let body = null;
  switch (op) {
    case 'add':
      method = 'POST';
      body = { frame };
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
  const init = { method };
  if (body) {
    init.headers = { 'Content-Type': 'application/json' };
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
