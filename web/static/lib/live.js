// WebSocket client for the live level stream, with backoff reconnect.
//
// The server pushes real min/max peak bins (~100/s) rather than a single RMS
// scalar, which is what makes an actual waveform drawable on the client.
// Frames come ~100 times a second, so STALE_MS of silence is long. How the
// socket is kept open is socket.js's.

import { connectSocket } from './socket.js';

export { STALE_MS, FRESH_MS } from './socket.js';

export function connectLive({ onFrame, onOpen, onClose }, env = {}) {
  return connectSocket('/api/live', { onMessage: onFrame, onOpen, onClose }, env);
}
