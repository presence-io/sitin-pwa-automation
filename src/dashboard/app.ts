import {
  DB_URL, fbPut, fbGet, fbPatch, fbDelete, fbListen,
  type DeviceInfo, type RemoteCommand, type CommandProgress,
} from '../shared/firebase';

const TESTS_BASE_URL = 'https://presence-io.github.io/sitin-pwa-automation/tests';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── State ──

interface DashboardState {
  project: string | null;
  manifest: any | null;
  devices: DeviceInfo[];
  selectedDevices: Set<string>;
  suites: any[];
  selectedSuite: number;
  activeCmd: string | null;
  results: Map<string, CommandProgress>;
  history: RemoteCommand[];
}

const state: DashboardState = {
  project: localStorage.getItem('autobot_dashboard_project') || null,
  manifest: null,
  devices: [],
  selectedDevices: new Set(),
  suites: [],
  selectedSuite: -1,
  activeCmd: null,
  results: new Map(),
  history: [],
};

let devicesSource: EventSource | null = null;
let resultsSource: EventSource | null = null;

// ── Firebase helpers ──

async function fetchManifest(): Promise<any> {
  try {
    const resp = await fetch(`${TESTS_BASE_URL}/manifest.json`, { cache: 'no-cache' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function fetchSuite(projectId: string, file: string): Promise<any> {
  try {
    const resp = await fetch(`${TESTS_BASE_URL}/${projectId}/${file}`, { cache: 'no-cache' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

// ── Devices ──

function startDeviceListener(): void {
  if (devicesSource) devicesSource.close();
  devicesSource = fbListen('devices', () => refreshDevices());
  refreshDevices();
}

async function refreshDevices(): Promise<void> {
  const data = await fbGet<Record<string, DeviceInfo>>('devices');
  if (!data) { state.devices = []; renderDevices(); return; }
  const cutoff = Date.now() - 90000;
  const all = Object.values(data);
  state.devices = all.map(d => ({
    ...d,
    status: (d.status === 'online' && d.lastSeen > cutoff) ? 'online' : 'offline',
  }));
  state.devices.sort((a, b) => (a.status === 'online' ? 0 : 1) - (b.status === 'online' ? 0 : 1));
  renderDevices();
  updateRunButton();
}

function renderDevices(): void {
  const el = document.getElementById('device-list')!;
  const countEl = document.getElementById('device-count')!;
  const online = state.devices.filter(d => d.status === 'online');
  countEl.textContent = String(online.length);

  if (state.devices.length === 0) {
    el.innerHTML = '<div class="empty">No devices registered</div>';
    return;
  }

  el.innerHTML = state.devices.map(d => {
    const checked = state.selectedDevices.has(d.deviceId) ? 'checked' : '';
    const statusClass = d.status === 'online' ? 'online' : 'offline';
    const ago = d.status === 'online' ? '' : ` · ${formatAgo(d.lastSeen)}`;
    const ua = shortenUA(d.userAgent);
    return `<div class="device-card">
      <input type="checkbox" data-device="${esc(d.deviceId)}" ${checked} ${d.status === 'offline' ? 'disabled' : ''}>
      <div class="dot ${statusClass}"></div>
      <div class="info">
        <div class="name">${esc(d.deviceId)}</div>
        <div class="meta">${d.project ? esc(d.project) : 'no project'} · ${esc(ua)}${ago}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = (e.target as HTMLInputElement).dataset.device!;
      if ((e.target as HTMLInputElement).checked) state.selectedDevices.add(id);
      else state.selectedDevices.delete(id);
      updateRunButton();
    });
  });
}

// ── Suites ──

async function loadSuites(): Promise<void> {
  state.manifest = await fetchManifest();
  renderProjectSelector();

  if (!state.project || !state.manifest) { state.suites = []; renderSuites(); return; }

  const entry = state.manifest.projects?.find((p: any) => p.id === state.project);
  if (!entry) { state.suites = []; renderSuites(); return; }

  const suites: any[] = [];
  for (const s of entry.suites) {
    const suite = await fetchSuite(state.project!, s.file);
    if (suite) suites.push({ ...suite, _file: s.file, _remoteName: s.name });
  }
  state.suites = suites;
  if (suites.length > 0) state.selectedSuite = 0;
  renderSuites();
  updateRunButton();
}

function renderProjectSelector(): void {
  const sel = document.getElementById('project-select') as HTMLSelectElement;
  const projects = state.manifest?.projects ?? [];
  sel.innerHTML = '<option value="">-- Select Project --</option>' +
    projects.map((p: any) => `<option value="${esc(p.id)}" ${p.id === state.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function renderSuites(): void {
  const el = document.getElementById('suite-list')!;
  const countEl = document.getElementById('suite-count')!;
  countEl.textContent = String(state.suites.length);

  if (state.suites.length === 0) {
    el.innerHTML = '<div class="empty">No suites loaded — select a project first</div>';
    return;
  }

  el.innerHTML = state.suites.map((s, i) => {
    const cases = s.cases?.length ?? 0;
    const checked = i === state.selectedSuite ? 'checked' : '';
    return `<div class="suite-item">
      <input type="radio" name="suite" value="${i}" ${checked}>
      <span class="name">${esc(s._remoteName || s.name)}</span>
      <span class="count">${cases} cases</span>
      <button class="preview-btn" data-idx="${i}">Preview</button>
    </div>`;
  }).join('');

  el.querySelectorAll('input[type=radio]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.selectedSuite = parseInt((e.target as HTMLInputElement).value);
      updateRunButton();
    });
  });

  el.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.idx!);
      showPreviewModal(state.suites[idx]);
    });
  });
}

// ── Executor ──

async function runOnDevices(): Promise<void> {
  const targets = [...state.selectedDevices];
  if (targets.length === 0 || state.selectedSuite < 0) return;

  const suite = state.suites[state.selectedSuite];
  if (!suite) return;

  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cmd: RemoteCommand = {
    id,
    targets,
    action: 'run',
    project: state.project!,
    suite: suite._file || suite.name,
    suiteData: suite,
    status: 'pending',
    createdBy: 'dashboard',
    createdAt: Date.now(),
  };

  await fbPut(`commands/${id}`, cmd);
  state.activeCmd = id;
  state.results.clear();
  renderResults();
  startResultsListener(id);
  document.getElementById('run-status')!.textContent = `Sent to ${targets.length} device(s)...`;
}

function startResultsListener(cmdId: string): void {
  if (resultsSource) resultsSource.close();
  resultsSource = fbListen(`results/${cmdId}`, async () => {
    const data = await fbGet<Record<string, CommandProgress>>(`results/${cmdId}`);
    if (data) {
      state.results = new Map(Object.entries(data));
      renderResults();
    }
  });
}

function renderResults(): void {
  const el = document.getElementById('result-list')!;

  if (state.results.size === 0 && !state.activeCmd) {
    el.innerHTML = '<div class="empty">No results yet — run a suite on devices</div>';
    return;
  }

  if (state.results.size === 0 && state.activeCmd) {
    el.innerHTML = '<div class="empty">Waiting for devices to respond...</div>';
    return;
  }

  el.innerHTML = [...state.results.entries()].map(([deviceId, r]) => {
    let icon = '⏳';
    let detail = '';
    let cls = 'running';

    if (r.status === 'running' && r.progress) {
      icon = '⏳';
      detail = `case ${r.progress.current}/${r.progress.total} — ${r.progress.currentCase}`;
    } else if (r.status === 'completed') {
      icon = '✅';
      cls = 'passed';
      detail = r.summary ? `${r.summary.passed}/${r.summary.total} passed` : 'done';
      if (r.duration) detail += ` (${(r.duration / 1000).toFixed(1)}s)`;
    } else if (r.status === 'failed') {
      icon = '❌';
      cls = 'failed';
      detail = r.summary ? `${r.summary.passed}/${r.summary.total} passed, ${r.summary.failed} failed` : 'failed';
    }

    return `<div class="result-item ${cls}">
      <span class="icon">${icon}</span>
      <span class="device">${esc(deviceId)}</span>
      <span class="detail">${esc(detail)}</span>
      ${r.report ? `<button class="preview-btn" data-report-device="${esc(deviceId)}">Report</button>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('[data-report-device]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const deviceId = (e.target as HTMLElement).dataset.reportDevice!;
      const r = state.results.get(deviceId);
      if (r?.report) showReportModal(deviceId, r.report);
    });
  });
}

// ── History ──

async function refreshHistory(): Promise<void> {
  const data = await fbGet<Record<string, RemoteCommand>>('commands');
  if (!data) { state.history = []; renderHistory(); return; }
  state.history = Object.values(data)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);
  renderHistory();
}

function renderHistory(): void {
  const el = document.getElementById('history-list')!;
  if (state.history.length === 0) {
    el.innerHTML = '<div class="empty">No command history</div>';
    return;
  }

  el.innerHTML = state.history.map(cmd => {
    const icon = cmd.status === 'completed' ? '✅' : cmd.status === 'failed' ? '❌' : cmd.status === 'running' ? '⏳' : '⏸️';
    const targets = cmd.targets?.join(', ') || (cmd as any).targetDevice || '?';
    const time = new Date(cmd.createdAt).toLocaleString();
    return `<div class="result-item ${cmd.status === 'completed' ? 'passed' : cmd.status === 'failed' ? 'failed' : ''}">
      <span class="icon">${icon}</span>
      <span class="device">${esc(targets)}</span>
      <span class="detail">${esc(cmd.suite)} · ${esc(cmd.status)}</span>
      <span class="time">${time}</span>
    </div>`;
  }).join('');
}

// ── Modals ──

function showModal(title: string, bodyHTML: string): void {
  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <div class="modal-hdr"><h3>${esc(title)}</h3><button class="close" id="modal-close">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div>
  </div>`;
  container.querySelector('#modal-close')!.addEventListener('click', closeModal);
  container.querySelector('#modal-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay') closeModal();
  });
}

function closeModal(): void {
  document.getElementById('modal-container')!.innerHTML = '';
}

function showPreviewModal(suite: any): void {
  const json = JSON.stringify(suite, null, 2);
  showModal(`Preview: ${suite.name}`, `<pre>${esc(json)}</pre>`);
}

function showReportModal(deviceId: string, report: any): void {
  const json = JSON.stringify(report, null, 2);
  showModal(`Report: ${deviceId}`, `<pre>${esc(json)}</pre>`);
}

function showPasteModal(): void {
  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal">
      <div class="modal-hdr"><h3>Paste Test Suite JSON</h3><button class="close" id="modal-close">✕</button></div>
      <div class="modal-body"><textarea id="paste-input" placeholder='{"name": "...", "cases": [...]}'></textarea></div>
      <div class="modal-footer"><button class="btn btn-run" id="paste-confirm">Import</button></div>
    </div>
  </div>`;
  container.querySelector('#modal-close')!.addEventListener('click', closeModal);
  container.querySelector('#modal-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay') closeModal();
  });
  container.querySelector('#paste-confirm')!.addEventListener('click', () => {
    const text = (document.getElementById('paste-input') as HTMLTextAreaElement).value.trim();
    if (!text) return;
    try {
      const suite = JSON.parse(text);
      if (!suite.name || !Array.isArray(suite.cases)) { alert('Invalid format: need name + cases[]'); return; }
      state.suites.push({ ...suite, _file: '', _remoteName: `[local] ${suite.name}` });
      renderSuites();
      updateRunButton();
      closeModal();
    } catch { alert('Invalid JSON'); }
  });
}

