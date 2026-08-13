'use strict';
// Demo ADS-B source: simulated aircraft orbiting and transiting around a
// metro area, emitting the same 1 Hz snapshots as the real AdsbSource.
const { EventEmitter } = require('events');

const CENTER = { lat: 51.47, lon: -0.4543 }; // around EGLL for plausible traffic
const TRAIL_MAX = 120;

const FLEET = [
  { callsign: 'BAW117', icao: '400F01', alt: 12000, gs: 285, track: 268, vr: -1200, kind: 'transit' },
  { callsign: 'SHT4M', icao: '400A23', alt: 6500, gs: 230, track: 92, vr: 1800, kind: 'transit' },
  { callsign: 'DLH441', icao: '3C6589', alt: 37000, gs: 465, track: 121, vr: 0, kind: 'transit' },
  { callsign: 'AFR90MD', icao: '392AE4', alt: 34000, gs: 448, track: 165, vr: 0, kind: 'transit' },
  { callsign: 'EZY52UT', icao: '406B72', alt: 21000, gs: 390, track: 12, vr: 2200, kind: 'transit' },
  { callsign: 'RYR7KX', icao: '4CA2D1', alt: 8200, gs: 265, track: 205, vr: -1600, kind: 'transit' },
  { callsign: 'VIR25B', icao: '400802', alt: 3900, gs: 190, track: 270, vr: -900, kind: 'approach' },
  { callsign: 'UAE29', icao: '89642A', alt: 41000, gs: 480, track: 305, vr: 0, kind: 'transit' },
];

function jitter(v, amt) {
  return v + (Math.random() * 2 - 1) * amt;
}

class DemoAdsbSource extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._tick = null;
    this.aircraft = [];
    this.msgCount = 0;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this.msgCount = 0;
    // scatter the fleet around the center
    this.aircraft = FLEET.map((f) => ({
      ...f,
      lat: CENTER.lat + (Math.random() * 2 - 1) * 0.55,
      lon: CENTER.lon + (Math.random() * 2 - 1) * 0.9,
      msgs: 0,
      lastSeen: Date.now(),
      trail: [],
    }));
    this.emit('status', { state: 'running', demo: true, mode: 'adsb' });
    this.emit('log', { stream: 'app', line: 'demo mode: simulating ADS-B traffic at 1090 MHz (no SDR in use)' });
    this._tick = setInterval(() => this._step(), 1000);
    return { ok: true };
  }

  _step() {
    const now = Date.now();
    for (const ac of this.aircraft) {
      // move along track: knots -> degrees per second
      const dist = (ac.gs * 0.514444) / 111320; // deg lat per second
      const rad = (ac.track * Math.PI) / 180;
      ac.lat += Math.cos(rad) * dist;
      ac.lon += (Math.sin(rad) * dist) / Math.cos((ac.lat * Math.PI) / 180);
      ac.track = (ac.track + jitter(ac.kind === 'approach' ? 0.8 : 0.15, 0.4) + 360) % 360;
      ac.alt = Math.max(500, ac.alt + ac.vr / 60 + jitter(0, 8));
      ac.gs = Math.max(140, ac.gs + jitter(0, 1.5));
      if (ac.vr !== 0 && (ac.alt < 1500 || ac.alt > 42500)) ac.vr = -ac.vr; // bounce
      // wrap aircraft that drift too far back to the other side
      if (Math.abs(ac.lat - CENTER.lat) > 0.9) ac.lat = CENTER.lat - (ac.lat - CENTER.lat) * 0.95;
      if (Math.abs(ac.lon - CENTER.lon) > 1.4) ac.lon = CENTER.lon - (ac.lon - CENTER.lon) * 0.95;

      ac.msgs += 1 + Math.floor(Math.random() * 3);
      this.msgCount += 2;
      ac.lastSeen = now;
      ac.trail.push([ac.lat, ac.lon]);
      if (ac.trail.length > TRAIL_MAX) ac.trail.splice(0, ac.trail.length - TRAIL_MAX);
    }
    this.emit('aircraft', this.snapshot());
  }

  snapshot() {
    return {
      aircraft: this.aircraft.map((ac) => ({
        icao: ac.icao,
        callsign: ac.callsign,
        lat: ac.lat,
        lon: ac.lon,
        altitude: Math.round(ac.alt),
        gs: Math.round(ac.gs),
        track: Math.round(ac.track),
        vr: ac.vr,
        msgs: ac.msgs,
        lastSeen: ac.lastSeen,
        trail: ac.trail,
      })),
      totalMsgs: this.msgCount,
      msgsPerMinute: this.running ? this.aircraft.length * 120 : 0,
    };
  }

  stop() {
    this.running = false;
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
    this.emit('log', { stream: 'app', line: 'demo ADS-B stopped' });
    this.emit('status', { state: 'stopped', demo: true, mode: 'adsb' });
    return { ok: true };
  }
}

module.exports = { DemoAdsbSource };
