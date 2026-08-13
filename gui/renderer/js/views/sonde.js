// Radiosonde view: telemetry tiles + dark map with the balloon's track.
/* global L */
import { store } from '../state.js';
import { esc, fmtAgo } from '../format.js';

const root = document.getElementById('view-sonde');

let map = null;
let marker = null;
let trailLine = null;
let userMoved = false;

const TRAIL_COLOR = '#199e70';
const BALLOON_COLOR = '#d95926';

function balloonIcon() {
  return L.divIcon({
    className: 'air-marker',
    html: `<svg viewBox="0 0 24 24" width="34" height="34" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">
      <circle cx="12" cy="8" r="6" fill="${BALLOON_COLOR}" stroke="#0f1116" stroke-width="0.8"/>
      <path d="M10.4 13.4 10 16h4l-.4-2.6" fill="${BALLOON_COLOR}" stroke="#0f1116" stroke-width="0.6"/>
      <rect x="10.4" y="16" width="3.2" height="2.6" rx="0.6" fill="#e8eaf0" stroke="#0f1116" stroke-width="0.5"/>
    </svg>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function tile(id, label) {
  return `<div class="stat-tile">
    <div class="stat-label">${label}</div>
    <div class="stat-value" id="sd-${id}">—</div>
    <div class="stat-sub" id="sd-${id}-sub"></div>
  </div>`;
}

export function initSonde() {
  root.innerHTML = `
    <div class="stat-row" style="margin-bottom:12px">
      ${tile('alt', 'Altitude')}
      ${tile('climb', 'Climb rate')}
      ${tile('speed', 'Ground speed')}
      ${tile('temp', 'Temperature')}
      ${tile('frames', 'Frames')}
    </div>
    <div class="air-layout">
      <div class="air-map-wrap">
        <div id="sd-map"></div>
        <div class="air-empty" id="sd-empty">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="5.2"/><path d="M9.8 12.6 9 17h6l-.8-4.4"/><path d="M9 17c0 2 1.3 4 3 4s3-2 3-4"/></svg>
            <div class="big">No radiosonde decoded yet</div>
            <div class="small">Select <b>Radiosonde</b> in the top bar and press <b>Start</b>. RS41 sondes transmit between 400–406 MHz — set the frequency in <b>Settings → Radiosonde</b>. Launches typically happen around 00:00 and 12:00 UTC. Or use <b>Demo mode</b> to watch a simulated flight.</div>
          </div>
        </div>
      </div>
      <aside class="air-list" id="sd-panel"></aside>
    </div>`;

  window.rtl433.onSonde((snap) => {
    store.setSonde(snap);
  });
  store.on('sonde', () => {
    if (!root.hidden) render();
    updateBadge();
  });
  render();
}

export function refreshSonde() {
  ensureMap();
  setTimeout(() => map && map.invalidateSize(), 50);
  render();
}

function ensureMap() {
  if (map) return;
  map = L.map('sd-map', { center: [52.2, 0.1], zoom: 9, worldCopyJump: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 15,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.on('zoomstart dragstart', () => {
    userMoved = true;
  });
}

function phaseOf(s) {
  if (s.phase) return s.phase; // demo provides it
  if (s.vel_v == null) return null;
  if (s.vel_v > 1) return 'ascent';
  if (s.vel_v < -2) return 'descent';
  return 'drifting';
}

function updateBadge() {
  const badge = document.getElementById('nav-badge-sonde');
  const s = store.sonde.sonde;
  const live = s && Date.now() - (s.lastFrameTime || 0) < 60000;
  badge.hidden = !live;
  badge.textContent = '●';
}

function set(id, v, sub) {
  const e = document.getElementById(`sd-${id}`);
  const su = document.getElementById(`sd-${id}-sub`);
  if (e) e.textContent = v;
  if (su && sub != null) su.textContent = sub;
}

function render() {
  ensureMap();
  const { sonde: s, trail, frames } = store.sonde;
  document.getElementById('sd-empty').style.display = s && s.lat != null ? 'none' : 'flex';

  if (!s) {
    set('alt', '—', '');
    set('climb', '—', '');
    set('speed', '—', '');
    set('temp', '—', '');
    set('frames', '0', 'waiting');
    document.getElementById('sd-panel').innerHTML =
      '<div class="air-list-empty">No telemetry yet</div>';
    return;
  }

  const phase = phaseOf(s);
  set('alt', s.alt != null ? `${Math.round(s.alt).toLocaleString()} m` : '—', phase || '');
  set(
    'climb',
    s.vel_v != null ? `${s.vel_v > 0 ? '+' : ''}${(+s.vel_v).toFixed(1)} m/s` : '—',
    phase === 'descent' ? 'descending' : phase === 'ascent' ? 'ascending' : ''
  );
  set('speed', s.vel_h != null ? `${(+s.vel_h).toFixed(1)} m/s` : '—', s.heading != null ? `heading ${Math.round(s.heading)}°` : '');
  set('temp', s.temp != null ? `${(+s.temp).toFixed(1)} °C` : '—', s.humidity != null ? `${Math.round(s.humidity)} % RH` : '');
  set('frames', String(frames), s.lastFrameTime ? fmtAgo(Date.now() - s.lastFrameTime) : '');

  // side panel details
  const rows = [
    ['Serial', s.id || '—'],
    ['Type', s.type || 'RS41'],
    ['Frame', s.frame ?? '—'],
    ['Latitude', s.lat != null ? s.lat.toFixed(5) : '—'],
    ['Longitude', s.lon != null ? s.lon.toFixed(5) : '—'],
    ['Satellites', s.sats ?? '—'],
    ['Battery', s.batt != null ? `${(+s.batt).toFixed(2)} V` : '—'],
  ];
  document.getElementById('sd-panel').innerHTML = `
    <div class="air-row sel" style="cursor:default">
      <div class="air-row-head"><span class="cs">${esc(s.id || 'RS41')}</span>
        <span class="icao">${phase ? esc(phase) : ''}</span></div>
    </div>
    ${rows
      .map(
        ([k, v]) => `<div class="sd-kv"><span>${k}</span><span>${esc(v)}</span></div>`
      )
      .join('')}`;

  // map
  if (s.lat != null && s.lon != null) {
    if (!marker) {
      marker = L.marker([s.lat, s.lon], { icon: balloonIcon(), keyboard: false }).addTo(map);
    } else {
      marker.setLatLng([s.lat, s.lon]);
    }
    marker.bindTooltip(
      `${esc(s.id || 'RS41')} · ${s.alt != null ? Math.round(s.alt).toLocaleString() + ' m' : ''}`,
      { direction: 'top', offset: [0, -14], opacity: 0.95 }
    );
    const latlngs = trail.map((p) => [p[0], p[1]]);
    if (!trailLine) {
      trailLine = L.polyline(latlngs, { color: TRAIL_COLOR, weight: 2, opacity: 0.8 }).addTo(map);
    } else {
      trailLine.setLatLngs(latlngs);
    }
    if (!userMoved) map.panTo([s.lat, s.lon]);
  }
}
