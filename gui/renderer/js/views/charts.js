// Charts view: time-series of any recorded metric, grouped per unit family
// (one axis per chart — never dual axes). Series colors follow the fixed
// categorical order; a legend is shown whenever a chart has 2+ series.
import { store } from '../state.js';
import { labelOf, unitOf, deviceTitle, esc } from '../format.js';
import { renderLineChart } from '../chart.js';

const root = document.getElementById('view-charts');
const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70']; // validated palette, fixed order
const MAX_SERIES = 3; // all-pairs validated cap; beyond this, pick fewer metrics

const SPANS = [
  { label: '15 min', ms: 15 * 60000 },
  { label: '1 h', ms: 60 * 60000 },
  { label: '6 h', ms: 6 * 3600000 },
  { label: 'All', ms: 0 },
];

let selDevice = ''; // device key or '' = all devices
let selMetrics = new Set(); // metric keys currently plotted
let spanMs = 15 * 60000;
let renderQueued = false;

export function initCharts() {
  root.innerHTML = `
    <div class="toolbar">
      <select id="ch-device" style="min-width:230px" title="Device to plot"></select>
      <select id="ch-metric" style="min-width:170px" title="Add a metric"></select>
      <div class="grow"></div>
      <div class="seg" id="ch-span"></div>
    </div>
    <div id="ch-charts"></div>
    <div class="empty-state" id="ch-empty" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 14l4-4 3 3 5-6"/></svg>
      <div class="big">Nothing to chart yet</div>
      <div class="small">Once numeric readings arrive (temperature, humidity, wind…), pick a device and metrics here to plot them over time.</div>
    </div>`;

  const seg = document.getElementById('ch-span');
  for (const s of SPANS) {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.classList.toggle('active', s.ms === spanMs);
    b.addEventListener('click', () => {
      spanMs = s.ms;
      [...seg.children].forEach((c) => c.classList.toggle('active', c === b));
      render();
    });
    seg.appendChild(b);
  }

  document.getElementById('ch-device').addEventListener('change', (e) => {
    selDevice = e.target.value;
    selMetrics.clear(); // reset to defaults for the new selection
    render();
  });
  document.getElementById('ch-metric').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [op, key] = [e.target.value[0], e.target.value.slice(1)];
    if (op === '+') selMetrics.add(key);
    else selMetrics.delete(key);
    e.target.value = '';
    render();
  });

  store.on('devices', queueRender);
  window.addEventListener('resize', queueRender);
  render();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    if (!root.hidden) render();
  }, 500);
}

export function focusDevice(key) {
  selDevice = key;
  selMetrics.clear();
  render();
}

function availableMetrics() {
  const metrics = new Map(); // key -> count of devices having it
  for (const dev of store.devices.values()) {
    if (selDevice && dev.key !== selDevice) continue;
    for (const k of dev.history.keys()) metrics.set(k, (metrics.get(k) || 0) + 1);
  }
  return metrics;
}

function render() {
  const devSel = document.getElementById('ch-device');
  const devs = [...store.devices.values()].sort((a, b) => a.model.localeCompare(b.model));

  // (re)build device options preserving selection
  devSel.innerHTML = '<option value="">All devices</option>' + devs.map((d) => {
    const label = `${deviceTitle(d)}${d.id != null ? ` #${d.id}` : ''}${d.channel != null && d.channel !== '' ? ` (CH ${d.channel})` : ''}`;
    return `<option value="${esc(d.key)}">${esc(label)}</option>`;
  }).join('');
  devSel.value = selDevice;
  if (devSel.value !== selDevice) {
    selDevice = '';
    devSel.value = '';
  }

  const metrics = availableMetrics();
  const chartsHost = document.getElementById('ch-charts');
  const empty = document.getElementById('ch-empty');
  if (!metrics.size) {
    chartsHost.innerHTML = '';
    empty.hidden = false;
    document.getElementById('ch-metric').innerHTML = '<option value="">Add metric…</option>';
    return;
  }
  empty.hidden = true;

  // default metric selection: first two most common metrics
  if (!selMetrics.size) {
    const ranked = [...metrics.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    for (const k of ranked.slice(0, 2)) selMetrics.add(k);
  }
  // prune metrics that vanished (e.g. after clear)
  for (const k of selMetrics) if (!metrics.has(k)) selMetrics.delete(k);

  // metric picker: checkable list via select
  const mSel = document.getElementById('ch-metric');
  mSel.innerHTML = '<option value="">Add / remove metric…</option>' + [...metrics.keys()].sort().map((k) => {
    const on = selMetrics.has(k);
    return `<option value="${esc(on ? '-' + k : '+' + k)}">${on ? '✓ ' : ''}${esc(labelOf(k))}${unitOf(k) ? ` (${esc(unitOf(k))})` : ''}</option>`;
  }).join('');

  // Build one chart per selected metric. Series within a chart = devices.
  chartsHost.innerHTML = '';
  for (const metric of selMetrics) {
    let series = [];
    const devList = selDevice ? devs.filter((d) => d.key === selDevice) : devs;
    for (const dev of devList) {
      const h = dev.history.get(metric);
      if (!h || !h.length) continue;
      series.push({
        name: `${deviceTitle(dev)}${dev.id != null ? ` #${dev.id}` : ''}`,
        key: metric,
        points: h,
        color: '',
      });
    }
    if (!series.length) continue;
    // fixed-order colors; cap series to the validated all-pairs count
    let capped = 0;
    if (series.length > MAX_SERIES) {
      // keep most recently active devices
      series.sort((a, b) => b.points[b.points.length - 1][0] - a.points[a.points.length - 1][0]);
      capped = series.length - MAX_SERIES;
      series = series.slice(0, MAX_SERIES);
    }
    series.forEach((s, i) => (s.color = SERIES_COLORS[i]));

    const card = document.createElement('div');
    card.className = 'chart-card';
    const legend = series.length > 1
      ? `<div class="chart-legend">${series.map((s) => `<span class="li"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`
      : '';
    card.innerHTML = `
      <div class="chart-head">
        <span class="chart-title">${esc(labelOf(metric))}${unitOf(metric) ? ` — ${esc(unitOf(metric))}` : ''}</span>
        ${legend}
      </div>
      <div class="chart-svg-wrap"></div>
      ${capped ? `<div class="table-note" style="border:none;padding:6px 2px 0">Showing the ${MAX_SERIES} most recently active devices; ${capped} more hidden — filter to a single device to see them.</div>` : ''}`;
    chartsHost.appendChild(card);

    renderLineChart(card.querySelector('.chart-svg-wrap'), series, {
      height: 250,
      unit: unitOf(metric),
      timeSpanMs: spanMs || null,
    });
  }
}

export function rerenderCharts() {
  if (!root.hidden) render();
}
