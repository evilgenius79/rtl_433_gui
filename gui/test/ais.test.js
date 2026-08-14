'use strict';
// AIS decoder tests: the widely-published AIVDM reference sentence anchors the
// payload field extraction, and a synthesized HDLC frame exercises the full
// samples -> NRZI -> destuffing -> CRC -> decode pipeline.
const { test } = require('node:test');
const assert = require('node:assert');
const { AisSlicer, decodeAisPayload, buildFrameBits } = require('../main/ais.js');

test('decodes the canonical AIVDM type 1 position report', () => {
  // !AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C — the example used across
  // AIS documentation (gpsd AIVDM docs): MMSI 477553000 near Seattle.
  const m = decodeAisPayload('177KQJ5000G?tO`K>RA1wUbN0TKH');
  assert.ok(m);
  assert.strictEqual(m.type, 1);
  assert.strictEqual(m.mmsi, 477553000);
  assert.ok(Math.abs(m.lat - 47.58283) < 0.0001, `lat ${m.lat}`);
  assert.ok(Math.abs(m.lon - -122.34583) < 0.0001, `lon ${m.lon}`);
  assert.strictEqual(m.sog, 0);
  assert.ok(Math.abs(m.cog - 51) < 1, `cog ${m.cog}`);
  assert.strictEqual(m.heading, 181);
});

// pack an AIS bit string (MSB-first) into octets for transmission
function packBits(bitString) {
  const bits = bitString.split('').map(Number);
  while (bits.length % 8) bits.push(0);
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return bytes;
}

function typeOneBits({ mmsi, latDeg, lonDeg, sogKnots, cogDeg }) {
  const put = (arr, v, len) => {
    for (let i = len - 1; i >= 0; i--) arr.push((v >>> i) & 1);
  };
  const bits = [];
  put(bits, 1, 6); // type 1
  put(bits, 0, 2); // repeat
  put(bits, mmsi, 30);
  put(bits, 0, 4); // status
  put(bits, 0, 8); // rot
  put(bits, Math.round(sogKnots * 10), 10);
  put(bits, 0, 1); // accuracy
  put(bits, (Math.round(lonDeg * 600000) + (1 << 28)) & ((1 << 28) - 1), 28);
  put(bits, (Math.round(latDeg * 600000) + (1 << 27)) & ((1 << 27) - 1), 27);
  put(bits, Math.round(cogDeg * 10), 12);
  put(bits, 511, 9); // heading n/a
  put(bits, 60, 6); // timestamp n/a
  put(bits, 0, 2); // maneuver... (2 of 2+3 spare)
  put(bits, 0, 3); // spare+raim to reach 149? pad below
  while (bits.length < 168) bits.push(0);
  return bits.join('');
}

test('decodes a synthesized frame end to end from audio samples', () => {
  const bits = typeOneBits({ mmsi: 235098765, latDeg: 51.95, lonDeg: 4.14, sogKnots: 12.3, cogDeg: 231 });
  const frameBits = buildFrameBits(packBits(bits));

  // NRZI-encode (transition = 0), with a training prefix, then to samples.
  // The encoder level must chain from the preamble's final symbol.
  const nrzi = [];
  for (let i = 0; i < 32; i++) nrzi.push(i & 1); // preamble-ish transitions
  let level = nrzi[nrzi.length - 1];
  for (const b of frameBits) {
    if (b === 0) level ^= 1;
    nrzi.push(level);
  }
  for (let i = 0; i < 16; i++) nrzi.push(level); // tail
  const rate = 48000;
  const spb = rate / 9600;
  const samples = [];
  let pos = 0;
  for (const symbol of nrzi) {
    pos += spb;
    const n = Math.round(pos);
    pos -= n;
    for (let i = 0; i < n; i++) samples.push(symbol ? 9000 : -9000);
  }

  const messages = [];
  const slicer = new AisSlicer(rate, (m) => messages.push(m));
  slicer.pushSamples(samples);

  assert.strictEqual(messages.length, 1);
  const m = messages[0];
  assert.strictEqual(m.type, 1);
  assert.strictEqual(m.mmsi, 235098765);
  assert.ok(Math.abs(m.lat - 51.95) < 0.001, `lat ${m.lat}`);
  assert.ok(Math.abs(m.lon - 4.14) < 0.001, `lon ${m.lon}`);
  assert.ok(Math.abs(m.sog - 12.3) < 0.11, `sog ${m.sog}`);
  assert.ok(Math.abs(m.cog - 231) < 0.6, `cog ${m.cog}`);
});
