'use strict';
// AIS decoder (ITU-R M.1371). Consumes FM-demodulated s16 audio from rtl_fm
// on an AIS channel (161.975 / 162.025 MHz): recovers the 9600-baud GMSK bit
// stream, NRZI-decodes it, deframes HDLC (flags, bit destuffing, CRC-16/X.25)
// and decodes the common position/static message types.

const SIXBIT = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';

// ---- CRC-16/X.25 (poly 0x8408 reflected, init 0xFFFF, xorout 0xFFFF) ----
function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0x8408 : crc >> 1;
    }
  }
  return (~crc) & 0xffff;
}

// bits: array of 0/1 in HDLC order (LSB-first per byte)
function bitsToBytesLsbFirst(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b |= bits[i + j] << j;
    bytes.push(b);
  }
  return bytes;
}

// read an unsigned field from AIS payload bits (MSB-first order)
function u(bits, start, len) {
  let v = 0;
  for (let i = start; i < start + len; i++) v = v * 2 + bits[i];
  return v;
}

function s(bits, start, len) {
  const v = u(bits, start, len);
  return bits[start] ? v - Math.pow(2, len) : v; // two's complement
}

function str6(bits, start, len) {
  let out = '';
  for (let i = start; i + 6 <= start + len; i += 6) {
    out += SIXBIT[u(bits, i, 6)];
  }
  return out.replace(/@.*$/, '').trim();
}

// Decode an AIS message from payload bits (MSB-first). Returns null when the
// type isn't one we handle.
function decodeAisBits(bits) {
  if (bits.length < 38) return null;
  const type = u(bits, 0, 6);
  const mmsi = u(bits, 8, 30);
  const out = { type, mmsi };

  if (type >= 1 && type <= 3) {
    // class A position report
    out.status = u(bits, 38, 4);
    const sog = u(bits, 50, 10);
    if (sog !== 1023) out.sog = sog / 10;
    const lon = s(bits, 61, 28);
    const lat = s(bits, 89, 27);
    if (lon !== 0x6791ac0) out.lon = lon / 600000;
    if (lat !== 0x3412140) out.lat = lat / 600000;
    const cog = u(bits, 116, 12);
    if (cog !== 3600) out.cog = cog / 10;
    const hdg = u(bits, 128, 9);
    if (hdg !== 511) out.heading = hdg;
    return out;
  }
  if (type === 18 || type === 19) {
    // class B position report
    const sog = u(bits, 46, 10);
    if (sog !== 1023) out.sog = sog / 10;
    const lon = s(bits, 57, 28);
    const lat = s(bits, 85, 27);
    if (lon !== 0x6791ac0) out.lon = lon / 600000;
    if (lat !== 0x3412140) out.lat = lat / 600000;
    const cog = u(bits, 112, 12);
    if (cog !== 3600) out.cog = cog / 10;
    const hdg = u(bits, 124, 9);
    if (hdg !== 511) out.heading = hdg;
    if (type === 19 && bits.length >= 263) out.name = str6(bits, 143, 120);
    return out;
  }
  if (type === 5 && bits.length >= 240) {
    // class A static & voyage data
    out.callsign = str6(bits, 70, 42);
    out.name = str6(bits, 112, 120);
    out.shiptype = u(bits, 232, 8);
    return out;
  }
  if (type === 24) {
    const part = u(bits, 38, 2);
    if (part === 0 && bits.length >= 160) {
      out.name = str6(bits, 40, 120);
      return out;
    }
    return null;
  }
  return null;
}

// Decode the 6-bit "armored" payload of an AIVDM sentence (for tests and for
// possible future network feeds).
function decodeAisPayload(payload) {
  const bits = [];
  for (const ch of payload) {
    let v = ch.charCodeAt(0) - 48;
    if (v > 40) v -= 8;
    for (let i = 5; i >= 0; i--) bits.push((v >> i) & 1);
  }
  return decodeAisBits(bits);
}

