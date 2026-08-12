// Central store: event log, per-device aggregation, console log, run status.
// Views subscribe to topics; the store batches notifications per animation frame.
import { deviceKey, metricKeysOf, parseEventTime } from './format.js';

const MAX_HISTORY_POINTS = 2000; // per device metric

class Store {
  constructor() {
    this.events = []; // newest first
    this.maxEvents = 5000;
    this.devices = new Map(); // key -> device
    this.logs = [];
    this.maxLogs = 3000;
    this.status = { state: 'stopped' };
    this.demoMode = false;
    this.settings = null;
    this.startedAt = null;
    this.totalEvents = 0;
    this._eventTimes = []; // recent arrival timestamps for rate calc
    this._subs = new Map(); // topic -> Set<fn>
    this._pending = new Set();
    this._raf = null;
  }

  on(topic, fn) {
    if (!this._subs.has(topic)) this._subs.set(topic, new Set());
    this._subs.get(topic).add(fn);
  }

  _notify(topic) {
    this._pending.add(topic);
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      const topics = [...this._pending];
      this._pending.clear();
      for (const t of topics) {
        for (const fn of this._subs.get(t) || []) fn();
      }
    });
  }

  addEvent(evt) {
    const now = Date.now();
    const ts = parseEventTime(evt);
    const rec = { evt, ts, recv: now, seq: ++this.totalEvents };
    this.events.unshift(rec);
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;

    this._eventTimes.push(now);
    if (this._eventTimes.length > 600) this._eventTimes.splice(0, 100);

    // device aggregation
    const key = deviceKey(evt);
    let dev = this.devices.get(key);
    if (!dev) {
      dev = {
        key,
        model: evt.model || 'Unknown',
        id: evt.id,
        channel: evt.channel,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        lastEvent: evt,
        history: new Map(),
      };
      this.devices.set(key, dev);
    }
    dev.count++;
    dev.lastSeen = now;
    dev.lastEvent = evt;
    for (const k of metricKeysOf(evt)) {
      let h = dev.history.get(k);
      if (!h) {
        h = [];
        dev.history.set(k, h);
      }
      h.push([ts, evt[k]]);
      if (h.length > MAX_HISTORY_POINTS) h.splice(0, h.length - MAX_HISTORY_POINTS);
    }

    this._notify('events');
    this._notify('devices');
  }

  addLog(entry) {
    this.logs.push({ ...entry, ts: Date.now() });
    if (this.logs.length > this.maxLogs) this.logs.splice(0, 500);
    this._notify('logs');
  }

  setStatus(s) {
    const wasRunning = this.status.state === 'running';
    this.status = s;
    if (s.state === 'running' && !wasRunning) this.startedAt = Date.now();
    if (s.state !== 'running') this.startedAt = null;
    this._notify('status');
  }

  eventsPerMinute() {
    const cutoff = Date.now() - 60000;
    return this._eventTimes.filter((t) => t >= cutoff).length;
  }

  clearEvents() {
    this.events = [];
    this._notify('events');
  }

  clearAll() {
    this.events = [];
    this.devices.clear();
    this.totalEvents = 0;
    this._eventTimes = [];
    this._notify('events');
    this._notify('devices');
  }

  clearLogs() {
    this.logs = [];
    this._notify('logs');
  }
}

export const store = new Store();
