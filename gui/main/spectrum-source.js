'use strict';
// Spectrum mode: two sub-functions sharing one dongle.
// - Sweep: rtl_power scans a range and emits CSV rows; full sweeps are
//   assembled and pushed to the renderer for the waterfall.
// - Listen: rtl_fm streams demodulated audio (FM or AM) to the renderer for
//   playback. Starting one stops the other (same physical device).
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { resolveRtlFm } = require('./pager-source');

function resolveRtlPower(configured) {
  if (configured && configured.trim()) return configured.trim();
  const exe = process.platform === 'win32' ? 'rtl_power.exe' : 'rtl_power';
  for (const c of [
    path.join(process.resourcesPath || '.', 'rtl_433', exe),
    path.join(__dirname, '..', 'vendor', 'rtl_433', exe),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return exe;
}

class SpectrumSource extends EventEmitter {
  constructor() {
    super();
    this.child = null; // rtl_power OR rtl_fm depending on submode
    this.submode = null; // 'sweep' | 'listen'
    this.stopping = false;
    this._buf = '';
    this._sweep = null; // accumulating sweep {startHz, stopHz, stepHz, dbs[]}
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    return this._startSweep(settings);
  }

  _spawnCommon(bin, args, label, mode) {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return { error: e.message };
    }
    this.child = child;
    this.emit('log', { stream: 'app', line: `$ ${bin} ${args.join(' ')}` });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) this.emit('log', { stream: 'stderr', line });
    });
    child.on('error', (e) => {
      this.child = null;
      const hint = e.code === 'ENOENT' ? `${label} binary not found ("${bin}").` : e.message;
      this.emit('status', { state: 'error', error: hint, mode });
    });
    child.on('exit', (code, signal) => {
      const wasStopping = this.stopping;
      if (this.child !== child) return; // superseded by a submode switch
      this.child = null;
      this.submode = null;
      this.stopping = false;
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.emit('log', { stream: 'app', line: `${label} stopped (${why})` });
      this.emit('status', {
        state: wasStopping || code === 0 ? 'stopped' : 'error',
        error: wasStopping || code === 0 ? undefined : `${label} exited unexpectedly (${why}) — is the SDR in use by another mode?`,
        mode,
      });
    });
    return { child };
  }

  _startSweep(settings) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveRtlPower(settings.rtlPowerPath);
    const range = `${settings.spectrumStart || '433M'}:${settings.spectrumStop || '435M'}:${settings.spectrumStep || '10k'}`;
    const args = ['-f', range, '-i', String(settings.spectrumInterval || 1)];
    if (settings.spectrumDevice) args.push('-d', String(settings.spectrumDevice));
    if (settings.spectrumGain !== '' && settings.spectrumGain != null) args.push('-g', String(settings.spectrumGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));

    this.stopping = false;
    this._buf = '';
    this._sweep = null;
    const res = this._spawnCommon(bin, args, 'rtl_power', 'spectrum');
    if (res.error) return { ok: false, error: res.error };
    this.submode = 'sweep';
    this.emit('status', { state: 'running', pid: res.child.pid, mode: 'spectrum', submode: 'sweep' });

    res.child.stdout.setEncoding('utf8');
    res.child.stdout.on('data', (chunk) => {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, idx).trim();
        this._buf = this._buf.slice(idx + 1);
        if (line) this._ingestRow(line);
      }
    });
    return { ok: true, pid: res.child.pid };
  }

  // rtl_power CSV row: date, time, hz_low, hz_high, hz_step, samples, db, db…
  _ingestRow(line) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 7) return;
    const lo = Number(parts[2]);
    const hi = Number(parts[3]);
    const step = Number(parts[4]);
    if (!isFinite(lo) || !isFinite(hi) || !isFinite(step)) return;
    const dbs = parts.slice(6).map(Number).filter((v) => isFinite(v));

    if (!this._sweep || lo < this._sweep.nextHz - step / 2) {
      // a row starting back at the bottom begins a new sweep
      if (this._sweep && this._sweep.dbs.length) this._emitSweep();
      this._sweep = { startHz: lo, stepHz: step, dbs: [], nextHz: lo };
    }
    this._sweep.dbs.push(...dbs);
    this._sweep.nextHz = hi;
    this._sweep.stopHz = hi;
  }

  _emitSweep() {
    const s = this._sweep;
    this.emit('spectrum', {
      startHz: s.startHz,
      stopHz: s.stopHz,
      stepHz: s.stepHz,
      dbs: s.dbs,
      time: Date.now(),
    });
  }

  // ---- listen (rtl_fm audio to the renderer) ----
  startListen(settings, { freq, demod }) {
    // stop the sweep (same dongle) but keep the mode 'running'
    this._switchOff();
    const bin = resolveRtlFm(settings.rtlFmPath);
    const args = ['-M', demod === 'am' ? 'am' : 'fm', '-f', String(freq), '-s', '24000'];
    if (settings.spectrumDevice) args.push('-d', String(settings.spectrumDevice));
    if (settings.spectrumGain !== '' && settings.spectrumGain != null) args.push('-g', String(settings.spectrumGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));
    args.push('-');

    this.stopping = false;
    const res = this._spawnCommon(bin, args, 'rtl_fm (listen)', 'spectrum');
    if (res.error) return { ok: false, error: res.error };
    this.submode = 'listen';
    this.emit('status', { state: 'running', pid: res.child.pid, mode: 'spectrum', submode: 'listen', freq });

    res.child.stdout.on('data', (buf) => {
      // raw s16le mono 24 kHz chunks straight to the renderer
      this.emit('audio', buf);
    });
    return { ok: true, sampleRate: 24000 };
  }

  stopListen(settings) {
    if (this.submode !== 'listen') return { ok: true };
    this._switchOff();
    // resume sweeping on the same device
    return this._startSweep(settings);
  }

  _switchOff() {
    const child = this.child;
    this.child = null;
    this.submode = null;
    if (child) {
      try {
        child.kill(process.platform === 'win32' ? undefined : 'SIGINT');
      } catch (e) {
        /* gone */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (e) {
          /* gone */
        }
      }, 2000);
    }
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

module.exports = { SpectrumSource, resolveRtlPower };
