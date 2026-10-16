// web/static/lib/tape/refusal.js
// What a page says when the Pi refuses an edit to the tape.
//
// While ● Rec is armed or punching the Pi answers 409 to a change of what is
// armed or of a track's input (Recording.Allows, internal/api/tape.go): the
// refusal stays, since it fixes a real desync. The 409 carries
// {"reason":"recording"}; every other refusal (a take is saving, an update is
// under way, ...) has none and is shown in the Pi's own words.

/** WAITING is what a person is told, in Gabe's words; WAITING_DETAIL is the line under it. */
export const WAITING = 'Waiting for rec to finish';
export const WAITING_DETAIL = 'Edits work again once recording stops.';

/**
 * refusal reads a failed response (its status and parsed body) as
 * {recording, message, detail}: for the recording refusal the words above,
 * otherwise the Pi's own text, or "HTTP 409" when it sent none.
 */
export function refusal(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (status === 409 && b.reason === 'recording') {
    return { recording: true, message: WAITING, detail: WAITING_DETAIL };
  }
  return { recording: false, message: b.error || `HTTP ${status}`, detail: '' };
}

/**
 * failToast says why an edit did not happen: the waiting message for the
 * recording refusal, otherwise "<what>: <the Pi's words>". toast is
 * lib/toast.js's.
 */
export function failToast(toast, what, e) {
  if (e && e.recording) toast(WAITING, 'warn', { detail: WAITING_DETAIL });
  else toast(`${what}: ${e && e.message}`, 'bad');
}