function showConnectHelp(): void {
  const script = `fetch('https://presence-io.github.io/sitin-pwa-automation/autobot.js').then(r=>r.text()).then(t=>{const s=document.createElement('script');s.textContent=t;document.body.appendChild(s)})`;
  showModal('Add Device', `
    <p style="margin-bottom:12px;color:#8b949e">Inject AutoBot agent into any web page to connect a device:</p>
    <p style="font-weight:600;margin-bottom:8px;color:#e6edf3">Option 1: Browser Console</p>
    <p style="margin-bottom:4px;color:#8b949e;font-size:12px">Open DevTools Console on the target page and paste:</p>
    <pre style="cursor:pointer" id="copy-script">${esc(script)}</pre>
    <p style="font-size:11px;color:#484f58;margin-top:4px">Click to copy</p>
    <p style="font-weight:600;margin:16px 0 8px;color:#e6edf3">Option 2: Script tag (permanent)</p>
    <pre>&lt;script&gt;
if (localStorage.getItem('autobot_enabled') === '1') {
  var s = document.createElement('script');
  s.src = 'https://presence-io.github.io/sitin-pwa-automation/autobot.js';
  s.dataset.project = '${esc(state.project || 'your-project')}';
  document.body.appendChild(s);
}
&lt;/script&gt;</pre>
  `);
  document.getElementById('copy-script')?.addEventListener('click', () => {
    navigator.clipboard.writeText(script);
    document.getElementById('copy-script')!.style.borderColor = '#3fb950';
    setTimeout(() => { document.getElementById('copy-script')!.style.borderColor = ''; }, 1000);
  });
}

