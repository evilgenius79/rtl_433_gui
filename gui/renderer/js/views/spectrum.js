// Spectrum view: live sweep trace + scrolling waterfall from rtl_power, and
// an audio monitor (rtl_fm -> Web Audio) sharing the same dongle.
import { store } from '../state.js';
import { esc } from '../format.js';

const root = document.getElementById('view-spectrum');

let lastSweep = null;
let maxHold = null;
let hoverX = null;
let listening = false;
let audioCtx = null;
let gainNode = null;
let nextAudioTime = 0;

const TRACE_H = 170;
const WATER_H = 300;

const PRESETS = [
  { label: 'ISM 433', start: '433M', stop: '435M', step: '10k' },
  { label: 'ISM 868', start: '867M', stop: '869M', step: '10k' },
  { label: 'Pagers', start: '169M', stop: '170.5M', step: '5k' },
  { label: 'Airband', start: '118M', stop: '137M', step: '25k' },
  { label: 'Marine', start: '156M', stop: '163M', step: '10k' },
];

export function initSpectrum() {
  root.innerHTML = `
    <div class="toolbar">
      <div class="preset-chips" id="sp-presets"></div>
      <span class="section-sub" id="sp-range"></span>
      <div class="grow"></div>
      <button class="btn btn-sm" id="sp-maxhold">Max hold</button>
      <span class="section-sub" id="sp-status">stopped</span>
    </div>
    <div class="chart-card" style="padding:12px 14px">
      <div class="sp-wrap">
        <canvas id="sp-trace" height="${TRACE_H}"></canvas>
        <canvas id="sp-water" height="${WATER_H}"></canvas>
        <div class="sp-readout" id="sp-readout" hidden></div>
      </div>
    </div>
    <div class="chart-card" style="padding:14px 16px">
      <div class="chart-head" style="margin-bottom:10px">
        <span class="chart-title">Audio monitor</span>
        <span class="section-sub">tunes the spectrum dongle with rtl_fm — sweeping pauses while listening</span>
      </div>
      <div class="form-field" style="gap:10px">
        <input type="text" id="sp-listen-freq" style="width:130px" placeholder="433.92M" />
        <select id="sp-listen-mode" style="width:90px">
          <option value="fm">FM</option>
          <option value="am">AM</option>
        </select>
        <button class="btn btn-sm btn-primary" id="sp-listen-btn">Listen</button>
        <label class="form-hint" style="display:flex;align-items:center;gap:8px">Volume
          <input type="range" id="sp-volume" min="0" max="100" value="70" style="width:120px" /></label>
        <span class="form-hint" id="sp-listen-status"></span>
      </div>
    </div>
    <div class="empty-state" id="sp-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12h3l2-7 4 14 3-10 2 3h6"/></svg>
      <div class="big">No sweeps yet</div>
      <div class="small">Select <b>Spectrum</b> in the top bar and press <b>Start</b> to sweep with rtl_power — or flip on <b>Demo mode</b> for a synthetic band. Click the trace to read off a frequency.</div>
    </div>`;

  const presetHost = document.getElementById('sp-presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset-chip';
    b.textContent = p.label;
    b.title = `${p.start} – ${p.stop} (${p.step})`;
    b.addEventListener('click', async () => {
      store.settings = await window.rtl433.saveSettings({
        spectrumStart: p.start,
        spectrumStop: p.stop,
        spectrumStep: p.step,
      });
      maxHold = null;
      window.toast(`Sweep range set to ${p.label} — restart the spectrum to apply.`);
    });
    presetHost.appendChild(b);
  }

  document.getElementById('sp-maxhold').addEventListener('click', (e) => {
    if (maxHold) {
      maxHold = null;
      e.target.classList.remove('btn-primary');
    } else {
      maxHold = lastSweep ? [...lastSweep.dbs] : [];
      e.target.classList.add('btn-primary');
    }
  });

  const trace = document.getElementById('sp-trace');
  trace.addEventListener('mousemove', (e) => {
    hoverX = e.offsetX;
    drawTrace();
    const readout = document.getElementById('sp-readout');
    if (lastSweep) {
      const f = freqAt(hoverX);
      readout.hidden = false;
      readout.textContent = `${(f / 1e6).toFixed(4)} MHz`;
      readout.style.left = `${Math.min(e.offsetX + 12, trace.clientWidth - 90)}px`;
    }
  });
  trace.addEventListener('mouseleave', () => {
    hoverX = null;
    document.getElementById('sp-readout').hidden = true;
    drawTrace();
  });
  trace.addEventListener('click', (e) => {
    if (!lastSweep) return;
    const f = freqAt(e.offsetX);
    const mhz = `${(f / 1e6).toFixed(4)}M`;
    document.getElementById('sp-listen-freq').value = mhz;
    window.toast(`Tuned the audio monitor to ${(f / 1e6).toFixed(4)} MHz`);
  });

  document.getElementById('sp-listen-btn').addEventListener('click', toggleListen);
  document.getElementById('sp-volume').addEventListener('input', (e) => {
    if (gainNode) gainNode.gain.value = Number(e.target.value) / 100;
  });

  window.rtl433.onSpectrum((sweep) => {
    lastSweep = sweep;
    if (maxHold && maxHold.length === sweep.dbs.length) {
      for (let i = 0; i < maxHold.length; i++) maxHold[i] = Math.max(maxHold[i], sweep.dbs[i]);
    } else if (maxHold && !maxHold.length) {
      maxHold = [...sweep.dbs];
    }
    if (!root.hidden) {
      document.getElementById('sp-empty').hidden = true;
      drawTrace();
      drawWaterfall(sweep);
      document.getElementById('sp-range').textContent =
        `${(sweep.startHz / 1e6).toFixed(3)} – ${(sweep.stopHz / 1e6).toFixed(3)} MHz · ${sweep.dbs.length.toLocaleString()} bins`;
    }
  });

  window.rtl433.onAudio((buf) => playAudioChunk(buf));

  store.on('status', () => {
    const s = store.modeStatus.spectrum || { state: 'stopped' };
    document.getElementById('sp-status').textContent =
      s.state === 'running' ? (s.submode === 'listen' ? 'listening' : 'sweeping') : s.state;
    if (s.state !== 'running' && listening) setListenUI(false);
  });
}

