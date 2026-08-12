// Console view: rtl_433 stderr / app log stream.
import { store } from '../state.js';
import { fmtClock } from '../format.js';

const root = document.getElementById('view-console');
let autoScroll = true;
let held = false; // user scrolled up: hold auto-scroll until they return to the bottom
let rendered = 0;

export function initConsole() {
  root.innerHTML = `
    <div class="toolbar">
      <span class="section-sub">Output from the rtl_433 process (stderr) and app notices.</span>
      <div class="grow"></div>
      <label class="demo-toggle" style="padding:4px 6px">
        <input type="checkbox" id="con-autoscroll" checked />
        <span class="switch"></span>
        <span>Auto-scroll</span>
      </label>
      <button class="btn btn-sm" id="con-clear">Clear</button>
    </div>
    <div class="console-wrap" id="con-log" aria-live="polite"></div>`;

  document.getElementById('con-autoscroll').addEventListener('change', (e) => {
    autoScroll = e.target.checked;
  });
  document.getElementById('con-clear').addEventListener('click', () => {
    store.clearLogs();
  });

  // reading back-scroll? hold the auto-scroll until the user returns to the bottom
  const logHost = document.getElementById('con-log');
  logHost.addEventListener('scroll', () => {
    held = logHost.scrollTop + logHost.clientHeight < logHost.scrollHeight - 30;
  });

  store.on('logs', render);
  render();
}

function classify(entry) {
  if (entry.stream === 'app') return /error/i.test(entry.line) ? 'err' : 'app';
  if (/error|fail|usage:/i.test(entry.line)) return 'err';
  return entry.stream;
}

function render() {
  const host = document.getElementById('con-log');
  if (store.logs.length < rendered) {
    host.textContent = '';
    rendered = 0;
  }
  const frag = document.createDocumentFragment();
  for (let i = rendered; i < store.logs.length; i++) {
    const entry = store.logs[i];
    const div = document.createElement('div');
    div.className = `console-line ${classify(entry)}`;
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = fmtClock(new Date(entry.ts));
    div.appendChild(ts);
    div.appendChild(document.createTextNode(entry.line));
    frag.appendChild(div);
  }
  rendered = store.logs.length;
  host.appendChild(frag);
  // cap DOM nodes
  while (host.childNodes.length > 3000) host.removeChild(host.firstChild);
  if (autoScroll && !held) host.scrollTop = host.scrollHeight;
}
