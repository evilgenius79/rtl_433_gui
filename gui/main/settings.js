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
  receiverMode: 'ism', // ism (rtl_433) | adsb (rtl_adsb aircraft)
  adsbPath: '', // rtl_adsb binary override; empty = bundled copy
  adsbGain: '', // -g for rtl_adsb; empty = default
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
