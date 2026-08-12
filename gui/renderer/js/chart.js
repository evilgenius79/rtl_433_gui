// Minimal SVG time-series line chart.
// Mark specs per the dataviz method: 2px lines, recessive hairline grid,
// crosshair + shared tooltip, no dual axes (one unit family per chart).
import { fmtValue, fmtClock, esc } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = lo; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * Render a line chart into `host` (a .chart-svg-wrap div).
 * series: [{ name, color, key, points: [[tMs, value], ...] }]  (points sorted asc)
 * opts: { height, unit, timeSpanMs }
 */
export function renderLineChart(host, series, opts = {}) {
  const height = opts.height || 260;
  const width = Math.max(320, host.clientWidth || 640);
  host.textContent = '';

  const pad = { l: 46, r: 14, t: 12, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height });
  host.appendChild(svg);

  const allPts = series.flatMap((s) => s.points);
  if (!allPts.length) {
    const t = el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: '#6f7787', 'font-size': 12.5 });
    t.textContent = 'No data yet — waiting for transmissions';
    svg.appendChild(t);
    return;
  }

  const now = Date.now();
  const tMax = opts.timeSpanMs ? now : Math.max(...allPts.map((p) => p[0]));
  const tMin = opts.timeSpanMs ? now - opts.timeSpanMs : Math.min(...allPts.map((p) => p[0]));
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const [t, v] of allPts) {
    if (t < tMin || t > tMax) continue;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  if (!isFinite(vMin)) {
    vMin = 0;
    vMax = 1;
  }
  const vPad = (vMax - vMin) * 0.12 || Math.abs(vMax) * 0.1 || 1;
  vMin -= vPad;
  vMax += vPad;

  const x = (t) => pad.l + ((t - tMin) / Math.max(1, tMax - tMin)) * iw;
  const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * ih;

  // grid + y labels
  for (const tv of niceTicks(vMin, vMax, 5)) {
    const gy = y(tv);
    if (gy < pad.t - 1 || gy > pad.t + ih + 1) continue;
    svg.appendChild(el('line', { x1: pad.l, x2: pad.l + iw, y1: gy, y2: gy, stroke: '#2a2e38', 'stroke-width': 1 }));
    const lbl = el('text', { x: pad.l - 8, y: gy + 4, 'text-anchor': 'end', fill: '#6f7787', 'font-size': 11 });
    lbl.textContent = Math.abs(tv) >= 1000 ? tv.toLocaleString() : String(tv);
    svg.appendChild(lbl);
  }
  // x labels (time)
  const tickCount = Math.max(3, Math.min(7, Math.floor(iw / 110)));
  for (let i = 0; i <= tickCount; i++) {
    const t = tMin + ((tMax - tMin) * i) / tickCount;
    const gx = x(t);
    const lbl = el('text', { x: gx, y: pad.t + ih + 18, 'text-anchor': i === 0 ? 'start' : i === tickCount ? 'end' : 'middle', fill: '#6f7787', 'font-size': 11 });
    lbl.textContent = fmtClock(new Date(t));
    svg.appendChild(lbl);
  }
  // baseline
  svg.appendChild(el('line', { x1: pad.l, x2: pad.l + iw, y1: pad.t + ih, y2: pad.t + ih, stroke: '#3a4050', 'stroke-width': 1 }));

  // series lines
  for (const s of series) {
    const pts = s.points.filter((p) => p[0] >= tMin - 60000 && p[0] <= tMax);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (pts.length === 1) {
      svg.appendChild(el('circle', { cx: x(pts[0][0]), cy: y(pts[0][1]), r: 3.5, fill: s.color }));
    }
  }

  // ---- crosshair + tooltip ----
  const cross = el('line', { y1: pad.t, y2: pad.t + ih, stroke: '#6f7787', 'stroke-width': 1, 'stroke-dasharray': '3,3', visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = series.map((s) => {
    const c = el('circle', { r: 4, fill: s.color, stroke: '#1a1d24', 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(c);
    return c;
  });

  let tip = host.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    host.appendChild(tip);
  }

  const hit = el('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent' });
  svg.appendChild(hit);

  function nearest(pts, t) {
    // binary search closest point by time
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    const cand = [pts[lo], pts[lo - 1]].filter(Boolean);
    cand.sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t));
    return cand[0];
  }

  hit.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const sx = width / box.width;
    const mx = (ev.clientX - box.left) * sx;
    const t = tMin + ((mx - pad.l) / iw) * (tMax - tMin);

    cross.setAttribute('x1', mx);
    cross.setAttribute('x2', mx);
    cross.setAttribute('visibility', 'visible');

    let rows = '';
    let anyT = null;
    series.forEach((s, i) => {
      const p = s.points.length ? nearest(s.points, t) : null;
      if (!p || Math.abs(p[0] - t) > Math.max(120000, (tMax - tMin) * 0.08)) {
        dots[i].setAttribute('visibility', 'hidden');
        return;
      }
      anyT = anyT == null || Math.abs(p[0] - t) < Math.abs(anyT - t) ? p[0] : anyT;
      dots[i].setAttribute('cx', x(p[0]));
      dots[i].setAttribute('cy', y(p[1]));
      dots[i].setAttribute('visibility', 'visible');
      rows += `<div class="tr"><span class="sw" style="background:${s.color}"></span><span>${esc(s.name)}</span><span class="v">${esc(fmtValue(s.key, p[1]))}${opts.unit ? ' ' + esc(opts.unit) : ''}</span></div>`;
    });

    if (!rows) {
      tip.style.display = 'none';
      return;
    }
    tip.innerHTML = `<div class="tt">${fmtClock(new Date(anyT ?? t))}</div>${rows}`;
    tip.style.display = 'block';
    const hostBox = host.getBoundingClientRect();
    const px = ev.clientX - hostBox.left;
    const tw = tip.offsetWidth;
    tip.style.left = `${px + 14 + tw > hostBox.width ? px - tw - 12 : px + 14}px`;
    tip.style.top = `${Math.max(0, ev.clientY - hostBox.top - tip.offsetHeight - 8)}px`;
  });

  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.style.display = 'none';
  });
}

/** Tiny inline sparkline for device cards (single series, no axes). */
export function renderSparkline(host, points, color, spanMs) {
  const w = host.clientWidth || 120;
  const h = 26;
  host.textContent = '';
  if (!points || points.length < 2) return;
  const now = Date.now();
  const tMin = spanMs ? now - spanMs : points[0][0];
  const pts = points.filter((p) => p[0] >= tMin);
  if (pts.length < 2) return;
  let vMin = Math.min(...pts.map((p) => p[1]));
  let vMax = Math.max(...pts.map((p) => p[1]));
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  }
  const pad = (vMax - vMin) * 0.15;
  vMin -= pad;
  vMax += pad;
  const x = (t) => ((t - tMin) / Math.max(1, now - tMin)) * w;
  const y = (v) => 2 + (1 - (v - vMin) / (vMax - vMin)) * (h - 4);
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'none' });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  svg.appendChild(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', opacity: 0.85 }));
  host.appendChild(svg);
}
