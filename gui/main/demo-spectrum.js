'use strict';
// Demo spectrum source: a synthetic live waterfall of the 433 MHz ISM band —
// a noise floor with a handful of carriers, one of them slowly drifting,
// plus the occasional wideband sensor burst. Runs at the same ~20 fps as the
// real live-FFT path so demo mode feels like the real thing.
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
    this.emit('status', { state: 'running', demo: true, mode: 'spectrum', submode: 'live' });
    this.emit('log', { stream: 'app', line: 'demo mode: live waterfall of 433–435 MHz (synthetic spectrum, no SDR in use)' });
    this._tick = setInterval(() => this._sweep(), 50);
    return { ok: true };
  }

  _sweep() {
    this.t++;
    const startHz = 433e6;
    const stopHz = 435e6;
    const stepHz = 2e3;
    const n = Math.round((stopHz - startHz) / stepHz);
    const dbs = new Array(n);
    const t = this.t / 20; // seconds
    const carriers = [
      { hz: 433.92e6, amp: 28, w: 15 }, // ISM centre, busy
      { hz: 433.42e6 + Math.sin(t / 1.5) * 60e3, amp: 18, w: 10 }, // drifter
      { hz: 434.42e6, amp: 12, w: 8 },
      { hz: 433.2e6, amp: t % 17 < 3 ? 22 : 0, w: 25 }, // bursty sensor
      // short OOK pips flickering around the centre, like real key fobs
      { hz: 433.86e6 + ((this.t % 7) - 3) * 8e3, amp: this.t % 5 < 2 ? 15 : 0, w: 4 },
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
    this.emit('spectrum', { startHz, stopHz, stepHz, dbs, live: true, time: Date.now() });
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
