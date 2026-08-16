'use strict';
// Tests for the live-waterfall DSP: FFT correctness against a direct DFT,
// power-spectrum peak location/level from synthetic cu8 IQ, and the
// bin-cropping math that maps a capture window onto the requested range.
const { test } = require('node:test');
const assert = require('node:assert');
const { Fft, PowerSpectrum } = require('../main/fft.js');
const { cropRange } = require('../main/spectrum-source.js');

test('FFT matches a direct DFT on random data', () => {
  const n = 64;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // deterministic pseudo-random input
  let seed = 1234;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let i = 0; i < n; i++) {
    re[i] = rnd();
    im[i] = rnd();
  }
  const dftRe = new Float64Array(n);
  const dftIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      dftRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      dftIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  new Fft(n).transform(re, im);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(re[k] - dftRe[k]) < 1e-9, `re[${k}]`);
    assert.ok(Math.abs(im[k] - dftIm[k]) < 1e-9, `im[${k}]`);
  }
});

test('a synthetic cu8 tone lands in the right bin at about 0 dBFS', () => {
  const n = 1024;
  const ps = new PowerSpectrum(n);
  // complex exponential at +100 bins from centre, near full scale
  const buf = new Uint8Array(n * 2);
  const fbin = 100;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * fbin * i) / n;
    buf[2 * i] = Math.round(127.5 + 120 * Math.cos(a));
    buf[2 * i + 1] = Math.round(127.5 + 120 * Math.sin(a));
  }
  const acc = new Float64Array(n);
  ps.accumulate(buf, 0, acc);
  const dbs = ps.toDb(acc, 1);
  let peak = 0;
  for (let i = 1; i < n; i++) if (dbs[i] > dbs[peak]) peak = i;
  // after fft-shift the centre (DC) is bin n/2, so +100 bins => n/2 + 100
  assert.strictEqual(peak, n / 2 + fbin);
  // 120/127.5 amplitude ≈ -0.5 dBFS; allow a little windowing slop
  assert.ok(dbs[peak] > -2 && dbs[peak] < 1, `peak level ${dbs[peak]}`);
  // noise floor of a clean synthetic tone should sit far below the peak
  const floor = dbs[n / 2 + 300];
  assert.ok(dbs[peak] - floor > 40, `dynamic range ${dbs[peak] - floor}`);
});

test('per-window DC removal suppresses the centre spike', () => {
  const n = 1024;
  const ps = new PowerSpectrum(n);
  // pure DC offset (the RTL2832's signature) plus a touch of noise
  const buf = new Uint8Array(n * 2);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let i = 0; i < n * 2; i++) buf[i] = Math.round(140 + rnd() * 4);
  const acc = new Float64Array(n);
  ps.accumulate(buf, 0, acc);
  const dbs = ps.toDb(acc, 1);
  // the DC bin (centre after shift) should NOT tower over its neighbours
  const dc = dbs[n / 2];
  let nearby = -Infinity;
  for (const k of [n / 2 - 8, n / 2 - 4, n / 2 + 4, n / 2 + 8]) nearby = Math.max(nearby, dbs[k]);
  assert.ok(dc < nearby + 12, `dc ${dc} vs nearby ${nearby}`);
});

test('cropRange maps the requested span onto capture bins', () => {
  // 2.048 MHz capture centred at 434 MHz, 4096 bins => 500 Hz/bin
  const c = cropRange(434e6, 2048e3, 4096, 433e6, 435e6);
  assert.ok(c);
  assert.ok(c.startHz >= 433e6 && c.startHz < 433e6 + 500);
  assert.ok(c.stopHz <= 435e6 && c.stopHz > 435e6 - 500);
  assert.strictEqual(c.stepHz, 500);
  assert.ok(c.i0 >= 0 && c.i1 < 4096 && c.i1 > c.i0);
  // a span wider than the capture clamps to the full window
  const full = cropRange(434e6, 2048e3, 4096, 430e6, 440e6);
  assert.strictEqual(full.i0, 0);
  assert.strictEqual(full.i1, 4095);
  // a span entirely outside the capture is rejected
  assert.strictEqual(cropRange(434e6, 2048e3, 4096, 500e6, 501e6), null);
});
