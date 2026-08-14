// About view: credit to the projects and references this app is built on.
// Links open in the system browser (the main process routes target=_blank
// externally and blocks in-app navigation).

const root = document.getElementById('view-about');

const PROJECTS = [
  {
    name: 'rtl_433',
    by: 'Benjamin Larsson (merbanan) & contributors',
    license: 'GPL-2.0',
    url: 'https://github.com/merbanan/rtl_433',
    role: 'The heart of it all — decodes 380+ ISM-band sensor protocols. This app is built in a fork of it, and the bundled rtl_433.exe is compiled from that source.',
  },
  {
    name: 'rtl-sdr (Osmocom)',
    by: 'Osmocom project, Steve Markgraf & contributors',
    license: 'GPL-2.0',
    url: 'https://github.com/osmocom/rtl-sdr',
    role: 'librtlsdr and the bundled tools: rtl_fm (pagers, sondes, AIS, tuner audio), rtl_adsb (aircraft frames) and rtl_power (spectrum sweeps).',
  },
  {
    name: 'libusb',
    by: 'libusb project',
    license: 'LGPL-2.1',
    url: 'https://libusb.info',
    role: 'USB access to the RTL dongles, statically linked into every bundled tool.',
  },
  {
    name: 'RS — radiosonde decoders',
    by: 'rs1729 (Zilog80)',
    license: 'GPL-3.0',
    url: 'https://github.com/rs1729/RS',
    role: 'The reference weather-balloon decoders bundled for the Radiosonde view: rs41mod, dfm09mod, m10mod, m20mod and imet54mod.',
  },
  {
    name: 'Leaflet',
    by: 'Volodymyr Agafonkin & contributors',
    license: 'BSD-2-Clause',
    url: 'https://leafletjs.com',
    role: 'The interactive maps under the aircraft, ships and radiosonde views.',
  },
  {
    name: 'OpenStreetMap',
    by: '© OpenStreetMap contributors',
    license: 'ODbL',
    url: 'https://www.openstreetmap.org/copyright',
    role: 'The map tiles themselves — drawn by a worldwide community of volunteer mappers.',
  },
  {
    name: 'Electron',
    by: 'OpenJS Foundation & contributors',
    license: 'MIT',
    url: 'https://www.electronjs.org',
    role: 'The cross-platform desktop shell this app runs in (Chromium + Node.js).',
  },
  {
    name: 'electron-builder & electron-updater',
    by: 'electron-userland',
    license: 'MIT',
    url: 'https://www.electron.build',
    role: 'The Windows installer, portable builds and automatic updates.',
  },
];

const REFERENCES = [
  {
    name: 'The 1090 Megahertz Riddle',
    by: 'Junzi Sun (TU Delft)',
    url: 'https://mode-s.org',
    role: 'The open guide to Mode S / ADS-B — this app’s in-app decoder (CRC, CPR position math, velocity) was written and unit-tested against its worked examples.',
  },
  {
    name: 'AIVDM/AIVDO protocol decoding',
    by: 'Eric S. Raymond & the gpsd project',
    url: 'https://gpsd.gitlab.io/gpsd/AIVDM.html',
    role: 'The de-facto AIS reference — the in-app AIS decoder is validated against its canonical example sentence.',
  },
  {
    name: 'ITU-R M.584 (POCSAG)',
    by: 'International Telecommunication Union',
    url: 'https://www.itu.int/rec/R-REC-M.584',
    role: 'The pager protocol standard behind the in-app POCSAG decoder, anchored to its published sync and idle codewords.',
  },
];

function projectCard(p) {
  return `<div class="credit-card">
    <div class="credit-head">
      <a href="${p.url}" target="_blank" class="credit-name">${p.name}</a>
      <span class="chip">${p.license}</span>
    </div>
    <div class="credit-by">${p.by}</div>
    <div class="credit-role">${p.role}</div>
    <a href="${p.url}" target="_blank" class="credit-link">${p.url.replace('https://', '')}</a>
  </div>`;
}

export async function initAbout() {
  let version = '';
  try {
    version = await window.rtl433.getVersion();
  } catch (e) {
    /* fine */
  }
  root.innerHTML = `
    <div class="about-hero">
      <svg class="brand-mark" style="width:40px;height:40px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
        <circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
      </svg>
      <div>
        <div class="about-title">rtl_433 GUI ${version ? `<span class="chip">v${version}</span>` : ''}</div>
        <div class="section-sub">An RTL-SDR signal console — free software under GPL-2.0-or-later.
          <a href="https://github.com/evilgenius79/rtl_433_gui" target="_blank">Source &amp; releases on GitHub</a></div>
      </div>
    </div>

    <div class="section-head" style="margin-top:20px">
      <h2 class="section-title">Standing on the shoulders of</h2>
      <span class="section-sub">the projects whose work makes this app possible — click through and star them</span>
    </div>
    <div class="credit-grid">${PROJECTS.map(projectCard).join('')}</div>

    <div class="section-head" style="margin-top:22px">
      <h2 class="section-title">Protocol references</h2>
      <span class="section-sub">the documentation the in-app decoders were written and tested against</span>
    </div>
    <div class="credit-grid">${REFERENCES.map((r) => projectCard({ ...r, license: 'reference' })).join('')}</div>

    <p class="about-foot">
      Thanks as well to the wider RTL-SDR community, whose reverse-engineering of a
      $10 DVB-T dongle into a general-purpose receiver made this whole category of
      software possible.
    </p>`;
}
