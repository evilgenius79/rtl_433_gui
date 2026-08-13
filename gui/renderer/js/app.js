// App shell: navigation, top bar controls, IPC stream wiring.
import { store } from './state.js';
import { deviceKey, summarize } from './format.js';
import { initDashboard, refreshDashboard } from './views/dashboard.js';
import { initEvents, refreshEvents } from './views/events.js';
import { initCharts, rerenderCharts } from './views/charts.js';
import { initAircraft, refreshAircraft } from './views/aircraft.js';
import { initConsole } from './views/console.js';
import { initSettings } from './views/settings.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  events: 'Events',
  charts: 'Charts',
  aircraft: 'Aircraft',
  console: 'Console',
  settings: 'Settings',
};

let currentView = 'dashboard';

window.showView = (name) => showView(name);

function showView(name) {
  currentView = name;
  for (const v of Object.keys(VIEW_TITLES)) {
    document.getElementById(`view-${v}`).hidden = v !== name;
  }
  document.getElementById('view-title').textContent = VIEW_TITLES[name];
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.view === name);
  }
  // hidden views skip rendering; refresh the one that just became visible
  if (name === 'charts') rerenderCharts();
  if (name === 'dashboard') refreshDashboard();
  if (name === 'events') refreshEvents();
  if (name === 'aircraft') refreshAircraft();
}

// ---- toasts ----
window.toast = (msg, kind = '') => {
  const host = document.getElementById('toast-host');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 350);
  }, 3800);
};

// ---- top bar ----
function updateStatusUI() {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const btn = document.getElementById('btn-startstop');
  const btnText = document.getElementById('btn-startstop-text');
  const iconPlay = document.getElementById('icon-play');
  const iconStop = document.getElementById('icon-stop');

  const s = store.status;
  const running = s.state === 'running';
  const modeTag = s.mode === 'adsb' ? ' ADS-B' : '';
  pill.className = `status-pill ${s.state === 'error' ? 'error' : running ? 'running' : 'stopped'}`;
  text.textContent = running
    ? `Receiving${modeTag}${s.demo ? ' · demo' : ''}`
    : s.state === 'error' ? 'Error' : 'Stopped';
  btnText.textContent = running ? 'Stop' : 'Start';
  btn.classList.toggle('btn-primary', !running);
  btn.classList.toggle('btn-danger', running);
  // note: SVG elements ignore the `hidden` attribute — toggle display instead
  iconPlay.style.display = running ? 'none' : '';
  iconStop.style.display = running ? '' : 'none';
  // the receiver mode can't change while running
  document.getElementById('mode-select').disabled = running;
}

window.updateFreqChip = () => {
  const adsbActive =
    (store.status.state === 'running' && store.status.mode === 'adsb') ||
    (store.settings?.receiverMode || 'ism') === 'adsb';
  if (adsbActive) {
    document.getElementById('freq-chip-text').textContent = '1090 MHz';
    return;
  }
  const freqs = store.settings?.frequencies?.filter((f) => String(f).trim()) || [];
  const fmt = (f) => {
    const s = String(f).trim();
    const m = s.match(/^([\d.]+)\s*([MkG]?)/i);
    if (!m) return s;
    let mhz = parseFloat(m[1]);
    const suf = m[2].toUpperCase();
    if (suf === 'K') mhz /= 1000;
    else if (suf === 'G') mhz *= 1000;
    else if (!suf) mhz /= 1e6;
    return `${+mhz.toFixed(3)} MHz`;
  };
  document.getElementById('freq-chip-text').textContent = freqs.length
    ? freqs.map(fmt).join(' ⇄ ')
    : '—';
};

async function toggleStartStop() {
  const btn = document.getElementById('btn-startstop');
  btn.disabled = true;
  try {
    if (store.status.state === 'running') {
      await window.rtl433.stop();
    } else {
      const res = await window.rtl433.start();
      if (res && res.ok === false && res.error) window.toast(res.error, 'error');
    }
  } finally {
    setTimeout(() => (btn.disabled = false), 400);
  }
}

