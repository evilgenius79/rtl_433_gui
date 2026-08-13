// Pagers view: live table of decoded POCSAG messages.
import { store } from '../state.js';
import { esc, fmtClock } from '../format.js';

const root = document.getElementById('view-pagers');
const RENDER_CAP = 300;

let filterText = '';
let paused = false;

export function initPagers() {
  root.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="text" id="pg-search" placeholder="Filter messages…" />
      </div>
      <span class="section-sub">POCSAG 512 / 1200 / 2400 via bundled rtl_fm — set the frequency in Settings</span>
      <div class="grow"></div>
      <button class="btn btn-sm" id="pg-pause"><span>Pause</span></button>
      <button class="btn btn-sm" id="pg-clear">Clear</button>
      <button class="btn btn-sm" id="pg-export">Export CSV</button>
    </div>
    <div class="table-wrap">
      <div style="max-height: calc(100vh - 210px); overflow-y: auto;">
        <table class="etable">
          <thead><tr>
            <th style="width:92px">Time</th>
            <th style="width:100px">Address</th>
            <th style="width:56px">Baud</th>
            <th style="width:70px">Type</th>
            <th>Message</th>
          </tr></thead>
          <tbody id="pg-tbody"></tbody>
        </table>
      </div>
      <div class="table-note" id="pg-note"></div>
    </div>
    <div class="empty-state" id="pg-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 12h.01M11 12h.01M15 12h.01"/><path d="M7 15.2h10"/></svg>
      <div class="big">No pages received yet</div>
      <div class="small">Select <b>POCSAG pagers</b> in the top bar and press <b>Start</b>. Pager frequencies vary by country — set yours under <b>Settings → Pagers</b> (e.g. 169.65 MHz for Dutch P2000). Or use <b>Demo mode</b> for simulated traffic.</div>
    </div>`;

  document.getElementById('pg-search').addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase();
    render();
  });
  document.getElementById('pg-pause').addEventListener('click', () => {
    paused = !paused;
    const btn = document.getElementById('pg-pause');
    btn.querySelector('span').textContent = paused ? 'Resume' : 'Pause';
    btn.classList.toggle('btn-primary', paused);
    if (!paused) render();
  });
  document.getElementById('pg-clear').addEventListener('click', () => {
    store.pagerMessages = [];
    render();
  });
  document.getElementById('pg-export').addEventListener('click', exportCsv);

  store.on('pagers', () => {
    updateBadge();
    if (!paused && !root.hidden) render();
  });
  render();
}

export function refreshPagers() {
  render();
}

function updateBadge() {
  const badge = document.getElementById('nav-badge-pagers');
  badge.hidden = store.totalPagerMessages === 0;
  badge.textContent = store.totalPagerMessages > 9999 ? '9999+' : String(store.totalPagerMessages);
}

function filtered() {
  if (!filterText) return store.pagerMessages;
  return store.pagerMessages.filter(
    (m) => `${m.address} ${m.text}`.toLowerCase().includes(filterText)
  );
}

function render() {
  const list = filtered();
  document.getElementById('pg-empty').hidden = store.pagerMessages.length > 0;
  document.getElementById('pg-tbody').innerHTML = list
    .slice(0, RENDER_CAP)
    .map(
      (m) => `<tr>
      <td class="t-time">${fmtClock(new Date(m.time))}</td>
      <td class="t-num">${esc(m.address)}</td>
      <td class="t-num">${esc(m.baud)}</td>
      <td><span class="chip">${m.type === 'alpha' ? 'Alpha' : 'Numeric'}</span></td>
      <td class="t-msg">${esc(m.text)}</td>
    </tr>`
    )
    .join('');
  const note = document.getElementById('pg-note');
  note.textContent = list.length
    ? `${list.length.toLocaleString()} message${list.length === 1 ? '' : 's'}${paused ? ' — paused' : ''}`
    : store.pagerMessages.length
      ? 'No messages match the filter.'
      : 'Waiting for pages…';
}

async function exportCsv() {
  const list = filtered();
  if (!list.length) return window.toast('Nothing to export yet.', 'error');
  const escCsv = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['time,address,function,baud,type,message'];
  for (const m of [...list].reverse()) {
    lines.push([new Date(m.time).toISOString(), m.address, m.func, m.baud, m.type, escCsv(m.text)].join(','));
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const res = await window.rtl433.exportFile({
    defaultName: `pocsag-messages-${stamp}.csv`,
    content: lines.join('\n') + '\n',
  });
  if (res.ok) window.toast(`Exported ${list.length} messages to ${res.path}`, 'success');
}
