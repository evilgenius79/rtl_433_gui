// Ships view: dark map with live AIS vessel traffic and a side list.
/* global L */
import { store } from '../state.js';
import { esc, fmtAgo } from '../format.js';

const root = document.getElementById('view-ships');

let map = null;
let markers = new Map();
let trails = new Map();
let snap = { ships: [], totalMsgs: 0 };
let selected = null;
let userMoved = false;
let didFit = false;

const COLOR = '#199e70';
const COLOR_SEL = '#d95926';

const SHIPTYPES = {
  3: 'Special', 5: 'Special', 6: 'Passenger', 7: 'Cargo', 8: 'Tanker', 9: 'Other',
};

function shipIconSvg(cog, isSel) {
  const color = isSel ? COLOR_SEL : COLOR;
  return `<svg viewBox="0 0 24 24" width="26" height="26" style="transform:rotate(${cog || 0}deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">
    <path fill="${color}" stroke="#0f1116" stroke-width="0.8"
      d="M12 2.2 17 12v7.5l-5 2.3-5-2.3V12z"/>
  </svg>`;
}

function shipName(s) {
  return s.name || `MMSI ${s.mmsi}`;
}

export function initShips() {
  root.innerHTML = `
    <div class="air-stats">
      <div class="air-chip"><span class="k">Vessels</span><span class="v" id="sh-count">0</span></div>
      <div class="air-chip"><span class="k">With position</span><span class="v" id="sh-poscount">0</span></div>
      <div class="air-chip"><span class="k">Messages</span><span class="v" id="sh-total">0</span></div>
      <div class="grow"></div>
      <span class="section-sub">AIS 161.975 / 162.025 MHz via bundled rtl_fm</span>
    </div>
    <div class="air-layout">
      <div class="air-map-wrap">
        <div id="sh-map"></div>
        <div class="air-empty" id="sh-empty">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3 17 12v7l-5 2-5-2v-7z"/></svg>
            <div class="big">No vessels yet</div>
            <div class="small">Select <b>AIS ships</b> in the top bar and press <b>Start</b>. You'll need line of sight to water — AIS is VHF, so range from shore is typically 10–40 km. Or use <b>Demo mode</b> for simulated harbour traffic.</div>
          </div>
        </div>
      </div>
      <aside class="air-list" id="sh-list"></aside>
    </div>`;

  window.rtl433.onShips((s) => {
    snap = s;
    if (!root.hidden) render();
    const badge = document.getElementById('nav-badge-ships');
    badge.hidden = snap.ships.length === 0;
    badge.textContent = String(snap.ships.length);
  });

  document.getElementById('sh-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-mmsi]');
    if (!row) return;
    const mmsi = Number(row.dataset.mmsi);
    selected = selected === mmsi ? null : mmsi;
    const ship = snap.ships.find((s) => s.mmsi === selected);
    if (ship && ship.lat != null) map.panTo([ship.lat, ship.lon]);
    render();
  });
}

export function refreshShips() {
  ensureMap();
  setTimeout(() => map && map.invalidateSize(), 50);
  render();
}

function ensureMap() {
  if (map) return;
  map = L.map('sh-map', { center: [51.96, 4.08], zoom: 11, worldCopyJump: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 15,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.on('zoomstart dragstart', () => {
    userMoved = true;
  });
}

function render() {
  ensureMap();
  const withPos = snap.ships.filter((s) => s.lat != null);
  document.getElementById('sh-count').textContent = snap.ships.length;
  document.getElementById('sh-poscount').textContent = withPos.length;
  document.getElementById('sh-total').textContent = snap.totalMsgs.toLocaleString();
  document.getElementById('sh-empty').style.display = withPos.length ? 'none' : 'flex';

  const seen = new Set();
  for (const s of withPos) {
    seen.add(s.mmsi);
    const isSel = s.mmsi === selected;
    const icon = L.divIcon({
      className: 'air-marker',
      html: shipIconSvg(s.cog ?? s.heading, isSel),
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    let m = markers.get(s.mmsi);
    if (!m) {
      m = L.marker([s.lat, s.lon], { icon, keyboard: false });
      m.on('click', () => {
        selected = selected === s.mmsi ? null : s.mmsi;
        render();
      });
      m.addTo(map);
      markers.set(s.mmsi, m);
    } else {
      m.setLatLng([s.lat, s.lon]);
      m.setIcon(icon);
    }
    m.bindTooltip(`${esc(shipName(s))}${s.sog != null ? ` · ${s.sog.toFixed(1)} kt` : ''}`, {
      direction: 'top',
      offset: [0, -10],
      opacity: 0.95,
    });

    if (s.trail && s.trail.length > 1) {
      let line = trails.get(s.mmsi);
      const style = { color: isSel ? COLOR_SEL : COLOR, weight: isSel ? 2.5 : 1.5, opacity: isSel ? 0.9 : 0.35 };
      if (!line) {
        line = L.polyline(s.trail, style).addTo(map);
        trails.set(s.mmsi, line);
      } else {
        line.setLatLngs(s.trail);
        line.setStyle(style);
      }
    }
  }
  for (const [mmsi, m] of markers) {
    if (!seen.has(mmsi)) {
      m.remove();
      markers.delete(mmsi);
    }
  }
  for (const [mmsi, line] of trails) {
    if (!seen.has(mmsi)) {
      line.remove();
      trails.delete(mmsi);
    }
  }

  if (withPos.length && !userMoved && !didFit) {
    didFit = true;
    map.fitBounds(L.latLngBounds(withPos.map((s) => [s.lat, s.lon])).pad(0.25));
  }

  const list = [...snap.ships].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  document.getElementById('sh-list').innerHTML = list
    .map((s) => `<div class="air-row ${s.mmsi === selected ? 'sel' : ''}" data-mmsi="${s.mmsi}">
      <div class="air-row-head">
        <span class="cs">${esc(shipName(s))}</span>
        <span class="icao">${esc(SHIPTYPES[Math.floor((s.shiptype || 0) / 10)] || '')}</span>
      </div>
      <div class="air-row-sub">
        <span>${s.sog != null ? s.sog.toFixed(1) + ' kt' : ''}</span>
        <span>${s.cog != null ? Math.round(s.cog) + '°' : ''}</span>
        <span>${s.lat == null ? 'no position' : ''}</span>
        <span class="age">${fmtAgo(Date.now() - (s.lastSeen || 0))}</span>
      </div>
    </div>`)
    .join('') || '<div class="air-list-empty">Nothing heard yet</div>';
}
