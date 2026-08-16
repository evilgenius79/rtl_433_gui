// Settings view: receiver, radio, decoder and output configuration.
// Values map 1:1 onto rtl_433 command-line options (built in main/rtl433.js).
import { store } from '../state.js';

const root = document.getElementById('view-settings');

// presets set the recommended sample rate too: the 900/868 bands want a wide
// window (hopping US meters, 868 FSK sensors); 433/315 are fine at default
const FREQ_PRESETS = [
  { label: '433.92 MHz', value: '433.92M', rate: '' },
  { label: '868.3 MHz', value: '868.3M', rate: '1024k' },
  { label: 'US meters · 915 MHz', value: '915M', rate: '1024k',
    title: 'US utility meters (ERT electric/gas/water) hop across 902–928 MHz — expect readings to accumulate over several minutes' },
  { label: '315 MHz', value: '315M', rate: '' },
];
const RATE_OPTIONS = ['', '250k', '1024k', '2048k', '3.2M'];

let protocols = [];
let protoFilter = '';
let draft = null; // working copy of settings

export async function initSettings() {
  protocols = await window.rtl433.getProtocols();
  draft = { ...store.settings };

  root.innerHTML = `
  <div class="settings-grid">
    <div class="settings-card">
      <h3>Receiver</h3>
      <div class="card-sub">Where to find rtl_433 and which SDR to use.</div>
      <div class="form-row">
        <div><div class="form-label">rtl_433 executable</div>
          <div class="form-hint">Leave empty to use rtl_433 from PATH or a bundled copy.</div></div>
        <div class="form-field">
          <input type="text" id="s-bin" class="wide" placeholder="e.g. C:\\Program Files\\rtl_433\\rtl_433.exe" />
          <button class="btn btn-sm" id="s-bin-browse">Browse…</button>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">SDR device (ISM)</div>
          <div class="form-hint">RTL-SDR index (0,1,…), :serial, or a SoapySDR query. Empty = first device. With two dongles, give each mode its own index so they can run at the same time.</div></div>
        <div class="form-field"><input type="text" id="s-device" class="wide" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Receiver location</div>
          <div class="form-hint">Your antenna's coordinates — enables range rings, max-range and coverage on the maps.</div></div>
        <div class="form-field">
          <input type="text" id="s-rxlat" style="width:120px" placeholder="lat, e.g. 52.1" />
          <input type="text" id="s-rxlon" style="width:120px" placeholder="lon, e.g. -0.4" />
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Radio</h3>
      <div class="card-sub">Tuning and demodulation parameters.</div>
      <div class="form-row">
        <div><div class="form-label">Frequency</div>
          <div class="form-hint">Comma-separate several to hop between them. US utility meters live at 902–928 MHz — use the US meters preset, not 433.</div></div>
        <div class="form-field">
          <input type="text" id="s-freq" class="wide" placeholder="433.92M" />
          <div class="preset-chips" id="s-freq-presets"></div>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Hop interval</div>
          <div class="form-hint">Seconds per frequency when hopping.</div></div>
        <div class="form-field"><input type="number" id="s-hop" min="1" style="width:110px" /> <span class="form-hint">s</span></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Sample rate</div>
          <div class="form-hint">Default 250k suits 433 MHz; use 1024k for 868 MHz FSK sensors.</div></div>
        <div class="form-field">
          <select id="s-rate">${RATE_OPTIONS.map((r) => `<option value="${r}">${r || 'Default (250k)'}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div>
          <div class="form-hint">Empty = automatic gain control.</div></div>
        <div class="form-field"><input type="text" id="s-gain" style="width:110px" placeholder="auto" /> <span class="form-hint">dB</span></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Frequency correction</div>
          <div class="form-hint">Crystal error of your dongle.</div></div>
        <div class="form-field"><input type="number" id="s-ppm" style="width:110px" /> <span class="form-hint">ppm</span></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>ADS-B aircraft</h3>
      <div class="card-sub">The 1090 MHz aircraft pipeline (bundled rtl_adsb).</div>
      <div class="form-row">
        <div><div class="form-label">SDR device</div>
          <div class="form-hint">Dongle index for ADS-B — use a different one than ISM to run both at once.</div></div>
        <div class="form-field"><input type="text" id="s-adsb-dev" style="width:110px" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div>
          <div class="form-hint">Empty = rtl_adsb default (max). ADS-B usually benefits from high gain.</div></div>
        <div class="form-field"><input type="text" id="s-adsb-gain" style="width:110px" placeholder="max" /> <span class="form-hint">dB</span></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">rtl_adsb executable</div>
          <div class="form-hint">Leave empty to use the copy bundled with the app.</div></div>
        <div class="form-field">
          <input type="text" id="s-adsb-bin" class="wide" placeholder="(bundled)" />
          <button class="btn btn-sm" id="s-adsb-browse">Browse…</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Pagers (POCSAG)</h3>
      <div class="card-sub">FM demodulated by the bundled rtl_fm; POCSAG 512/1200/2400 decoded in-app.</div>
      <div class="form-row">
        <div><div class="form-label">SDR device</div>
          <div class="form-hint">Dongle index for the pager receiver.</div></div>
        <div class="form-field"><input type="text" id="s-pg-dev" style="width:110px" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Frequency</div>
          <div class="form-hint">Pager networks are regional — pick the one for your country.</div></div>
        <div class="form-field">
          <input type="text" id="s-pg-freq" style="width:130px" placeholder="169.65M" />
          <div class="preset-chips" id="s-pg-presets"></div>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div><div class="form-hint">Empty = automatic.</div></div>
        <div class="form-field"><input type="text" id="s-pg-gain" style="width:110px" placeholder="auto" /> <span class="form-hint">dB</span></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Radiosonde</h3>
      <div class="card-sub">Weather balloons at 400–406 MHz, decoded by the bundled rs1729/RS decoders.</div>
      <div class="form-row">
        <div><div class="form-label">Sonde type</div>
          <div class="form-hint">RS41 is the most common worldwide; pick the type flown near you.</div></div>
        <div class="form-field">
          <select id="s-sd-type">
            <option value="rs41">RS41 (Vaisala)</option>
            <option value="dfm09">DFM-09/17 (Graw)</option>
            <option value="m10">M10 (Meteomodem)</option>
            <option value="m20">M20 (Meteomodem)</option>
            <option value="imet54">iMet-54</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">SDR device</div>
          <div class="form-hint">Dongle index for the sonde receiver.</div></div>
        <div class="form-field"><input type="text" id="s-sd-dev" style="width:110px" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Frequency</div>
          <div class="form-hint">Your local sonde frequency; check a tracker site like sondehub.org.</div></div>
        <div class="form-field">
          <input type="text" id="s-sd-freq" style="width:130px" placeholder="402.7M" />
          <div class="preset-chips" id="s-sd-presets"></div>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div><div class="form-hint">Empty = automatic.</div></div>
        <div class="form-field"><input type="text" id="s-sd-gain" style="width:110px" placeholder="auto" /> <span class="form-hint">dB</span></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>AIS ships</h3>
      <div class="card-sub">Vessel traffic on marine VHF, decoded in-app from the bundled rtl_fm.</div>
      <div class="form-row">
        <div><div class="form-label">SDR device</div><div class="form-hint">Dongle index for the AIS receiver.</div></div>
        <div class="form-field"><input type="text" id="s-ais-dev" style="width:110px" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Channel</div>
          <div class="form-hint">Vessels alternate between both channels; either works.</div></div>
        <div class="form-field">
          <select id="s-ais-freq">
            <option value="161.975M">A — 161.975 MHz</option>
            <option value="162.025M">B — 162.025 MHz</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div><div class="form-hint">Empty = automatic.</div></div>
        <div class="form-field"><input type="text" id="s-ais-gain" style="width:110px" placeholder="auto" /> <span class="form-hint">dB</span></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Spectrum</h3>
      <div class="card-sub">Band sweeping with the bundled rtl_power; presets are on the Spectrum view.</div>
      <div class="form-row">
        <div><div class="form-label">SDR device</div><div class="form-hint">Dongle index for sweeping and the audio monitor.</div></div>
        <div class="form-field"><input type="text" id="s-sp-dev" style="width:110px" placeholder="0" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Range</div>
          <div class="form-hint">Start, stop and bin size for the sweep.</div></div>
        <div class="form-field">
          <input type="text" id="s-sp-start" style="width:100px" placeholder="433M" />
          <span class="form-hint">to</span>
          <input type="text" id="s-sp-stop" style="width:100px" placeholder="435M" />
          <span class="form-hint">step</span>
          <input type="text" id="s-sp-step" style="width:80px" placeholder="10k" />
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Sweep interval</div><div class="form-hint">Seconds of integration per sweep row.</div></div>
        <div class="form-field"><input type="number" id="s-sp-int" min="1" style="width:90px" /> <span class="form-hint">s</span></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Gain</div><div class="form-hint">Empty = automatic.</div></div>
        <div class="form-field"><input type="text" id="s-sp-gain" style="width:110px" placeholder="auto" /> <span class="form-hint">dB</span></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>MQTT</h3>
      <div class="card-sub">rtl_433 publishes every ISM event straight to your broker — ideal for Home Assistant.</div>
      <div class="form-row">
        <div class="form-label">Enable MQTT output</div>
        <div class="form-field"><input type="checkbox" id="s-mq-on" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Broker</div><div class="form-hint">Host and port of your MQTT broker.</div></div>
        <div class="form-field">
          <input type="text" id="s-mq-host" style="width:180px" placeholder="127.0.0.1" />
          <input type="number" id="s-mq-port" style="width:90px" placeholder="1883" />
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Credentials</div><div class="form-hint">Leave empty for anonymous access.</div></div>
        <div class="form-field">
          <input type="text" id="s-mq-user" style="width:140px" placeholder="user" />
          <input type="password" id="s-mq-pass" style="width:140px" placeholder="password" />
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Retain messages</div>
          <div class="form-hint">Keep the last value on each topic for new subscribers.</div></div>
        <div class="form-field"><input type="checkbox" id="s-mq-retain" /></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Alert rules</h3>
      <div class="card-sub">Fire a desktop notification when a device reports something noteworthy. Alerts respect a 5-minute per-device cooldown.</div>
      <div id="s-alert-list"></div>
      <div class="form-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:12px">
        <div class="form-label">New rule</div>
        <div class="form-field" style="gap:8px">
          <input type="text" id="s-al-name" style="width:130px" placeholder="Name" />
          <select id="s-al-device" style="max-width:170px"><option value="">Any device</option></select>
          <input type="text" id="s-al-metric" style="width:130px" placeholder="metric, e.g. temperature_C" list="s-al-metrics" />
          <datalist id="s-al-metrics">
            <option value="temperature_C"></option><option value="humidity"></option>
            <option value="moisture"></option><option value="battery_ok"></option>
            <option value="state"></option><option value="wind_avg_km_h"></option>
            <option value="pressure_kPa"></option>
          </datalist>
          <select id="s-al-op" style="width:110px">
            <option value=">">&gt;</option><option value="<">&lt;</option>
            <option value=">=">&ge;</option><option value="<=">&le;</option>
            <option value="==">equals</option><option value="changes">changes</option>
            <option value="any">any event</option>
          </select>
          <input type="text" id="s-al-value" style="width:80px" placeholder="value" />
          <input type="text" id="s-al-from" style="width:70px" placeholder="from hh:mm" title="Optional time window start" />
          <input type="text" id="s-al-to" style="width:70px" placeholder="to hh:mm" title="Optional time window end" />
          <button class="btn btn-sm" id="s-al-add">Add rule</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Decoders</h3>
      <div class="card-sub" id="s-proto-sub"></div>
      <div class="form-row">
        <div class="form-label">Mode</div>
        <div class="form-field">
          <select id="s-proto-mode">
            <option value="default">All default decoders (untick to disable specific ones)</option>
            <option value="custom">Only selected decoders</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-label">Protocols</div>
        <div>
          <div class="form-field" style="margin-bottom:8px">
            <div class="search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input type="text" id="s-proto-search" placeholder="Search ${protocols.length} protocols…" /></div>
          </div>
          <div class="proto-box" id="s-proto-list"></div>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Output</h3>
      <div class="card-sub">How decoded values are reported.</div>
      <div class="form-row">
        <div class="form-label">Units</div>
        <div class="form-field">
          <select id="s-units">
            <option value="si">Metric (SI)</option>
            <option value="customary">US customary</option>
            <option value="native">Native (as transmitted)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Signal metadata</div>
          <div class="form-hint">Include RSSI / SNR / noise with each event.</div></div>
        <div class="form-field"><input type="checkbox" id="s-level" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Log events to disk</div>
          <div class="form-hint">Append every ISM event to a daily NDJSON file for long-term analysis.</div></div>
        <div class="form-field">
          <input type="checkbox" id="s-log" />
          <span class="form-hint">keep</span>
          <input type="number" id="s-log-days" min="1" style="width:70px" />
          <span class="form-hint">days</span>
          <button class="btn btn-sm" id="s-log-open">Open log folder</button>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Behavior</h3>
      <div class="card-sub">Startup, recovery and desktop notifications.</div>
      <div class="form-row">
        <div><div class="form-label">Start on launch</div>
          <div class="form-hint">Begin receiving as soon as the app opens.</div></div>
        <div class="form-field"><input type="checkbox" id="s-autostart" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Auto-restart receiver</div>
          <div class="form-hint">If rtl_433 exits unexpectedly, relaunch it after 5 seconds.</div></div>
        <div class="form-field"><input type="checkbox" id="s-autorestart" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Notify on new device</div>
          <div class="form-hint">Desktop notification the first time an unseen device transmits.</div></div>
        <div class="form-field"><input type="checkbox" id="s-notifynew" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Notify on low battery</div>
          <div class="form-hint">Desktop notification (once per device) when a sensor reports low battery.</div></div>
        <div class="form-field"><input type="checkbox" id="s-notifybatt" /></div>
      </div>
      <div class="form-row">
        <div><div class="form-label">Close to tray</div>
          <div class="form-hint">Closing the window keeps receivers running in the system tray.</div></div>
        <div class="form-field"><input type="checkbox" id="s-tray" /></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Advanced</h3>
      <div class="card-sub">Appended verbatim to the rtl_433 command line.</div>
      <div class="form-row">
        <div class="form-label">Extra arguments</div>
        <div class="form-field"><input type="text" id="s-extra" class="wide" placeholder='e.g. -Y autolevel -M noise' /></div>
      </div>
    </div>

    <div class="settings-actions">
      <button class="btn btn-primary" id="s-save">Save settings</button>
      <button class="btn" id="s-copycmd" title="Copy the exact rtl_433 command line built from the saved settings">Copy command line</button>
      <span class="save-note" id="s-note"></span>
    </div>
  </div>`;

  // populate fields
  const g = (id) => document.getElementById(id);
  g('s-bin').value = draft.rtl433Path || '';
  g('s-device').value = draft.device || '';
  g('s-freq').value = (draft.frequencies || []).join(', ');
  g('s-hop').value = draft.hopInterval ?? 600;
  g('s-rate').value = draft.sampleRate || '';
  g('s-gain').value = draft.gain ?? '';
  g('s-ppm').value = draft.ppmError || 0;
  g('s-proto-mode').value = draft.protocolMode || 'default';
  g('s-units').value = draft.units || 'si';
  g('s-level').checked = draft.reportLevel !== false;
  g('s-extra').value = draft.extraArgs || '';
  g('s-adsb-bin').value = draft.adsbPath || '';
  g('s-adsb-gain').value = draft.adsbGain ?? '';
  g('s-adsb-dev').value = draft.adsbDevice || '';
  g('s-pg-dev').value = draft.pagerDevice || '';
  g('s-pg-freq').value = draft.pagerFreq || '169.65M';
  g('s-pg-gain').value = draft.pagerGain ?? '';
  g('s-sd-dev').value = draft.sondeDevice || '';
  g('s-sd-freq').value = draft.sondeFreq || '402.7M';
  g('s-sd-gain').value = draft.sondeGain ?? '';
  g('s-sd-type').value = draft.sondeType || 'rs41';
  g('s-rxlat').value = draft.receiverLat || '';
  g('s-rxlon').value = draft.receiverLon || '';
  g('s-ais-dev').value = draft.aisDevice || '';
  g('s-ais-freq').value = draft.aisFreq || '161.975M';
  g('s-ais-gain').value = draft.aisGain ?? '';
  g('s-sp-dev').value = draft.spectrumDevice || '';
  g('s-sp-start').value = draft.spectrumStart || '433M';
  g('s-sp-stop').value = draft.spectrumStop || '435M';
  g('s-sp-step').value = draft.spectrumStep || '10k';
  g('s-sp-int').value = draft.spectrumInterval || 1;
  g('s-sp-gain').value = draft.spectrumGain ?? '';
  g('s-mq-on').checked = !!draft.mqttEnabled;
  g('s-mq-host').value = draft.mqttHost || '127.0.0.1';
  g('s-mq-port').value = draft.mqttPort || 1883;
  g('s-mq-user').value = draft.mqttUser || '';
  g('s-mq-pass').value = draft.mqttPass || '';
  g('s-mq-retain').checked = !!draft.mqttRetain;
  g('s-log').checked = !!draft.logEvents;
  g('s-log-days').value = draft.logRetentionDays || 14;
  g('s-tray').checked = !!draft.closeToTray;

  // regional presets for the pager and sonde bands
  const chipRow = (hostId, inputId, presets) => {
    const host = g(hostId);
    for (const p of presets) {
      const b = document.createElement('button');
      b.className = 'preset-chip';
      b.textContent = p.label;
      b.title = p.title || '';
      b.addEventListener('click', () => {
        g(inputId).value = p.value;
      });
      host.appendChild(b);
    }
  };
  chipRow('s-pg-presets', 's-pg-freq', [
    { label: '169.65 (NL P2000)', value: '169.65M' },
    { label: '152.840 (US)', value: '152.840M' },
    { label: '153.350 (SE)', value: '153.350M' },
    { label: '466.075 (FR)', value: '466.075M' },
  ]);
  chipRow('s-sd-presets', 's-sd-freq', [
    { label: '402.7', value: '402.7M' },
    { label: '403.0', value: '403M' },
    { label: '404.3', value: '404.3M' },
    { label: '405.3', value: '405.3M' },
  ]);
  g('s-autostart').checked = !!draft.autoStart;
  g('s-autorestart').checked = !!draft.autoRestart;
  g('s-notifynew').checked = !!draft.notifyNewDevice;
  g('s-notifybatt').checked = draft.notifyLowBattery !== false;

  const presetHost = g('s-freq-presets');
  for (const p of FREQ_PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-chip';
    b.textContent = p.label;
    if (p.title) b.title = p.title;
    b.addEventListener('click', () => {
      g('s-freq').value = p.value;
      g('s-rate').value = p.rate;
      markPresets();
      if (p.rate) window.toast(`Sample rate set to ${p.rate} — recommended for this band.`);
    });
    presetHost.appendChild(b);
  }
  g('s-freq').addEventListener('input', markPresets);
  markPresets();

  function markPresets() {
    const cur = g('s-freq').value.trim();
    [...presetHost.children].forEach((b, i) => b.classList.toggle('active', FREQ_PRESETS[i].value === cur));
  }

  g('s-bin-browse').addEventListener('click', async () => {
    const res = await window.rtl433.pickBinary();
    if (res.ok) g('s-bin').value = res.path;
  });
  g('s-adsb-browse').addEventListener('click', async () => {
    const res = await window.rtl433.pickBinary();
    if (res.ok) g('s-adsb-bin').value = res.path;
  });

  g('s-proto-mode').addEventListener('change', () => {
    draft.protocolMode = g('s-proto-mode').value;
    renderProtoList();
  });
  g('s-proto-search').addEventListener('input', (e) => {
    protoFilter = e.target.value.toLowerCase();
    renderProtoList();
  });
  g('s-proto-list').addEventListener('change', (e) => {
    const num = Number(e.target.dataset.num);
    if (!num) return;
    if (draft.protocolMode === 'custom') {
      const set = new Set(draft.enabledProtocols);
      e.target.checked ? set.add(num) : set.delete(num);
      draft.enabledProtocols = [...set].sort((a, b) => a - b);
    } else {
      const set = new Set(draft.disabledProtocols);
      e.target.checked ? set.delete(num) : set.add(num);
      draft.disabledProtocols = [...set].sort((a, b) => a - b);
    }
    updateProtoSub();
  });

  renderProtoList();

  g('s-save').addEventListener('click', async () => {
    const freqs = g('s-freq').value.split(',').map((s) => s.trim()).filter(Boolean);
    const patch = {
      rtl433Path: g('s-bin').value.trim(),
      device: g('s-device').value.trim(),
      frequencies: freqs.length ? freqs : ['433.92M'],
      hopInterval: Number(g('s-hop').value) || 600,
      sampleRate: g('s-rate').value,
      gain: g('s-gain').value.trim(),
      ppmError: Number(g('s-ppm').value) || 0,
      protocolMode: draft.protocolMode,
      enabledProtocols: draft.enabledProtocols,
      disabledProtocols: draft.disabledProtocols,
      units: g('s-units').value,
      reportLevel: g('s-level').checked,
      extraArgs: g('s-extra').value,
      adsbPath: g('s-adsb-bin').value.trim(),
      adsbGain: g('s-adsb-gain').value.trim(),
      adsbDevice: g('s-adsb-dev').value.trim(),
      pagerDevice: g('s-pg-dev').value.trim(),
      pagerFreq: g('s-pg-freq').value.trim() || '169.65M',
      pagerGain: g('s-pg-gain').value.trim(),
      sondeDevice: g('s-sd-dev').value.trim(),
      sondeFreq: g('s-sd-freq').value.trim() || '402.7M',
      sondeGain: g('s-sd-gain').value.trim(),
      sondeType: g('s-sd-type').value,
      receiverLat: g('s-rxlat').value.trim(),
      receiverLon: g('s-rxlon').value.trim(),
      aisDevice: g('s-ais-dev').value.trim(),
      aisFreq: g('s-ais-freq').value,
      aisGain: g('s-ais-gain').value.trim(),
      spectrumDevice: g('s-sp-dev').value.trim(),
      spectrumStart: g('s-sp-start').value.trim() || '433M',
      spectrumStop: g('s-sp-stop').value.trim() || '435M',
      spectrumStep: g('s-sp-step').value.trim() || '10k',
      spectrumInterval: Number(g('s-sp-int').value) || 1,
      spectrumGain: g('s-sp-gain').value.trim(),
      mqttEnabled: g('s-mq-on').checked,
      mqttHost: g('s-mq-host').value.trim(),
      mqttPort: Number(g('s-mq-port').value) || 1883,
      mqttUser: g('s-mq-user').value.trim(),
      mqttPass: g('s-mq-pass').value,
      mqttRetain: g('s-mq-retain').checked,
      logEvents: g('s-log').checked,
      logRetentionDays: Number(g('s-log-days').value) || 14,
      closeToTray: g('s-tray').checked,
      alertRules: draft.alertRules || [],
      autoStart: g('s-autostart').checked,
      autoRestart: g('s-autorestart').checked,
      notifyNewDevice: g('s-notifynew').checked,
      notifyLowBattery: g('s-notifybatt').checked,
    };
    store.settings = await window.rtl433.saveSettings(patch);
    draft = { ...store.settings };
    window.updateFreqChip();
    const running = store.status.state === 'running';
    g('s-note').textContent = running ? 'Saved — stop & start the receiver to apply.' : 'Saved.';
    window.toast('Settings saved' + (running ? ' — restart the receiver to apply' : ''), 'success');
    setTimeout(() => (g('s-note').textContent = ''), 4000);
  });

  g('s-copycmd').addEventListener('click', async () => {
    const cmd = await window.rtl433.previewCmd();
    await window.rtl433.copyText(cmd);
    window.toast('Copied: ' + (cmd.length > 96 ? cmd.slice(0, 96) + '…' : cmd), 'success');
  });

  g('s-log-open').addEventListener('click', () => window.rtl433.openLogFolder());

  // ---- alert rules editor ----
  function renderAlertRules() {
    const host = g('s-alert-list');
    const rules = draft.alertRules || [];
    host.innerHTML = rules.length
      ? rules
          .map(
            (r, i) => `<div class="proto-row" style="gap:8px">
          <input type="checkbox" data-al-toggle="${i}" ${r.enabled ? 'checked' : ''} title="Enabled" />
          <span style="font-weight:600;min-width:110px">${r.name ? String(r.name).replace(/</g, '&lt;') : 'Rule'}</span>
          <span style="color:var(--text-2);flex:1">${r.deviceKey ? String(r.deviceKey).split('|')[0] : 'any device'} ·
            ${r.op === 'any' ? 'any event' : `${r.metric} ${r.op === 'changes' ? 'changes' : `${r.op} ${r.value}`}`}
            ${r.from && r.to ? ` · ${r.from}–${r.to}` : ''}</span>
          <button class="btn btn-ghost btn-sm" data-al-del="${i}">✕</button>
        </div>`
          )
          .join('')
      : '<div class="proto-row" style="color:var(--text-3)">No rules yet — add one below.</div>';
  }
  g('s-alert-list').addEventListener('click', (e) => {
    const del = e.target.dataset.alDel;
    if (del != null) {
      draft.alertRules.splice(Number(del), 1);
      renderAlertRules();
    }
  });
  g('s-alert-list').addEventListener('change', (e) => {
    const idx = e.target.dataset.alToggle;
    if (idx != null) draft.alertRules[Number(idx)].enabled = e.target.checked;
  });
  // device dropdown from currently-known devices
  {
    const sel = g('s-al-device');
    for (const dev of store.devices.values()) {
      const o = document.createElement('option');
      o.value = dev.key;
      o.textContent = `${dev.model}${dev.id != null ? ` #${dev.id}` : ''}`;
      sel.appendChild(o);
    }
  }
  g('s-al-add').addEventListener('click', () => {
    const op = g('s-al-op').value;
    const metric = g('s-al-metric').value.trim();
    if (op !== 'any' && !metric) return window.toast('Pick a metric for the rule.', 'error');
    if (['>', '<', '>=', '<=', '=='].includes(op) && !g('s-al-value').value.trim()) {
      return window.toast('The rule needs a comparison value.', 'error');
    }
    draft.alertRules = draft.alertRules || [];
    draft.alertRules.push({
      id: 'al' + Date.now().toString(36),
      name: g('s-al-name').value.trim() || `${metric || 'event'} ${op}`,
      enabled: true,
      deviceKey: g('s-al-device').value,
      metric,
      op,
      value: g('s-al-value').value.trim(),
      from: g('s-al-from').value.trim(),
      to: g('s-al-to').value.trim(),
    });
    g('s-al-name').value = '';
    g('s-al-value').value = '';
    renderAlertRules();
    window.toast('Rule added — remember to Save settings.');
  });
  renderAlertRules();

  function updateProtoSub() {
    const sub = g('s-proto-sub');
    if (draft.protocolMode === 'custom') {
      sub.textContent = `${draft.enabledProtocols.length} protocol${draft.enabledProtocols.length === 1 ? '' : 's'} enabled — only these will be decoded.`;
    } else {
      const n = draft.disabledProtocols.length;
      sub.textContent = n
        ? `Running all default decoders except ${n} disabled.`
        : 'Running all default decoders.';
    }
  }
  updateProtoSub();

  function renderProtoList() {
    const host = g('s-proto-list');
    const isCustom = draft.protocolMode === 'custom';
    const enabled = new Set(draft.enabledProtocols);
    const disabled = new Set(draft.disabledProtocols);
    const rows = [];
    for (const p of protocols) {
      if (protoFilter && !`${p.num} ${p.name}`.toLowerCase().includes(protoFilter)) continue;
      const checked = isCustom ? enabled.has(p.num) : p.default && !disabled.has(p.num);
      const offByDefault = !p.default && !isCustom;
      rows.push(`<label class="proto-row" ${offByDefault ? 'title="Disabled by default in rtl_433 (enable via custom mode)" style="opacity:.5"' : ''}>
        <input type="checkbox" data-num="${p.num}" ${checked ? 'checked' : ''} ${offByDefault ? 'disabled' : ''} />
        <span class="num">${p.num}</span>
        <span>${p.name.replace(/</g, '&lt;')}</span>
      </label>`);
      if (rows.length > 500) break;
    }
    host.innerHTML = rows.join('') || '<div class="proto-row" style="color:var(--text-3)">No protocols match.</div>';
    updateProtoSub();
  }
}
