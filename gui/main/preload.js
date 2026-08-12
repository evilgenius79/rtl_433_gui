'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtl433', {
  // control
  start: () => ipcRenderer.invoke('rt:start'),
  stop: () => ipcRenderer.invoke('rt:stop'),
  getStatus: () => ipcRenderer.invoke('rt:getStatus'),
  setDemoMode: (on) => ipcRenderer.invoke('rt:setDemoMode', on),

  // settings
  getSettings: () => ipcRenderer.invoke('rt:getSettings'),
  saveSettings: (patch) => ipcRenderer.invoke('rt:saveSettings', patch),
  pickBinary: () => ipcRenderer.invoke('rt:pickBinary'),
  getProtocols: () => ipcRenderer.invoke('rt:getProtocols'),

  // data export & misc
  exportFile: (opts) => ipcRenderer.invoke('rt:exportFile', opts),
  previewCmd: () => ipcRenderer.invoke('rt:previewCmd'),
  copyText: (text) => ipcRenderer.invoke('rt:copyText', text),
  getVersion: () => ipcRenderer.invoke('rt:version'),

  // streams (main -> renderer)
  onEvent: (cb) => ipcRenderer.on('rt:event', (_e, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('rt:log', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('rt:status', (_e, data) => cb(data)),
});
