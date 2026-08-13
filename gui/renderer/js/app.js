// App shell: navigation, top bar controls, IPC stream wiring.
import { store } from './state.js';
import { deviceKey, summarize } from './format.js';
import { initDashboard, refreshDashboard } from './views/dashboard.js';
import { initEvents, refreshEvents } from './views/events.js';
import { initCharts, rerenderCharts } from './views/charts.js';
import { initAircraft, refreshAircraft } from './views/aircraft.js';
import { initPagers, refreshPagers } from './views/pagers.js';
import { initSonde, refreshSonde } from './views/sonde.js';
import { initConsole } from './views/console.js';
import { initSettings } from './views/settings.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  events: 'Events',
  charts: 'Charts',
  aircraft: 'Aircraft',
  pagers: 'Pagers',
  sonde: 'Radiosonde',
  console: 'Console',
  settings: 'Settings',
};

const MODE_NAMES = { ism: 'ISM', adsb: 'ADS-B', pocsag: 'Pagers', sonde: 'Sonde' };
const MODE_HOME_VIEW = { ism: 'dashboard', adsb: 'aircraft', pocsag: 'pagers', sonde: 'sonde' };
// which device-setting key each mode's pipeline uses (for conflict warnings)
const MODE_DEVICE_KEY = { ism: 'device', adsb: 'adsbDevice', pocsag: 'pagerDevice', sonde: 'sondeDevice' };

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
  if (name === 'pagers') refreshPagers();
  if (name === 'sonde') refreshSonde();
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
// The pill summarizes every running pipeline; the button controls only the
// mode currently selected in the dropdown (so a 2nd dongle can run another).
function updateStatusUI() {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const btn = document.getElementById('btn-startstop');
  const btnText = document.getElementById('btn-startstop-text');
  const iconPlay = document.getElementById('icon-play');
  const iconStop = document.getElementById('icon-stop');

  const selected = store.settings?.receiverMode || 'ism';
  const selectedStatus = store.modeStatus[selected] || { state: 'stopped' };
  const selRunning = selectedStatus.state === 'running';
  const running = store.runningModes();
  const anyDemo = running.some((m) => store.modeStatus[m]?.demo);

  if (running.length) {
    pill.className = 'status-pill running';
    text.textContent = `Receiving ${running.map((m) => MODE_NAMES[m] || m).join(' + ')}${anyDemo ? ' · demo' : ''}`;
  } else if (selectedStatus.state === 'error') {
    pill.className = 'status-pill error';
    text.textContent = 'Error';
  } else {
    pill.className = 'status-pill stopped';
    text.textContent = 'Stopped';
  }

  btnText.textContent = selRunning ? `Stop ${MODE_NAMES[selected]}` : `Start ${MODE_NAMES[selected]}`;
  btn.classList.toggle('btn-primary', !selRunning);
  btn.classList.toggle('btn-danger', selRunning);
  // note: SVG elements ignore the `hidden` attribute — toggle display instead
  iconPlay.style.display = selRunning ? 'none' : '';
  iconStop.style.display = selRunning ? '' : 'none';
}

function fmtFreq(f) {
  const s = String(f).trim();
  const m = s.match(/^([\d.]+)\s*([MkG]?)/i);
  if (!m) return s;
  let mhz = parseFloat(m[1]);
  const suf = m[2].toUpperCase();
  if (suf === 'K') mhz /= 1000;
  else if (suf === 'G') mhz *= 1000;
  else if (!suf) mhz /= 1e6;
  return `${+mhz.toFixed(3)} MHz`;
}

window.updateFreqChip = () => {
  const mode = store.settings?.receiverMode || 'ism';
  let text = '—';
  if (mode === 'adsb') {
    text = '1090 MHz';
  } else if (mode === 'pocsag') {
    text = fmtFreq(store.settings?.pagerFreq || '169.65M');
  } else if (mode === 'sonde') {
    text = fmtFreq(store.settings?.sondeFreq || '402.7M');
  } else {
    const freqs = store.settings?.frequencies?.filter((f) => String(f).trim()) || [];
    if (freqs.length) text = freqs.map(fmtFreq).join(' ⇄ ');
  }
  document.getElementById('freq-chip-text').textContent = text;
};

async function toggleStartStop() {
  const btn = document.getElementById('btn-startstop');
  const mode = store.settings?.receiverMode || 'ism';
  btn.disabled = true;
  try {
    if (store.modeStatus[mode]?.state === 'running') {
      await window.rtl433.stop(mode);
    } else {
      // one dongle can't serve two modes: warn when the device is already used
      if (!store.demoMode) {
        const myDev = String(store.settings[MODE_DEVICE_KEY[mode]] || '0');
        const clash = store.runningModes().find(
          (m) => !store.modeStatus[m]?.demo && String(store.settings[MODE_DEVICE_KEY[m]] || '0') === myDev
        );
        if (clash) {
          window.toast(
            `SDR device ${myDev} is already used by ${MODE_NAMES[clash]} — give ${MODE_NAMES[mode]} its own dongle in Settings, or stop ${MODE_NAMES[clash]} first.`,
            'error'
          );
        }
      }
      const res = await window.rtl433.start(mode);
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

  // receiver mode select: picks which pipeline the Start/Stop button controls
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
    updateStatusUI();
    showView(MODE_HOME_VIEW[res.mode] || 'dashboard');
  });

  // demo toggle
  const demoToggle = document.getElementById('demo-toggle');
  const status = await window.rtl433.getStatus();
  if (status.modes) {
    for (const [m, s] of Object.entries(status.modes)) store.modeStatus[m] = s;
  }
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

  // pager stream
  window.rtl433.onPager((msg) => store.addPagerMessage(msg));

  // views
  initDashboard();
  initEvents();
  initCharts();
  initAircraft();
  initPagers();
  initSonde();
  initConsole();
  initSettings();

  // land on the view matching the saved receiver mode
  const homeView = MODE_HOME_VIEW[store.settings.receiverMode || 'ism'];
  if (homeView && homeView !== 'dashboard') showView(homeView);

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

  // keyboard shortcuts: Ctrl+1..8 switch views
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
      showView(Object.keys(VIEW_TITLES)[Number(e.key) - 1]);
      e.preventDefault();
    }
  });
}

main();
