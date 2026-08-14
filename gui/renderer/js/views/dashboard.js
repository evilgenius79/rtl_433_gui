// Dashboard: stat tiles + live device cards.
import { store } from '../state.js';
import {
  pickPrimary, labelOf, unitOf, fmtValue, fmtValueUnit, metricKeysOf,
  fmtAgo, fmtUptime, signalLevel, deviceTitle, esc, categorize, CATEGORIES,
} from '../format.js';
import { renderSparkline } from '../chart.js';
import { focusDevice } from './charts.js';

const root = document.getElementById('view-dashboard');
const cardEls = new Map(); // device key -> element
let lastFlash = new Map();
let categoryFilter = '';

function statTile(id, label, icon) {
  return `<div class="stat-tile">
    <div class="stat-label">${icon}${label}</div>
    <div class="stat-value" id="stat-${id}">—</div>
    <div class="stat-sub" id="stat-${id}-sub"></div>
  </div>`;
}

const ICONS = {
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4.1 12.5H11L9.5 22 19 10.5h-7z"/></svg>',
  devices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2.2"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/></svg>',
  rate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-6 4 3 6-8"/></svg>',
  uptime: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
};

export function initDashboard() {
  root.innerHTML = `
    <div class="stat-row">
      ${statTile('events', 'Events received', ICONS.events)}
      ${statTile('devices', 'Devices seen', ICONS.devices)}
      ${statTile('rate', 'Events / min', ICONS.rate)}
      ${statTile('uptime', 'Session', ICONS.uptime)}
    </div>
    <div id="dash-alerts" hidden>
      <div class="section-head">
        <h2 class="section-title">Recent alerts</h2>
        <span class="section-sub" id="dash-alert-count"></span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="dash-alerts-clear">Dismiss</button>
      </div>
      <div class="alert-strip" id="dash-alert-list"></div>
    </div>
    <div class="section-head">
      <h2 class="section-title">Live devices</h2>
      <span class="section-sub" id="dash-devcount"></span>
      <span style="flex:1"></span>
      <select id="dash-category" title="Show only one category of devices">
        <option value="">All categories</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="dash-reset" title="Forget all devices and their chart history (also clears the saved copy)">Reset data</button>
    </div>
    <div class="device-grid" id="device-grid"></div>
    <div class="empty-state" id="dash-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>
      <div class="big">No transmissions yet</div>
      <div class="small">Press <b>Start</b> to begin receiving. Devices appear here automatically as their transmissions are decoded — or flip on <b>Demo mode</b> in the sidebar to explore with simulated traffic.</div>
    </div>`;

  document.getElementById('dash-reset').addEventListener('click', () => {
    store.clearAll();
    window.toast('Device list and history cleared.');
  });
  document.getElementById('dash-category').addEventListener('change', (e) => {
    categoryFilter = e.target.value;
    renderDevices();
  });

  document.getElementById('dash-alerts-clear').addEventListener('click', () => {
    store.alerts = [];
    renderAlerts();
  });
  store.on('alerts', renderAlerts);

  store.on('devices', renderDevices);
  store.on('status', renderStats);
  setInterval(renderStats, 1000);
  setInterval(renderRelativeTimes, 5000);
  renderDevices();
  renderStats();
}

// called by the shell when this view becomes visible again
export function refreshDashboard() {
  renderDevices();
  renderStats();
  renderAlerts();
}

function renderAlerts() {
  const host = document.getElementById('dash-alerts');
  const alerts = store.alerts.slice(0, 6);
  host.hidden = alerts.length === 0;
  if (!alerts.length) return;
  document.getElementById('dash-alert-count').textContent =
    `${store.alerts.length} this session`;
  document.getElementById('dash-alert-list').innerHTML = alerts
    .map(
      (a) => `<div class="alert-row">
      <span class="alert-time">${new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      <span class="alert-name">${esc(a.rule)}</span>
      <span class="alert-detail">${esc(a.device)} — ${esc(a.detail)}</span>
    </div>`
    )
    .join('');
}

function renderStats() {
  const set = (id, v, sub) => {
    const e = document.getElementById(`stat-${id}`);
    const s = document.getElementById(`stat-${id}-sub`);
    if (e) e.textContent = v;
    if (s && sub != null) s.textContent = sub;
  };
  set('events', store.totalEvents.toLocaleString(), store.events.length ? `${store.events.length.toLocaleString()} in log` : ' ');
  set('devices', String(store.devices.size), ' ');
  set('rate', String(store.eventsPerMinute()), 'last 60 s');
  set('uptime', store.startedAt ? fmtUptime(Date.now() - store.startedAt) : '—',
    store.status.state === 'running' ? (store.status.demo ? 'demo mode' : 'receiving') : 'stopped');
}

function batteryBadge(evt) {
  if (evt.battery_ok === 0) {
    return `<span class="batt-warn" title="Sensor reports low battery">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="16" height="8" rx="2"/><path d="M20 11v2"/><path d="M6 12h4"/></svg>Low batt</span>`;
  }
  return '';
}

