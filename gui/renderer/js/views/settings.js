// Settings view: receiver, radio, decoder and output configuration.
// Values map 1:1 onto rtl_433 command-line options (built in main/rtl433.js).
import { store } from '../state.js';

const root = document.getElementById('view-settings');

const FREQ_PRESETS = [
  { label: '433.92 MHz', value: '433.92M' },
  { label: '868.3 MHz', value: '868.3M' },
  { label: '915 MHz', value: '915M' },
  { label: '315 MHz', value: '315M' },
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
        <div><div class="form-label">SDR device</div>
          <div class="form-hint">RTL-SDR index (0,1,…), :serial, or a SoapySDR query. Empty = first device.</div></div>
        <div class="form-field"><input type="text" id="s-device" class="wide" placeholder="0" /></div>
      </div>
    </div>

    <div class="settings-card">
      <h3>Radio</h3>
      <div class="card-sub">Tuning and demodulation parameters.</div>
      <div class="form-row">
        <div><div class="form-label">Frequency</div>
          <div class="form-hint">Comma-separate several to hop between them.</div></div>
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
  g('s-autostart').checked = !!draft.autoStart;
  g('s-autorestart').checked = !!draft.autoRestart;
  g('s-notifynew').checked = !!draft.notifyNewDevice;
  g('s-notifybatt').checked = draft.notifyLowBattery !== false;

  const presetHost = g('s-freq-presets');
  for (const p of FREQ_PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-chip';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      g('s-freq').value = p.value;
      markPresets();
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
