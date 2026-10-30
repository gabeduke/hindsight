// web/static/lib/wave/share.js
// A region as text, and how a file leaves the device: downloaded, or handed
// to the share sheet. The take page and the Studio both export through here.
function tenths(frame, sr) {
  const t = Math.floor((frame / sr) * 10) / 10;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export { gainText } from '../edit/curves.js';

export function fmtRegionText(region, sampleRate) {
  if (!region) return 'whole take';
  return `${tenths(region.start, sampleRate)} – ${tenths(region.end, sampleRate)}`;
}

// A render that failed halfway is still a 200 with a short or empty body --
// the headers went out before ffmpeg spoke. So the body is sniffed rather
// than trusted: an ID3 tag or an MPEG frame sync, and enough of it to be a
// take rather than an error page.
export function looksLikeMP3(bytes) {
  if (!bytes || bytes.length <= 1024) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // "ID3"
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;                       // frame sync
}

// The share sheet needs a secure context and a browser that shares files.
// Probed with a tiny File so the button can say "Download" from the start on
// the plain LAN address instead of surprising the user on tap.
export function canShareFiles() {
  try {
    if (!globalThis.isSecureContext) return false;
    const nav = globalThis.navigator;
    // canShare without share is not a thing any browser ships, but calling a
    // missing share() would throw where returning false just downloads.
    if (!nav || typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false;
    const probe = new File([new Uint8Array(4)], 'probe.mp3', { type: 'audio/mpeg' });
    return nav.canShare({ files: [probe] }) === true;
  } catch { return false; }
}

/** finePointer says this device's main pointer is a mouse or a trackpad. */
export function finePointer() {
  try { return !!globalThis.matchMedia?.('(pointer: fine)')?.matches; } catch { return false; }
}

/**
 * exportWays is how a file can leave this device, in the order to offer
 * them: 'download' always, and 'share' beside it where the browser hands
 * files to a share sheet. With a mouse Download comes first; on a touch
 * screen the share sheet does, as it is how a phone saves a file too. A
 * computer's sheet is no way to keep one: Chrome on a Mac, over the kit's
 * HTTPS address, can share, and its sheet lists apps, never a folder.
 */
export function exportWays({ share = canShareFiles(), fine = finePointer() } = {}) {
  if (!share) return ['download'];
  return fine ? ['download', 'share'] : ['share', 'download'];
}

/**
 * orderExportKeys shows a Download key and a Share key (menu rows, or an
 * inspector's keys) as exportWays has them: Share hidden where the browser
 * can't share files, and whichever comes first, first.
 */
export function orderExportKeys(download, share, ways = exportWays()) {
  if (!download || !share) return;
  share.hidden = !ways.includes('share');
  // Moved only when out of order: moving a key drops the keyboard's focus
  // off it, and the clip's inspector puts these in order each time it fills.
  if (ways[0] === 'share') { if (share.nextElementSibling !== download) download.before(share); }
  else if (download.nextElementSibling !== share) share.before(download);
}

/**
 * saveFile downloads `src` as `filename`: a Blob, or the address of a file
 * the Pi serves (an empty name takes the Pi's), which the browser fetches
 * itself, so a big one never sits in the page's memory. Every download the
 * pages start goes through here.
 */
export function saveFile(src, filename = '') {
  const blob = typeof src !== 'string';
  const url = blob ? URL.createObjectURL(src) : src;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away cancels the download in some browsers; ten seconds
  // is longer than any of them takes to read the blob.
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * shareFile hands `blob` to the share sheet as `filename`, and says what
 * happened: 'shared'; 'cancelled' when the person waved the sheet away,
 * which stays silent; or, when the sheet fails any other way, it saves it
 * once instead: 'downloaded'. The File is built inside the try, so a browser
 * without the constructor still downloads.
 */
export async function shareFile(blob, filename, title, type = 'audio/mpeg') {
  try {
    const file = new File([blob], filename, { type });
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  saveFile(blob, filename);
  return 'downloaded';
}

/**
 * exportActions is a toast's keys for a file that is ready to leave, in
 * exportWays' order: Download, and Share where the browser can. A phone
 * opens the share sheet only straight from a tap, so a file rendered first
 * is offered by a key rather than shared as it arrives.
 */
export function exportActions(blob, filename, title, type = 'audio/mpeg', ways = exportWays()) {
  return ways.map((w) => (w === 'share'
    ? { label: 'Share', run: () => shareFile(blob, filename, title, type) }
    : { label: 'Download', run: () => saveFile(blob, filename) }));
}

// Hands the MP3 to the share sheet where there is one, and otherwise saves
// it (shareFile). The take page's Share key; where Download is offered
// beside Share, exportWays and exportActions say which comes first.
export async function shareOrDownload(blob, filename, title, type = 'audio/mpeg') {
  if (canShareFiles()) return shareFile(blob, filename, title, type);
  saveFile(blob, filename);
  return 'downloaded';
}
