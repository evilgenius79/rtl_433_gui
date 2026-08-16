'use strict';
// Manages the rtl_433 child process: builds the argument list from settings,
// spawns it, splits stdout into JSON events and stderr into log lines.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

// Locations probed (in order) when no explicit binary path is configured.
function candidateBinaries() {
  const exe = process.platform === 'win32' ? 'rtl_433.exe' : 'rtl_433';
  const cands = [];
  // the copy bundled with the app (extraResources in packaged builds,
  // gui/vendor in a from-source checkout)
  cands.push(path.join(process.resourcesPath || '.', 'rtl_433', exe));
  cands.push(path.join(__dirname, '..', 'vendor', 'rtl_433', exe));
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'];
    const pf86 = process.env['ProgramFiles(x86)'];
    if (pf) cands.push(path.join(pf, 'rtl_433', exe));
    if (pf86) cands.push(path.join(pf86, 'rtl_433', exe));
    cands.push(path.join('C:\\rtl_433', exe));
  }
  // a copy dropped next to the app resources (portable bundles)
  cands.push(path.join(process.resourcesPath || '.', exe));
  cands.push(exe); // finally: rely on PATH
  return cands;
}

function resolveBinary(configured) {
  if (configured && configured.trim()) return configured.trim();
  for (const c of candidateBinaries()) {
    if (c.includes(path.sep) && fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'rtl_433.exe' : 'rtl_433';
}

// Parse an rtl_433-style frequency/rate string ("915M", "433.92M", "1024k",
// plain Hz) into Hz. Returns NaN when it doesn't look like a number.
function freqToHz(v) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmMgG]?)/.exec(String(v));
  if (!m) return NaN;
  const mult = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }[m[2]];
  return parseFloat(m[1]) * mult;
}

// rtl_433's built-in default sample rate (250k) is only wide enough for the
// 433/315 MHz bands. 868 MHz FSK sensors and especially the 902–928 MHz
// hopping US utility meters are undecodable at 250k — verified by replaying
// reference captures: ERT-SCM decodes at 1024k, silently never at 250k.
// So when the user tunes high but leaves the rate on default, pick 1024k.
function needsWideRate(s) {
  if (s.sampleRate) return false;
  return (s.frequencies || []).some((f) => freqToHz(f) >= 600e6);
}

// Translate the settings object into an rtl_433 argv array.
function buildArgs(s) {
  const args = [];
  if (s.device) args.push('-d', String(s.device));
  for (const f of s.frequencies || []) {
    if (String(f).trim()) args.push('-f', String(f).trim());
  }
  if ((s.frequencies || []).filter((f) => String(f).trim()).length > 1 && s.hopInterval) {
    args.push('-H', String(s.hopInterval));
  }
  if (s.sampleRate) args.push('-s', String(s.sampleRate));
  else if (needsWideRate(s)) args.push('-s', '1024k');
  if (s.gain !== '' && s.gain != null) args.push('-g', String(s.gain));
  if (s.ppmError) args.push('-p', String(s.ppmError));

  if (s.protocolMode === 'custom') {
    for (const n of s.enabledProtocols || []) args.push('-R', String(n));
  } else {
    for (const n of s.disabledProtocols || []) args.push('-R', String(-Math.abs(n)));
  }

  if (s.units && s.units !== 'native') args.push('-C', s.units);
  args.push('-M', 'time:iso:usec:tz');
  if (s.reportLevel) args.push('-M', 'level');
  if (s.reportProtocol) args.push('-M', 'protocol');

  if (s.extraArgs && s.extraArgs.trim()) {
    // naive shell-ish split honoring double quotes
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s.extraArgs)) !== null) args.push(m[1] != null ? m[1] : m[2]);
  }

  // without an explicit log output, rtl_433 suppresses its own errors and
  // warnings once another -F output is set — keep them flowing to stderr
  args.push('-F', 'log');
  args.push('-F', 'json'); // line-delimited JSON on stdout is our transport

  // optional MQTT republishing straight from rtl_433 (Home Assistant et al.)
  if (s.mqttEnabled && s.mqttHost) {
    let mqtt = `mqtt://${s.mqttHost}:${s.mqttPort || 1883}`;
    if (s.mqttUser) mqtt += `,user=${s.mqttUser}`;
    if (s.mqttPass) mqtt += `,pass=${s.mqttPass}`;
    if (s.mqttRetain) mqtt += ',retain=1';
    args.push('-F', mqtt);
  }
  return args;
}

