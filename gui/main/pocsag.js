'use strict';
// POCSAG pager decoder. Consumes FM-demodulated s16 audio (from rtl_fm),
// recovers the bit clock at 512/1200/2400 baud, frames batches and decodes
// address + alpha/numeric message codewords with BCH(31,21) correction.
//
// Structure (ITU-R M.584): >=576 bits of 1010… preamble, then batches of a
// frame sync codeword (0x7CD215D8) followed by 8 frames x 2 codewords.
// Codeword: 1 type bit + 20 payload bits + 10 BCH parity bits + 1 even parity.

const FSC = 0x7cd215d8;
const IDLE = 0x7a89c197;
const BCH_POLY = 0x769; // x^10+x^9+x^8+x^6+x^5+x^3+1
const NUMERIC_CHARSET = '0123456789*U -)(';

// ---- codeword math ----

// 10-bit BCH remainder over the 21 data bits (bits 31..11 of the codeword)
function bchRemainder(data21) {
  let rem = data21 << 10;
  for (let i = 30; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= BCH_POLY << (i - 10);
  }
  return rem & 0x3ff;
}

function parity32(v) {
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v ^= v >>> 2;
  v ^= v >>> 1;
  return v & 1;
}

function codewordValid(cw) {
  const data = (cw >>> 11) & 0x1fffff;
  const bch = (cw >>> 1) & 0x3ff;
  return bchRemainder(data) === bch && parity32(cw) === 0;
}

// build a valid codeword from 21 data bits (used by tests and sanity checks)
function encodeCodeword(data21) {
  let cw = ((data21 & 0x1fffff) << 11) | (bchRemainder(data21 & 0x1fffff) << 1);
  if (parity32(cw)) cw |= 1;
  return cw >>> 0;
}

// try to make an invalid codeword valid by flipping a single bit
function correctCodeword(cw) {
  if (codewordValid(cw)) return cw;
  for (let i = 0; i < 32; i++) {
    const c = (cw ^ (1 << i)) >>> 0;
    if (codewordValid(c)) return c;
  }
  return null;
}

// ---- message assembly ----

function decodeAlpha(payloadBits) {
  // 7-bit ASCII, each char transmitted LSB-first across the payload stream
  let out = '';
  for (let i = 0; i + 7 <= payloadBits.length; i += 7) {
    let c = 0;
    for (let b = 0; b < 7; b++) c |= payloadBits[i + b] << b;
    if (c === 0 || c === 3 || c === 4 || c === 23) break; // NUL/ETX/EOT/ETB terminate
    out += String.fromCharCode(c);
  }
  return out.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
}

function decodeNumeric(payloadBits) {
  let out = '';
  for (let i = 0; i + 4 <= payloadBits.length; i += 4) {
    // nibbles are also LSB-first on air
    let n = 0;
    for (let b = 0; b < 4; b++) n |= payloadBits[i + b] << b;
    out += NUMERIC_CHARSET[n];
  }
  return out.replace(/[ ]+$/g, '');
}

function printableRatio(s) {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 10 || c === 13 || (c >= 32 && c < 127)) ok++;
  }
  return ok / s.length;
}

// A batch decoder fed one codeword at a time; emits finished messages via cb.
class PocsagAssembler {
  constructor(baud, onMessage) {
    this.baud = baud;
    this.onMessage = onMessage;
    this.current = null; // {address, func, payloadBits: []}
  }

  flush() {
    const m = this.current;
    this.current = null;
    if (!m) return;
    const alpha = decodeAlpha(m.payloadBits);
    const numeric = decodeNumeric(m.payloadBits);
    // function 0 is numeric by convention; 3 is alphanumeric. For the rest,
    // prefer alpha when it looks like real text.
    let type;
    let text;
    if (m.func === 3 || (m.func !== 0 && alpha.length >= 2 && printableRatio(alpha) > 0.9)) {
      type = 'alpha';
      text = alpha;
    } else {
      type = 'numeric';
      text = numeric;
    }
    this.onMessage({
      baud: this.baud,
      address: m.address,
      func: m.func,
      type,
      text,
      alpha,
      numeric,
      time: Date.now(),
    });
  }

