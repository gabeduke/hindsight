import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtRegionText, looksLikeMP3, canShareFiles, shareOrDownload, gainText, exportWays, orderExportKeys, saveFile, exportActions } from './share.js';

test('region text is tenths with an en dash, or whole take', () => {
  assert.equal(fmtRegionText({ start: 48000 * 12.34, end: 48000 * 41.87 }, 48000), '0:12.3 – 0:41.8');
  assert.equal(fmtRegionText({ start: 0, end: 48000 * 75 }, 48000), '0:00.0 – 1:15.0');
  assert.equal(fmtRegionText(null, 48000), 'whole take');
});

test('looksLikeMP3 accepts ID3 and frame-sync starts, rejects short or other bytes', () => {
  const big = (head) => { const b = new Uint8Array(2048); b.set(head); return b; };
  assert.equal(looksLikeMP3(big([0x49, 0x44, 0x33])), true);        // "ID3"
  assert.equal(looksLikeMP3(big([0xff, 0xfb, 0x90])), true);        // MPEG-1 layer III sync
  assert.equal(looksLikeMP3(big([0xff, 0xe0])), true);              // minimal sync
  assert.equal(looksLikeMP3(big([0x52, 0x49, 0x46, 0x46])), false); // "RIFF"
  assert.equal(looksLikeMP3(new Uint8Array([0x49, 0x44, 0x33])), false); // too short
  assert.equal(looksLikeMP3(null), false);
});

// --- the share sheet, stubbed --------------------------------------------
// share.js reads its globals at call time, so a browser is a few properties
// on globalThis rather than a DOM.
function stub(name, value) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (prev) Object.defineProperty(globalThis, name, prev);
    else delete globalThis[name];
  };
}

function fakeDocument() {
  const clicks = [];
  const doc = {
    clicks,
    createElement: () => ({
      click() { clicks.push({ href: this.href, download: this.download }); },
      remove() {},
    }),
    body: { appendChild() {} },
  };
  return doc;
}

function browser({ secure = true, canShare = () => true, share = async () => {} } = {}) {
  const doc = fakeDocument();
  const undo = [
    stub('isSecureContext', secure),
    stub('navigator', { canShare, share }),
    stub('document', doc),
  ];
  return { doc, restore: () => { for (const u of undo.reverse()) u(); } };
}

test('canShareFiles needs a secure context, canShare and share', () => {
  let b = browser({ secure: false });
  try { assert.equal(canShareFiles(), false); } finally { b.restore(); }

  b = browser({ canShare: () => false });
  try { assert.equal(canShareFiles(), false); } finally { b.restore(); }

  b = browser({ share: null }); // null, not undefined: undefined takes the default
  try { assert.equal(canShareFiles(), false); } finally { b.restore(); }

  b = browser({ canShare: () => { throw new Error('nope'); } });
  try { assert.equal(canShareFiles(), false); } finally { b.restore(); }

  b = browser();
  try { assert.equal(canShareFiles(), true); } finally { b.restore(); }
});

test('shareOrDownload shares when it can, and says what it did', async () => {
  const shared = [];
  const b = browser({ share: async (data) => { shared.push(data); } });
  try {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });
    assert.equal(await shareOrDownload(blob, 'jam 0.05-0.12.mp3', 'jam 0.05-0.12'), 'shared');
    assert.equal(shared.length, 1);
    assert.equal(shared[0].title, 'jam 0.05-0.12');
    assert.equal(shared[0].files[0].name, 'jam 0.05-0.12.mp3');
    assert.equal(shared[0].files[0].type, 'audio/mpeg');
    assert.equal(b.doc.clicks.length, 0);
  } finally { b.restore(); }
});

test('a dismissed share sheet is cancelled, and downloads nothing', async () => {
  const abort = Object.assign(new Error('share canceled'), { name: 'AbortError' });
  const b = browser({ share: async () => { throw abort; } });
  try {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });
    assert.equal(await shareOrDownload(blob, 'jam.mp3', 'jam'), 'cancelled');
    assert.equal(b.doc.clicks.length, 0);
  } finally { b.restore(); }
});

test('any other share failure falls back to one download', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the revoke timer, not a real 10s wait
  const b = browser({ share: async () => { throw new Error('no transport'); } });
  try {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });
    assert.equal(await shareOrDownload(blob, 'jam 0.05-0.12.mp3', 'jam'), 'downloaded');
    assert.equal(b.doc.clicks.length, 1);
    assert.equal(b.doc.clicks[0].download, 'jam 0.05-0.12.mp3');
    assert.match(b.doc.clicks[0].href, /^blob:/);
  } finally { b.restore(); }
});

test('a browser that cannot share files downloads without asking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = browser({ canShare: () => false, share: async () => { throw new Error('should not be called'); } });
  try {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });
    assert.equal(await shareOrDownload(blob, 'jam.mp3', 'jam'), 'downloaded');
    assert.equal(b.doc.clicks.length, 1);
    assert.equal(b.doc.clicks[0].download, 'jam.mp3');
  } finally { b.restore(); }
});

test('shareOrDownload shares a zip with the type it is given', async () => {
  // Node ships a read-only global `navigator` (and `File`), so a bare
  // `globalThis.navigator = ...` throws here where it wouldn't in a browser.
  // The existing stub() helper swaps the property descriptor instead, and
  // restores it afterwards so this test leaves no globals behind for the
  // ones that follow.
  const seen = [];
  const undo = [
    stub('isSecureContext', true),
    stub('navigator', {
      canShare: () => true,
      share: async ({ files }) => { seen.push(files[0].type); },
    }),
    stub('File', class { constructor(parts, name, opts) { this.name = name; this.type = opts.type; } }),
  ];
  try {
    const r = await shareOrDownload(new Blob(['x']), 'a.zip', 'a', 'application/zip');
    assert.equal(r, 'shared');
    assert.deepEqual(seen, ['application/zip']);
  } finally { for (const u of undo.reverse()) u(); }
});

