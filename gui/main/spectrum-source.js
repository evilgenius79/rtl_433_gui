'use strict';
// Spectrum mode: three sub-functions sharing one dongle.
// - Live: for spans that fit the dongle's real-time bandwidth (≤2 MHz),
//   rtl_sdr streams raw IQ and we FFT it here — a fluid ~20 fps waterfall.
// - Sweep: for wider spans, rtl_power scans the range and emits CSV rows;
//   full sweeps are assembled and pushed to the renderer (~1 frame/interval).
// - Listen: rtl_fm streams demodulated audio to the renderer for playback.
// Starting one stops the others (same physical device).
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { resolveRtlFm } = require('./pager-source');
const { freqToHz } = require('./rtl433');
const { PowerSpectrum } = require('./fft');

// live-FFT tuning: 4096 bins, 4 windows averaged per frame, ~20 fps
const LIVE_SPAN_MAX = 2.0e6;
const FFT_N = 4096;
const FRAME_MS = 50;
const FRAME_AVG = 4;

// Which bins of a rate-wide FFT centered on centerHz cover [startHz, stopHz]?
// Returns null when the requested span misses the captured window entirely.
function cropRange(centerHz, rateHz, n, startHz, stopHz) {
  const binHz = rateHz / n;
  const firstHz = centerHz - rateHz / 2;
  let i0 = Math.max(0, Math.ceil((startHz - firstHz) / binHz));
  let i1 = Math.min(n - 1, Math.floor((stopHz - firstHz) / binHz));
  if (i1 < i0) return null;
  return { i0, i1, startHz: firstHz + i0 * binHz, stopHz: firstHz + i1 * binHz, stepHz: binHz };
}

// demodulator -> rtl_fm arguments and the resulting audio sample rate
const DEMODS = {
  wfm: { args: ['-M', 'wbfm', '-s', '170k', '-r', '32000'], rate: 32000 },
  nbfm: { args: ['-M', 'fm', '-s', '24000'], rate: 24000 },
  am: { args: ['-M', 'am', '-s', '24000'], rate: 24000 },
  usb: { args: ['-M', 'usb', '-s', '24000'], rate: 24000 },
  lsb: { args: ['-M', 'lsb', '-s', '24000'], rate: 24000 },
};

// packaged builds carry the tools in resourcesPath/rtl_433; a from-source
// checkout has them in gui/vendor (win) or gui/vendor-linux (linux/pi)
function toolCandidates(exe) {
  const vendorDir = process.platform === 'win32' ? 'vendor' : 'vendor-linux';
  return [
    path.join(process.resourcesPath || '.', 'rtl_433', exe),
    path.join(__dirname, '..', vendorDir, 'rtl_433', exe),
  ];
}

function resolveRtlPower(configured) {
  if (configured && configured.trim()) return configured.trim();
  const exe = process.platform === 'win32' ? 'rtl_power.exe' : 'rtl_power';
  for (const c of toolCandidates(exe)) {
    if (fs.existsSync(c)) return c;
  }
  return exe;
}

function resolveRtlSdr(configured) {
  if (configured && configured.trim()) return configured.trim();
  const exe = process.platform === 'win32' ? 'rtl_sdr.exe' : 'rtl_sdr';
  for (const c of toolCandidates(exe)) {
    if (fs.existsSync(c)) return c;
  }
  return null; // older install without the bundled rtl_sdr — fall back to sweep
}

class SpectrumSource extends EventEmitter {
  constructor() {
    super();
    this.child = null; // rtl_sdr, rtl_power or rtl_fm depending on submode
    this.submode = null; // 'live' | 'sweep' | 'listen'
    this.stopping = false;
    this._buf = '';
    this._sweep = null; // accumulating sweep {startHz, stopHz, stepHz, dbs[]}
    this._iq = null; // live-FFT state {chunks, bytes, timer, ps, acc, ...}
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    // a span the dongle can capture in one go gets the real-time FFT
    // waterfall; anything wider falls back to the rtl_power scan
    const startHz = freqToHz(settings.spectrumStart || '433M');
    const stopHz = freqToHz(settings.spectrumStop || '435M');
    const span = stopHz - startHz;
    if (isFinite(span) && span > 0 && span <= LIVE_SPAN_MAX && resolveRtlSdr(settings.rtlSdrPath)) {
      return this._startLive(settings, startHz, stopHz);
    }
    return this._startSweep(settings);
  }

