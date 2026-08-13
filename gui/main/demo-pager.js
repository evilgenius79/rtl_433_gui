'use strict';
// Demo pager source: emits plausible POCSAG traffic (dispatch-style alpha
// pages plus numeric pages) without any hardware.
const { EventEmitter } = require('events');

const ALPHA_PAGES = [
  'A2 13106 Rit 84120 Ambulancepost Noord Hoofdstraat 12',
  'P 1 BDH-01 BR woning (rook gemeld) Lindenlaan 8',
  'B2 Assistentie politie Marktplein t.h.v. 22',
  'PRIO 1 AED-alarm Sporthal De Vaart, melder 06-1234',
  'GRIP-1 opschaling: stroomuitval wijk Zuid, meldkamer',
  'A1 13108 Rit 84131 MMT gealarmeerd, Ringweg 101',
  'TEST OPROEP regionale alarmering — geen actie vereist',
  'P 2 Liftopsluiting Stationsplein 3, 1 persoon',
];

const NUMERIC_PAGES = ['0612345678', '112', '84120*3', '31201234567', '911411'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

class DemoPagerSource extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._timer = null;
    this.msgCount = 0;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return { ok: false, error: 'already running' };
    this.running = true;
    this.msgCount = 0;
    this.emit('status', { state: 'running', demo: true, mode: 'pocsag' });
    this.emit('log', { stream: 'app', line: 'demo mode: simulating POCSAG pager traffic at 169.650MHz (no SDR in use)' });
    const schedule = () => {
      if (!this.running) return;
      this._timer = setTimeout(() => {
        this._emitOne();
        schedule();
      }, 2500 + Math.random() * 9000);
    };
    this._timer = setTimeout(() => {
      this._emitOne();
      schedule();
    }, 1200);
    return { ok: true };
  }

  _emitOne() {
    if (!this.running) return;
    const alpha = Math.random() < 0.75;
    this.msgCount++;
    this.emit('pager', {
      time: Date.now(),
      freq: '169.65M',
      baud: alpha ? 1200 : 512,
      address: 1000000 + Math.floor(Math.random() * 300000),
      func: alpha ? 3 : 0,
      type: alpha ? 'alpha' : 'numeric',
      text: alpha ? pick(ALPHA_PAGES) : pick(NUMERIC_PAGES),
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._timer = null;
    this.emit('log', { stream: 'app', line: 'demo pager source stopped' });
    this.emit('status', { state: 'stopped', demo: true, mode: 'pocsag' });
    return { ok: true };
  }
}

module.exports = { DemoPagerSource };