// translate rtl_433's stderr failure signatures into actionable messages
const STDERR_HINTS = [
  [/usb_open error|usb_claim_interface|Device or resource busy|rtlsdr_open/i,
    'the SDR could not be opened — it may be in use by another mode, or (on Windows) this dongle still needs its WinUSB driver installed with Zadig. Each dongle needs Zadig run once.'],
  [/No supported devices found|no device found/i,
    'no SDR was found — check the dongle is plugged in and (on Windows) has the WinUSB driver via Zadig; with several dongles, check the device index in Settings.'],
  [/Failed to open rtlsdr device/i,
    'the selected device index does not exist — with one dongle use 0, with two use 0 and 1 (see Settings).'],
];

class Rtl433Process extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.stopping = false;
    this._stdoutBuf = '';
    this._stderrBuf = '';
    this._stderrHint = null;
  }

  get running() {
    return !!this.child;
  }

  start(settings) {
    if (this.child) return { ok: false, error: 'already running' };
    const bin = resolveBinary(settings.rtl433Path);
    const args = buildArgs(settings);
    this.stopping = false;

    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    this.child = child;
    this.emit('status', { state: 'running', pid: child.pid, binary: bin, args });
    this.emit('log', { stream: 'app', line: `$ ${bin} ${args.join(' ')}` });
    if (needsWideRate(settings)) {
      this.emit('log', {
        stream: 'app',
        line: 'note: sample rate defaulted to 1024k — rtl_433’s 250k default is too narrow to decode 868/915 MHz signals',
      });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this._stdoutBuf += chunk;
      let idx;
      while ((idx = this._stdoutBuf.indexOf('\n')) >= 0) {
        const line = this._stdoutBuf.slice(0, idx).trim();
        this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          this.emit('event', JSON.parse(line));
        } catch (e) {
          this.emit('log', { stream: 'stdout', line });
        }
      }
    });

    this._stderrHint = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this._stderrBuf += chunk;
      let idx;
      while ((idx = this._stderrBuf.indexOf('\n')) >= 0) {
        const line = this._stderrBuf.slice(0, idx).replace(/\r$/, '');
        this._stderrBuf = this._stderrBuf.slice(idx + 1);
        if (!line.trim()) continue;
        this.emit('log', { stream: 'stderr', line });
        if (!this._stderrHint) {
          for (const [re, hint] of STDERR_HINTS) {
            if (re.test(line)) {
              this._stderrHint = hint;
              break;
            }
          }
        }
      }
    });

    child.on('error', (e) => {
      // spawn failure (ENOENT etc.) — surface a friendly message
      this.child = null;
      const hint =
        e.code === 'ENOENT'
          ? `rtl_433 binary not found ("${bin}"). Set its location in Settings.`
          : e.message;
      this.emit('status', { state: 'error', error: hint });
      this.emit('log', { stream: 'app', line: `error: ${hint}` });
    });

    // 'close' (not 'exit') so all stderr has been delivered before we decide
    // what error message to show
    child.on('close', (code, signal) => {
      const wasStopping = this.stopping;
      this.child = null;
      this.stopping = false;
      // scan any trailing stderr that arrived without a final newline
      if (!this._stderrHint && this._stderrBuf.trim()) {
        for (const [re, hint] of STDERR_HINTS) {
          if (re.test(this._stderrBuf)) {
            this._stderrHint = hint;
            break;
          }
        }
      }
      this._stderrBuf = '';
      const why = signal ? `signal ${signal}` : `exit code ${code}`;
      this.emit('log', { stream: 'app', line: `rtl_433 stopped (${why})` });
      const failed = !wasStopping && code !== 0;
      this.emit('status', {
        state: failed ? 'error' : 'stopped',
        error: failed
          ? this._stderrHint
            ? `rtl_433 failed: ${this._stderrHint}`
            : `rtl_433 exited unexpectedly (${why}) — see the Console view for details`
          : undefined,
        code,
        signal,
      });
    });

    return { ok: true, pid: child.pid };
  }

  stop() {
    if (!this.child) return { ok: true };
    this.stopping = true;
    const child = this.child;
    try {
      if (process.platform === 'win32') {
        child.kill(); // rtl_433 handles CTRL events; TerminateProcess as fallback
      } else {
        child.kill('SIGINT'); // let it flush and close the SDR cleanly
      }
    } catch (e) {
      /* already gone */
    }
    // escalate if it lingers
    setTimeout(() => {
      if (this.child === child) {
        try {
          child.kill('SIGKILL');
        } catch (e) {
          /* already gone */
        }
      }
    }, 3000);
    return { ok: true };
  }
}

module.exports = { Rtl433Process, buildArgs, resolveBinary, freqToHz };