  _startLive(settings, startHz, stopHz) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveRtlSdr(settings.rtlSdrPath);
    const centerHz = Math.round((startHz + stopHz) / 2);
    const rate = stopHz - startHz <= 0.9e6 ? 1024000 : 2048000;
    const args = ['-f', String(centerHz), '-s', String(rate)];
    if (settings.spectrumDevice) args.push('-d', String(settings.spectrumDevice));
    if (settings.spectrumGain !== '' && settings.spectrumGain != null) args.push('-g', String(settings.spectrumGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));
    args.push('-'); // IQ to stdout

    this.stopping = false;
    const res = this._spawnCommon(bin, args, 'rtl_sdr', 'spectrum');
    if (res.error) return { ok: false, error: res.error };
    this.submode = 'live';
    this.emit('status', { state: 'running', pid: res.child.pid, mode: 'spectrum', submode: 'live' });

    const crop = cropRange(centerHz, rate, FFT_N, startHz, stopHz);
    const windowBytes = FFT_N * 2;
    const neededBytes = windowBytes * FRAME_AVG;
    const iq = {
      chunks: [],
      bytes: 0,
      ps: new PowerSpectrum(FFT_N),
      acc: new Float64Array(FFT_N),
      crop,
      timer: null,
    };
    this._iq = iq;

    res.child.stdout.on('data', (chunk) => {
      iq.chunks.push(chunk);
      iq.bytes += chunk.length;
      // keep only the freshest ~2 frames' worth; IQ is perishable
      while (iq.bytes - iq.chunks[0].length > neededBytes * 2) {
        iq.bytes -= iq.chunks.shift().length;
      }
    });

    iq.timer = setInterval(() => {
      if (iq.bytes < neededBytes || this._iq !== iq) return;
      const buf = iq.chunks.length === 1 ? iq.chunks[0] : Buffer.concat(iq.chunks);
      iq.chunks = [buf];
      iq.bytes = buf.length;
      iq.acc.fill(0);
      // FFT the newest FRAME_AVG windows and average them
      const lastPair = Math.floor(buf.length / 2);
      for (let w = 0; w < FRAME_AVG; w++) {
        iq.ps.accumulate(buf, lastPair - FFT_N * (w + 1), iq.acc);
      }
      const dbs = iq.ps.toDb(iq.acc, FRAME_AVG);
      const c = iq.crop;
      this.emit('spectrum', {
        startHz: c ? c.startHz : centerHz - rate / 2,
        stopHz: c ? c.stopHz : centerHz + rate / 2,
        stepHz: c ? c.stepHz : rate / FFT_N,
        dbs: c ? dbs.slice(c.i0, c.i1 + 1) : dbs,
        live: true,
        time: Date.now(),
      });
      // consumed — start collecting the next frame fresh
      iq.chunks = [];
      iq.bytes = 0;
    }, FRAME_MS);
    return { ok: true, pid: res.child.pid };
  }

  _stopLiveTimer() {
    if (this._iq) {
      clearInterval(this._iq.timer);
      this._iq = null;
    }
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
      this._stopLiveTimer();
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

  // ---- listen (rtl_fm audio to the renderer): a general-coverage tuner ----
  // Any frequency the dongle supports, five demodulators, optional squelch.
  // Calling again while listening retunes (the old child is superseded).
  startListen(settings, { freq, demod, squelch }) {
    // stop the sweep or previous tune (same dongle) but keep the mode 'running'
    this._switchOff();
    const bin = resolveRtlFm(settings.rtlFmPath);
    const d = DEMODS[demod] || DEMODS.nbfm;
    const args = [...d.args, '-f', String(freq)];
    if (squelch && Number(squelch) > 0) args.push('-l', String(Number(squelch)));
    if (settings.spectrumDevice) args.push('-d', String(settings.spectrumDevice));
    if (settings.spectrumGain !== '' && settings.spectrumGain != null) args.push('-g', String(settings.spectrumGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));
    args.push('-');

    this.stopping = false;
    const res = this._spawnCommon(bin, args, 'rtl_fm (listen)', 'spectrum');
    if (res.error) return { ok: false, error: res.error };
    this.submode = 'listen';
    this.emit('status', {
      state: 'running', pid: res.child.pid, mode: 'spectrum',
      submode: 'listen', freq, demod: demod || 'nbfm', sampleRate: d.rate,
    });

    res.child.stdout.on('data', (buf) => {
      // raw s16le mono chunks straight to the renderer
      this.emit('audio', buf);
    });
    return { ok: true, sampleRate: d.rate };
  }

  stopListen(settings) {
    if (this.submode !== 'listen') return { ok: true };
    this._switchOff();
    // resume watching the band on the same device (live FFT or sweep)
    return this.start(settings);
  }

  _switchOff() {
    this._stopLiveTimer();
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
    this._stopLiveTimer();
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

module.exports = { SpectrumSource, resolveRtlPower, resolveRtlSdr, cropRange };
