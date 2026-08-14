'use strict';
// Demo spectrum source: synthetic sweeps of the 433 MHz ISM band — a noise
// floor with a handful of carriers, one of them slowly drifting, plus the
// occasional wideband sensor burst.
const { EventEmitter } = require('events');

class DemoSpectrumSource extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._tick = null;
    this.t = 0;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this.t = 0;
    this.emit('status', { state: 'running', demo: true, mode: 'spectrum', submode: 'sweep' });
    this.emit('log', { stream: 'app', line: 'demo mode: sweeping 433–435 MHz (synthetic spectrum, no SDR in use)' });
    this._tick = setInterval(() => this._sweep(), 1000);
    return { ok: true };
  }

  _sweep() {
    this.t++;
    const startHz = 433e6;
    const stopHz = 435e6;
    const stepHz = 10e3;
    const n = Math.round((stopHz - startHz) / stepHz);
    const dbs = new Array(n);
    const carriers = [
      { hz: 433.92e6, amp: 28, w: 3 }, // ISM centre, busy
      { hz: 433.42e6 + Math.sin(this.t / 30) * 60e3, amp: 18, w: 2 }, // drifter
      { hz: 434.42e6, amp: 12, w: 1.5 },
      { hz: 433.2e6, amp: this.t % 17 < 3 ? 22 : 0, w: 5 }, // bursty sensor
    ];
    for (let i = 0; i < n; i++) {
      const hz = startHz + i * stepHz;
      let db = -32 + Math.random() * 2.5; // noise floor
      for (const c of carriers) {
        if (!c.amp) continue;
        const d = (hz - c.hz) / (c.w * stepHz);
        db += c.amp * Math.exp(-d * d);
      }
      dbs[i] = +db.toFixed(2);
    }
    this.emit('spectrum', { startHz, stopHz, stepHz, dbs, time: Date.now() });
  }

  startListen() {
    return { ok: false, error: 'listening is not available in demo mode' };
  }

  stopListen() {
    return { ok: true };
  }

  stop() {
    this.running = false;
    clearInterval(this._tick);
    this._tick = null;
    this.emit('log', { stream: 'app', line: 'demo spectrum stopped' });
    this.emit('status', { state: 'stopped', demo: true, mode: 'spectrum' });
    return { ok: true };
  }
}

module.exports = { DemoSpectrumSource };
