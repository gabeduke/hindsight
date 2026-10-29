// One poll of the Pi at a time -- unless the page has just woken.
//
// A tablet that slept leaves a poll that is never answered. A page that only
// polls when none is in flight then never polls again. The gate lets a poll
// that is forced (back in view, back online) go ahead of one that may be lost,
// and drops the old poll's answer, should it ever come, as older than the
// state on screen.
//
// A nudge (lib/tape/changes.js: the Pi says the tape changed) wants a poll
// now. With none in flight it polls at once; with one in flight, that poll
// may have been answered before the change, so it polls once more when that
// one ends -- once, however many nudges came meanwhile, and never two at once.

export function pollGate() {
  let seq = 0;
  let busy = false;
  let again = false;
  return {
    /** begin returns this poll's ticket, or null: one is in flight and this isn't forced. */
    begin(force = false) {
      if (busy && !force) return null;
      busy = true;
      again = false;
      return ++seq;
    },
    /** current: is this still the latest poll, whose answer may be shown? */
    current(ticket) { return ticket === seq; },
    /**
     * nudge: the Pi says something changed. True means poll now; false, one
     * is in flight, and its end() will say to poll again.
     */
    nudge() {
      if (!busy) return true;
      again = true;
      return false;
    },
    /**
     * end releases the gate, unless a newer poll has taken it over. True
     * means a nudge came while this poll was out: poll once more now.
     */
    end(ticket) {
      if (ticket !== seq) return false;
      busy = false;
      const more = again;
      again = false;
      return more;
    },
  };
}
