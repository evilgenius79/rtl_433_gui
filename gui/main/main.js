'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./settings');
const { Rtl433Process, buildArgs, resolveBinary } = require('./rtl433');
const { DemoSource } = require('./demo');
const { AdsbSource } = require('./adsb');
const { DemoAdsbSource } = require('./demo-adsb');
const { PagerSource } = require('./pager-source');
const { DemoPagerSource } = require('./demo-pager');
const { SondeSource } = require('./sonde-source');
const { DemoSondeSource } = require('./demo-sonde');
const { ShipsSource } = require('./ships-source');
const { DemoShipsSource } = require('./demo-ships');
const { SpectrumSource } = require('./spectrum-source');
const { DemoSpectrumSource } = require('./demo-spectrum');

let win = null;
let settings = null;
const proc = new Rtl433Process();
const demo = new DemoSource();
const adsb = new AdsbSource();
const demoAdsb = new DemoAdsbSource();
const pager = new PagerSource();
const demoPager = new DemoPagerSource();
const sonde = new SondeSource();
const demoSonde = new DemoSondeSource();
const ships = new ShipsSource();
const demoShips = new DemoShipsSource();
const spectrum = new SpectrumSource();
const demoSpectrum = new DemoSpectrumSource();

// Each receiver mode has a real pipeline and a demo twin; with two (or more)
// dongles several modes can run at once, each bound to its own SDR device.
const MODES = {
  ism: { real: proc, demo, isDemoRunning: () => demo.isRunning },
  adsb: { real: adsb, demo: demoAdsb, isDemoRunning: () => demoAdsb.isRunning },
  pocsag: { real: pager, demo: demoPager, isDemoRunning: () => demoPager.isRunning },
  sonde: { real: sonde, demo: demoSonde, isDemoRunning: () => demoSonde.isRunning },
  ais: { real: ships, demo: demoShips, isDemoRunning: () => demoShips.isRunning },
  spectrum: { real: spectrum, demo: demoSpectrum, isDemoRunning: () => demoSpectrum.isRunning },
};

let demoMode = process.argv.includes('--demo');
const statusByMode = {}; // mode -> last status payload
let manualStop = false; // user pressed Stop: suppress auto-restart
let runStartedAt = 0;
let restartTimer = null;

