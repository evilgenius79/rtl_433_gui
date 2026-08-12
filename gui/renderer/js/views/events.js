// Events view: filterable table of decoded transmissions with expandable
// JSON detail rows and CSV / NDJSON export.
import { store } from '../state.js';
import { summarize, fmtClock, esc } from '../format.js';

const root = document.getElementById('view-events');
const RENDER_CAP = 400;
const RENDER_MIN_INTERVAL = 200; // ms between table rebuilds under load

let filterText = '';
let filterModel = '';
let paused = false;
let expanded = new Set(); // seq numbers with open detail row
let lastRender = 0;
let renderTimer = null;

export function initEvents() {
  root.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="text" id="ev-search" placeholder="Filter events…" />
      </div>
      <select id="ev-model" title="Filter by device model">
        <option value="">All models</option>
      </select>
      <div class="grow"></div>
      <button class="btn btn-sm" id="ev-pause" title="Freeze the table (data still arrives)">
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        <span>Pause</span>
      </button>
      <button class="btn btn-sm" id="ev-clear">Clear</button>
      <button class="btn btn-sm" id="ev-export-csv">Export CSV</button>
      <button class="btn btn-sm" id="ev-export-json">Export JSON</button>
    </div>
    <div class="table-wrap">
      <div style="max-height: calc(100vh - 210px); overflow-y: auto;">
        <table class="etable">
          <thead><tr>
            <th style="width:92px">Time</th>
            <th style="width:190px">Model</th>
            <th style="width:74px">ID</th>
            <th style="width:44px">CH</th>
            <th>Readings</th>
            <th style="width:74px">RSSI</th>
            <th style="width:64px">SNR</th>
          </tr></thead>
          <tbody id="ev-tbody"></tbody>
        </table>
      </div>
      <div class="table-note" id="ev-note"></div>
    </div>`;

  document.getElementById('ev-search').addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase();
    render();
  });
  document.getElementById('ev-model').addEventListener('change', (e) => {
    filterModel = e.target.value;
    render();
  });
  document.getElementById('ev-pause').addEventListener('click', () => {
    paused = !paused;
    const btn = document.getElementById('ev-pause');
    btn.querySelector('span').textContent = paused ? 'Resume' : 'Pause';
    btn.classList.toggle('btn-primary', paused);
    if (!paused) render();
  });
  document.getElementById('ev-clear').addEventListener('click', () => {
    store.clearEvents();
    expanded.clear();
  });
  document.getElementById('ev-export-csv').addEventListener('click', () => exportEvents('csv'));
  document.getElementById('ev-export-json').addEventListener('click', () => exportEvents('json'));

  document.getElementById('ev-tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-seq]');
    if (!tr) return;
    const seq = Number(tr.dataset.seq);
    if (expanded.has(seq)) expanded.delete(seq);
    else expanded.add(seq);
    render();
  });

  store.on('events', () => {
    if (!paused) throttledRender();
    updateBadge();
  });
  render();
}

// called by the shell when this view becomes visible again
export function refreshEvents() {
  render();
}

function throttledRender() {
  if (root.hidden) return; // refreshed on view switch instead
  const since = Date.now() - lastRender;
  if (since >= RENDER_MIN_INTERVAL) {
    render();
  } else if (!renderTimer) {
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!paused && !root.hidden) render();
    }, RENDER_MIN_INTERVAL - since);
  }
}

function updateBadge() {
  const badge = document.getElementById('nav-badge-events');
  badge.hidden = store.totalEvents === 0;
  badge.textContent = store.totalEvents > 9999 ? '9999+' : String(store.totalEvents);
}

function filtered() {
  let list = store.events;
  if (filterModel) list = list.filter((r) => r.evt.model === filterModel);
  if (filterText) {
    list = list.filter((r) => JSON.stringify(r.evt).toLowerCase().includes(filterText));
  }
  return list;
}

function render() {
  lastRender = Date.now();
  // model filter options (kept up to date, selection preserved)
  const sel = document.getElementById('ev-model');
  const models = [...new Set([...store.devices.values()].map((d) => d.model))].sort();
  const have = new Set([...sel.options].map((o) => o.value));
  for (const m of models) {
    if (!have.has(m)) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      sel.appendChild(o);
    }
  }

  const list = filtered();
  const rows = [];
  for (const rec of list.slice(0, RENDER_CAP)) {
    const e = rec.evt;
    rows.push(`<tr class="expandable" data-seq="${rec.seq}">
      <td class="t-time">${fmtClock(new Date(rec.ts))}</td>
      <td class="t-model">${esc(e.model || '—')}</td>
      <td class="t-num">${e.id != null ? esc(e.id) : '—'}</td>
      <td class="t-num">${e.channel != null && e.channel !== '' ? esc(e.channel) : '—'}</td>
      <td class="t-summary" title="click to expand">${esc(summarize(e))}</td>
      <td class="t-num">${typeof e.rssi === 'number' ? e.rssi.toFixed(1) : '—'}</td>
      <td class="t-num">${typeof e.snr === 'number' ? e.snr.toFixed(1) : '—'}</td>
    </tr>`);
    if (expanded.has(rec.seq)) {
      rows.push(`<tr class="detail-row"><td colspan="7">${esc(JSON.stringify(e, null, 2))}</td></tr>`);
    }
  }
  document.getElementById('ev-tbody').innerHTML = rows.join('');

  const note = document.getElementById('ev-note');
  const total = list.length;
  note.textContent = total === 0
    ? 'No events match. Waiting for transmissions…'
    : total > RENDER_CAP
      ? `Showing latest ${RENDER_CAP} of ${total.toLocaleString()} matching events (log holds up to ${store.maxEvents.toLocaleString()}). Use Export for the full log.`
      : `${total.toLocaleString()} event${total === 1 ? '' : 's'}${paused ? ' — paused' : ''}`;
}

async function exportEvents(kind) {
  const list = filtered();
  if (!list.length) return window.toast('Nothing to export yet.', 'error');
  let content;
  let name;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  if (kind === 'json') {
    content = [...list].reverse().map((r) => JSON.stringify(r.evt)).join('\n') + '\n';
    name = `rtl433-events-${stamp}.ndjson`;
  } else {
    // union of keys, stable order: common first
    const keys = [];
    const seen = new Set();
    for (const k of ['time', 'model', 'id', 'channel']) {
      keys.push(k);
      seen.add(k);
    }
    for (const r of list) {
      for (const k of Object.keys(r.evt)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    const csvEsc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.join(',')];
    for (const r of [...list].reverse()) {
      lines.push(keys.map((k) => csvEsc(r.evt[k])).join(','));
    }
    content = lines.join('\n') + '\n';
    name = `rtl433-events-${stamp}.csv`;
  }
  const res = await window.rtl433.exportFile({ defaultName: name, content });
  if (res.ok) window.toast(`Exported ${list.length.toLocaleString()} events to ${res.path}`, 'success');
  else if (res.error) window.toast(`Export failed: ${res.error}`, 'error');
}
