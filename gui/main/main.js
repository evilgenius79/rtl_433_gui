'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./settings');
const { Rtl433Process } = require('./rtl433');
const { DemoSource } = require('./demo');

let win = null;
let settings = null;
const proc = new Rtl433Process();
const demo = new DemoSource();
let demoMode = process.argv.includes('--demo');
let lastStatus = { state: 'stopped' };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Wire both sources to the same renderer streams.
for (const src of [proc, demo]) {
  src.on('event', (e) => send('rt:event', e));
  src.on('log', (l) => send('rt:log', l));
  src.on('status', (s) => {
    lastStatus = { ...s, demo: src === demo ? true : s.demo };
    send('rt:status', lastStatus);
  });
}

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

  // external links open in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  createWindow();
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
      console.log('screenshots written to', outDir);
    } catch (e) {
      console.error('screenshot capture failed:', e);
    } finally {
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  proc.stop();
  demo.stop();
  app.quit();
});

app.on('before-quit', () => {
  proc.stop();
  demo.stop();
});

// ---- IPC ----
ipcMain.handle('rt:start', () => {
  if (demoMode) return demo.start();
  return proc.start(settings.data);
});

ipcMain.handle('rt:stop', () => {
  demo.stop();
  return proc.stop();
});

ipcMain.handle('rt:getStatus', () => ({ ...lastStatus, demoMode, running: proc.running || demo.isRunning }));

ipcMain.handle('rt:setDemoMode', (_e, on) => {
  if (proc.running || demo.isRunning) return { ok: false, error: 'stop the receiver first' };
  demoMode = !!on;
  return { ok: true, demoMode };
});

ipcMain.handle('rt:getSettings', () => settings.data);
ipcMain.handle('rt:saveSettings', (_e, patch) => settings.save(patch));

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