// ---- HDLC deframer over an NRZI-decoded bit stream ----
// AIS frames: 0x7E flag, payload with bit stuffing (a 0 inserted after five
// consecutive 1s), 16-bit FCS (X.25), 0x7E flag. Because stuffing guarantees
// data never contains six consecutive 1s, the flag pattern is unambiguous in
// the raw stream — so we collect raw bits between flags and destuff offline.
class AisDeframer {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.window = 0; // last 8 raw bits, for flag detection
    this.collecting = false;
    this.raw = [];
  }

  pushBit(bit) {
    this.window = ((this.window << 1) | bit) & 0xff;
    if (this.window === 0x7e) {
      // the flag's first 7 bits are sitting at the end of the raw buffer
      if (this.collecting && this.raw.length > 7) this._process(this.raw.slice(0, -7));
      this.collecting = true;
      this.raw = [];
      return;
    }
    if (!this.collecting) return;
    this.raw.push(bit);
    if (this.raw.length > 1500) {
      this.collecting = false; // runaway without a closing flag
      this.raw = [];
    }
  }

  _process(rawBits) {
    // destuff: drop the 0 that follows five consecutive 1s
    const bits = [];
    let ones = 0;
    for (const b of rawBits) {
      if (ones === 5) {
        ones = 0;
        if (b === 1) return; // six ones outside a flag: corrupt
        continue; // stuffed zero dropped
      }
      if (b === 1) ones++;
      else ones = 0;
      bits.push(b);
    }
    if (bits.length < 40 + 16 || bits.length % 8 !== 0) return;
    const bytes = bitsToBytesLsbFirst(bits);
    const fcs = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
    if (crc16(bytes.slice(0, -2)) !== fcs) return;
    // octets were sent LSB-first, so LSB-first assembly recovered the octet
    // values; the AIS bit string then reads each octet MSB-first
    const msgBits = [];
    for (const b of bytes.slice(0, -2)) {
      for (let i = 7; i >= 0; i--) msgBits.push((b >> i) & 1);
    }
    const msg = decodeAisBits(msgBits);
    if (msg) this.onMessage(msg);
  }
}

// ---- sample slicer (9600 baud from FM audio) + NRZI decode ----
class AisSlicer {
  constructor(sampleRate, onMessage) {
    this.spb = sampleRate / 9600;
    this.phase = 0;
    this.lastSign = 1;
    this.dc = 0;
    this.lastSymbol = 0;
    this.deframer = new AisDeframer(onMessage);
    // polarity of the FM discriminator is transmitter/receiver dependent;
    // NRZI (transition = 0) makes decoding polarity-independent anyway.
  }

  pushSamples(samples) {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      this.dc += (v - this.dc) * 0.002;
      const sign = v - this.dc >= 0 ? 1 : 0;
      if (sign !== this.lastSign) {
        this.phase += (this.spb / 2 - this.phase) * 0.5;
        this.lastSign = sign;
      }
      this.phase += 1;
      if (this.phase >= this.spb) {
        this.phase -= this.spb;
        // NRZI: a transition encodes 0, no transition encodes 1
        const bit = sign === this.lastSymbol ? 1 : 0;
        this.lastSymbol = sign;
        this.deframer.pushBit(bit);
      }
    }
  }
}

// Build a raw HDLC bit stream for a message (tests): payload bytes -> CRC ->
// stuffing -> flags. Returns bits in wire order.
function buildFrameBits(payloadBytes) {
  const withFcs = [...payloadBytes];
  const fcs = crc16(payloadBytes);
  withFcs.push(fcs & 0xff, (fcs >> 8) & 0xff);
  const raw = [];
  for (const b of withFcs) {
    for (let i = 0; i < 8; i++) raw.push((b >> i) & 1);
  }
  const stuffed = [];
  let ones = 0;
  for (const bit of raw) {
    stuffed.push(bit);
    if (bit === 1) {
      if (++ones === 5) {
        stuffed.push(0);
        ones = 0;
      }
    } else {
      ones = 0;
    }
  }
  const flag = [0, 1, 1, 1, 1, 1, 1, 0];
  return [...flag, ...stuffed, ...flag];
}

module.exports = {
  AisSlicer,
  AisDeframer,
  decodeAisPayload,
  decodeAisBits,
  crc16,
  buildFrameBits,
};
