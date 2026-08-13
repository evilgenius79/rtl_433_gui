// Aircraft view: dark Leaflet map with live ADS-B traffic — rotated plane
// markers, altitude-tinted trails, and a side list of aircraft.
/* global L */
import { store } from '../state.js';
import { esc, fmtAgo } from '../format.js';

const root = document.getElementById('view-aircraft');

let map = null;
let markers = new Map(); // icao -> L.marker
let trails = new Map(); // icao -> L.polyline
let snap = { aircraft: [], totalMsgs: 0, msgsPerMinute: 0 };
let selected = null;
let userMoved = false;
let didFit = false;

const COLOR = '#3987e5';
const COLOR_SEL = '#d95926';

function planeIconSvg(track, isSel) {
  const color = isSel ? COLOR_SEL : COLOR;
  return `<svg viewBox="0 0 24 24" width="30" height="30" style="transform:rotate(${track || 0}deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">
    <path fill="${color}" stroke="#0f1116" stroke-width="0.7"
      d="M12 1.8c.6 0 1.1 1 1.1 2v5.2l8.4 5v2l-8.4-2.6v5l2.2 1.8v1.8L12 20.6 8.7 22v-1.8l2.2-1.8v-5L2.5 16v-2l8.4-5V3.8c0-1 .5-2 1.1-2z"/>
  </svg>`;
}

function acName(ac) {
  return ac.callsign || ac.icao;
}

export function initAircraft() {
  root.innerHTML = `
    <div class="air-stats">
      <div class="air-chip"><span class="k">Aircraft</span><span class="v" id="air-count">0</span></div>
      <div class="air-chip"><span class="k">With position</span><span class="v" id="air-poscount">0</span></div>
      <div class="air-chip"><span class="k">Messages/min</span><span class="v" id="air-rate">0</span></div>
      <div class="air-chip"><span class="k">Total messages</span><span class="v" id="air-total">0</span></div>
      <div class="grow"></div>
      <span class="section-sub">1090 MHz Mode S / ADS-B via bundled rtl_adsb</span>
    </div>
    <div class="air-layout">
      <div class="air-map-wrap">
        <div id="air-map"></div>
        <div class="air-empty" id="air-empty">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
            <div class="big">No aircraft yet</div>
            <div class="small">Switch the receiver to <b>ADS-B aircraft</b> in the top bar and press <b>Start</b>. A 1090&nbsp;MHz-capable antenna helps a lot — or use <b>Demo mode</b> to watch simulated traffic.</div>
          </div>
        </div>
      </div>
      <aside class="air-list" id="air-list"></aside>
    </div>`;

  window.rtl433.onAircraft((s) => {
    snap = s;
    render();
  });

  document.getElementById('air-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-icao]');
    if (!row) return;
    select(row.dataset.icao, true);
  });
}

function ensureMap() {
  if (map) return;
  map = L.map('air-map', {
    center: [51.47, -0.45],
    zoom: 9,
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
  });
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 15,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  // offline (or blocked) tile server: keep tracking on the dark canvas, say why once
  let tileFailNoted = false;
  tiles.on('tileerror', () => {
    if (tileFailNoted) return;
    tileFailNoted = true;
    window.toast('Map tiles unavailable (offline?) — aircraft are still tracked on the dark canvas.', 'error');
  });
  tiles.on('tileload', () => {
    tileFailNoted = true; // at least one tile works; don't warn about stragglers
  });
  map.on('zoomstart dragstart', () => {
    userMoved = true;
  });
}

function select(icao, pan) {
  selected = selected === icao ? null : icao;
  if (pan && selected) {
    const ac = snap.aircraft.find((a) => a.icao === selected);
    if (ac && ac.lat != null) map.panTo([ac.lat, ac.lon]);
  }
  render();
}

function popupHtml(ac) {
  const rows = [
    ['ICAO', ac.icao],
    ['Altitude', ac.altitude != null ? `${ac.altitude.toLocaleString()} ft` : '—'],
    ['Speed', ac.gs != null ? `${Math.round(ac.gs)} kt` : '—'],
    ['Track', ac.track != null ? `${Math.round(ac.track)}°` : '—'],
    ['Climb', ac.vr != null ? `${ac.vr > 0 ? '+' : ''}${ac.vr} ft/min` : '—'],
    ['Messages', ac.msgs],
  ];
  return `<div class="air-popup"><b>${esc(acName(ac))}</b>${rows
    .map(([k, v]) => `<div class="pr"><span>${k}</span><span>${esc(v)}</span></div>`)
    .join('')}</div>`;
}