test('a Level gain reads with its sign, to the tenth', () => {
  assert.equal(gainText(6.2), '+6.2 dB');
  assert.equal(gainText(24), '+24.0 dB');
  assert.equal(gainText(-1), '−1.0 dB');
  assert.equal(gainText(0), '0 dB');
});

// --- Download, and Share beside it ----------------------------------------
// A computer's share sheet has no folder: Chrome on a Mac, over the kit's
// HTTPS address, can share files, and its sheet lists apps. An export that
// offered only the sheet there left no way to keep the file.

test('export always offers Download, and Share beside it where the browser can share', () => {
  assert.deepEqual(exportWays({ share: false, fine: true }), ['download']);
  assert.deepEqual(exportWays({ share: false, fine: false }), ['download']);
  // With a mouse, Download first: a Mac's Chrome over HTTPS.
  assert.deepEqual(exportWays({ share: true, fine: true }), ['download', 'share']);
  // On a touch screen, the share sheet first: it is how a phone saves too.
  assert.deepEqual(exportWays({ share: true, fine: false }), ['share', 'download']);
});

test('exportWays asks the browser: can it share files, and is its pointer a mouse', () => {
  const mouse = [
    stub('isSecureContext', true),
    stub('navigator', { canShare: () => true, share: async () => {} }),
    stub('matchMedia', (q) => ({ matches: q === '(pointer: fine)' })),
  ];
  try { assert.deepEqual(exportWays(), ['download', 'share']); } finally { for (const u of mouse.reverse()) u(); }
  const touch = [
    stub('isSecureContext', true),
    stub('navigator', { canShare: () => true, share: async () => {} }),
    stub('matchMedia', () => ({ matches: false })),
  ];
  try { assert.deepEqual(exportWays(), ['share', 'download']); } finally { for (const u of touch.reverse()) u(); }
});

// Two keys in a parent, by name, for orderExportKeys' before(); moves
// counts the times one was moved (a move drops the keyboard's focus).
function keys() {
  const list = [];
  let moves = 0;
  const key = (name) => ({
    name, hidden: false,
    get nextElementSibling() { return list[list.indexOf(this) + 1] ?? null; },
    before(other) { moves++; list.splice(list.indexOf(other), 1); list.splice(list.indexOf(this), 0, other); },
  });
  const download = key('download'), share = key('share');
  list.push(share, download); // the wrong way round, to see it put right
  return { download, share, moves: () => moves, names: () => list.filter((k) => !k.hidden).map((k) => k.name) };
}

test('orderExportKeys leaves keys already in order where they are', () => {
  const k = keys();
  orderExportKeys(k.download, k.share, ['download', 'share']);
  orderExportKeys(k.download, k.share, ['download', 'share']);
  orderExportKeys(k.download, k.share, ['download']);
  assert.equal(k.moves(), 1);
  orderExportKeys(k.download, k.share, ['share', 'download']);
  orderExportKeys(k.download, k.share, ['share', 'download']);
  assert.equal(k.moves(), 2);
});

test('orderExportKeys shows the keys in exportWays order, Share hidden where it cannot share', () => {
  let k = keys();
  orderExportKeys(k.download, k.share, ['download', 'share']);
  assert.deepEqual(k.names(), ['download', 'share']);
  k = keys();
  orderExportKeys(k.download, k.share, ['share', 'download']);
  assert.deepEqual(k.names(), ['share', 'download']);
  k = keys();
  orderExportKeys(k.download, k.share, ['download']);
  assert.deepEqual(k.names(), ['download']);
  assert.equal(k.share.hidden, true);
});

test('saveFile downloads a Blob as its name, or the Pi’s address as the Pi names it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = browser();
  try {
    saveFile(new Blob(['x']), 'Song 2026-10-30.mp3');
    saveFile('/api/tapes/clip?id=a&clip=c1');
    assert.equal(b.doc.clicks.length, 2);
    assert.match(b.doc.clicks[0].href, /^blob:/);
    assert.equal(b.doc.clicks[0].download, 'Song 2026-10-30.mp3');
    assert.deepEqual(b.doc.clicks[1], { href: '/api/tapes/clip?id=a&clip=c1', download: '' });
  } finally { b.restore(); }
});

test('a rendered file’s toast offers Download, and Share where it can, each doing what it says', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shared = [];
  const b = browser({ share: async (d) => { shared.push(d.files[0].name); } });
  try {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });
    assert.deepEqual(exportActions(blob, 'mix.mp3', 'mix', 'audio/mpeg', ['download']).map((a) => a.label), ['Download']);
    const [dl, sh] = exportActions(blob, 'mix.mp3', 'mix', 'audio/mpeg', ['download', 'share']);
    assert.deepEqual([dl.label, sh.label], ['Download', 'Share']);
    dl.run();
    assert.equal(b.doc.clicks.length, 1);
    assert.equal(b.doc.clicks[0].download, 'mix.mp3');
    assert.equal(await sh.run(), 'shared');
    assert.deepEqual(shared, ['mix.mp3']);
    assert.equal(b.doc.clicks.length, 1);
  } finally { b.restore(); }
});
