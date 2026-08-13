'use strict';
// Decoder validated against the worked examples in "The 1090 Megahertz
// Riddle" (mode-s.org) — canonical ADS-B reference frames.
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeFrame, cprDecodeGlobal } = require('../main/modes.js');

test('rejects garbage and short/corrupt frames', () => {
  assert.strictEqual(decodeFrame('nonsense'), null);
  assert.strictEqual(decodeFrame('8d4840d6'), null);
  // valid frame with one flipped bit fails CRC
  assert.strictEqual(decodeFrame('8c4840d6202cc371c32ce0576098'), null);
});

test('decodes aircraft identification (callsign)', () => {
  const d = decodeFrame('8D4840D6202CC371C32CE0576098');
  assert.ok(d, 'frame should pass CRC');
  assert.strictEqual(d.icao, '4840D6');
  assert.strictEqual(d.tc, 4);
  assert.strictEqual(d.callsign, 'KLM1023');
});

test('decodes airborne position pair via global CPR', () => {
  const even = decodeFrame('8D40621D58C382D690C8AC2863A7');
  const odd = decodeFrame('8D40621D58C386435CC412692AD6');
  assert.ok(even && odd);
  assert.strictEqual(even.icao, '40621D');
  assert.strictEqual(even.oddFlag, 0);
  assert.strictEqual(odd.oddFlag, 1);
  assert.strictEqual(even.altitude, 38000);

  // the even frame is the newer one in the book's example
  const pos = cprDecodeGlobal(even, odd, false);
  assert.ok(pos);
  assert.ok(Math.abs(pos.lat - 52.2572) < 0.001, `lat ${pos.lat}`);
  assert.ok(Math.abs(pos.lon - 3.91937) < 0.001, `lon ${pos.lon}`);
});

test('decodes ground speed and track from velocity frame', () => {
  const d = decodeFrame('8D485020994409940838175B284F');
  assert.ok(d);
  assert.strictEqual(d.icao, '485020');
  assert.strictEqual(d.tc, 19);
  assert.ok(Math.abs(d.gs - 159.2) < 1, `gs ${d.gs}`);
  assert.ok(Math.abs(d.track - 182.88) < 0.5, `track ${d.track}`);
  assert.ok(Math.abs(d.vr - -832) < 1, `vr ${d.vr}`);
});
