'use strict';
// Persistent settings store: a plain JSON file in Electron's userData dir.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  rtl433Path: '', // empty = use "rtl_433" from PATH / bundled hint
  device: '', // -d value; empty = first available
  frequencies: ['433.92M'], // -f, may hold several (hopping)
  hopInterval: 600, // -H seconds, used when several frequencies
  sampleRate: '', // -s; empty = rtl_433 default (250k)
  gain: '', // -g; empty = auto
  ppmError: 0, // -p
  protocolMode: 'default', // default | custom
  enabledProtocols: [], // -R n (custom mode)
  disabledProtocols: [], // -R -n (default mode tweaks)
  units: 'si', // -C
  reportLevel: true, // -M level (RSSI/SNR/noise)
  reportProtocol: true, // -M protocol
  extraArgs: '', // free-form, appended verbatim
  autoScrollConsole: true,
  maxEvents: 5000, // renderer event-log cap
  theme: 'dark',
  autoStart: false, // begin receiving when the app opens
  autoRestart: false, // relaunch rtl_433 if it exits unexpectedly
  notifyNewDevice: false, // desktop notification when an unseen device appears
  notifyLowBattery: true, // desktop notification when a sensor reports low battery
  receiverMode: 'ism', // mode the top-bar button controls: ism | adsb | pocsag | sonde
  // Per-mode SDR device selection: with several dongles, give each running
  // mode its own index/serial. Empty = first device.
  adsbDevice: '',
  adsbPath: '', // rtl_adsb binary override; empty = bundled copy
  adsbGain: '', // -g for rtl_adsb; empty = default
  pagerDevice: '',
  pagerFreq: '169.65M', // POCSAG frequency (regional; presets in Settings)
  pagerGain: '',
  sondeDevice: '',
  sondeFreq: '402.7M', // RS41 radiosonde frequency (400.05-406 MHz band)
  sondeGain: '',
  rtlFmPath: '', // rtl_fm binary override; empty = bundled copy
  rs41Path: '', // rs41mod binary override; empty = bundled copy
};

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...DEFAULTS, ...raw };
    } catch (e) {
      // first run or corrupt file: keep defaults
    }
    return this.data;
  }

  save(patch) {
    this.data = { ...this.data, ...patch };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('settings: failed to save:', e.message);
    }
    return this.data;
  }
}

module.exports = { Settings, DEFAULTS };
