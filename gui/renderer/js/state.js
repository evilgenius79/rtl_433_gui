// Central store: event log, per-device aggregation, console log, run status.
// Views subscribe to topics; the store batches notifications per animation frame.
import { deviceKey, metricKeysOf, parseEventTime } from './format.js';

const MAX_HISTORY_POINTS = 2000; // per device metric
const STORAGE_KEY = 'rtl433.history.v1';
const PERSIST_POINTS = 500; // per metric kept across restarts

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
    this._persistTimer = null;
    this._restore();
    window.addEventListener('pagehide', () => this.persist());
  }

  // ---- persistence: devices and their chart history survive restarts ----
  _restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!raw || !Array.isArray(raw.devices)) return;
      for (const d of raw.devices) {
        if (!d || !d.key) continue;
        this.devices.set(d.key, {
          key: d.key,
          model: d.model || 'Unknown',
          id: d.id,
          channel: d.channel,
          count: d.count || 0,
          firstSeen: d.firstSeen || Date.now(),
          lastSeen: d.lastSeen || 0,
          lastEvent: d.lastEvent || {},
          history: new Map(Object.entries(d.history || {})),
        });
      }
    } catch (e) {
      // corrupt storage: start clean
    }
  }

  persist() {
    try {
      const devices = [...this.devices.values()].map((d) => ({
        key: d.key,
        model: d.model,
        id: d.id,
        channel: d.channel,
        count: d.count,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        lastEvent: d.lastEvent,
        history: Object.fromEntries(
          [...d.history.entries()].map(([k, pts]) => [k, pts.slice(-PERSIST_POINTS)])
        ),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), devices }));
    } catch (e) {
      // quota exceeded etc. — non-fatal
    }
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persist();
    }, 15000);
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
    this._schedulePersist();
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* non-fatal */
    }
    this._notify('events');
    this._notify('devices');
  }

  clearLogs() {
    this.logs = [];
    this._notify('logs');
  }
}

export const store = new Store();