function cardHtml(dev) {
  const evt = dev.lastEvent;
  const primary = pickPrimary(evt);
  const chips = [];
  if (evt.id != null) chips.push(`<span class="chip" title="Device ID">ID ${esc(evt.id)}</span>`);
  if (evt.channel != null && evt.channel !== '') chips.push(`<span class="chip" title="Channel">CH ${esc(evt.channel)}</span>`);

  let primaryHtml = '';
  if (primary != null) {
    primaryHtml = `<div class="device-primary" title="${esc(labelOf(primary))}">
      <span class="val">${esc(fmtValue(primary, evt[primary]))}</span>
      <span class="unit">${esc(unitOf(primary) || labelOf(primary))}</span>
    </div>`;
  } else {
    const state = evt.state || evt.event || evt.code || '—';
    primaryHtml = `<div class="device-primary"><span class="val" style="font-size:20px">${esc(String(state).slice(0, 18))}</span></div>`;
  }

  const secondary = metricKeysOf(evt)
    .filter((k) => k !== primary)
    .slice(0, 3)
    .map((k) => `<div class="kv"><span class="k">${esc(labelOf(k))}</span><span class="v">${esc(fmtValueUnit(k, evt[k]))}</span></div>`)
    .join('');

  const lvl = signalLevel(evt.rssi);
  return `
    <div class="device-head">
      <div class="device-name" title="${esc(deviceTitle(dev))}">${esc(deviceTitle(dev))}</div>
      <div class="device-chips">${chips.join('')}</div>
    </div>
    ${primaryHtml}
    <div class="device-secondary">${secondary || '<span class="k" style="color:var(--text-3);font-size:12px">no numeric readings</span>'}</div>
    <div class="spark" data-spark></div>
    <div class="device-foot">
      <span class="sig" data-level="${lvl}" title="RSSI ${esc(evt.rssi ?? '—')} dB"><i></i><i></i><i></i><i></i></span>
      ${evt.rssi != null ? `<span>${evt.rssi.toFixed(0)} dB</span>` : ''}
      ${batteryBadge(evt)}
      <span class="spacer"></span>
      <span data-ago title="${dev.count} transmissions">${fmtAgo(Date.now() - dev.lastSeen)} · ${dev.count}×</span>
    </div>`;
}

function renderDevices() {
  if (root.hidden) return; // refreshed on view switch instead
  const grid = document.getElementById('device-grid');
  const empty = document.getElementById('dash-empty');
  const all = [...store.devices.values()].sort((a, b) => b.lastSeen - a.lastSeen);

  // category dropdown with live counts (selection preserved)
  const counts = {};
  for (const d of all) {
    const c = categorize(d.lastEvent);
    counts[c] = (counts[c] || 0) + 1;
  }
  const catSel = document.getElementById('dash-category');
  catSel.innerHTML = `<option value="">All categories (${all.length})</option>` +
    Object.entries(CATEGORIES)
      .filter(([id]) => counts[id])
      .map(([id, label]) => `<option value="${id}">${label} (${counts[id]})</option>`)
      .join('');
  catSel.value = counts[categoryFilter] ? categoryFilter : '';
  if (!counts[categoryFilter]) categoryFilter = catSel.value;

  const devs = categoryFilter ? all.filter((d) => categorize(d.lastEvent) === categoryFilter) : all;

  empty.hidden = all.length > 0;
  document.getElementById('dash-devcount').textContent = devs.length
    ? `${devs.length} device${devs.length > 1 ? 's' : ''}, sorted by last transmission`
    : all.length ? 'no devices in this category' : '';

  const seen = new Set();
  for (const dev of devs) {
    seen.add(dev.key);
    let elCard = cardEls.get(dev.key);
    if (!elCard) {
      elCard = document.createElement('div');
      elCard.className = 'device-card';
      elCard.title = 'Click to chart this device';
      const key = dev.key;
      elCard.addEventListener('click', () => {
        focusDevice(key);
        window.showView('charts');
      });
      cardEls.set(dev.key, elCard);
    }
    elCard.innerHTML = cardHtml(dev);
    grid.appendChild(elCard); // re-append reorders by recency

    // flash on fresh data
    const prev = lastFlash.get(dev.key);
    if (prev !== dev.count) {
      lastFlash.set(dev.key, dev.count);
      if (prev != null) {
        elCard.classList.remove('flash');
        void elCard.offsetWidth; // restart animation
        elCard.classList.add('flash');
      }
    }

    const primary = pickPrimary(dev.lastEvent);
    const sparkHost = elCard.querySelector('[data-spark]');
    if (primary && dev.history.get(primary)?.length > 1) {
      renderSparkline(sparkHost, dev.history.get(primary), 'var(--series-1)', null);
    }
  }
  // drop cards for devices no longer present (after clear)
  for (const [key, elCard] of cardEls) {
    if (!seen.has(key)) {
      elCard.remove();
      cardEls.delete(key);
      lastFlash.delete(key);
    }
  }
}

function renderRelativeTimes() {
  for (const [key, elCard] of cardEls) {
    const dev = store.devices.get(key);
    const span = elCard.querySelector('[data-ago]');
    if (dev && span) span.textContent = `${fmtAgo(Date.now() - dev.lastSeen)} · ${dev.count}×`;
  }
}