// ── Utilities ──

function formatAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function shortenUA(ua: string): string {
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  return 'Browser';
}

function updateRunButton(): void {
  const btn = document.getElementById('btn-run') as HTMLButtonElement;
  const n = state.selectedDevices.size;
  const hasSuite = state.selectedSuite >= 0;
  btn.disabled = n === 0 || !hasSuite;
  btn.textContent = n > 0 && hasSuite
    ? `▶ Run on ${n} device${n > 1 ? 's' : ''}`
    : '▶ Run on selected devices';
}

// ── Init ──

async function init(): Promise<void> {
  startDeviceListener();
  await loadSuites();
  await refreshHistory();

  // Event bindings
  document.getElementById('project-select')!.addEventListener('change', async (e) => {
    const val = (e.target as HTMLSelectElement).value;
    state.project = val || null;
    if (val) localStorage.setItem('autobot_dashboard_project', val);
    else localStorage.removeItem('autobot_dashboard_project');
    state.suites = [];
    state.selectedSuite = -1;
    renderSuites();
    if (val) await loadSuites();
    updateRunButton();
  });

  document.getElementById('btn-refresh-devices')!.addEventListener('click', refreshDevices);
  document.getElementById('btn-refresh-history')!.addEventListener('click', refreshHistory);
  document.getElementById('btn-run')!.addEventListener('click', runOnDevices);
  document.getElementById('btn-connect-help')!.addEventListener('click', showConnectHelp);
  document.getElementById('btn-paste')!.addEventListener('click', showPasteModal);

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  document.getElementById('btn-import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const suite = JSON.parse(text);
      if (!suite.name || !Array.isArray(suite.cases)) { alert('Invalid format'); return; }
      state.suites.push({ ...suite, _file: '', _remoteName: `[local] ${suite.name}` });
      renderSuites();
      updateRunButton();
    } catch { alert('Invalid JSON file'); }
    fileInput.value = '';
  });

  setInterval(refreshDevices, 30000);
}

init();
