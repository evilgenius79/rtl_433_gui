# rtl_433 GUI

A polished desktop GUI for [rtl_433](https://github.com/merbanan/rtl_433) and
friends, built for Windows (runs on Linux/macOS too) — an RTL-SDR signal
console with six receiver modes that run concurrently across multiple dongles.

![dashboard](docs/dashboard.png)

## Features

- **Dashboard (ISM sensors)** — live cards for every device heard, with
  headline reading, sparkline, signal bars, low-battery warnings, category
  filter and last-seen age. Click a card to chart it.
- **Events** — filterable, pausable log of every decoded transmission with
  expandable raw JSON, CSV / NDJSON export, and optional daily NDJSON logging
  to disk with retention.
- **Charts** — time-series of any recorded metric, overlaying up to three
  devices, with crosshair tooltips and 15 min / 1 h / 6 h / all ranges.
  Device history persists across restarts.
- **Aircraft (ADS-B, 1090 MHz)** — altitude-colored planes with trails on a
  dark map, airline lookup, range rings, per-bearing coverage plot and
  max-range stat; Mode S decoded in-app (CRC + CPR, reference-vector tested).
- **Pagers (POCSAG)** — 512/1200/2400 baud decoded in-app with BCH error
  correction; live message table with export.
- **Radiosonde** — RS41 / DFM / M10 / M20 / iMet-54 balloons on the map with
  altitude, climb, wind and PTU telemetry via the bundled rs1729/RS decoders.
- **Ships (AIS)** — vessels with wakes on the map, decoded in-app (HDLC,
  CRC-16/X.25, position + static reports).
- **Spectrum + tuner** — rtl_power sweeps with live trace, max hold and
  waterfall; band presets; plus a general-coverage tuner (WFM / NBFM / AM /
  USB / LSB) with step buttons, squelch and bookmarks — click a peak on the
  trace to tune it.
- **Alert rules** — thresholds, change detection and time windows per
  device/metric, with desktop notifications and a dashboard alert strip.
- **Integrations** — MQTT output for Home Assistant, straight from rtl_433.
- **Console** — every pipeline's stderr stream for troubleshooting.
- **Settings** — per-mode SDR device selection (multi-dongle), frequencies
  with presets and hopping, gains, PPM, per-protocol decoder toggles (all 378
  rtl_433 protocols), units, receiver location, tray behavior, auto-start /
  auto-restart, notifications and free-form extra arguments.
- **Demo mode** — every mode has a realistic simulator; explore the whole app
  with no hardware.
- **Auto-update** — packaged builds update themselves from GitHub Releases.
- **About tab** — in-app credits for every project this app builds on, with
  licenses and links.

Each mode runs its receiver tool as a managed child process and the exact
command line used is always shown in the Console view; POCSAG, Mode S/ADS-B
and AIS are decoded in the app itself with unit tests against published
reference vectors.

## Running from source

Requires [Node.js](https://nodejs.org) 20+.

```sh
cd gui
npm install
npm start          # normal mode (expects rtl_433 on PATH or set in Settings)
npm run start:demo # demo mode, no hardware needed
```

## Installing on Windows

Grab **`rtl_433 GUI Setup <version>.exe`** from the repository's
[Releases](../../../releases) page (or the portable `.zip` if you prefer no
installer) and run it — all receiver tools are bundled, and the app keeps
itself up to date from Releases.

## Building the Windows installer

```sh
cd gui
npm install
npm run dist       # produces dist/rtl_433 GUI Setup <version>.exe (NSIS) + portable zip
```

(On Linux/macOS the NSIS step needs Wine; the portable Windows zip builds
everywhere.)

The GitHub Actions workflow `.github/workflows/build-gui.yml` builds the
installer on every push that touches `gui/`, uploading it as a build artifact —
and pushing a tag like **`gui-v0.1.0`** publishes it automatically as a GitHub
Release with the `.exe` attached.

### Bundled binaries

Installer and zip builds ship with statically linked, self-contained tools,
cross-compiled by `gui/scripts/build-rtl433-win64.sh` (run automatically in
CI) — no separate installs needed:

| Binary | Source | Used for |
|---|---|---|
| `rtl_433.exe` | this repository (GPL-2) | ISM sensor decoding |
| `rtl_adsb.exe` | osmocom rtl-sdr tools (GPL-2) | raw Mode S frames for the aircraft map |
| `rtl_fm.exe` | osmocom rtl-sdr tools (GPL-2) | FM demodulation for pagers, sondes, AIS & listening |
| `rtl_power.exe` | osmocom rtl-sdr tools (GPL-2) | spectrum sweeps |
| `rs41mod.exe`, `dfm09mod.exe`, `m10mod.exe`, `m20mod.exe`, `imet54mod.exe` | [rs1729/RS](https://github.com/rs1729/RS) (GPL-3) | radiosonde telemetry |

POCSAG, Mode S/ADS-B and AIS decoding is implemented in the app itself
(`main/pocsag.js`, `main/modes.js`, `main/ais.js`) with unit tests against
published reference vectors.

The app looks for `rtl_433.exe` in this order:

1. the path configured in **Settings → Receiver**,
2. the bundled copy (`resources/rtl_433/rtl_433.exe`, or `gui/vendor/rtl_433/`
   when running from source),
3. `%ProgramFiles%\rtl_433\rtl_433.exe` (and `C:\rtl_433\rtl_433.exe`),
4. next to the app's resources,
5. `rtl_433` on the `PATH`.

Note: your RTL-SDR dongle still needs the WinUSB driver — install it once with
[Zadig](https://zadig.akeo.ie/) if rtl_433 reports no device found.

## Development notes

- `main/` — Electron main process: window, settings persistence
  (`settings.json` in the user-data dir), the rtl_433 process manager and the
  demo-mode synthesizer. No runtime npm dependencies.
- `renderer/` — vanilla ES-module UI, no framework. The renderer is sandboxed
  (`contextIsolation`, no `nodeIntegration`) and talks to the main process only
  through the `window.rtl433` bridge in `main/preload.js`.
- `data/protocols.json` — decoder list harvested from `rtl_433 -R`; regenerate
  with a current binary when protocols change upstream.
- Screenshots for docs/CI: `RTL433_SCREENSHOT_DIR=out RTL433_DEMO_SPEED=20
  electron . --demo` captures every view and exits.
