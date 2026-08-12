// Field metadata: labels, units and formatting for well-known rtl_433 keys.
// Anything numeric that is not listed and not excluded is still chartable,
// shown with its raw key name.

export const FIELD_META = {
  temperature_C: { label: 'Temperature', unit: '°C', dp: 1 },
  temperature_F: { label: 'Temperature', unit: '°F', dp: 1 },
  temperature_1_C: { label: 'Temperature 1', unit: '°C', dp: 1 },
  temperature_2_C: { label: 'Temperature 2', unit: '°C', dp: 1 },
  setpoint_C: { label: 'Setpoint', unit: '°C', dp: 1 },
  humidity: { label: 'Humidity', unit: '%', dp: 0 },
  humidity_1: { label: 'Humidity 1', unit: '%', dp: 0 },
  humidity_2: { label: 'Humidity 2', unit: '%', dp: 0 },
  moisture: { label: 'Moisture', unit: '%', dp: 0 },
  wind_avg_km_h: { label: 'Wind', unit: 'km/h', dp: 1 },
  wind_avg_m_s: { label: 'Wind', unit: 'm/s', dp: 1 },
  wind_max_km_h: { label: 'Gust', unit: 'km/h', dp: 1 },
  wind_max_m_s: { label: 'Gust', unit: 'm/s', dp: 1 },
  wind_dir_deg: { label: 'Wind dir', unit: '°', dp: 0 },
  rain_mm: { label: 'Rain', unit: 'mm', dp: 2 },
  rain_in: { label: 'Rain', unit: 'in', dp: 2 },
  rain_rate_mm_h: { label: 'Rain rate', unit: 'mm/h', dp: 1 },
  pressure_hPa: { label: 'Pressure', unit: 'hPa', dp: 1 },
  pressure_kPa: { label: 'Pressure', unit: 'kPa', dp: 1 },
  pressure_PSI: { label: 'Pressure', unit: 'PSI', dp: 1 },
  battery_V: { label: 'Battery', unit: 'V', dp: 2 },
  battery_mV: { label: 'Battery', unit: 'mV', dp: 0 },
  supercap_V: { label: 'Supercap', unit: 'V', dp: 2 },
  power_W: { label: 'Power', unit: 'W', dp: 1 },
  energy_kWh: { label: 'Energy', unit: 'kWh', dp: 2 },
  current_A: { label: 'Current', unit: 'A', dp: 2 },
  voltage_V: { label: 'Voltage', unit: 'V', dp: 1 },
  uv: { label: 'UV index', unit: '', dp: 0 },
  uvi: { label: 'UV index', unit: '', dp: 1 },
  light_lux: { label: 'Light', unit: 'lx', dp: 0 },
  co2_ppm: { label: 'CO₂', unit: 'ppm', dp: 0 },
  pm2_5_ug_m3: { label: 'PM2.5', unit: 'µg/m³', dp: 1 },
  pm10_ug_m3: { label: 'PM10', unit: 'µg/m³', dp: 1 },
  depth_cm: { label: 'Depth', unit: 'cm', dp: 0 },
  rssi: { label: 'RSSI', unit: 'dB', dp: 1 },
  snr: { label: 'SNR', unit: 'dB', dp: 1 },
  noise: { label: 'Noise', unit: 'dB', dp: 1 },
};

// keys never treated as sensor metrics
export const NON_METRIC_KEYS = new Set([
  'time', 'model', 'id', 'channel', 'protocol', 'subtype', 'mic', 'mod',
  'freq', 'freq1', 'freq2', 'brand', 'type', 'event', 'code', 'data', 'rows',
  'flags', 'state', 'button', 'cmd', 'group', 'unit', 'learn', 'test',
  'battery_ok', 'heartbeat', 'ad_raw', 'boost', 'raw_msg', 'msg_type',
  'counter', 'sequence', 'seq',
  // binary status flags — shown as text, not charted
  'contact_open', 'reed_open', 'alarm', 'tamper', 'motion', 'tilt',
  'occupancy', 'battery_low', 'pairing', 'closed', 'opened',
]);

// priority order when picking a card's headline metric
const PRIMARY_ORDER = [
  'temperature_C', 'temperature_F', 'moisture', 'pressure_kPa', 'pressure_PSI',
  'wind_avg_km_h', 'wind_avg_m_s', 'power_W', 'humidity', 'co2_ppm',
  'pm2_5_ug_m3', 'depth_cm', 'light_lux', 'rain_mm',
];

const SIGNAL_KEYS = new Set(['rssi', 'snr', 'noise']);

export function isMetricKey(key, value) {
  return typeof value === 'number' && !NON_METRIC_KEYS.has(key) && !SIGNAL_KEYS.has(key);
}

export function metricKeysOf(evt) {
  return Object.keys(evt).filter((k) => isMetricKey(k, evt[k]));
}

export function pickPrimary(evt) {
  for (const k of PRIMARY_ORDER) {
    if (typeof evt[k] === 'number') return k;
  }
  const rest = metricKeysOf(evt);
  return rest.length ? rest[0] : null;
}

export function labelOf(key) {
  return FIELD_META[key]?.label || key.replace(/_/g, ' ');
}

export function unitOf(key) {
  return FIELD_META[key]?.unit ?? '';
}

export function fmtValue(key, v) {
  if (typeof v !== 'number') return String(v);
  const dp = FIELD_META[key]?.dp;
  return dp != null ? v.toFixed(dp) : String(Math.round(v * 100) / 100);
}

export function fmtValueUnit(key, v) {
  const u = unitOf(key);
  return fmtValue(key, v) + (u ? ` ${u}` : '');
}

// One-line human summary of an event's interesting fields.
export function summarize(evt, max = 4) {
  const parts = [];
  for (const k of metricKeysOf(evt)) {
    parts.push(`${labelOf(k)} ${fmtValueUnit(k, evt[k])}`);
    if (parts.length >= max) break;
  }
  if (!parts.length) {
    for (const k of ['state', 'event', 'code', 'button', 'cmd']) {
      if (evt[k] != null) {
        parts.push(`${k}: ${String(evt[k]).slice(0, 24)}`);
        if (parts.length >= 2) break;
      }
    }
  }
  return parts.join(' · ');
}

export function deviceKey(evt) {
  return [evt.model || '?', evt.id ?? '', evt.channel ?? ''].join('|');
}

export function deviceTitle(dev) {
  return dev.model || 'Unknown device';
}

export function fmtClock(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// rssi (dB, typically -25..0 with rtl_433's relative scale) -> 0..4 bars
export function signalLevel(rssi) {
  if (typeof rssi !== 'number') return 0;
  if (rssi > -5) return 4;
  if (rssi > -10) return 3;
  if (rssi > -15) return 2;
  return 1;
}

// HTML-escape any value derived from decoded RF data before it goes into
// innerHTML — model/id/state strings are external input.
export function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseEventTime(evt) {
  if (evt.time) {
    const t = Date.parse(String(evt.time).replace(' ', 'T'));
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}
