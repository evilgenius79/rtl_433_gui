'use strict';
// Radiosonde source: rtl_fm demodulates ~400-406 MHz; the bundled rs41mod
// (reference RS41 decoder from rs1729/RS, GPL-3) reads the audio on stdin
// and emits one JSON telemetry line per decoded frame.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { resolveRtlFm } = require('./pager-source');

const SAMPLE_RATE = 48000;
const TRAIL_MAX = 600;

// per-sonde-type decoder binary and its arguments (all from rs1729/RS)
const SONDE_DECODERS = {
  rs41: { bin: 'rs41mod', args: ['--ecc', '--crc', '--ptu', '--json'] },
  dfm09: { bin: 'dfm09mod', args: ['--ecc', '--ptu', '--json'] },
  m10: { bin: 'm10mod', args: ['--ptu', '--json'] },
  m20: { bin: 'm20mod', args: ['--ptu', '--json'] },
  imet54: { bin: 'imet54mod', args: ['--ecc', '--json'] },
};

function resolveSondeDecoder(configured, type) {
  const dec = SONDE_DECODERS[type] || SONDE_DECODERS.rs41;
  if (configured && configured.trim()) return { bin: configured.trim(), args: dec.args };
  const exe = process.platform === 'win32' ? `${dec.bin}.exe` : dec.bin;
  for (const c of [
    path.join(process.resourcesPath || '.', 'rtl_433', exe),
    path.join(__dirname, '..', 'vendor', 'rtl_433', exe),
  ]) {
    if (fs.existsSync(c)) return { bin: c, args: dec.args };
  }
  return { bin: exe, args: dec.args };
}