async function main() {
  store.settings = await window.rtl433.getSettings();
  store.maxEvents = store.settings.maxEvents || 5000;
  window.updateFreqChip();

  // nav
  document.getElementById('nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (btn) showView(btn.dataset.view);
  });

  document.getElementById('btn-startstop').addEventListener('click', toggleStartStop);

  // receiver mode select
  const modeSelect = document.getElementById('mode-select');
  modeSelect.value = store.settings.receiverMode || 'ism';
  modeSelect.addEventListener('change', async () => {
    const res = await window.rtl433.setMode(modeSelect.value);
    if (res.ok === false) {
      modeSelect.value = store.settings.receiverMode || 'ism';
      window.toast(res.error || 'Cannot switch mode now', 'error');
      return;
    }
    store.settings.receiverMode = res.mode;
    window.updateFreqChip();
    showView(res.mode === 'adsb' ? 'aircraft' : 'dashboard');
    window.toast(res.mode === 'adsb'
      ? 'ADS-B mode — Start will tune 1090 MHz and track aircraft.'
      : 'ISM mode — Start will run rtl_433 for sensor traffic.');
  });

  // demo toggle
  const demoToggle = document.getElementById('demo-toggle');
  const status = await window.rtl433.getStatus();
  demoToggle.checked = !!status.demoMode;
  store.demoMode = !!status.demoMode;
  demoToggle.addEventListener('change', async () => {
    const res = await window.rtl433.setDemoMode(demoToggle.checked);
    if (res.ok === false) {
      demoToggle.checked = store.demoMode;
      window.toast(res.error || 'Cannot switch mode now', 'error');
      return;
    }
    store.demoMode = res.demoMode;
    window.toast(res.demoMode
      ? 'Demo mode on — Start will replay simulated sensor traffic.'
      : 'Demo mode off — Start will run rtl_433.');
  });

  // IPC streams
  const batteryNotified = new Set(); // one low-battery notification per device per session
  window.rtl433.onEvent((evt) => {
    const key = deviceKey(evt);
    const isNew = !store.devices.has(key);
    store.addEvent(evt);
    // desktop notifications (opt-in via Settings → Behavior)
    const s = store.settings || {};
    const name = `${evt.model || 'Unknown'}${evt.id != null ? ` #${evt.id}` : ''}`;
    try {
      if (isNew && s.notifyNewDevice) {
        new Notification(`New device: ${name}`, { body: summarize(evt) || 'First transmission received' });
      }
      if (evt.battery_ok === 0 && s.notifyLowBattery && !batteryNotified.has(key)) {
        batteryNotified.add(key);
        new Notification(`Low battery: ${name}`, { body: 'This sensor is reporting a low battery.' });
      }
    } catch (e) {
      /* notifications unavailable — non-fatal */
    }
  });
  window.rtl433.onLog((l) => store.addLog(l));
  window.rtl433.onStatus((s) => {
    store.setStatus(s);
    updateStatusUI();
    window.updateFreqChip();
    if (s.state === 'error' && s.error) window.toast(s.error, 'error');
  });
  store.on('status', updateStatusUI);

  // views
  initDashboard();
  initEvents();
  initCharts();
  initAircraft();
  initConsole();
  initSettings();

  // land on the view matching the saved receiver mode
  if ((store.settings.receiverMode || 'ism') === 'adsb') showView('aircraft');

  updateStatusUI();

  // version in the sidebar footer
  try {
    const v = await window.rtl433.getVersion();
    const footer = document.querySelector('.sidebar-footer');
    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:11px;color:var(--text-3);padding:6px 8px 0;';
    tag.textContent = `v${v}`;
    footer.appendChild(tag);
  } catch (e) {
    /* non-fatal */
  }

  // keyboard shortcuts: Ctrl+1..6 switch views
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key >= '1' && e.key <= '6') {
      showView(Object.keys(VIEW_TITLES)[Number(e.key) - 1]);
      e.preventDefault();
    }
  });
}

main();
