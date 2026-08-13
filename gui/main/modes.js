'use strict';
// Minimal Mode S / ADS-B (DF17/18) decoder for frames from rtl_adsb.
// Implements CRC-24 validation, callsign, barometric altitude, CPR global
// position decoding and velocity — the fields the aircraft map needs.
// References: ICAO Annex 10 Vol IV; "The 1090 Megahertz Riddle" (mode-s.org).

const CALLSIGN_CHARSET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ#####_###############0123456789######';

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(bytes[i])) return null;
  }
  return bytes;
}

// bit index msb-first across the byte array
function bits(bytes, start, len) {
  let v = 0;
  for (let i = start; i < start + len; i++) {
    v = v * 2 + ((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  }
  return v;
}

// CRC-24 (generator 0x1FFF409, MSB-first). For DF17/18 the last 24 bits are
// the CRC of the preceding bits; remainder over data must equal them.
function crc24(bytes, numBits) {
  let crc = 0;
  for (let i = 0; i < numBits; i++) {
    crc = (crc << 1) | ((bytes[i >> 3] >> (7 - (i & 7))) & 1);
    if (crc & 0x1000000) crc ^= 0x1fff409;
  }
  for (let i = 0; i < 24; i++) {
    crc <<= 1;
    if (crc & 0x1000000) crc ^= 0x1fff409;
  }
  return crc & 0xffffff;
}

// NL(lat): number of longitude zones (ICAO CPR), NZ = 15.
function cprNL(lat) {
  if (lat === 0) return 59;
  const abs = Math.abs(lat);
  if (abs >= 87) return abs > 87 ? 1 : 2;
  const a = 1 - Math.cos(Math.PI / 30); // NZ = 15
  const b = Math.cos((Math.PI / 180) * abs) ** 2;
  const nl = Math.floor((2 * Math.PI) / Math.acos(1 - a / b));
  return Math.max(1, nl);
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

// Global CPR decode from an even/odd frame pair; `latestOdd` selects which
// frame is newer (its zone wins). Returns {lat, lon} or null.
function cprDecodeGlobal(even, odd, latestOdd) {
  const latE = even.latCpr / 131072;
  const lonE = even.lonCpr / 131072;
  const latO = odd.latCpr / 131072;
  const lonO = odd.lonCpr / 131072;

  const dLat0 = 360 / 60;
  const dLat1 = 360 / 59;
  const j = Math.floor(59 * latE - 60 * latO + 0.5);
  let lat0 = dLat0 * (mod(j, 60) + latE);
  let lat1 = dLat1 * (mod(j, 59) + latO);
  if (lat0 >= 270) lat0 -= 360;
  if (lat1 >= 270) lat1 -= 360;
  if (lat0 < -90 || lat0 > 90 || lat1 < -90 || lat1 > 90) return null;
  if (cprNL(lat0) !== cprNL(lat1)) return null; // straddling a zone boundary — wait for next pair

  const lat = latestOdd ? lat1 : lat0;
  const nl = cprNL(lat);
  const m = Math.floor(lonE * (nl - 1) - lonO * nl + 0.5);
  const ni = Math.max(latestOdd ? nl - 1 : nl, 1);
  const dLon = 360 / ni;
  let lon = dLon * (mod(m, ni) + (latestOdd ? lonO : lonE));
  if (lon >= 180) lon -= 360;
  return { lat, lon };
}

// Decode one hex frame (rtl_adsb line without '*' and ';').
// Returns null for anything that is not a CRC-valid DF17/18 extended squitter.
function decodeFrame(hex) {
  hex = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length !== 28) return null; // 112-bit extended squitter only
  const bytes = hexToBytes(hex);
  if (!bytes) return null;

  const df = bits(bytes, 0, 5);
  if (df !== 17 && df !== 18) return null;
  if (crc24(bytes, 88) !== bits(bytes, 88, 24)) return null;

  const icao = hex.slice(2, 8).toUpperCase();
  const tc = bits(bytes, 32, 5); // ME type code
  const out = { icao, df, tc };

  if (tc >= 1 && tc <= 4) {
    // aircraft identification
    let cs = '';
    for (let i = 0; i < 8; i++) {
      cs += CALLSIGN_CHARSET[bits(bytes, 40 + i * 6, 6)];
    }
    out.callsign = cs.replace(/[#_]+$/g, '').replace(/_/g, ' ').trim();
  } else if ((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) {
    // airborne position
    if (tc <= 18) {
      // barometric altitude, 12 bits with Q-bit
      const altBits = bits(bytes, 40, 12);
      const q = (altBits >> 4) & 1;
      if (q) {
        const n = ((altBits >> 5) << 4) | (altBits & 0xf);
        out.altitude = n * 25 - 1000; // feet
      }
    }
    out.oddFlag = bits(bytes, 53, 1);
    out.latCpr = bits(bytes, 54, 17);
    out.lonCpr = bits(bytes, 71, 17);
    out.position = true;
  } else if (tc === 19) {
    const subtype = bits(bytes, 37, 3);
    if (subtype === 1 || subtype === 2) {
      // ground speed from east-west / north-south components
      const sEw = bits(bytes, 45, 1);
      const vEw = bits(bytes, 46, 10) - 1;
      const sNs = bits(bytes, 56, 1);
      const vNs = bits(bytes, 57, 10) - 1;
      if (vEw >= 0 && vNs >= 0) {
        const vx = (sEw ? -vEw : vEw);
        const vy = (sNs ? -vNs : vNs);
        out.gs = Math.round(Math.sqrt(vx * vx + vy * vy) * 10) / 10; // knots
        let track = (Math.atan2(vx, vy) * 180) / Math.PI;
        if (track < 0) track += 360;
        out.track = Math.round(track * 100) / 100;
      }
    } else {
      // airspeed + magnetic heading
      if (bits(bytes, 45, 1)) out.track = (bits(bytes, 46, 10) * 360) / 1024;
      const as = bits(bytes, 57, 10);
      if (as) out.gs = as - 1;
    }
    const svr = bits(bytes, 68, 1);
    const vr = bits(bytes, 69, 9);
    if (vr) out.vr = (svr ? -1 : 1) * (vr - 1) * 64; // ft/min
  }
  return out;
}

module.exports = { decodeFrame, crc24, cprDecodeGlobal, cprNL, hexToBytes, bits };
