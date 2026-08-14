'use strict';
// Demo AIS source: simulated vessel traffic around a busy waterway.
const { EventEmitter } = require('events');

const CENTER = { lat: 51.96, lon: 4.08 }; // approaches to Rotterdam

const FLEET = [
  { mmsi: 244123456, name: 'MAAS PIONEER', sog: 11.5, cog: 82, kind: 'cargo' },
  { mmsi: 235087654, name: 'EVER FORWARD', sog: 14.2, cog: 265, kind: 'cargo' },
  { mmsi: 244555001, name: 'PILOT 7', sog: 18.0, cog: 130, kind: 'pilot' },
  { mmsi: 205333222, name: 'STELLA MARIS', sog: 8.4, cog: 300, kind: 'tanker' },
  { mmsi: 244777888, name: 'HARBOUR TUG 3', sog: 5.2, cog: 40, kind: 'tug' },
  { mmsi: 219018765, name: 'NORDIC WIND', sog: 12.8, cog: 250, kind: 'cargo' },
  { mmsi: 244000199, name: 'WATERBUS 5', sog: 9.6, cog: 170, kind: 'passenger' },
];

function jitter(v, amt) {
  return v + (Math.random() * 2 - 1) * amt;
}

class DemoShipsSource extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._tick = null;
    this.msgCount = 0;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this.msgCount = 0;
    this.ships = FLEET.map((f) => ({
      ...f,
      lat: CENTER.lat + (Math.random() * 2 - 1) * 0.09,
      lon: CENTER.lon + (Math.random() * 2 - 1) * 0.22,
      heading: f.cog,
      msgs: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      trail: [],
    }));
    this.emit('status', { state: 'running', demo: true, mode: 'ais' });
    this.emit('log', { stream: 'app', line: 'demo mode: simulating AIS vessel traffic on 161.975MHz (no SDR in use)' });
    this._tick = setInterval(() => this._step(), 1000);
    return { ok: true };
  }

  _step() {
    const now = Date.now();
    for (const s of this.ships) {
      const dist = (s.sog * 0.514444) / 111320;
      const rad = (s.cog * Math.PI) / 180;
      s.lat += Math.cos(rad) * dist;
      s.lon += (Math.sin(rad) * dist) / Math.cos((s.lat * Math.PI) / 180);
      s.cog = (s.cog + jitter(0, s.kind === 'tug' ? 2.5 : 0.6) + 360) % 360;
      s.heading = Math.round(s.cog);
      s.sog = Math.max(0.5, jitter(s.sog, 0.15));
      // keep the fleet near the harbour
      if (Math.abs(s.lat - CENTER.lat) > 0.14) s.cog = (s.cog + 180) % 360;
      if (Math.abs(s.lon - CENTER.lon) > 0.3) s.cog = (360 - s.cog) % 360;
      s.msgs += 1;
      this.msgCount += 1;
      s.lastSeen = now;
      s.trail.push([s.lat, s.lon]);
      if (s.trail.length > 200) s.trail.splice(0, s.trail.length - 200);
    }
    this.emit('ships', { ships: this.ships, totalMsgs: this.msgCount });
  }

  stop() {
    this.running = false;
    clearInterval(this._tick);
    this._tick = null;
    this.emit('log', { stream: 'app', line: 'demo ships source stopped' });
    this.emit('status', { state: 'stopped', demo: true, mode: 'ais' });
    return { ok: true };
  }
}

module.exports = { DemoShipsSource };
