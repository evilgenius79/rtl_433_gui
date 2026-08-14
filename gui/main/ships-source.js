'use strict';
// AIS ship source: rtl_fm on an AIS channel feeds the in-app AIS decoder;
// per-vessel state is aggregated and snapshotted at 1 Hz.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { AisSlicer } = require('./ais');
const { resolveRtlFm } = require('./pager-source');

const SAMPLE_RATE = 48000;
const SHIP_TTL = 15 * 60000; // keep vessels 15 min after last message
const TRAIL_MAX = 200;

class ShipsSource extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.stopping = false;
    this.ships = new Map(); // mmsi -> state
    this.msgCount = 0;
    this._tick = null;
    this._carry = null;
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveRtlFm(settings.rtlFmPath);
    const freq = settings.aisFreq || '161.975M';
    const args = ['-M', 'fm', '-f', String(freq), '-s', String(SAMPLE_RATE)];
    if (settings.aisDevice) args.push('-d', String(settings.aisDevice));
    if (settings.aisGain !== '' && settings.aisGain != null) args.push('-g', String(settings.aisGain));
    if (settings.ppmError) args.push('-p', String(settings.ppmError));
    args.push('-');

    this.stopping = false;
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.child = child;
    this.ships.clear();
    this.msgCount = 0;

    const slicer = new AisSlicer(SAMPLE_RATE, (m) => this._ingest(m));
    this.emit('status', { state: 'running', pid: child.pid, binary: bin, args, mode: 'ais' });
    this.emit('log', { stream: 'app', line: `$ ${bin} ${args.join(' ')}` });

    child.stdout.on('data', (buf) => {
      if (this._carry) {
        buf = Buffer.concat([this._carry, buf]);
        this._carry = null;
      }
      const usable = buf.length & ~1;
      if (usable < buf.length) this._carry = buf.subarray(usable);
      slicer.pushSamples(new Int16Array(buf.buffer, buf.byteOffset, usable / 2));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) this.emit('log', { stream: 'stderr', line });
    });
    child.on('error', (e) => {
      this.child = null;
      const hint = e.code === 'ENOENT' ? `rtl_fm binary not found ("${bin}").` : e.message;
      this.emit('status', { state: 'error', error: hint, mode: 'ais' });
    });
    child.on('exit', (code, signal) => {
      const wasStopping = this.stopping;
      this.child = null;
      this.stopping = false;
      this._stopTick();
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.emit('log', { stream: 'app', line: `rtl_fm (AIS) stopped (${why})` });
      this.emit('status', {
        state: wasStopping || code === 0 ? 'stopped' : 'error',
        error: wasStopping || code === 0 ? undefined : `rtl_fm exited unexpectedly (${why}) — is the SDR in use by another mode?`,
        mode: 'ais',
      });
    });

    this._tick = setInterval(() => this.emit('ships', this.snapshot()), 1000);
    return { ok: true, pid: child.pid };
  }

  _ingest(m) {
    this.msgCount++;
    const now = Date.now();
    let ship = this.ships.get(m.mmsi);
    if (!ship) {
      ship = { mmsi: m.mmsi, firstSeen: now, msgs: 0, trail: [] };
      this.ships.set(m.mmsi, ship);
    }
    ship.msgs++;
    ship.lastSeen = now;
    if (m.name) ship.name = m.name;
    if (m.callsign) ship.callsign = m.callsign;
    if (m.shiptype != null) ship.shiptype = m.shiptype;
    if (m.sog != null) ship.sog = m.sog;
    if (m.cog != null) ship.cog = m.cog;
    if (m.heading != null) ship.heading = m.heading;
    if (m.lat != null && m.lon != null && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180) {
      ship.lat = m.lat;
      ship.lon = m.lon;
      const last = ship.trail[ship.trail.length - 1];
      if (!last || Math.abs(last[0] - m.lat) > 1e-5 || Math.abs(last[1] - m.lon) > 1e-5) {
        ship.trail.push([m.lat, m.lon]);
        if (ship.trail.length > TRAIL_MAX) ship.trail.splice(0, ship.trail.length - TRAIL_MAX);
      }
    }
  }

  snapshot() {
    const now = Date.now();
    for (const [mmsi, s] of this.ships) {
      if (now - s.lastSeen > SHIP_TTL) this.ships.delete(mmsi);
    }
    return {
      ships: [...this.ships.values()],
      totalMsgs: this.msgCount,
    };
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

module.exports = { ShipsSource };