  // cw: 32-bit codeword (already error-corrected), frameIdx: 0..7
  push(cw, frameIdx) {
    if (cw === IDLE) {
      this.flush();
      return;
    }
    if ((cw & 0x80000000) === 0) {
      // address codeword: finalize any previous message, start a new one
      this.flush();
      const address = (((cw >>> 13) & 0x3ffff) << 3) | frameIdx;
      const func = (cw >>> 11) & 3;
      this.current = { address, func, payloadBits: [] };
    } else if (this.current) {
      // message codeword: 20 payload bits, MSB-first on the wire
      for (let i = 30; i >= 11; i--) this.current.payloadBits.push((cw >>> i) & 1);
    }
  }
}

// ---- bit-level deframer ----
// Hunts for the frame sync codeword in a bit stream, then reads 16 codewords
// per batch, correcting single-bit errors.
class PocsagDeframer {
  constructor(baud, onMessage) {
    this.baud = baud;
    this.shift = 0;
    this.state = 'hunt';
    this.bitCount = 0;
    this.cwBits = 0;
    this.cwIndex = 0;
    this.badCw = 0;
    this.assembler = new PocsagAssembler(baud, onMessage);
  }

  pushBit(bit) {
    this.shift = ((this.shift << 1) | bit) >>> 0;
    if (this.state === 'hunt') {
      if (this.shift === FSC) {
        this.state = 'batch';
        this.cwBits = 0;
        this.cwIndex = 0;
        this.badCw = 0;
      }
      return;
    }
    // collecting a batch: 16 codewords of 32 bits
    this.cwBits++;
    if (this.cwBits < 32) return;
    this.cwBits = 0;
    const cw = this.shift;
    if (this.cwIndex < 16) {
      const fixed = correctCodeword(cw);
      if (fixed != null) {
        this.assembler.push(fixed, this.cwIndex >> 1);
      } else if (++this.badCw > 4) {
        // too much garbage: drop sync, finalize what we have
        this.assembler.flush();
        this.state = 'hunt';
        return;
      }
      this.cwIndex++;
      if (this.cwIndex === 16) {
        // next 32 bits must be another sync word, else the transmission ended
        this.cwIndex = 17;
        this.cwBits = 0;
      }
    } else {
      // expecting a sync codeword between batches (tolerate 2 bit errors)
      let diff = (cw ^ FSC) >>> 0;
      let errs = 0;
      while (diff) {
        errs += diff & 1;
        diff >>>= 1;
      }
      if (errs <= 2) {
        this.cwIndex = 0;
        this.badCw = 0;
      } else {
        this.assembler.flush();
        this.state = 'hunt';
      }
    }
  }
}

// ---- sample-level slicer ----
// Recovers bits from FM-demodulated s16 samples for one baud rate, feeding
// normal and inverted deframers (rtl_fm polarity depends on the transmitter).
class PocsagSlicer {
  constructor(sampleRate, baud, onMessage) {
    this.spb = sampleRate / baud;
    this.phase = 0;
    this.lastSign = 1;
    this.dc = 0;
    this.norm = new PocsagDeframer(baud, onMessage);
    this.inv = new PocsagDeframer(baud, onMessage);
  }

  pushSamples(samples) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.dc += (s - this.dc) * 0.0005; // slow DC tracker
      const sign = s - this.dc >= 0 ? 1 : -1;
      if (sign !== this.lastSign) {
        // transitions happen at bit boundaries: nudge the clock so the next
        // sample point lands mid-bit
        this.phase += (this.spb / 2 - this.phase) * 0.5;
        this.lastSign = sign;
      }
      this.phase += 1;
      if (this.phase >= this.spb) {
        this.phase -= this.spb;
        const bit = sign < 0 ? 1 : 0; // POCSAG: low frequency shift = 1
        this.norm.pushBit(bit);
        this.inv.pushBit(bit ^ 1);
      }
    }
  }
}

module.exports = {
  PocsagSlicer,
  PocsagDeframer,
  PocsagAssembler,
  encodeCodeword,
  codewordValid,
  correctCodeword,
  FSC,
  IDLE,
};