function render() {
  if (root.hidden) return;
  ensureMap();

  document.getElementById('air-count').textContent = snap.aircraft.length;
  const withPos = snap.aircraft.filter((a) => a.lat != null);
  document.getElementById('air-poscount').textContent = withPos.length;
  document.getElementById('air-rate').textContent = snap.msgsPerMinute.toLocaleString();
  document.getElementById('air-total').textContent = snap.totalMsgs.toLocaleString();

  const badge = document.getElementById('nav-badge-aircraft');
  badge.hidden = snap.aircraft.length === 0;
  badge.textContent = String(snap.aircraft.length);

  document.getElementById('air-empty').style.display = withPos.length ? 'none' : 'flex';

  // markers + trails
  const seen = new Set();
  for (const ac of withPos) {
    seen.add(ac.icao);
    const isSel = ac.icao === selected;
    const icon = L.divIcon({
      className: 'air-marker',
      html: planeIconSvg(ac.track, isSel),
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    let m = markers.get(ac.icao);
    if (!m) {
      m = L.marker([ac.lat, ac.lon], { icon, keyboard: false });
      m.on('click', () => select(ac.icao, false));
      m.addTo(map);
      markers.set(ac.icao, m);
    } else {
      m.setLatLng([ac.lat, ac.lon]);
      m.setIcon(icon);
    }
    m.bindTooltip(
      `${esc(acName(ac))}${ac.altitude != null ? ` · ${Math.round(ac.altitude / 100) * 100} ft` : ''}`,
      { direction: 'top', offset: [0, -12], opacity: 0.95 }
    );
    if (isSel) m.bindPopup(popupHtml(ac)).openPopup();

    // trail
    if (ac.trail && ac.trail.length > 1) {
      let line = trails.get(ac.icao);
      const style = {
        color: isSel ? COLOR_SEL : COLOR,
        weight: isSel ? 2.5 : 1.5,
        opacity: isSel ? 0.9 : 0.35,
      };
      if (!line) {
        line = L.polyline(ac.trail, style);
        line.addTo(map);
        trails.set(ac.icao, line);
      } else {
        line.setLatLngs(ac.trail);
        line.setStyle(style);
      }
    }
  }
  // remove stale
  for (const [icao, m] of markers) {
    if (!seen.has(icao)) {
      m.remove();
      markers.delete(icao);
    }
  }
  for (const [icao, line] of trails) {
    if (!seen.has(icao)) {
      line.remove();
      trails.delete(icao);
    }
  }

  // fit once when traffic first appears (until the user takes over)
  if (withPos.length && !userMoved && !didFit) {
    didFit = true;
    map.fitBounds(L.latLngBounds(withPos.map((a) => [a.lat, a.lon])).pad(0.25));
  }

  // side list, nearest-to-now first
  const list = [...snap.aircraft].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  document.getElementById('air-list').innerHTML = list
    .map((ac) => {
      const stale = Date.now() - (ac.lastSeen || 0) > 30000;
      return `<div class="air-row ${ac.icao === selected ? 'sel' : ''} ${stale ? 'stale' : ''}" data-icao="${esc(ac.icao)}">
        <div class="air-row-head">
          <span class="cs">${esc(acName(ac))}</span>
          <span class="icao">${esc(ac.icao)}</span>
        </div>
        <div class="air-row-sub">
          <span>${ac.altitude != null ? ac.altitude.toLocaleString() + ' ft' : 'no alt'}</span>
          <span>${ac.gs != null ? Math.round(ac.gs) + ' kt' : ''}</span>
          <span>${ac.lat != null ? '' : 'no position'}</span>
          <span class="age">${fmtAgo(Date.now() - (ac.lastSeen || 0))}</span>
        </div>
      </div>`;
    })
    .join('') || '<div class="air-list-empty">Nothing heard yet</div>';
}

// called by the shell when this view becomes visible
export function refreshAircraft() {
  ensureMap();
  // the map was created while hidden — recompute its size
  setTimeout(() => map && map.invalidateSize(), 50);
  render();
}