export function refreshSpectrum() {
  sizeCanvases();
  if (lastSweep) {
    document.getElementById('sp-empty').hidden = true;
    drawTrace();
  }
}

function sizeCanvases() {
  for (const id of ['sp-trace', 'sp-water']) {
    const c = document.getElementById(id);
    const w = c.parentElement.clientWidth - 4;
    if (c.width !== w && w > 100) c.width = w;
  }
}

function freqAt(x) {
  const c = document.getElementById('sp-trace');
  const frac = Math.max(0, Math.min(1, x / c.clientWidth));
  return lastSweep.startHz + frac * (lastSweep.stopHz - lastSweep.startHz);
}

function dbRange() {
  const dbs = lastSweep.dbs;
  let min = Infinity;
  let max = -Infinity;
  for (const v of dbs) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (maxHold) for (const v of maxHold) if (v > max) max = v;
  return [min - 2, Math.max(max + 4, min + 20)];
}

function drawTrace() {
  const c = document.getElementById('sp-trace');
  if (!c || !lastSweep) return;
  sizeCanvases();
  const ctx = c.getContext('2d');
  const { width: W, height: H } = c;
  ctx.fillStyle = '#101218';
  ctx.fillRect(0, 0, W, H);
  const [dbMin, dbMax] = dbRange();
  const y = (db) => H - ((db - dbMin) / (dbMax - dbMin)) * (H - 8) - 4;
  const dbs = lastSweep.dbs;

  // grid
  ctx.strokeStyle = '#2a2e38';
  ctx.lineWidth = 1;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#6f7787';
  for (let g = Math.ceil(dbMin / 10) * 10; g < dbMax; g += 10) {
    const gy = y(g);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
    ctx.fillText(`${g}`, 4, gy - 2);
  }

  // max hold (recessive)
  if (maxHold && maxHold.length === dbs.length) {
    ctx.strokeStyle = 'rgba(217, 89, 38, 0.55)';
    ctx.beginPath();
    for (let i = 0; i < maxHold.length; i++) {
      const px = (i / (dbs.length - 1)) * W;
      i ? ctx.lineTo(px, y(maxHold[i])) : ctx.moveTo(px, y(maxHold[i]));
    }
    ctx.stroke();
  }

  // live trace
  ctx.strokeStyle = '#3987e5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < dbs.length; i++) {
    const px = (i / (dbs.length - 1)) * W;
    i ? ctx.lineTo(px, y(dbs[i])) : ctx.moveTo(px, y(dbs[i]));
  }
  ctx.stroke();

  if (hoverX != null) {
    ctx.strokeStyle = '#6f7787';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hoverX * (W / c.clientWidth), 0);
    ctx.lineTo(hoverX * (W / c.clientWidth), H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// waterfall: scroll down one row per sweep; dB mapped onto a blue ramp
function drawWaterfall(sweep) {
  const c = document.getElementById('sp-water');
  if (!c) return;
  const ctx = c.getContext('2d');
  const { width: W, height: H } = c;
  if (!W) return;
  ctx.drawImage(c, 0, 0, W, H - 1, 0, 1, W, H - 1);
  const [dbMin, dbMax] = dbRange();
  const row = ctx.createImageData(W, 1);
  const dbs = sweep.dbs;
  for (let x = 0; x < W; x++) {
    const i = Math.min(dbs.length - 1, Math.round((x / (W - 1)) * (dbs.length - 1)));
    let t = (dbs[i] - dbMin) / (dbMax - dbMin);
    t = Math.max(0, Math.min(1, t));
    // dark surface -> mid blue -> light blue (single-hue magnitude ramp)
    let r;
    let g;
    let b;
    if (t < 0.55) {
      const u = t / 0.55;
      r = 16 + (57 - 16) * u;
      g = 19 + (135 - 19) * u;
      b = 26 + (229 - 26) * u;
    } else {
      const u = (t - 0.55) / 0.45;
      r = 57 + (205 - 57) * u;
      g = 135 + (226 - 135) * u;
      b = 229 + (251 - 229) * u;
    }
    const o = x * 4;
    row.data[o] = r;
    row.data[o + 1] = g;
    row.data[o + 2] = b;
    row.data[o + 3] = 255;
  }
  ctx.putImageData(row, 0, 0);
}

// ---- audio monitor ----
function setListenUI(on) {
  listening = on;
  const btn = document.getElementById('sp-listen-btn');
  btn.textContent = on ? 'Stop listening' : 'Listen';
  btn.classList.toggle('btn-danger', on);
  btn.classList.toggle('btn-primary', !on);
  document.getElementById('sp-listen-status').textContent = on ? 'live audio — sweep paused' : '';
}

async function toggleListen() {
  if (listening) {
    await window.rtl433.listenStop();
    setListenUI(false);
    return;
  }
  const freq = document.getElementById('sp-listen-freq').value.trim() || '433.92M';
  const demod = document.getElementById('sp-listen-mode').value;
  const res = await window.rtl433.listenStart({ freq, demod });
  if (res.ok === false) {
    window.toast(res.error || 'Could not start audio', 'error');
    return;
  }
  if (!audioCtx) {
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(document.getElementById('sp-volume').value) / 100;
    gainNode.connect(audioCtx.destination);
  }
  audioCtx.resume();
  nextAudioTime = 0;
  setListenUI(true);
}

function playAudioChunk(data) {
  if (!listening || !audioCtx) return;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const usable = bytes.length & ~1;
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
  if (!samples.length) return;
  const buf = audioCtx.createBuffer(1, samples.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  const now = audioCtx.currentTime;
  if (nextAudioTime < now + 0.05) nextAudioTime = now + 0.08;
  src.start(nextAudioTime);
  nextAudioTime += buf.duration;
}
