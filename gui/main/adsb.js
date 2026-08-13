'use strict';
// ADS-B source: runs rtl_adsb (bundled with the app, from the rtl-sdr tools),
// decodes its raw Mode S frames and aggregates them into per-aircraft state.
// Emits 'aircraft' snapshots at 1 Hz plus the usual 'log'/'status' streams.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { decodeFrame, cprDecodeGlobal } = require('./modes');

const CPR_PAIR_MAX_AGE = 10000; // ms an even/odd frame pair stays usable
const AIRCRAFT_TTL = 90000; // drop aircraft not heard for this long
const TRAIL_MAX = 120; // positions kept per aircraft

function candidateBinaries() {
  const exe = process.platform === 'win32' ? 'rtl_adsb.exe' : 'rtl_adsb';
  return [
    path.join(process.resourcesPath || '.', 'rtl_433', exe),
    path.join(__dirname, '..', 'vendor', 'rtl_433', exe),
    exe, // PATH
  ];
}

function resolveBinary(configured) {
  if (configured && configured.trim()) return configured.trim();
  for (const c of candidateBinaries()) {
    if (c.includes(path.sep) && fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'rtl_adsb.exe' : 'rtl_adsb';
}

class AdsbSource extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.stopping = false;
    this.aircraft = new Map(); // icao -> state
    this.msgCount = 0;
    this._buf = '';
    this._tick = null;
    this._recentMsgs = [];
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveBinary(settings.adsbPath);
    const args = [];
    if (settings.adsbDevice) args.push('-d', String(settings.adsbDevice));
    if (settings.adsbGain !== '' && settings.adsbGain != null) args.push('-g', String(settings.adsbGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));

    this.stopping = false;
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.child = child;
    this.aircraft.clear();
    this.msgCount = 0;
    this.emit('status', { state: 'running', pid: child.pid, binary: bin, args, mode: 'adsb' });
    this.emit('log', { stream: 'app', line: `$ ${bin} ${args.join(' ')}` });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, idx).trim();
        this._buf = this._buf.slice(idx + 1);
        // rtl_adsb frames look like *8d4840d6202cc371c32ce0576098;
        if (line.startsWith('*') && line.endsWith(';')) {
          this.ingestFrame(line.slice(1, -1));
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.emit('log', { stream: 'stderr', line });
      }
    });

    child.on('error', (e) => {
      this.child = null;
      const hint =
        e.code === 'ENOENT'
          ? `rtl_adsb binary not found ("${bin}"). It ships with the app; set a custom path in Settings if needed.`
          : e.message;
      this.emit('status', { state: 'error', error: hint, mode: 'adsb' });
      this.emit('log', { stream: 'app', line: `error: ${hint}` });
    });

    child.on('exit', (code, signal) => {
      const wasStopping = this.stopping;
      this.child = null;
      this.stopping = false;
      this._stopTick();
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.emit('log', { stream: 'app', line: `rtl_adsb stopped (${why})` });
      this.emit('status', {
        state: wasStopping || code === 0 ? 'stopped' : 'error',
        error: wasStopping || code === 0 ? undefined : `rtl_adsb exited unexpectedly (${why})`,
        mode: 'adsb',
      });
    });

    this._startTick();
    return { ok: true, pid: child.pid };
  }

  // Decode one raw hex frame and fold it into the aircraft table.
  ingestFrame(hex) {
    const d = decodeFrame(hex);
    if (!d) return;
    this.msgCount++;
    this._recentMsgs.push(Date.now());
    if (this._recentMsgs.length > 2000) this._recentMsgs.splice(0, 500);

    const now = Date.now();
    let ac = this.aircraft.get(d.icao);
    if (!ac) {
      ac = { icao: d.icao, firstSeen: now, msgs: 0, trail: [] };
      this.aircraft.set(d.icao, ac);
    }
    ac.msgs++;
    ac.lastSeen = now;

    if (d.callsign) ac.callsign = d.callsign;
    if (d.altitude != null) ac.altitude = d.altitude;
    if (d.gs != null) ac.gs = d.gs;
    if (d.track != null) ac.track = d.track;
    if (d.vr != null) ac.vr = d.vr;

    if (d.position) {
      const frame = { latCpr: d.latCpr, lonCpr: d.lonCpr, t: now };
      if (d.oddFlag) ac.cprOdd = frame;
      else ac.cprEven = frame;
      if (ac.cprEven && ac.cprOdd && Math.abs(ac.cprEven.t - ac.cprOdd.t) < CPR_PAIR_MAX_AGE) {
        const pos = cprDecodeGlobal(ac.cprEven, ac.cprOdd, ac.cprOdd.t > ac.cprEven.t);
        if (pos) {
          ac.lat = pos.lat;
          ac.lon = pos.lon;
          ac.posTime = now;
          const last = ac.trail[ac.trail.length - 1];
          if (!last || Math.abs(last[0] - pos.lat) > 1e-5 || Math.abs(last[1] - pos.lon) > 1e-5) {
            ac.trail.push([pos.lat, pos.lon]);
            if (ac.trail.length > TRAIL_MAX) ac.trail.splice(0, ac.trail.length - TRAIL_MAX);
          }
        }
      }
    }
  }

  snapshot() {
    const now = Date.now();
    for (const [icao, ac] of this.aircraft) {
      if (now - ac.lastSeen > AIRCRAFT_TTL) this.aircraft.delete(icao);
    }
    const cutoff = now - 60000;
    return {
      aircraft: [...this.aircraft.values()].map((ac) => ({
        icao: ac.icao,
        callsign: ac.callsign,
        lat: ac.lat,
        lon: ac.lon,
        altitude: ac.altitude,
        gs: ac.gs,
        track: ac.track,
        vr: ac.vr,
        msgs: ac.msgs,
        lastSeen: ac.lastSeen,
        trail: ac.trail,
      })),
      totalMsgs: this.msgCount,
      msgsPerMinute: this._recentMsgs.filter((t) => t >= cutoff).length,
    };
  }

  _startTick() {
    this._stopTick();
    this._tick = setInterval(() => this.emit('aircraft', this.snapshot()), 1000);
  }

  _stopTick() {
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
  }

  stop() {
    if (!this.child) return { ok: true };
    this.stopping = true;
    const child = this.child;
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGINT');
    } catch (e) {
      /* already gone */
    }
    setTimeout(() => {
      if (this.child === child) {
        try {
          child.kill('SIGKILL');
        } catch (e) {
          /* already gone */
        }
      }
    }, 3000);
    return { ok: true };
  }
}

module.exports = { AdsbSource, resolveBinary };
