// One poll of the Pi at a time -- unless the page has just woken.
//
// A tablet that slept leaves a poll that is never answered. A page that only
// polls when none is in flight then never polls again. The gate lets a poll
// that is forced (back in view, back online) go ahead of one that may be lost,
// and drops the old poll's answer, should it ever come, as older than the
// state on screen.

export function pollGate() {
  let seq = 0;
  let busy = false;
  return {
    /** begin returns this poll's ticket, or null: one is in flight and this isn't forced. */
    begin(force = false) {
      if (busy && !force) return null;
      busy = true;
      return ++seq;
    },
    /** current: is this still the latest poll, whose answer may be shown? */
    current(ticket) { return ticket === seq; },
    /** end releases the gate, unless a newer poll has taken it over. */
    end(ticket) { if (ticket === seq) busy = false; },
  };
}
