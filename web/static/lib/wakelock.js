// Keep the screen awake while the app is visible on a charging device.
//
// The target is a tablet docked on a charging base: leave the app up and it
// stays lit, so Capture is there when you sit down to play. A phone on battery
// is deliberately left alone -- holding someone's phone awake is antisocial,
// and "is it charging" is a good enough proxy for "it is parked somewhere".
//
// Two things about the platform shape this. The lock needs a secure context,
// so it works on the tailnet HTTPS name and not on the plain-HTTP LAN address
// -- the same gate sw.js already has. And the browser releases the lock
// whenever the document is hidden and never re-acquires it, while request()
// rejects outright if called while hidden, so re-acquiring on
// visibilitychange is the whole job.

// shouldHold is the entire policy, kept pure so it can be asserted directly.
export function shouldHold({ supported, secure, visible, charging }) {
  return Boolean(supported && secure && visible && charging);
}

// readBattery resolves to a BatteryManager, or null where the API is missing.
// navigator.getBattery is Chromium-only: Firefox removed it and Safari never
// shipped it. Charging is then unknowable, so the lock simply never engages
// and the app behaves as it did before this module existed.
async function readBattery() {
  if (typeof navigator.getBattery !== 'function') return null;
  try {
    return await navigator.getBattery();
  } catch {
    return null;
  }
}

export function initWakeLock({ onChange } = {}) {
  const supported = 'wakeLock' in navigator;
  const secure = window.isSecureContext;

  let battery = null;
  let sentinel = null;
  let held = false;
  // Guard against overlapping requests when visibility or charging flaps
  // faster than request() resolves.
  let busy = false;
  let stopped = false;

  function setHeld(v) {
    if (v === held) return;
    held = v;
    onChange?.(held);
  }

  function want() {
    return shouldHold({
      supported,
      secure,
      visible: !document.hidden,
      charging: battery ? battery.charging : false,
    });
  }

  async function sync() {
    if (stopped || busy) return;
    busy = true;
    try {
      if (want()) {
        if (sentinel && !sentinel.released) return;
        try {
          sentinel = await navigator.wakeLock.request('screen');
        } catch {
          // Rejected: hidden, battery too low, or blocked by permissions
          // policy. Not worth surfacing -- the next visibility or charging
          // change retries, and the indicator correctly stays off.
          sentinel = null;
          setHeld(false);
          return;
        }
        // The browser can drop the lock on its own; follow it so the
        // indicator never claims the screen is held when it is not.
        sentinel.addEventListener('release', () => {
          sentinel = null;
          setHeld(false);
        });
        setHeld(true);
      } else if (sentinel && !sentinel.released) {
        const s = sentinel;
        sentinel = null;
        setHeld(false);
        try {
          await s.release();
        } catch {
          // Already gone; the release listener above has done the work.
        }
      }
    } finally {
      busy = false;
    }
  }

  document.addEventListener('visibilitychange', sync);

  readBattery().then((b) => {
    if (stopped) return;
    battery = b;
    battery?.addEventListener('chargingchange', sync);
    sync();
  });

  return {
    // For tests and diagnostics; the indicator is driven by onChange.
    isHeld: () => held,
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', sync);
      battery?.removeEventListener('chargingchange', sync);
      sentinel?.release().catch(() => {});
      sentinel = null;
      setHeld(false);
    },
  };
}

// holdScreen keeps the screen on regardless of charging, for as long as
// something needs it: a phone recording, which a locked screen would cut off.
// It's the one exception to the charging rule above, and it ends when the
// caller releases it. Like the lock above it re-acquires whenever the page
// comes back into view. onChange(held) reports whether the lock is in place,
// so the recorder can say when it isn't.
export function holdScreen({ onChange } = {}) {
  const supported = 'wakeLock' in navigator && window.isSecureContext;
  let sentinel = null;
  let released = false;

  async function acquire() {
    if (released || !supported || document.hidden) return;
    if (sentinel && !sentinel.released) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      sentinel = null;
      onChange?.(false);
      return;
    }
    if (released) {
      sentinel.release().catch(() => {});
      return;
    }
    sentinel.addEventListener('release', () => {
      sentinel = null;
      if (!released) onChange?.(false);
    });
    onChange?.(true);
  }

  const onVisible = () => { if (!document.hidden) acquire(); };
  document.addEventListener('visibilitychange', onVisible);
  if (!supported) onChange?.(false);
  acquire();

  return {
    release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