// rs41mod expects a WAV stream; rtl_fm emits raw s16le, so hand the decoder a
// synthetic header first (length fields maxed out — it's an endless stream).
function wavHeader(sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(0xffffffff, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits
  h.write('data', 36);
  h.writeUInt32LE(0xffffffff, 40);
  return h;
}

class SondeSource extends EventEmitter {
  constructor() {
    super();
    this.fm = null;
    this.dec = null;
    this.stopping = false;
    this.state = null; // latest telemetry
    this.trail = [];
    this.frames = 0;
    this._tick = null;
    this._buf = '';
  }

  get running() {
    return !!(this.fm || this.dec);
  }

  start(settings) {
    if (this.running) return { ok: false, error: 'already running' };
    const fmBin = resolveRtlFm(settings.rtlFmPath);
    const { bin: decBin, args: decArgsBase } = resolveSondeDecoder(settings.rs41Path, settings.sondeType || 'rs41');
    const freq = settings.sondeFreq || '402.7M';
    const fmArgs = ['-M', 'fm', '-f', String(freq), '-s', String(SAMPLE_RATE)];
    if (settings.sondeDevice) fmArgs.push('-d', String(settings.sondeDevice));
    if (settings.sondeGain !== '' && settings.sondeGain != null) fmArgs.push('-g', String(settings.sondeGain));
    if (settings.ppmError) fmArgs.push('-p', String(settings.ppmError));
    fmArgs.push('-');
    const decArgs = [...decArgsBase];

    this.stopping = false;
    this.state = null;
    this.trail = [];
    this.frames = 0;

    let fm;
    let dec;
    try {
      dec = spawn(decBin, decArgs, { windowsHide: true });
      fm = spawn(fmBin, fmArgs, { windowsHide: true });
    } catch (e) {
      if (dec) dec.kill();
      return { ok: false, error: e.message };
    }
    this.fm = fm;
    this.dec = dec;
    this.emit('status', { state: 'running', pid: fm.pid, mode: 'sonde' });
    this.emit('log', { stream: 'app', line: `$ ${fmBin} ${fmArgs.join(' ')} | ${decBin} ${decArgs.join(' ')}` });

    dec.stdin.write(wavHeader(SAMPLE_RATE));
    fm.stdout.on('data', (d) => {
      if (this.dec && this.dec.stdin.writable) this.dec.stdin.write(d);
    });
    fm.stderr.setEncoding('utf8');
    fm.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) this.emit('log', { stream: 'stderr', line });
    });

    dec.stdout.setEncoding('utf8');
    dec.stdout.on('data', (chunk) => {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, idx).trim();
        this._buf = this._buf.slice(idx + 1);
        if (line.startsWith('{')) this._ingest(line);
        else if (line) this.emit('log', { stream: 'stdout', line });
      }
    });
    dec.stderr.setEncoding('utf8');
    dec.stderr.on('data', () => {
      /* rs41mod is chatty on stderr; drop it to keep the console usable */
    });

    const onExit = (name) => (code, signal) => {
      const wasStopping = this.stopping;
      this._teardown();
      if (wasStopping) {
        this.emit('status', { state: 'stopped', mode: 'sonde' });
      } else {
        const why = signal ? `signal ${signal}` : `exit code ${code}`;
        this.emit('log', { stream: 'app', line: `${name} stopped (${why})` });
        this.emit('status', {
          state: 'error',
          error: `${name} exited unexpectedly (${why}) — is the SDR in use by another mode?`,
          mode: 'sonde',
        });
      }
    };
    fm.on('exit', onExit('rtl_fm (sonde)'));
    dec.on('error', (e) => this.emit('log', { stream: 'app', line: `rs41mod error: ${e.message}` }));
    fm.on('error', (e) => {
      const hint = e.code === 'ENOENT' ? `rtl_fm binary not found ("${fmBin}").` : e.message;
      this._teardown();
      this.emit('status', { state: 'error', error: hint, mode: 'sonde' });
    });

    this._tick = setInterval(() => this.emit('sonde', this.snapshot()), 1000);
    return { ok: true, pid: fm.pid };
  }

  _ingest(line) {
    let j;
    try {
      j = JSON.parse(line);
    } catch (e) {
      return;
    }
    this.frames++;
    // new sonde id: start a fresh track
    if (this.state && j.id && this.state.id && j.id !== this.state.id) this.trail = [];
    this.state = {
      id: j.id,
      type: j.type || j.subtype || 'RS41',
      frame: j.frame,
      datetime: j.datetime,
      lat: j.lat,
      lon: j.lon,
      alt: j.alt,
      vel_h: j.vel_h,
      vel_v: j.vel_v,
      heading: j.heading,
      sats: j.sats,
      temp: j.temp,
      humidity: j.humidity,
      batt: j.batt,
      lastFrameTime: Date.now(),
    };
    if (typeof j.lat === 'number' && typeof j.lon === 'number' && (j.lat !== 0 || j.lon !== 0)) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.abs(last[0] - j.lat) > 1e-6 || Math.abs(last[1] - j.lon) > 1e-6) {
        this.trail.push([j.lat, j.lon, j.alt]);
        if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
      }
    }
  }

  snapshot() {
    return { sonde: this.state, trail: this.trail, frames: this.frames };
  }

  _teardown() {
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
    const kill = (c) => {
      if (!c) return;
      try {
        c.kill();
      } catch (e) {
        /* gone */
      }
    };
    const fm = this.fm;
    const dec = this.dec;
    this.fm = null;
    this.dec = null;
    kill(fm);
    if (dec) {
      try {
        dec.stdin.end();
      } catch (e) {
        /* gone */
      }
      setTimeout(() => kill(dec), 1000);
    }
  }

  stop() {
    if (!this.running) return { ok: true };
    this.stopping = true;
    const fm = this.fm;
    try {
      if (fm) fm.kill(process.platform === 'win32' ? undefined : 'SIGINT');
    } catch (e) {
      /* gone */
    }
    setTimeout(() => {
      if (this.fm === fm && fm) {
        try {
          fm.kill('SIGKILL');
        } catch (e) {
          /* gone */
        }
      }
    }, 3000);
    return { ok: true };
  }
}

module.exports = { SondeSource, resolveSondeDecoder, wavHeader };
