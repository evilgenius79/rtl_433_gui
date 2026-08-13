'use strict';
// POCSAG decoder tests: the protocol's published constants anchor the BCH
// implementation, and a synthesized transmission exercises the full
// samples -> bits -> batches -> message pipeline.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  PocsagSlicer, encodeCodeword, codewordValid, correctCodeword, FSC, IDLE,
} = require('../main/pocsag.js');

test('the published sync and idle codewords are BCH-valid', () => {
  // These constants are defined by ITU-R M.584; if our BCH math is right,
  // both must check out as valid codewords.
  assert.strictEqual(codewordValid(FSC), true);
  assert.strictEqual(codewordValid(IDLE), true);
});

test('single-bit errors are corrected', () => {
  const cw = encodeCodeword(0x12345);
  assert.strictEqual(codewordValid(cw), true);
  for (const bit of [0, 7, 15, 31]) {
    const damaged = (cw ^ (1 << bit)) >>> 0;
    assert.strictEqual(codewordValid(damaged), false);
    assert.strictEqual(correctCodeword(damaged), cw);
  }
});

// ---- helpers to synthesize a transmission ----

function addressCodeword(address, func) {
  return encodeCodeword((((address >>> 3) & 0x3ffff) << 2) | (func & 3));
}

function alphaMessageCodewords(text) {
  const bits = [];
  for (const ch of text + '\x04') {
    const c = ch.charCodeAt(0) & 0x7f;
    for (let b = 0; b < 7; b++) bits.push((c >> b) & 1); // LSB-first on air
  }
  while (bits.length % 20) bits.push(0);
  const cws = [];
  for (let i = 0; i < bits.length; i += 20) {
    let data = 1 << 20; // message type bit
    for (let b = 0; b < 20; b++) data |= bits[i + b] << (19 - b); // MSB-first in the codeword
    cws.push(encodeCodeword(data));
  }
  return cws;
}

function numericMessageCodewords(digits) {
  const charset = '0123456789*U -)(';
  const bits = [];
  for (const ch of digits) {
    const n = charset.indexOf(ch);
    for (let b = 0; b < 4; b++) bits.push((n >> b) & 1);
  }
  while (bits.length % 20) bits.push(1); // pad with 0xC = space nibbles (LSB-first 0011… keep simple: pad 1s -> 'U'.. trimmed? use space)
  const cws = [];
  for (let i = 0; i < bits.length; i += 20) {
    let data = 1 << 20;
    for (let b = 0; b < 20; b++) data |= bits[i + b] << (19 - b);
    cws.push(encodeCodeword(data));
  }
  return cws;
}

function buildBatchBits(codewords) {
  // preamble + FSC + 16 codewords (pad with idle)
  const cws = [...codewords];
  while (cws.length < 16) cws.push(IDLE);
  const bits = [];
  for (let i = 0; i < 600; i++) bits.push(i & 1 ? 0 : 1);
  const pushWord = (w) => {
    for (let i = 31; i >= 0; i--) bits.push((w >>> i) & 1);
  };
  pushWord(FSC);
  for (const cw of cws.slice(0, 16)) pushWord(cw);
  // second batch of idles so the deframer sees a clean continuation
  pushWord(FSC);
  for (let i = 0; i < 16; i++) pushWord(IDLE);
  return bits;
}

function bitsToSamples(bits, sampleRate, baud, amplitude = 9000) {
  const spb = sampleRate / baud;
  const out = [];
  let pos = 0;
  for (const bit of bits) {
    pos += spb;
    const n = Math.round(pos);
    pos -= n;
    for (let i = 0; i < n; i++) out.push(bit ? -amplitude : amplitude);
  }
  return out;
}

function runPipeline(codewords, baud = 1200, rate = 22050) {
  const messages = [];
  const slicer = new PocsagSlicer(rate, baud, (m) => messages.push(m));
  slicer.pushSamples(bitsToSamples(buildBatchBits(codewords), rate, baud));
  return messages;
}

test('decodes an alphanumeric page end to end from audio samples', () => {
  const address = 1194056; // frame index = address & 7 = 0 -> slot 0
  const cws = [addressCodeword(address, 3), ...alphaMessageCodewords('A2 AMBU 12345 Main St GRIP-1')];
  const messages = runPipeline(cws);
  assert.strictEqual(messages.length, 1);
  const m = messages[0];
  assert.strictEqual(m.address, address);
  assert.strictEqual(m.func, 3);
  assert.strictEqual(m.type, 'alpha');
  assert.strictEqual(m.text, 'A2 AMBU 12345 Main St GRIP-1');
});

test('decodes a numeric page end to end from audio samples', () => {
  const address = 1357000; // 21-bit RIC, & 7 = 0
  const cws = [addressCodeword(address, 0), ...numericMessageCodewords('0800123456')];
  const messages = runPipeline(cws);
  assert.strictEqual(messages.length, 1);
  const m = messages[0];
  assert.strictEqual(m.address, address);
  assert.strictEqual(m.type, 'numeric');
  assert.ok(m.text.startsWith('0800123456'), `got "${m.text}"`);
});

test('decodes with inverted polarity too', () => {
  const address = 44040; // & 7 = 0
  const cws = [addressCodeword(address, 3), ...alphaMessageCodewords('TEST INV')];
  const messages = [];
  const slicer = new PocsagSlicer(22050, 1200, (m) => messages.push(m));
  const samples = bitsToSamples(buildBatchBits(cws), 22050, 1200).map((s) => -s);
  slicer.pushSamples(samples);
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].text, 'TEST INV');
});
