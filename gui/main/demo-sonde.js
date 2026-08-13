'use strict';
// Demo radiosonde source: one simulated RS41 flight — ascent, burst, descent,
// landing, then a fresh launch — emitting the same snapshots as SondeSource.
const { EventEmitter } = require('events');

const LAUNCH = { lat: 52.21, lon: 0.105 }; // launch site for the simulated flights
const TRAIL_MAX = 600;

function jitter(v, amt) {
  return v + (Math.random() * 2 - 1) * amt;
}

class DemoSondeSource extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._tick = null;
  }

  get isRunning() {
    return this.running;
  }

  _newFlight() {
    this.sonde = {
      id: 'S' + Math.floor(1000000 + Math.random() * 9000000),
      type: 'RS41-SG',
      frame: 100,
      lat: jitter(LAUNCH.lat, 0.03),
      lon: jitter(LAUNCH.lon, 0.03),
      alt: 150,
      vel_v: 5.2,
      vel_h: 8,
      heading: 80 + Math.random() * 40,
      temp: 14,
      humidity: 70,
      batt: 2.9,
      sats: 9,
      burst: 30000 + Math.random() * 4000,
      phase: 'ascent',
    };
    this.trail = [];
    this.frames = 0;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this._newFlight();
    this.emit('status', { state: 'running', demo: true, mode: 'sonde' });
    this.emit('log', { stream: 'app', line: 'demo mode: simulating an RS41 radiosonde flight at 402.700MHz (no SDR in use)' });
    this._tick = setInterval(() => this._step(), 1000);
    return { ok: true };
  }

  _step() {
    const s = this.sonde;
    this.frames++;
    s.frame++;

    if (s.phase === 'ascent') {
      s.vel_v = jitter(5.2, 0.6);
      if (s.alt >= s.burst) {
        s.phase = 'descent';
        this.emit('log', { stream: 'app', line: `demo sonde ${s.id}: burst at ${Math.round(s.alt)} m` });
      }
    } else if (s.phase === 'descent') {
      // parachute descent: fast up high, slowing in denser air
      s.vel_v = -(6 + 14 * Math.min(1, s.alt / 30000)) + jitter(0, 0.8);
      if (s.alt <= 250) {
        s.phase = 'landed';
        s.vel_v = 0;
        s.vel_h = 0;
        this.emit('log', { stream: 'app', line: `demo sonde ${s.id}: landed — launching a new flight shortly` });
        setTimeout(() => {
          if (this.running) this._newFlight();
        }, 12000);
      }
    }
    s.alt = Math.max(120, s.alt + s.vel_v);
    // wind: speed and direction vary with altitude bands
    if (s.phase !== 'landed') {
      const windSpeed = 6 + 22 * Math.min(1, s.alt / 12000);
      s.vel_h = jitter(windSpeed, 1.5);
      s.heading = (s.heading + jitter(0.35, 0.5) + 360) % 360;
      const dist = s.vel_h / 111320;
      const rad = (s.heading * Math.PI) / 180;
      s.lat += Math.cos(rad) * dist;
      s.lon += (Math.sin(rad) * dist) / Math.cos((s.lat * Math.PI) / 180);
      this.trail.push([s.lat, s.lon, s.alt]);
      if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
    }
    // ISA-ish temperature, drifting battery
    s.temp = +(15 - 6.5 * (s.alt / 1000) + jitter(0, 0.4)).toFixed(1);
    if (s.temp < -62) s.temp = jitter(-62, 2);
    s.humidity = Math.max(1, Math.min(100, jitter(s.humidity, 2)));
    s.batt = Math.max(2.2, s.batt - 0.0001);
    s.lastFrameTime = Date.now();

    this.emit('sonde', this.snapshot());
  }

  snapshot() {
    const { burst, phase, ...pub } = this.sonde;
    return { sonde: { ...pub, phase }, trail: this.trail, frames: this.frames };
  }

  stop() {
    this.running = false;
    clearInterval(this._tick);
    this._tick = null;
    this.emit('log', { stream: 'app', line: 'demo sonde source stopped' });
    this.emit('status', { state: 'stopped', demo: true, mode: 'sonde' });
    return { ok: true };
  }
}

module.exports = { DemoSondeSource };
