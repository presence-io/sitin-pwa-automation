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
  firebaseSuites: any[];
  firebaseRecordings: any[];
  selectedSuite: number;
  activeCmd: string | null;
  results: Map<string, CommandProgress>;
  history: RemoteCommand[];
  screenViewers: Map<string, EventSource>;
}

const state: DashboardState = {
  project: localStorage.getItem('autobot_dashboard_project') || null,
  manifest: null,
  devices: [],
  selectedDevices: new Set(),
  suites: [],
  firebaseSuites: [],
  firebaseRecordings: [],
  selectedSuite: -1,
  activeCmd: null,
  results: new Map(),
  history: [],
  screenViewers: new Map(),
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
      ${d.status === 'online' ? `<button class="preview-btn btn-screen" data-device="${esc(d.deviceId)}" title="View screen">👁</button>` : ''}
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

  el.querySelectorAll('.btn-screen').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const deviceId = (e.target as HTMLElement).dataset.device!;
      showScreenModal(deviceId);
    });
  });
}

// ── Suites ──

async function loadSuites(): Promise<void> {
  state.manifest = await fetchManifest();
  renderProjectSelector();

  if (!state.project) {
    state.suites = [];
    state.firebaseSuites = [];
    state.firebaseRecordings = [];
    renderSuites();
    return;
  }

  // Load from GitHub Pages
  const suites: any[] = [];
  if (state.manifest) {
    const entry = state.manifest.projects?.find((p: any) => p.id === state.project);
    if (entry) {
      for (const s of entry.suites) {
        const suite = await fetchSuite(state.project!, s.file);
        if (suite) suites.push({ ...suite, _file: s.file, _remoteName: s.name, _source: 'remote' });
      }
    }
  }

  // Load from Firebase — suites uploaded by agents
  const fbSuites = await fbGet<Record<string, any>>(`suites/${state.project}`);
  state.firebaseSuites = fbSuites ? Object.values(fbSuites).map(s => ({
    ...s, _source: 'firebase', _remoteName: `🔥 ${s.name}`,
  })) : [];

  // Load from Firebase — recordings uploaded by agents
  const fbRecs = await fbGet<Record<string, any>>(`recordings/${state.project}`);
  state.firebaseRecordings = fbRecs ? Object.values(fbRecs) : [];

  state.suites = [...suites, ...state.firebaseSuites];
  if (state.suites.length > 0 && state.selectedSuite < 0) state.selectedSuite = 0;
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
  const totalCount = state.suites.length + state.firebaseRecordings.length;
  countEl.textContent = String(totalCount);

  if (totalCount === 0) {
    el.innerHTML = '<div class="empty">No suites loaded — select a project first</div>';
    return;
  }

  let html = '';

  // Test suites (remote + firebase)
  html += state.suites.map((s, i) => {
    const cases = s.cases?.length ?? 0;
    const checked = i === state.selectedSuite ? 'checked' : '';
    const isFirebase = s._source === 'firebase';
    const deleteBtn = isFirebase ? `<button class="preview-btn btn-del-suite" data-idx="${i}" title="Delete" style="color:#f85149">✕</button>` : '';
    return `<div class="suite-item">
      <input type="radio" name="suite" value="${i}" ${checked}>
      <span class="name">${esc(s._remoteName || s.name)}</span>
      <span class="count">${cases} cases</span>
      <button class="preview-btn" data-idx="${i}">Preview</button>
      ${deleteBtn}
    </div>`;
  }).join('');

  // Recordings from Firebase (not yet converted to test suites)
  if (state.firebaseRecordings.length > 0) {
    html += `<div style="font-size:11px;color:#8b949e;margin:10px 0 6px;border-top:1px solid #30363d;padding-top:8px">📹 Recordings from devices</div>`;
    html += state.firebaseRecordings.map((r, i) => {
      const steps = r.steps?.length ?? 0;
      return `<div class="suite-item" style="border-color:#30363d">
        <span class="name" style="color:#8b949e">📹 ${esc(r.name)} <span style="font-size:10px;color:#484f58">${r.deviceId || ''}</span></span>
        <span class="count">${steps} steps</span>
        <button class="preview-btn btn-preview-rec" data-rec-idx="${i}">Preview</button>
        <button class="preview-btn btn-del-rec" data-rec-idx="${i}" title="Delete" style="color:#f85149">✕</button>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;

  // Bind suite events
  el.querySelectorAll('input[type=radio]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.selectedSuite = parseInt((e.target as HTMLInputElement).value);
      updateRunButton();
    });
  });

  el.querySelectorAll('.preview-btn[data-idx]:not(.btn-del-suite)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.idx!);
      showPreviewModal(state.suites[idx]);
    });
  });

  el.querySelectorAll('.btn-del-suite').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.idx!);
      const suite = state.suites[idx];
      if (!suite || suite._source !== 'firebase') return;
      if (!confirm(`Delete "${suite.name}" from Firebase?`)) return;
      const key = suite.name.replace(/[.#$/\[\]]/g, '_');
      await fbDelete(`suites/${state.project}/${key}`);
      await loadSuites();
    });
  });

  // Bind recording events
  el.querySelectorAll('.btn-preview-rec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.recIdx!);
      showPreviewModal(state.firebaseRecordings[idx]);
    });
  });

  el.querySelectorAll('.btn-del-rec').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt((e.target as HTMLElement).dataset.recIdx!);
      const rec = state.firebaseRecordings[idx];
      if (!rec) return;
      if (!confirm(`Delete recording "${rec.name}"?`)) return;
      const key = rec.name.replace(/[.#$/\[\]]/g, '_');
      await fbDelete(`recordings/${state.project}/${key}`);
      await loadSuites();
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
  container.querySelector('#paste-confirm')!.addEventListener('click', async () => {
    const text = (document.getElementById('paste-input') as HTMLTextAreaElement).value.trim();
    if (!text) return;
    try {
      const suite = JSON.parse(text);
      if (!suite.name || !Array.isArray(suite.cases)) { alert('Invalid format: need name + cases[]'); return; }
      // Save to Firebase
      if (state.project) {
        const key = suite.name.replace(/[.#$/\[\]]/g, '_');
        await fbPut(`suites/${state.project}/${key}`, { ...suite, uploadedAt: Date.now() });
      }
      state.suites.push({ ...suite, _file: '', _remoteName: `🔥 ${suite.name}`, _source: 'firebase' });
      renderSuites();
      updateRunButton();
      closeModal();
    } catch { alert('Invalid JSON'); }
  });
}

function showScreenModal(deviceId: string): void {
  // Tell agent to start sync
  fbPut(`syncControl/${deviceId}`, { screenSync: true, fps: 1 });

  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal" style="max-width:420px">
      <div class="modal-hdr">
        <h3>📱 ${esc(deviceId)}</h3>
        <button class="close" id="modal-close">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;padding:8px">
        <div id="screen-info" style="font-size:11px;color:#8b949e;margin-bottom:8px">Connecting...</div>
        <img id="screen-img" style="max-width:100%;border:1px solid #30363d;border-radius:6px;background:#0d1117;min-height:200px" />
      </div>
    </div>
  </div>`;

  const imgEl = document.getElementById('screen-img') as HTMLImageElement;
  const infoEl = document.getElementById('screen-info')!;

  // SSE listen for screen updates
  const source = fbListen(`screens/${deviceId}`, async () => {
    const data = await fbGet<any>(`screens/${deviceId}`);
    if (!data) return;
    if (data.image) {
      imgEl.src = `data:image/jpeg;base64,${data.image}`;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }
    const parts = [`${data.width}×${data.height}`, data.url || ''];
    if (data.title) parts.push(data.title);
    parts.push(new Date(data.timestamp).toLocaleTimeString());
    infoEl.textContent = parts.join(' · ');
    if (!data.image && data.visibleText) {
      infoEl.textContent += '\n' + data.visibleText.slice(0, 150);
      infoEl.style.whiteSpace = 'pre-wrap';
    }
  });

  state.screenViewers.set(deviceId, source);

  const cleanup = () => {
    source.close();
    state.screenViewers.delete(deviceId);
    fbPut(`syncControl/${deviceId}`, { screenSync: false });
    container.innerHTML = '';
  };

  container.querySelector('#modal-close')!.addEventListener('click', cleanup);
  container.querySelector('#modal-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay') cleanup();
  });
}

function showAIGenerate(): void {
  const projectId = state.project || 'your-project';
  const projectEntry = state.manifest?.projects?.find((p: any) => p.id === state.project);
  const projectName = projectEntry?.name || projectId;

  // Build context from current project config
  const sampleSuite = state.suites[0];
  const sampleJSON = sampleSuite ? JSON.stringify(sampleSuite.cases[0] || {}, null, 2).slice(0, 500) : '(no sample available)';

  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal" style="max-width:700px">
      <div class="modal-hdr"><h3>✨ AI Generate Test Case</h3><button class="close" id="modal-close">✕</button></div>
      <div class="modal-body">
        <p style="color:#8b949e;margin-bottom:12px;font-size:13px">Describe the test scenario, then generate a prompt with project context to send to Claude/ChatGPT.</p>

        <label style="font-size:12px;font-weight:600;color:#e6edf3;display:block;margin-bottom:4px">Project: ${esc(projectName)}</label>

        <label style="font-size:12px;color:#8b949e;display:block;margin:12px 0 4px">Test scenario description:</label>
        <textarea id="ai-scenario" placeholder="e.g. Test the user registration flow: open /login, click Quick Login, complete onboarding with username and age, verify redirected to /home and rangers login_success event fires" style="width:100%;min-height:100px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:10px;font-size:12px;resize:vertical;font-family:inherit"></textarea>

        <div style="display:flex;gap:8px;margin-top:12px">
          <button id="ai-gen-prompt" style="padding:8px 16px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Generate Prompt</button>
          <span id="ai-status" style="font-size:12px;color:#8b949e;line-height:36px"></span>
        </div>

        <div id="ai-prompt-area" style="display:none;margin-top:12px">
          <label style="font-size:12px;color:#8b949e;display:block;margin-bottom:4px">Generated prompt (copy to Claude/ChatGPT):</label>
          <textarea id="ai-prompt-output" readonly style="width:100%;min-height:200px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:10px;font-family:'SF Mono',Consolas,monospace;font-size:11px;resize:vertical"></textarea>
          <button id="ai-copy-prompt" style="margin-top:8px;padding:6px 16px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:12px;cursor:pointer">📋 Copy to clipboard</button>
        </div>

        <div style="margin-top:16px;border-top:1px solid #30363d;padding-top:12px">
          <label style="font-size:12px;color:#8b949e;display:block;margin-bottom:4px">Paste AI-generated JSON here:</label>
          <textarea id="ai-json-input" placeholder='{ "name": "...", "cases": [...] }' style="width:100%;min-height:100px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;padding:10px;font-family:'SF Mono',Consolas,monospace;font-size:11px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button id="ai-import-json" style="padding:8px 16px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Import & Add to Library</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  container.querySelector('#modal-close')!.addEventListener('click', closeModal);
  container.querySelector('#modal-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay') closeModal();
  });

  container.querySelector('#ai-gen-prompt')!.addEventListener('click', () => {
    const scenario = (document.getElementById('ai-scenario') as HTMLTextAreaElement).value.trim();
    if (!scenario) { document.getElementById('ai-status')!.textContent = 'Please describe a scenario first'; return; }

    const prompt = buildAIPrompt(projectId, scenario, sampleJSON);
    const outputArea = document.getElementById('ai-prompt-output') as HTMLTextAreaElement;
    outputArea.value = prompt;
    document.getElementById('ai-prompt-area')!.style.display = 'block';
    document.getElementById('ai-status')!.textContent = 'Prompt generated — copy and send to AI';
  });

  container.querySelector('#ai-copy-prompt')!.addEventListener('click', () => {
    const text = (document.getElementById('ai-prompt-output') as HTMLTextAreaElement).value;
    navigator.clipboard.writeText(text);
    (container.querySelector('#ai-copy-prompt') as HTMLElement).textContent = '✅ Copied!';
    setTimeout(() => { (container.querySelector('#ai-copy-prompt') as HTMLElement).textContent = '📋 Copy to clipboard'; }, 2000);
  });

  container.querySelector('#ai-import-json')!.addEventListener('click', async () => {
    const text = (document.getElementById('ai-json-input') as HTMLTextAreaElement).value.trim();
    if (!text) return;
    try {
      const suite = JSON.parse(text);
      if (!suite.name || !Array.isArray(suite.cases)) { alert('Invalid format: need name + cases[]'); return; }
      if (state.project) {
        const key = suite.name.replace(/[.#$/\[\]]/g, '_');
        await fbPut(`suites/${state.project}/${key}`, { ...suite, uploadedAt: Date.now() });
      }
      state.suites.push({ ...suite, _file: '', _remoteName: `🔥 ${suite.name}`, _source: 'firebase' });
      renderSuites();
      updateRunButton();
      closeModal();
    } catch { alert('Invalid JSON'); }
  });
}

function buildAIPrompt(projectId: string, scenario: string, sampleJSON: string): string {
  return `You are an automation testing expert. Generate a test suite JSON for the AutoBot testing framework.

## Project: ${projectId}

## Test Scenario
${scenario}

## TestSuite JSON Format

\`\`\`typescript
interface TestSuite {
  name: string;
  cases: TestCase[];
}

interface TestCase {
  name: string;
  tags?: string[];         // e.g. ["smoke", "regression"]
  variables?: Record<string, string>;  // supports {{random:prefix_}}, {{timestamp}}
  setup?: TestAction[];    // pre-test cleanup
  steps: TestAction[];     // test steps
  teardown?: TestAction[]; // post-test cleanup
  teardownOnFail?: boolean; // default true
}

interface TestAction {
  action: 'click' | 'input' | 'select' | 'navigate' | 'scroll' | 'assert' | 'wait' | 'call';
  // Element locators (for click/input/select):
  locators?: Array<{ type: 'id' | 'testid' | 'aria' | 'text' | 'placeholder' | 'css'; value: string }>;
  tag?: string;          // element tag: 'button', 'input', 'div', etc.
  value?: string;        // for input action
  url?: string;          // for navigate action
  delay?: number;        // for wait action (ms)
  fn?: string;           // for call action: 'deleteAccount', 'clearLocalStorage', 'resetState'
  timeout?: number;      // step timeout (default 10000ms)
  // Assert params:
  assertType?: 'url' | 'textExists' | 'textNotExists' | 'elementExists' | 'elementNotExists'
             | 'eventFired' | 'eventNotFired' | 'eventParams' | 'eventCount'
             | 'localStorage' | 'cookie' | 'jsExpression';
  expected?: string;
  sdk?: string;          // tracker SDK name for event assertions
  event?: string;        // event name for event assertions
  key?: string;          // param key for eventParams / localStorage / cookie
}
\`\`\`

## Locator Priority (prefer text/placeholder over css):
1. text — button/link text content: \`{ "type": "text", "value": "Sign In" }\`
2. placeholder — input placeholder: \`{ "type": "placeholder", "value": "Enter email" }\`
3. aria — aria-label: \`{ "type": "aria", "value": "Close" }\`
4. testid — data-testid: \`{ "type": "testid", "value": "submit-btn" }\`
5. css — CSS selector (last resort): \`{ "type": "css", "value": "#login-form button" }\`

## Sample from this project:
\`\`\`json
${sampleJSON}
\`\`\`

## Requirements:
1. Output valid JSON only, no explanation
2. Use text/placeholder locators primarily (more stable than CSS)
3. Add assertions after key operations (URL checks, text existence, event tracking)
4. Include setup/teardown if the scenario involves user state
5. Use {{random:prefix_}} for generated usernames/emails
6. Use the "call" action for cleanup functions like "deleteAccount", "clearLocalStorage"`;
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
  document.getElementById('btn-ai-gen')!.addEventListener('click', showAIGenerate);

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  document.getElementById('btn-import')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const suite = JSON.parse(text);
      if (!suite.name || !Array.isArray(suite.cases)) { alert('Invalid format'); return; }
      // Save to Firebase
      if (state.project) {
        const key = suite.name.replace(/[.#$/\[\]]/g, '_');
        await fbPut(`suites/${state.project}/${key}`, { ...suite, uploadedAt: Date.now() });
      }
      state.suites.push({ ...suite, _file: '', _remoteName: `🔥 ${suite.name}`, _source: 'firebase' });
      renderSuites();
      updateRunButton();
    } catch { alert('Invalid JSON file'); }
    fileInput.value = '';
  });

  setInterval(refreshDevices, 30000);
}

init();