function modeRunning(mode) {
  const m = MODES[mode];
  return m.real.running || m.isDemoRunning();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Wire all sources to the same renderer streams; every status carries its mode.
for (const [mode, m] of Object.entries(MODES)) {
  for (const [src, isDemo] of [[m.real, false], [m.demo, true]]) {
    src.on('event', (e) => send('rt:event', e));
    src.on('log', (l) => send('rt:log', l));
    src.on('status', (s) => {
      const payload = { ...s, mode, demo: isDemo || s.demo };
      statusByMode[mode] = payload;
      send('rt:status', payload);
    });
  }
}
for (const src of [adsb, demoAdsb]) {
  src.on('aircraft', (snap) => send('rt:aircraft', snap));
}
for (const src of [pager, demoPager]) {
  src.on('pager', (msg) => send('rt:pager', msg));
}
for (const src of [sonde, demoSonde]) {
  src.on('sonde', (snap) => send('rt:sonde', snap));
}
for (const src of [ships, demoShips]) {
  src.on('ships', (snap) => send('rt:ships', snap));
}
for (const src of [spectrum, demoSpectrum]) {
  src.on('spectrum', (sweep) => send('rt:spectrum', sweep));
}
spectrum.on('audio', (buf) => send('rt:audio', buf));

function anyRunning() {
  return Object.keys(MODES).some(modeRunning);
}

function startMode(mode) {
  const m = MODES[mode];
  if (!m) return { ok: false, error: 'unknown mode' };
  if (demoMode) return m.demo.start(settings.data);
  return m.real.start(settings.data);
}

function stopMode(mode) {
  const m = MODES[mode];
  if (!m) return { ok: false, error: 'unknown mode' };
  m.demo.stop();
  return m.real.stop();
}

function stopAll() {
  for (const mode of Object.keys(MODES)) stopMode(mode);
  return { ok: true };
}

// Auto-restart: if rtl_433 dies unexpectedly after having run for a while
// (i.e. not a bad-flag/missing-binary startup failure), bring it back.
proc.on('status', (s) => {
  if (s.state === 'running') runStartedAt = Date.now();
  const crashed = s.state === 'error' && !manualStop;
  const ranLongEnough = runStartedAt && Date.now() - runStartedAt > 10000;
  if (crashed && ranLongEnough && settings && settings.data.autoRestart && !demoMode) {
    send('rt:log', { stream: 'app', line: 'auto-restart: rtl_433 stopped unexpectedly, restarting in 5 s…' });
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (!proc.running && !manualStop) proc.start(settings.data);
    }, 5000);
  }
});

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#14161b',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          // height matches the .topbar so the caption buttons align with it;
          // the topbar reserves their width via env(titlebar-area-width)
          titleBarOverlay: { color: '#0f1116', symbolColor: '#a7afbd', height: 56 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // close-to-tray keeps receivers running in the background
  win.on('close', (e) => {
    if (!quitting && settings && settings.data.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  // optional: begin receiving as soon as the app opens
  if (!process.env.RTL433_SCREENSHOT_DIR) {
    win.webContents.once('did-finish-load', () => {
      if (settings && settings.data.autoStart) {
        setTimeout(() => {
          const mode = settings.data.receiverMode || 'ism';
          if (!modeRunning(mode)) startMode(mode);
        }, 800);
      }
    });
  }

  // external links open in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  createWindow();
  setupTray();
  setupAutoUpdate();
  pruneEventLog();
  if (process.env.RTL433_SCREENSHOT_DIR) captureScreenshots(process.env.RTL433_SCREENSHOT_DIR);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Automated UI capture (used for docs/CI): RTL433_SCREENSHOT_DIR=/out electron . --demo
async function captureScreenshots(outDir) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  win.webContents.once('did-finish-load', async () => {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      demoMode = true;
      await sleep(800);
      demo.start();
      await sleep(Number(process.env.RTL433_SCREENSHOT_WAIT || 15000)); // let demo data accumulate
      for (const view of ['dashboard', 'events', 'charts', 'console', 'settings']) {
        await win.webContents.executeJavaScript(
          `document.querySelector('.nav-item[data-view="${view}"]').click()`
        );
        await sleep(700);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, `${view}.png`), img.toPNG());
      }
      // remaining modes run concurrently (the multi-dongle scenario)
      demo.stop();
      await sleep(500);
      demoAdsb.start();
      demoPager.start();
      demoSonde.start();
      demoShips.start();
      demoSpectrum.start();
      await win.webContents.executeJavaScript(
        `document.querySelector('.nav-item[data-view="aircraft"]').click()`
      );
      await sleep(Number(process.env.RTL433_SCREENSHOT_AIR_WAIT || 12000));
      for (const view of ['aircraft', 'pagers', 'sonde', 'ships', 'spectrum', 'about']) {
        await win.webContents.executeJavaScript(
          `document.querySelector('.nav-item[data-view="${view}"]').click()`
        );
        await sleep(900);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, `${view}.png`), img.toPNG());
      }
      console.log('screenshots written to', outDir);
    } catch (e) {
      console.error('screenshot capture failed:', e);
    } finally {
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  stopAll();
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopAll();
});

// ---- IPC ----
ipcMain.handle('rt:start', (_e, mode) => {
  mode = mode || settings.data.receiverMode || 'ism';
  if (mode === 'ism') manualStop = false;
  if (modeRunning(mode)) return { ok: false, error: 'this mode is already running' };
  return startMode(mode);
});

ipcMain.handle('rt:stop', (_e, mode) => {
  if (!mode) {
    manualStop = true;
    clearTimeout(restartTimer);
    return stopAll();
  }
  if (mode === 'ism') {
    manualStop = true;
    clearTimeout(restartTimer);
  }
  return stopMode(mode);
});

ipcMain.handle('rt:setMode', (_e, mode) => {
  // "selected" mode only affects which pipeline the top-bar button controls;
  // switching is always allowed — other modes keep running
  if (!MODES[mode]) return { ok: false, error: 'unknown mode' };
  settings.save({ receiverMode: mode });
  return { ok: true, mode };
});

ipcMain.handle('rt:previewCmd', () => {
  const bin = resolveBinary(settings.data.rtl433Path);
  return [bin, ...buildArgs(settings.data)]
    .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ');
});

