'use strict';
// Demo mode: synthesizes a realistic stream of rtl_433 JSON events so the GUI
// can be explored without an SDR dongle or the rtl_433 binary installed.
// Each virtual device transmits on its own period with slowly drifting values.
const { EventEmitter } = require('events');

// RTL433_DEMO_SPEED=8 makes virtual devices transmit 8x faster (screenshots/CI)
const SPEED = Math.max(0.1, Number(process.env.RTL433_DEMO_SPEED) || 1);

function jitter(v, amt) {
  return v + (Math.random() * 2 - 1) * amt;
}

function walk(dev, key, min, max, step) {
  dev._state[key] = Math.min(max, Math.max(min, (dev._state[key] ?? (min + max) / 2) + (Math.random() * 2 - 1) * step));
  return dev._state[key];
}

const DEVICES = [
  {
    period: 16,
    base: { model: 'Acurite-Tower', id: 5876, channel: 'A', protocol: 40, mod: 'ASK', freq: 433.93 },
    fields: (d) => ({
      battery_ok: 1,
      temperature_C: +walk(d, 't', 20.5, 24.5, 0.15).toFixed(1),
      humidity: Math.round(walk(d, 'h', 38, 52, 0.8)),
    }),
  },
  {
    period: 57,
    base: { model: 'LaCrosse-TX141THBv2', id: 133, channel: 0, protocol: 73, mod: 'ASK', freq: 433.92 },
    fields: (d) => ({
      battery_ok: 1,
      temperature_C: +walk(d, 't', -2.0, 4.0, 0.2).toFixed(1),
      humidity: Math.round(walk(d, 'h', 68, 88, 1.0)),
      test: 'No',
    }),
  },
  {
    period: 79,
    base: { model: 'Nexus-TH', id: 42, channel: 2, protocol: 19, mod: 'ASK', freq: 433.89 },
    fields: (d) => ({
      battery_ok: 0, // low battery — exercises the warning UI
      temperature_C: +walk(d, 't', 17.0, 19.5, 0.1).toFixed(1),
      humidity: Math.round(walk(d, 'h', 55, 65, 0.6)),
    }),
  },
  {
    period: 31,
    base: { model: 'Fineoffset-WH51', id: '00d2c4', protocol: 142, mod: 'FSK', freq: 433.92 },
    fields: (d) => ({
      battery_ok: 1,
      battery_mV: 1500,
      moisture: Math.round(walk(d, 'm', 22, 44, 1.2)),
      boost: 0,
      ad_raw: 210,
    }),
  },
  {
    period: 18,
    base: { model: 'Acurite-5n1', subtype: 56, id: 1234, channel: 'B', protocol: 40, mod: 'ASK', freq: 433.94 },
    fields: (d) => ({
      battery_ok: 1,
      wind_avg_km_h: +walk(d, 'w', 0, 26, 2.5).toFixed(1),
      wind_dir_deg: Math.round(walk(d, 'wd', 0, 359, 22)),
      rain_mm: +( (d._state.rain = (d._state.rain ?? 132.4) + (Math.random() < 0.06 ? 0.25 : 0)) ).toFixed(2),
      temperature_C: +walk(d, 't', 19.0, 23.0, 0.12).toFixed(1),
      humidity: Math.round(walk(d, 'h', 45, 60, 0.7)),
    }),
  },
  {
    period: 132,
    base: { model: 'Oregon-THGR122N', id: 195, channel: 1, protocol: 12, mod: 'ASK', freq: 433.92 },
    fields: (d) => ({
      battery_ok: 1,
      temperature_C: +walk(d, 't', 21.0, 23.0, 0.1).toFixed(1),
      humidity: Math.round(walk(d, 'h', 40, 48, 0.5)),
    }),
  },
  {
    period: 210,
    minPeriod: 45,
    random: true, // event-driven: door/window sensor
    base: { model: 'Honeywell-Security', id: 217143, channel: 8, protocol: 70, mod: 'ASK', freq: 433.92 },
    fields: (d) => {
      d._state.open = !d._state.open;
      return {
        event: 128,
        state: d._state.open ? 'open' : 'closed',
        contact_open: d._state.open ? 1 : 0,
        reed_open: d._state.open ? 1 : 0,
        alarm: 0,
        tamper: 0,
        battery_ok: 1,
        heartbeat: 0,
      };
    },
  },
  {
    period: 340,
    random: true, // passing car
    base: { model: 'Schrader', type: 'TPMS', id: '03AB56E1', protocol: 60, mod: 'ASK', freq: 433.92 },
    fields: (d) => ({
      flags: '03',
      pressure_kPa: +jitter(220, 6).toFixed(1),
      temperature_C: Math.round(jitter(28, 3)),
    }),
  },
];

class DemoSource extends EventEmitter {
  constructor() {
    super();
    this.timers = [];
    this.running = false;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this.emit('status', { state: 'running', demo: true });
    this.emit('log', { stream: 'app', line: 'demo mode: replaying simulated sensor traffic (no SDR in use)' });
    this.emit('log', { stream: 'stderr', line: 'rtl_433 demo source active. Tuned to 433.920MHz.' });

    for (const dev of DEVICES) {
      dev._state = {};
      const schedule = () => {
        if (!this.running) return;
        const base = dev.random
          ? (dev.minPeriod || 30) + Math.random() * dev.period
          : jitter(dev.period, dev.period * 0.05);
        const t = setTimeout(() => {
          this._emitFrom(dev);
          schedule();
        }, Math.max(400, (base * 1000) / SPEED));
        this.timers.push(t);
      };
      // stagger initial transmissions across the first ~8 s so the UI fills fast
      const t0 = setTimeout(() => {
        this._emitFrom(dev);
        schedule();
      }, 300 + Math.random() * 8000);
      this.timers.push(t0);
    }
    return { ok: true };
  }

  _emitFrom(dev) {
    if (!this.running) return;
    const rssi = jitter(-7, 3.5);
    const evt = {
      time: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      ...dev.base,
      ...dev.fields(dev),
      mic: 'CHECKSUM',
      mod: dev.base.mod,
      freq: +jitter(dev.base.freq, 0.005).toFixed(3),
      rssi: +rssi.toFixed(1),
      snr: +jitter(18, 4).toFixed(1),
      noise: +(rssi - 20).toFixed(1),
    };
    delete evt.protocol; // re-add ordered below
    evt.protocol = dev.base.protocol;
    this.emit('event', evt);
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.emit('log', { stream: 'app', line: 'demo mode stopped' });
    this.emit('status', { state: 'stopped', demo: true });
    return { ok: true };
  }
}

module.exports = { DemoSource };
