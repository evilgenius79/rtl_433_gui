'use strict';
// Generates assets/icon.png (512px) and assets/icon.ico (multi-size, PNG-packed)
// from an inline SVG. Run with: xvfb-run electron scripts/gen-icon.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c2531"/>
      <stop offset="1" stop-color="#10131a"/>
    </linearGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5ea3f0"/>
      <stop offset="1" stop-color="#2a6fc4"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="4"/>
  <g stroke="url(#wave)" stroke-width="30" stroke-linecap="round" fill="none">
    <path d="M136 342c-47-48-47-124 0-172"/>
    <path d="M376 170c47 48 47 124 0 172"/>
  </g>
  <g stroke="#7db8f5" stroke-width="26" stroke-linecap="round" fill="none" opacity="0.85">
    <path d="M188 310c-30-30-30-78 0-108"/>
    <path d="M324 202c30 30 30 78 0 108"/>
  </g>
  <circle cx="256" cy="256" r="42" fill="url(#wave)"/>
  <circle cx="256" cy="256" r="42" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="4"/>
</svg>`;

function buildIco(pngs) {
  // ICO container with PNG-compressed entries (valid on Windows Vista+)
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512, webPreferences: { offscreen: true } });
  await win.loadURL('data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });

  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.png'), img.toPNG());

  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = sizes.map((size) => ({
    size,
    buf: nativeImage.createFromBuffer(img.toPNG()).resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(pngs));
  console.log('wrote icon.png (512) and icon.ico', sizes.join('/'));
  app.quit();
});
