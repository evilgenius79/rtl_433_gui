'use strict';
// Pager source: rtl_fm demodulates the pager frequency; the POCSAG slicers
// (512/1200/2400 baud, both polarities) decode messages from the audio.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { PocsagSlicer } = require('./pocsag');

const SAMPLE_RATE = 22050;

function resolveRtlFm(configured) {
  if (configured && configured.trim()) return configured.trim();
  const exe = process.platform === 'win32' ? 'rtl_fm.exe' : 'rtl_fm';
  for (const c of [
    path.join(process.resourcesPath || '.', 'rtl_433', exe),
    path.join(__dirname, '..', 'vendor', 'rtl_433', exe),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return exe;
}

class PagerSource extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.stopping = false;
    this.slicers = [];
    this.recent = []; // [text+addr, time] for de-duplication
    this.msgCount = 0;
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveRtlFm(settings.rtlFmPath);
    const freq = settings.pagerFreq || '169.65M';
    const args = ['-f', String(freq), '-s', String(SAMPLE_RATE)];
    if (settings.pagerDevice) args.push('-d', String(settings.pagerDevice));
    if (settings.pagerGain !== '' && settings.pagerGain != null) args.push('-g', String(settings.pagerGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));
    args.push('-'); // raw s16le to stdout

    this.stopping = false;
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.child = child;
    this.msgCount = 0;
    this.recent = [];

    const onMessage = (m) => {
      // the same page often decodes on both polarity paths — de-duplicate
      const key = `${m.address}|${m.text}`;
      const now = Date.now();
      this.recent = this.recent.filter(([, t]) => now - t < 3000);
      if (this.recent.some(([k]) => k === key)) return;
      this.recent.push([key, now]);
      if (!m.text) return; // tone-only page: still counts, but nothing to show
      this.msgCount++;
      this.emit('pager', { ...m, freq });
    };
    this.slicers = [512, 1200, 2400].map((baud) => new PocsagSlicer(SAMPLE_RATE, baud, onMessage));

    this.emit('status', { state: 'running', pid: child.pid, binary: bin, args, mode: 'pocsag' });
    this.emit('log', { stream: 'app', line: `$ ${bin} ${args.join(' ')}` });

    let carry = null;
    child.stdout.on('data', (buf) => {
      if (carry) {
        buf = Buffer.concat([carry, buf]);
        carry = null;
      }
      const usable = buf.length & ~1;
      if (usable < buf.length) carry = buf.subarray(usable);
      const samples = new Int16Array(buf.buffer, buf.byteOffset, usable / 2);
      for (const s of this.slicers) s.pushSamples(samples);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.emit('log', { stream: 'stderr', line });
      }
    });

    child.on('error', (e) => {
      this.child = null;
      const hint = e.code === 'ENOENT' ? `rtl_fm binary not found ("${bin}").` : e.message;
      this.emit('status', { state: 'error', error: hint, mode: 'pocsag' });
      this.emit('log', { stream: 'app', line: `error: ${hint}` });
    });

    child.on('exit', (code, signal) => {
      const wasStopping = this.stopping;
      this.child = null;
      this.stopping = false;
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.emit('log', { stream: 'app', line: `rtl_fm (pager) stopped (${why})` });
      this.emit('status', {
        state: wasStopping || code === 0 ? 'stopped' : 'error',
        error: wasStopping || code === 0 ? undefined : `rtl_fm exited unexpectedly (${why}) — is the SDR in use by another mode?`,
        mode: 'pocsag',
      });
    });

    return { ok: true, pid: child.pid };
  }

  stop() {
    if (!this.child) return { ok: true };
    this.stopping = true;
    const child = this.child;
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGINT');
    } catch (e) {
      /* gone */
    }
    setTimeout(() => {
      if (this.child === child) {
        try {
          child.kill('SIGKILL');
        } catch (e) {
          /* gone */
        }
      }
    }, 3000);
    return { ok: true };
  }
}

module.exports = { PagerSource, resolveRtlFm };
