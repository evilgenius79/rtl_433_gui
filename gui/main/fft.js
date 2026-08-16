'use strict';
// Minimal radix-2 FFT and a power-spectrum helper for the live waterfall:
// interleaved cu8 IQ from rtl_sdr in, fft-shifted dBFS spectrum out.

class Fft {
  constructor(n) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  // in-place complex FFT over re[]/im[] (both length n)
  transform(re, im) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const r = rev[i];
      if (r > i) {
        let t = re[i];
        re[i] = re[r];
        re[r] = t;
        t = im[i];
        im[i] = im[r];
        im[r] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const tr = re[j + half] * cos[k] - im[j + half] * sin[k];
          const ti = re[j + half] * sin[k] + im[j + half] * cos[k];
          re[j + half] = re[j] - tr;
          im[j + half] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }
}

// Power spectrum of cu8 IQ: Hann window, per-window DC removal (kills the
// RTL2832's center spike), fft-shift so the tuned frequency lands mid-array.
// A full-scale tone reads ~0 dBFS; the noise floor of an 8-bit dongle sits
// around -55 to -70 dB depending on gain.
class PowerSpectrum {
  constructor(n = 4096) {
    this.n = n;
    this.fft = new Fft(n);
    this.win = new Float64Array(n);
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      wsum += this.win[i];
    }
    // coherent window-gain normalization; complex IQ puts a tone's full
    // energy in a single bin, so no ×2 real-signal correction here
    this.scale = 1 / wsum;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  // Accumulate one window's LINEAR power into out (Float64Array(n)) so
  // several windows can be averaged before the dB conversion.
  // buf holds interleaved u8 I,Q; sampleOffset is in IQ pairs.
  accumulate(buf, sampleOffset, out) {
    const { n, re, im, win } = this;
    const o = sampleOffset * 2;
    let meanI = 0;
    let meanQ = 0;
    for (let i = 0; i < n; i++) {
      meanI += buf[o + 2 * i];
      meanQ += buf[o + 2 * i + 1];
    }
    meanI /= n;
    meanQ /= n;
    for (let i = 0; i < n; i++) {
      re[i] = ((buf[o + 2 * i] - meanI) / 127.5) * win[i];
      im[i] = ((buf[o + 2 * i + 1] - meanQ) / 127.5) * win[i];
    }
    this.fft.transform(re, im);
    const s = this.scale;
    const half = n >> 1;
    for (let i = 0; i < n; i++) {
      const k = i < half ? i + half : i - half; // fft-shift
      const rr = re[i] * s;
      const ii = im[i] * s;
      out[k] += rr * rr + ii * ii;
    }
  }

  // average `count` accumulated spectra and convert to dB
  toDb(acc, count) {
    const out = new Float32Array(acc.length);
    for (let i = 0; i < acc.length; i++) {
      out[i] = 10 * Math.log10(acc[i] / count + 1e-12);
    }
    return out;
  }
}

module.exports = { Fft, PowerSpectrum };
