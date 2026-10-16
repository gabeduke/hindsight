// web/static/lib/tape/refusal.js
// What a page says when the Pi refuses an edit to the tape.
//
// While ● Rec is armed or punching the Pi answers 409 to an EDIT of what is
// armed, of a track's input, or of the output mode (Recording.Allows in
// internal/tape): the refusal stays, since it fixes a real desync. That 409
// carries {"reason":"recording"}. Every other refusal -- a mixdown or a second
// record while one is running, a take saving, an update under way -- has no
// such reason and is shown in the Pi's own words, as it always was.
//
// The error a call throws keeps the Pi's text in e.message; only an edit path
// (failToast) puts the waiting words in front of a person.

/** WAITING is what a person is told, in Gabe's words; WAITING_DETAIL is the line under it. */
export const WAITING = 'Waiting for rec to finish';
export const WAITING_DETAIL = 'Edits work again once recording stops.';

/**
 * refusal reads a failed response (its status and parsed body) as
 * {recording, reason, message, detail}: message is always the Pi's own text
 * (or "HTTP 409"); recording says it was an edit waiting for Rec, and then
 * detail is the line to show under WAITING.
 */
export function refusal(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const recording = status === 409 && b.reason === 'recording';
  return {
    recording,
    reason: typeof b.reason === 'string' ? b.reason : '',
    message: b.error || `HTTP ${status}`,
    detail: recording ? WAITING_DETAIL : '',
  };
}

/** readResponse is a fetch response's parsed body, or the Error it threw: e.message the Pi's text, e.status, e.reason, e.recording. */
export async function readResponse(res) {
  const b = await res.json().catch(() => ({}));
  if (res.ok) return b;
  const why = refusal(res.status, b);
  const e = new Error(why.message);
  e.status = res.status;
  e.reason = why.reason;
  e.recording = why.recording;
  throw e;
}

/**
 * failToast says why an edit did not happen: the waiting words for the
 * recording refusal, otherwise "<what>: <the Pi's words>". toast is
 * lib/toast.js's.
 */
export function failToast(toast, what, e) {
  if (e && e.recording) toast(WAITING, 'warn', { detail: WAITING_DETAIL });
  else toast(`${what}: ${e && e.message}`, 'bad');
}

/**
 * editTape runs an edit of the tape (run() sends it) and says whether it
 * happened. When the Pi refuses, the person is told why and resync() brings
 * the page back to the Pi's state, so a control moved ahead of the answer
 * does not stay where the Pi refused it.
 */
export async function editTape(run, { toast, resync }) {
  try {
    await run();
    return true;
  } catch (e) {
    failToast(toast, 'Could not change the tape', e);
    resync();
    return false;
  }
}
