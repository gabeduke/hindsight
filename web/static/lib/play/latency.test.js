import { test } from 'node:test';
import assert from 'node:assert/strict';

import { line, rows, pathName, mountLine } from './latency.js';

const spread = (p50, p95, max, n = 12) => ({ n, p50_ms: p50, p95_ms: p95, max_ms: max });

const report = {
  paths: [
    { path: 'midi→room', via: 'midi', ear: 'room', count: 40, total: spread(108.2, 115, 131), pi_to_ear: spread(108.2, 115, 131) },
    {
      path: 'page→phone', via: 'page', ear: 'phone', count: 12, total: spread(1180, 1260, 1302),
      touch_to_send: spread(3, 6, 9), send_to_pi: spread(18, 40, 61), pi_to_ear: spread(1150, 1210, 1240),
    },
  ],
  quantised: 5,
  missed: 0,
  buffers: { sample_rate: 48000, block_frames: 1024, ahead_frames: 5120, ahead_ms: 106.7, output_latency_ms: 100, lead_ms: 201.3 },
  underflows: { render: 1, device: 0, phone: 2 },
  phone: { fill_ms: 800, output_ms: 42, age_s: 0.4 },
};

test('a path is the way in and the ear, in words', () => {
  assert.equal(pathName({ via: 'midi', ear: 'room' }), 'Controller → room');
  assert.equal(pathName({ via: 'page', ear: 'phone' }), 'Page → phone');
});

test('the Rig\'s line is each path\'s total and what it was taken with', () => {
  assert.equal(line(report),
    'Control to ear: Controller → room 108 ms (95% 115, worst 131) · Page → phone 1180 ms (95% 1260, worst 1302); '
    + 'rendered 107 ms ahead, the device asked for 100 ms, the phone buffers 800 ms, 3 underflows.');
  assert.equal(line({ ...report, paths: [] }), '', 'nothing timed: no line');
  assert.equal(line(null), '');
});

test('the overlay has a row a path, its legs, and the buffers', () => {
  const r = rows(report);
  assert.deepEqual(r[0], ['Controller → room', '108 ms (95% 115, worst 131) · n 40']);
  assert.deepEqual(r[1], ['', 'pi→ear 108']);
  assert.deepEqual(r[3], ['', 'page 3 · wi-fi 18 · pi→ear 1150']);
  assert.deepEqual(r.at(-1), ['quantised', '5 waited for a line, not timed']);
  assert.ok(r.some(([k, v]) => k === 'buffers' && v.includes('lead 201 ms')));
  assert.deepEqual(rows(null), [['latency', 'the Pi did not answer']]);
  assert.deepEqual(rows({ paths: [] })[0], ['latency', 'nothing timed yet: play a pad']);
});

test('the Rig\'s line is drawn from the Pi\'s answer and hides while there is nothing', async () => {
  const el = { textContent: '', hidden: true };
  let answer = { paths: [] };
  const timers = [];
  const stop = mountLine(el, {
    fetchFn: async () => ({ ok: true, json: async () => answer }),
    doc: { hidden: false },
    setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer: () => {},
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.hidden, true);
  answer = report;
  await timers.at(-1)();
  assert.equal(el.hidden, false);
  assert.match(el.textContent, /^Control to ear: Controller → room 108 ms/);
  stop();
});