ipcMain.handle('rt:copyText', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return { ok: true };
});

ipcMain.handle('rt:version', () => app.getVersion());

// spectrum listen (audio monitor) — shares the spectrum mode's dongle
ipcMain.handle('rt:listenStart', (_e, opts) => {
  if (demoMode) return { ok: false, error: 'listening is not available in demo mode' };
  return spectrum.startListen(settings.data, opts || {});
});
ipcMain.handle('rt:listenStop', () => {
  if (demoMode) return { ok: true };
  return spectrum.stopListen(settings.data);
});

// ---- durable event log: one NDJSON file per day in the user-data dir ----
const LOG_DIRNAME = 'event-log';
function logDir() {
  return path.join(app.getPath('userData'), LOG_DIRNAME);
}
function appendEventLog(evt) {
  if (!settings || !settings.data.logEvents) return;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFile(path.join(logDir(), `events-${day}.ndjson`), JSON.stringify(evt) + '\n', () => {});
  } catch (e) {
    /* non-fatal */
  }
}
function pruneEventLog() {
  if (!settings) return;
  const keep = Math.max(1, Number(settings.data.logRetentionDays) || 14);
  try {
    const cutoff = Date.now() - keep * 86400000;
    for (const f of fs.readdirSync(logDir())) {
      const m = f.match(/^events-(\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (m && Date.parse(m[1]) < cutoff) fs.unlinkSync(path.join(logDir(), f));
    }
  } catch (e) {
    /* no log dir yet */
  }
}
for (const src of [proc, demo]) src.on('event', appendEventLog);
setInterval(pruneEventLog, 6 * 3600000);

ipcMain.handle('rt:openLogFolder', () => {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    shell.openPath(logDir());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- system tray ----
let tray = null;
let quitting = false;
function setupTray() {
  try {
    const img = nativeImage
      .createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'))
      .resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('rtl_433 GUI');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: () => { if (win) { win.show(); win.focus(); } } },
        { type: 'separator' },
        { label: 'Stop all receivers', click: () => stopAll() },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } },
      ])
    );
    tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  } catch (e) {
    /* tray unavailable in some environments — not fatal */
  }
}

// ---- auto-update (packaged builds only; fails silently offline) ----
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      send('rt:log', { stream: 'app', line: `update ${info.version} downloaded — it will install when the app quits` });
      send('rt:updateReady', { version: info.version });
    });
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600000);
  } catch (e) {
    /* updater not available */
  }
}

ipcMain.handle('rt:getStatus', () => ({
  demoMode,
  running: anyRunning(),
  modes: Object.fromEntries(
    Object.keys(MODES).map((m) => [m, { ...(statusByMode[m] || { state: 'stopped', mode: m }), running: modeRunning(m) }])
  ),
}));

ipcMain.handle('rt:setDemoMode', (_e, on) => {
  if (anyRunning()) return { ok: false, error: 'stop the receiver first' };
  demoMode = !!on;
  return { ok: true, demoMode };
});

ipcMain.handle('rt:getSettings', () => settings.data);
ipcMain.handle('rt:saveSettings', (_e, patch) => {
  const data = settings.save(patch);
  // a running ISM receiver keeps its old command line — restart it so the
  // saved frequency/gain/decoders actually take effect
  if (proc.running) {
    send('rt:log', { stream: 'app', line: 'settings saved — restarting rtl_433 to apply' });
    proc.once('status', (s) => {
      if (s.state !== 'running' && !manualStop) {
        setTimeout(() => {
          if (!proc.running && !manualStop) proc.start(settings.data);
        }, 400);
      }
    });
    proc.stop();
  }
  return data;
});

ipcMain.handle('rt:pickBinary', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Locate the rtl_433 executable',
    properties: ['openFile'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'rtl_433 executable', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
        : [{ name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});

ipcMain.handle('rt:getProtocols', () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'protocols.json'), 'utf8'));
  } catch (e) {
    return [];
  }
});

ipcMain.handle('rt:exportFile', async (_e, { defaultName, content }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export data',
    defaultPath: defaultName,
    filters: [
      { name: 'JSON lines', extensions: ['ndjson', 'jsonl', 'json'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
