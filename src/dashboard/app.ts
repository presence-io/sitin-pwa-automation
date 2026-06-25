import {
  DB_URL, fbPut, fbGet, fbPatch, fbDelete, fbListen,
  type DeviceInfo, type RemoteCommand, type CommandProgress,
} from '../shared/firebase';
import { loadRrweb } from '../shared/rrweb-loader';
import { getRtcConfig, waitIceComplete, Reassembler } from '../shared/webrtc';

// Minimal rrweb replay styles (the base Replayer renders into an iframe; these
// only cover the wrapper + cursor so we don't need the full rrweb stylesheet).
const RRWEB_CSS = `
.replayer-wrapper{position:relative;overflow:hidden}
.replayer-wrapper>iframe{border:none;background:#fff}
.replayer-mouse{position:absolute;width:20px;height:20px;border-radius:50%;background:rgba(9,105,218,.35);transition:left .05s linear,top .05s linear;z-index:9}
`;
function ensureRrwebCss(): void {
  if (document.getElementById('rrweb-css')) return;
  const s = document.createElement('style');
  s.id = 'rrweb-css';
  s.textContent = RRWEB_CSS;
  document.head.appendChild(s);
}

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

let devicesDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function startDeviceListener(): void {
  if (devicesSource) devicesSource.close();
  devicesSource = fbListen('devices', () => {
    if (devicesDebounceTimer) clearTimeout(devicesDebounceTimer);
    devicesDebounceTimer = setTimeout(() => refreshDevices(), 2000);
  });
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
      <button class="preview-btn btn-del-device" data-device="${esc(d.deviceId)}" title="Delete device" style="color:#cf222e">🗑</button>
    </div>`;
  }).join('');

  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = (e.target as HTMLInputElement).dataset.device!;
      if ((e.target as HTMLInputElement).checked) state.selectedDevices.add(id);
      else state.selectedDevices.delete(id);
      updateRunButton();
      renderStages();
    });
  });

  el.querySelectorAll('.btn-screen').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const deviceId = (e.currentTarget as HTMLElement).dataset.device!;
      showScreenModal(deviceId);
    });
  });

  el.querySelectorAll('.btn-del-device').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const deviceId = (e.currentTarget as HTMLElement).dataset.device!;
      deleteDevice(deviceId);
    });
  });
}

// Remove a device from the registry along with its realtime screen/log data.
// Note: an online device whose agent is still running will re-register on its
// next heartbeat — delete is mainly for clearing stale/offline entries.
async function deleteDevice(deviceId: string): Promise<void> {
  if (!confirm(`删除设备 "${deviceId}"？\n将从列表移除该设备及其屏幕同步、日志数据。`)) return;

  const viewer = state.screenViewers.get(deviceId);
  if (viewer) { viewer.close(); state.screenViewers.delete(deviceId); }

  state.selectedDevices.delete(deviceId);
  state.devices = state.devices.filter(d => d.deviceId !== deviceId);
  renderDevices();
  updateRunButton();

  await Promise.all([
    fbDelete(`devices/${deviceId}`),
    fbDelete(`screens/${deviceId}`),
    fbDelete(`logs/${deviceId}`),
    fbDelete(`syncControl/${deviceId}`),
  ]);
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
    const deleteBtn = isFirebase ? `<button class="preview-btn btn-del-suite" data-idx="${i}" title="Delete" style="color:#cf222e">✕</button>` : '';
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
    html += `<div style="font-size:11px;color:#59636e;margin:10px 0 6px;border-top:1px solid #d0d7de;padding-top:8px">📹 Recordings from devices</div>`;
    html += state.firebaseRecordings.map((r, i) => {
      const steps = r.steps?.length ?? 0;
      return `<div class="suite-item" style="border-color:#d0d7de">
        <span class="name" style="color:#59636e">📹 ${esc(r.name)} <span style="font-size:10px;color:#8c959f">${r.deviceId || ''}</span></span>
        <span class="count">${steps} steps</span>
        <button class="preview-btn btn-preview-rec" data-rec-idx="${i}">Preview</button>
        <button class="preview-btn btn-del-rec" data-rec-idx="${i}" title="Delete" style="color:#cf222e">✕</button>
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
      showPreviewModal(state.suites[idx], idx);
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
    const isDone = cmd.status === 'completed' || cmd.status === 'failed';
    return `<div class="result-item ${cmd.status === 'completed' ? 'passed' : cmd.status === 'failed' ? 'failed' : ''}">
      <span class="icon">${icon}</span>
      <span class="device">${esc(targets)}</span>
      <span class="detail">${esc(cmd.suite)} · ${esc(cmd.status)}</span>
      <span class="time">${time}</span>
      ${isDone ? `<button class="preview-btn btn-history-report" data-cmd-id="${esc(cmd.id)}">Report</button>` : ''}
      <button class="preview-btn btn-del-history" data-cmd-id="${esc(cmd.id)}" title="Delete" style="color:#cf222e">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.btn-history-report').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cmdId = (btn as HTMLElement).dataset.cmdId!;
      const cmd = state.history.find(c => c.id === cmdId);
      const data = await fbGet<Record<string, any>>(`results/${cmdId}`);
      if (!data || Object.keys(data).length === 0) {
        alert('No report data found for this command');
        return;
      }
      showHistoryReportModal(cmd, data);
    });
  });

  el.querySelectorAll('.btn-del-history').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cmdId = (btn as HTMLElement).dataset.cmdId!;
      if (!confirm('Delete this command and its results?')) return;
      await fbDelete(`commands/${cmdId}`);
      await fbDelete(`results/${cmdId}`);
      await refreshHistory();
    });
  });
}

function showHistoryReportModal(cmd: RemoteCommand | undefined, deviceResults: Record<string, any>): void {
  const suiteName = cmd?.suite || 'Unknown';
  const targets = cmd?.targets?.join(', ') || '';
  const time = cmd ? new Date(cmd.createdAt).toLocaleString() : '';
  const entries = Object.entries(deviceResults);

  let html = `<div style="margin-bottom:12px;font-size:12px;color:#59636e">
    Suite: <strong style="color:#1f2328">${esc(suiteName)}</strong> ·
    Devices: <strong style="color:#1f2328">${esc(targets)}</strong> ·
    ${time}
  </div>`;

  // Summary across all devices
  let totalPassed = 0, totalFailed = 0, totalAll = 0;
  for (const [, r] of entries) {
    if (r.summary) {
      totalPassed += r.summary.passed || 0;
      totalFailed += r.summary.failed || 0;
      totalAll += r.summary.total || 0;
    }
  }
  if (totalAll > 0) {
    const passRate = Math.round((totalPassed / totalAll) * 100);
    const barColor = totalFailed > 0 ? '#cf222e' : '#1a7f37';
    html += `<div style="display:flex;gap:12px;margin-bottom:12px">
      <div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:${barColor}">${passRate}%</div>
        <div style="font-size:10px;color:#59636e">Overall</div>
      </div>
      <div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#1f2328">${totalPassed}<span style="font-size:12px;color:#59636e">/${totalAll}</span></div>
        <div style="font-size:10px;color:#59636e">Passed</div>
      </div>
      <div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#1f2328">${entries.length}</div>
        <div style="font-size:10px;color:#59636e">Devices</div>
      </div>
    </div>`;
  }

  // Per-device results
  for (const [deviceId, r] of entries) {
    const ds = r.summary;
    const dur = r.duration ? (r.duration / 1000).toFixed(1) + 's' : '';
    const statusIcon = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : '⏳';
    const summaryText = ds ? `${ds.passed}/${ds.total} passed` : r.status;

    html += `<div style="border:1px solid #d0d7de;border-radius:8px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#ffffff;cursor:pointer" class="device-toggle">
        <span>${statusIcon}</span>
        <span style="flex:1;font-size:13px;font-weight:600;color:#1f2328">📱 ${esc(deviceId)}</span>
        <span style="font-size:11px;color:#59636e">${esc(summaryText)} · ${dur}</span>
        <span style="font-size:10px;color:#8c959f">▼</span>
      </div>
      <div class="device-detail" style="display:none;padding:8px 12px;background:#f6f8fa">`;

    if (r.report) {
      // Full report available — render case details
      const results: any[] = r.report.results || [];
      for (const c of results) {
        const cIcon = c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '○';
        const cColor = c.status === 'passed' ? '#1a7f37' : c.status === 'failed' ? '#cf222e' : '#59636e';
        const cDur = c.duration ? (c.duration / 1000).toFixed(1) + 's' : '';

        html += `<div style="margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px">
            <span style="color:${cColor};font-weight:700">${cIcon}</span>
            <span style="color:#1f2328">${esc(c.name)}</span>
            <span style="color:#59636e;font-size:10px">${cDur}</span>
          </div>`;

        if (c.error) {
          html += `<div style="padding:4px 8px;background:#ffebe9;border:1px solid #cf222e;border-radius:4px;margin-bottom:4px;font-size:11px;color:#cf222e">${esc(c.error)}</div>`;
        }

        // Steps
        const steps: any[] = c.steps || [];
        if (steps.length > 0) {
          html += `<table style="width:100%;font-size:10px;border-collapse:collapse;margin-bottom:4px">`;
          for (let i = 0; i < steps.length; i++) {
            const st = steps[i];
            const sIcon = st.status === 'ok' ? '✓' : st.status === 'fail' ? '✗' : '○';
            const sColor = st.status === 'ok' ? '#1a7f37' : st.status === 'fail' ? '#cf222e' : '#59636e';
            html += `<tr style="border-bottom:1px solid #f6f8fa">
              <td style="padding:2px 4px;color:#8c959f;width:20px">${i + 1}</td>
              <td style="padding:2px 4px;color:#1f2328">${esc(st.action)}${st.detail ? ` <span style="color:#59636e">${esc(st.detail)}</span>` : ''}</td>
              <td style="padding:2px 4px;color:${sColor};width:20px">${sIcon}</td>
              <td style="padding:2px 4px;color:#59636e;width:50px">${st.duration ? st.duration + 'ms' : ''}</td>
            </tr>`;
          }
          html += `</table>`;
        }

        // Events
        const events: any[] = c.trackedEvents || [];
        if (events.length > 0) {
          html += `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px">`;
          for (const ev of events) {
            const p = ev.params && Object.keys(ev.params).length > 0
              ? ' (' + Object.entries(ev.params).map(([k, v]) => `${k}=${v}`).join(', ') + ')'
              : '';
            html += `<span style="padding:1px 6px;background:#ddf4ff;border:1px solid #0969da;border-radius:8px;font-size:9px;color:#0969da" title="${esc(ev.sdk + ':' + ev.event + p)}">${esc(ev.sdk)}:${esc(ev.event)}${p ? ' ...' : ''}</span>`;
          }
          html += `</div>`;
        }

        if (c.screenshot) {
          html += `<img src="${c.screenshot}" style="max-width:100%;border:1px solid #d0d7de;border-radius:4px;margin-top:4px" />`;
        }

        html += `</div>`;
      }
    } else {
      html += `<div style="font-size:11px;color:#59636e">Summary only — ${esc(summaryText)}</div>`;
    }

    html += `</div></div>`;
  }

  showModal(`History: ${suiteName}`, html);

  document.querySelectorAll('.device-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const detail = toggle.nextElementSibling as HTMLElement;
      if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    });
  });
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

function showPreviewModal(suite: any, suiteIndex?: number): void {
  const json = JSON.stringify(suite, null, 2);
  const isFirebase = suite._source === 'firebase';
  const isEditable = isFirebase || suiteIndex !== undefined;

  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal" style="max-width:700px">
      <div class="modal-hdr">
        <h3>${esc(suite._remoteName || suite.name)}</h3>
        <button class="close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <textarea id="suite-editor" style="width:100%;min-height:350px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:10px;font-family:'SF Mono',Consolas,monospace;font-size:11px;resize:vertical">${esc(json)}</textarea>
        <div id="editor-error" style="font-size:11px;color:#cf222e;margin-top:4px;display:none"></div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #d0d7de">
        <button id="editor-copy" style="padding:6px 16px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;font-size:12px;cursor:pointer">📋 Copy</button>
        <button id="editor-save" style="padding:6px 16px;background:#1f883d;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">Save</button>
      </div>
    </div>
  </div>`;

  container.querySelector('#modal-close')!.addEventListener('click', closeModal);
  container.querySelector('#modal-overlay')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay') closeModal();
  });

  container.querySelector('#editor-copy')!.addEventListener('click', () => {
    const text = (document.getElementById('suite-editor') as HTMLTextAreaElement).value;
    navigator.clipboard.writeText(text);
    (container.querySelector('#editor-copy') as HTMLElement).textContent = '✅ Copied!';
    setTimeout(() => { (container.querySelector('#editor-copy') as HTMLElement).textContent = '📋 Copy'; }, 2000);
  });

  container.querySelector('#editor-save')!.addEventListener('click', async () => {
    const text = (document.getElementById('suite-editor') as HTMLTextAreaElement).value.trim();
    const errEl = document.getElementById('editor-error')!;
    try {
      const parsed = JSON.parse(text);
      if (!parsed.name) { errEl.textContent = 'Missing "name" field'; errEl.style.display = 'block'; return; }

      // Save to Firebase
      if (state.project) {
        const key = parsed.name.replace(/[.#$/\[\]]/g, '_');
        // If name changed, delete old key
        if (suite.name !== parsed.name) {
          const oldKey = suite.name.replace(/[.#$/\[\]]/g, '_');
          await fbDelete(`suites/${state.project}/${oldKey}`);
        }
        await fbPut(`suites/${state.project}/${key}`, { ...parsed, uploadedAt: Date.now() });
      }

      // Update in-memory state
      if (suiteIndex !== undefined && suiteIndex >= 0 && suiteIndex < state.suites.length) {
        state.suites[suiteIndex] = { ...parsed, _source: 'firebase', _remoteName: `🔥 ${parsed.name}`, _file: '' };
      }

      closeModal();
      await loadSuites();
    } catch (e) {
      errEl.textContent = `Invalid JSON: ${e}`;
      errEl.style.display = 'block';
    }
  });
}

function showReportModal(deviceId: string, report: any): void {
  const s = report.summary || {};
  const duration = report.duration ? (report.duration / 1000).toFixed(1) : '?';
  const passRate = s.total ? Math.round((s.passed / s.total) * 100) : 0;
  const barColor = s.failed > 0 ? '#cf222e' : '#1a7f37';

  let html = `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:120px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:${barColor}">${passRate}%</div>
        <div style="font-size:11px;color:#59636e">Pass Rate</div>
      </div>
      <div style="flex:1;min-width:120px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#1f2328">${s.passed || 0}<span style="font-size:14px;color:#59636e">/${s.total || 0}</span></div>
        <div style="font-size:11px;color:#59636e">Passed</div>
      </div>
      <div style="flex:1;min-width:120px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#1f2328">${duration}<span style="font-size:14px;color:#59636e">s</span></div>
        <div style="font-size:11px;color:#59636e">Duration</div>
      </div>
    </div>

    <div style="background:#f6f8fa;border-radius:6px;height:6px;margin-bottom:16px;overflow:hidden">
      <div style="height:100%;width:${passRate}%;background:${barColor};border-radius:6px"></div>
    </div>
  `;

  // Case results
  const results: any[] = report.results || [];
  for (const r of results) {
    const icon = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    const caseColor = r.status === 'passed' ? '#1a7f37' : r.status === 'failed' ? '#cf222e' : '#59636e';
    const caseDur = r.duration ? (r.duration / 1000).toFixed(1) + 's' : '';

    html += `<div style="border:1px solid #d0d7de;border-radius:8px;margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#ffffff;cursor:pointer" class="case-toggle">
        <span>${icon}</span>
        <span style="flex:1;font-size:13px;font-weight:600;color:${caseColor}">${esc(r.name)}</span>
        <span style="font-size:11px;color:#59636e">${caseDur}</span>
        <span style="font-size:10px;color:#8c959f">▼</span>
      </div>
      <div class="case-detail" style="display:none;padding:8px 12px;background:#f6f8fa">`;

    // Error message
    if (r.error) {
      html += `<div style="padding:6px 8px;background:#ffebe9;border:1px solid #cf222e;border-radius:4px;margin-bottom:8px;font-size:12px;color:#cf222e">${esc(r.error)}</div>`;
    }

    // Steps table
    const steps: any[] = r.steps || [];
    if (steps.length > 0) {
      html += `<table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead><tr style="color:#59636e;text-align:left">
          <th style="padding:4px 6px;border-bottom:1px solid #d0d7de;width:30px">#</th>
          <th style="padding:4px 6px;border-bottom:1px solid #d0d7de">Action</th>
          <th style="padding:4px 6px;border-bottom:1px solid #d0d7de;width:50px">Status</th>
          <th style="padding:4px 6px;border-bottom:1px solid #d0d7de;width:60px">Time</th>
        </tr></thead><tbody>`;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const sIcon = step.status === 'ok' ? '✓' : step.status === 'fail' ? '✗' : '○';
        const sColor = step.status === 'ok' ? '#1a7f37' : step.status === 'fail' ? '#cf222e' : '#59636e';
        const stepDur = step.duration ? step.duration + 'ms' : '';
        html += `<tr style="border-bottom:1px solid #f6f8fa">
          <td style="padding:3px 6px;color:#8c959f">${i + 1}</td>
          <td style="padding:3px 6px;color:#1f2328">${esc(step.action)}${step.detail ? `<div style="font-size:10px;color:#59636e;margin-top:1px">${esc(step.detail)}</div>` : ''}</td>
          <td style="padding:3px 6px;color:${sColor};font-weight:600">${sIcon}</td>
          <td style="padding:3px 6px;color:#59636e">${stepDur}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // Screenshot
    if (r.screenshot) {
      html += `<div style="margin-top:8px"><div style="font-size:10px;color:#59636e;margin-bottom:4px">Failure Screenshot:</div>
        <img src="${r.screenshot}" style="max-width:100%;border:1px solid #d0d7de;border-radius:4px" /></div>`;
    }

    // Tracked events per case
    const events: any[] = r.trackedEvents || [];
    if (events.length > 0) {
      html += `<div style="margin-top:8px"><div style="font-size:10px;color:#59636e;margin-bottom:4px">Tracked Events (${events.length}):</div>
        <table style="width:100%;font-size:10px;border-collapse:collapse">
        <thead><tr style="color:#59636e;text-align:left">
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">SDK</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Event</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Params</th>
        </tr></thead><tbody>`;
      for (const ev of events) {
        const params = ev.params && Object.keys(ev.params).length > 0
          ? Object.entries(ev.params).map(([k, v]) => `${esc(k)}=${esc(String(v))}`).join(', ')
          : '-';
        html += `<tr style="border-bottom:1px solid #f6f8fa">
          <td style="padding:3px 6px;color:#0969da">${esc(ev.sdk)}</td>
          <td style="padding:3px 6px;color:#1f2328">${esc(ev.event)}</td>
          <td style="padding:3px 6px;color:#59636e;word-break:break-all">${params}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    html += `</div></div>`;
  }

  // Global tracked events
  const allEvents: any[] = report.trackedEvents || [];
  if (allEvents.length > 0) {
    html += `<div style="margin-top:12px;border-top:1px solid #d0d7de;padding-top:12px">
      <div style="font-size:12px;font-weight:600;color:#59636e;margin-bottom:6px">All Tracked Events (${allEvents.length})</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead><tr style="color:#59636e;text-align:left">
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">SDK</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Event</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Params</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Step</th>
          <th style="padding:3px 6px;border-bottom:1px solid #d0d7de">Time</th>
        </tr></thead><tbody>`;
    for (const ev of allEvents) {
      const t = new Date(ev.timestamp).toLocaleTimeString();
      const params = ev.params && Object.keys(ev.params).length > 0
        ? Object.entries(ev.params).map(([k, v]) => `<span style="color:#0969da">${esc(k)}</span>=${esc(String(v))}`).join(', ')
        : '<span style="color:#8c959f">-</span>';
      html += `<tr style="border-bottom:1px solid #f6f8fa">
        <td style="padding:3px 6px;color:#0969da">${esc(ev.sdk)}</td>
        <td style="padding:3px 6px;color:#1f2328">${esc(ev.event)}</td>
        <td style="padding:3px 6px;color:#59636e;word-break:break-all;max-width:300px">${params}</td>
        <td style="padding:3px 6px;color:#59636e">${ev.stepIndex ?? '-'}</td>
        <td style="padding:3px 6px;color:#8c959f">${t}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // Export button
  html += `<div style="margin-top:12px;display:flex;gap:8px">
    <button id="report-export-json" style="padding:6px 16px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;font-size:12px;cursor:pointer">📋 Copy JSON</button>
  </div>`;

  showModal(`Report: ${deviceId} — ${report.suite || ''}`, html);

  // Bind toggle for case details
  document.querySelectorAll('.case-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const detail = toggle.nextElementSibling as HTMLElement;
      if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    });
  });

  // Bind export
  document.getElementById('report-export-json')?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    const btn = document.getElementById('report-export-json')!;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy JSON'; }, 2000);
  });
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
  ensureRrwebCss();
  // Start with logs only — screen frames go peer-to-peer over WebRTC, so we
  // don't ask the agent to write screens/ to the database unless WebRTC fails.
  fbPut(`syncControl/${deviceId}`, { logSync: true, fps: 1 });

  const container = document.getElementById('modal-container')!;
  container.innerHTML = `<div class="modal-overlay" id="modal-overlay">
    <div class="modal" style="max-width:440px">
      <div class="modal-hdr">
        <h3>📱 ${esc(deviceId)}</h3>
        <button class="close" id="modal-close">✕</button>
      </div>
      <div class="modal-body" style="padding:10px">
        <div id="screen-info" style="font-size:11px;color:#59636e;margin-bottom:8px;white-space:pre-wrap">Connecting...</div>
        <div id="screen-stage" style="border:1px solid #d0d7de;border-radius:6px;background:#fff;overflow:hidden;min-height:200px"></div>
        <img id="screen-img" style="display:none;max-width:100%;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa" />

        <div id="pb-bar" style="display:flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;color:#59636e">
          <button id="pb-start" title="跳到开头" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:5px;color:#1f2328;font-size:12px;padding:3px 7px;cursor:pointer">⏮</button>
          <button id="pb-prev" title="上一帧（单步后退）" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:5px;color:#1f2328;font-size:12px;padding:3px 7px;cursor:pointer">⏪</button>
          <button id="pb-play" title="播放 / 暂停" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:5px;color:#1f2328;font-size:12px;padding:3px 9px;cursor:pointer">▶</button>
          <button id="pb-next" title="下一帧（单步前进）" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:5px;color:#1f2328;font-size:12px;padding:3px 7px;cursor:pointer">⏩</button>
          <input id="pb-seek" type="range" min="0" max="0" value="0" step="1" style="flex:1;cursor:pointer" />
          <span id="pb-time" style="white-space:nowrap;font-variant-numeric:tabular-nums">0.0 / 0.0s</span>
          <button id="pb-live" title="跟随最新画面" style="background:#0969da;border:1px solid #0969da;border-radius:5px;color:#fff;font-size:11px;padding:3px 8px;cursor:pointer">跟随</button>
        </div>

        <div style="margin-top:12px;border-top:1px solid #d0d7de;padding-top:10px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;font-weight:600;color:#1f2328">🖥 Console</span>
            <input id="log-search" placeholder="搜索日志…" style="flex:1;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:4px 8px;font-size:11px" />
            <label style="font-size:11px;color:#59636e;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="log-filter" style="cursor:pointer" />仅匹配</label>
            <select id="log-level" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:4px;font-size:11px">
              <option value="">全部</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
              <option value="log">log</option>
            </select>
            <span id="log-count" style="font-size:11px;color:#59636e;white-space:nowrap"></span>
            <button id="log-clear" title="清空显示" style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;font-size:11px;padding:4px 8px;cursor:pointer">清空</button>
          </div>
          <div id="log-list" style="height:200px;overflow:auto;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:6px;font-family:'SF Mono',Consolas,monospace;font-size:11px;line-height:1.5"></div>
        </div>
      </div>
    </div>
  </div>`;

  const stageEl = document.getElementById('screen-stage') as HTMLElement;
  const imgEl = document.getElementById('screen-img') as HTMLImageElement;
  const infoEl = document.getElementById('screen-info')!;
  const logListEl = document.getElementById('log-list') as HTMLElement;
  const logSearchEl = document.getElementById('log-search') as HTMLInputElement;
  const logFilterEl = document.getElementById('log-filter') as HTMLInputElement;
  const logLevelEl = document.getElementById('log-level') as HTMLSelectElement;
  const logCountEl = document.getElementById('log-count') as HTMLElement;

  let logEntries: Array<{ level: string; msg: string; ts: number }> = [];
  let logSeq = -1;

  const LEVEL_COLOR: Record<string, string> = {
    error: '#cf222e', warn: '#9a6700', info: '#0969da', log: '#1f2328', debug: '#59636e',
  };

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(text: string, q: string): string {
    const safe = escHtml(text);
    if (!q) return safe;
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safe.replace(re, '<mark style="background:#fff8c5;color:#1f2328;border-radius:2px">$1</mark>');
  }

  function renderLogs(): void {
    const q = logSearchEl.value.trim();
    const onlyMatch = logFilterEl.checked;
    const lvl = logLevelEl.value;
    const ql = q.toLowerCase();
    const atBottom = logListEl.scrollHeight - logListEl.scrollTop - logListEl.clientHeight < 24;

    let shown = 0;
    const rows: string[] = [];
    for (const e of logEntries) {
      if (lvl && e.level !== lvl) continue;
      const matches = q ? e.msg.toLowerCase().includes(ql) : false;
      if (onlyMatch && q && !matches) continue;
      shown++;
      const time = new Date(e.ts).toLocaleTimeString();
      const color = LEVEL_COLOR[e.level] || '#1f2328';
      rows.push(
        `<div style="padding:1px 0;color:${color};white-space:pre-wrap;word-break:break-word">` +
        `<span style="color:#59636e">${time}</span> ` +
        `<span style="color:#59636e">[${e.level}]</span> ` +
        highlight(e.msg, q) +
        `</div>`,
      );
    }
    logListEl.innerHTML = rows.join('') || '<div style="color:#59636e">暂无日志</div>';
    logCountEl.textContent = q || lvl ? `${shown}/${logEntries.length}` : `${logEntries.length}`;
    if (atBottom) logListEl.scrollTop = logListEl.scrollHeight;
  }

  logSearchEl.addEventListener('input', renderLogs);
  logFilterEl.addEventListener('change', renderLogs);
  logLevelEl.addEventListener('change', renderLogs);
  document.getElementById('log-clear')!.addEventListener('click', () => {
    logEntries = []; logSeq = -1; renderLogs();
  });

  const logSource = fbListen(`logs/${deviceId}`, async () => {
    const data = await fbGet<any>(`logs/${deviceId}`);
    if (!data || !Array.isArray(data.entries)) return;
    if (typeof data.seq === 'number' && data.seq === logSeq) return;
    logSeq = typeof data.seq === 'number' ? data.seq : logSeq;
    logEntries = data.entries;
    renderLogs();
  });

  let replayer: import('rrweb').Replayer | null = null;
  let curBufferId: number | null = null;
  let curCount = 0;

  // Playback state. `live` = auto-follow the latest frame; when the user touches
  // any transport control we freeze on the current window so they can step through.
  let live = true;
  let playing = false;
  let offset = 0;          // current position within the window (ms)
  let curTotal = 0;        // window length (ms)
  let curOffsets: number[] = []; // sorted event offsets, for single-frame stepping
  let latestData: any = null;
  let rafId: number | null = null;
  let playWallStart = 0;   // performance.now() when play() began
  let playFromOffset = 0;  // offset at the moment play() began

  const seekEl = document.getElementById('pb-seek') as HTMLInputElement;
  const timeEl = document.getElementById('pb-time') as HTMLElement;
  const playBtn = document.getElementById('pb-play') as HTMLButtonElement;
  const liveBtn = document.getElementById('pb-live') as HTMLButtonElement;

  function fmtSec(ms: number): string { return (ms / 1000).toFixed(1); }

  function syncTransport(): void {
    seekEl.max = String(Math.max(0, Math.round(curTotal)));
    seekEl.value = String(Math.max(0, Math.round(offset)));
    timeEl.textContent = `${fmtSec(offset)} / ${fmtSec(curTotal)}s`;
    playBtn.textContent = playing ? '⏸' : '▶';
    liveBtn.style.background = live ? '#0969da' : '#f6f8fa';
    liveBtn.style.borderColor = live ? '#0969da' : '#d0d7de';
    liveBtn.style.color = live ? '#fff' : '#1f2328';
  }

  function fitScale(w: number, h: number): void {
    const wrapper = stageEl.querySelector('.replayer-wrapper') as HTMLElement | null;
    if (!wrapper || !w) return;
    const scale = Math.min(1, stageEl.clientWidth / w);
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = 'top left';
    stageEl.style.height = Math.round(h * scale) + 'px';
  }

  function stopRaf(): void {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function seekTo(ms: number): void {
    if (!replayer) return;
    offset = Math.max(0, Math.min(curTotal, ms));
    replayer.pause(offset);
    syncTransport();
  }

  function pausePlayback(): void {
    playing = false;
    stopRaf();
    if (replayer) replayer.pause(offset);
    syncTransport();
  }

  function tick(): void {
    if (!playing) return;
    offset = playFromOffset + (performance.now() - playWallStart);
    if (offset >= curTotal) { offset = curTotal; pausePlayback(); return; }
    syncTransport();
    rafId = requestAnimationFrame(tick);
  }

  function startPlayback(): void {
    if (!replayer) return;
    live = false;
    if (offset >= curTotal) offset = 0; // replay from start if at the end
    playing = true;
    playFromOffset = offset;
    playWallStart = performance.now();
    replayer.play(offset);
    syncTransport();
    stopRaf();
    rafId = requestAnimationFrame(tick);
  }

  function stepFrame(dir: 1 | -1): void {
    if (!replayer) return;
    live = false;
    if (playing) pausePlayback();
    let target: number;
    if (dir > 0) {
      target = curOffsets.find((o) => o > offset + 0.5) ?? curTotal;
    } else {
      const prev = [...curOffsets].reverse().find((o) => o < offset - 0.5);
      target = prev ?? 0;
    }
    seekTo(target);
  }

  // rrweb replays every recorded <iframe> as a sandboxed about:blank frame. On
  // pages whose main content lives in a (often cross-origin) iframe the browser
  // can't reconstruct it, the Replayer throws mid-build, and — because the stage
  // was already cleared — the viewer goes fully white. We can never mirror a
  // cross-origin iframe from inside the page anyway (and getDisplayMedia isn't
  // available on iOS), so strip iframe nodes out of the stream entirely: the rest
  // of the DOM then replays reliably. Editing each event in place keeps the event
  // count stable, so incremental addEvent() indexing stays valid.
  function pruneIframeNodes(node: any): number {
    if (!node || !Array.isArray(node.childNodes)) return 0;
    let removed = 0;
    node.childNodes = node.childNodes.filter((c: any) => {
      const isIframe = c && c.type === 2 && String(c.tagName).toLowerCase() === 'iframe';
      if (isIframe) removed++;
      return !isIframe;
    });
    for (const c of node.childNodes) removed += pruneIframeNodes(c);
    return removed;
  }
  function sanitizeEvents(events: any[]): any[] {
    let removed = 0;
    for (const ev of events) {
      if (ev?.type === 2 && ev.data?.node) {
        removed += pruneIframeNodes(ev.data.node); // FullSnapshot
      } else if (ev?.type === 3 && ev.data?.source === 0 && Array.isArray(ev.data.adds)) {
        const before = ev.data.adds.length;
        ev.data.adds = ev.data.adds.filter(
          (a: any) => !(a?.node && a.node.type === 2 && String(a.node.tagName).toLowerCase() === 'iframe'),
        );
        removed += before - ev.data.adds.length;
        for (const a of ev.data.adds) removed += pruneIframeNodes(a.node); // Mutation adds
      }
    }
    if (removed > 0) console.log('[sync] stripped iframes', { count: removed, events: events.length });
    return events;
  }

  // Dump what the replay iframe actually contains, to tell "blank because the
  // content was stripped" apart from "full but visually white / mis-scaled".
  function viewDiag(): any {
    try {
      const ifr = replayer?.iframe;
      const body = ifr?.contentDocument?.body;
      const html = body?.innerHTML || '';
      return {
        bodyKids: body?.childElementCount,
        textLen: (body?.textContent || '').trim().length,
        htmlLen: html.length,
        bg: body ? getComputedStyle(body).backgroundColor : null,
        ifrSize: ifr ? `${ifr.clientWidth}x${ifr.clientHeight}` : null,
        bodySize: body ? `${body.scrollWidth}x${body.scrollHeight}` : null,
        sample: html.replace(/\s+/g, ' ').slice(0, 200),
      };
    } catch (e) {
      return { diagErr: String(e) };
    }
  }

  // Apply only the newly-arrived events to the existing Replayer, in small
  // chunks that yield to the browser between batches. A heavy interaction can
  // emit hundreds of mutations in one 1s flush; feeding them all synchronously
  // blocks the main thread long enough that the tab is killed ("page crash").
  // Yielding keeps the tab responsive — it may lag, but it never freezes.
  const FEED_CHUNK = 60;
  const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

  async function feedIncremental(data: any): Promise<void> {
    const startTime = replayer!.getMetaData().startTime;
    const from = curCount;
    let i = curCount;
    let addErrors = 0;
    let firstErr: any = null;
    console.log('[sync] feed start', { from, to: data.events.length, bufferId: data.bufferId });
    while (i < data.events.length) {
      const end = Math.min(i + FEED_CHUNK, data.events.length);
      for (; i < end; i++) {
        try {
          replayer!.addEvent(data.events[i]);
        } catch (e) {
          addErrors++;
          if (!firstErr) { firstErr = e; console.warn('[sync] addEvent threw', { idx: i, evType: data.events[i]?.type, err: String((e as any)?.message || e) }); }
        }
        const o = data.events[i].timestamp - startTime;
        if (o >= 0) curOffsets.push(o);
      }
      curCount = i;
      if (i < data.events.length) await nextFrame(); // let the browser breathe
    }
    let pauseErr: any = null;
    curTotal = Math.max(curTotal, replayer!.getMetaData().totalTime);
    if (live) {
      offset = curTotal;
      try { replayer!.pause(offset); } catch (e) { pauseErr = e; console.warn('[sync] pause threw', String((e as any)?.message || e)); }
    }
    console.log('[sync] feed done', { added: i - from, addErrors, total: curTotal, pauseErr: pauseErr ? String(pauseErr) : null, ...viewDiag() });
    syncTransport();
  }

  function buildFresh(rrweb: any, data: any): boolean {
    // Build a fresh Replayer into a holder appended alongside the current view and
    // only swap it in once construction succeeds — so if the Replayer throws, the
    // previous frame stays on screen instead of leaving the stage blank. (Don't
    // build detached and move it: re-parenting the replay iframe reloads it and
    // wipes the rendered content.)
    imgEl.style.display = 'none';
    stageEl.style.display = 'block';
    const holder = document.createElement('div');
    stageEl.appendChild(holder);
    let next: import('rrweb').Replayer;
    console.log('[sync] build start', { events: data.events.length, bufferId: data.bufferId, w: data.width, h: data.height });
    try {
      next = new rrweb.Replayer(data.events, {
        root: holder, liveMode: false, mouseTail: false, showWarning: false, showDebug: false,
      });
    } catch (e) {
      holder.remove();
      console.error('[sync] build THREW', String((e as any)?.stack || (e as any)?.message || e));
      if (!replayer) infoEl.textContent = '该页面无法回放（可能内嵌了跨域 iframe）';
      return false; // keep the last good frame
    }
    if (replayer) { try { replayer.destroy(); } catch {} }
    for (const child of Array.from(stageEl.children)) {
      if (child !== holder) child.remove(); // drop the old replayer's DOM
    }
    replayer = next;
    curBufferId = data.bufferId;
    curCount = data.events.length;
    playing = false;
    stopRaf();
    const meta = replayer.getMetaData();
    curTotal = Math.max(0, meta.totalTime);
    curOffsets = data.events
      .map((e: any) => e.timestamp - meta.startTime)
      .filter((o: number) => o >= 0 && o <= curTotal)
      .sort((a: number, b: number) => a - b);
    offset = curTotal; // newest window starts at its latest frame
    replayer.pause(offset);
    fitScale(data.width, data.height);
    console.log('[sync] build ok', { total: curTotal, ...viewDiag() });
    syncTransport();
    return true;
  }

  // Coalescing render pump: callers just update latestData and call requestRender().
  // Only one pump runs at a time; while it yields, newer frames overwrite latestData
  // and the pump keeps catching up to the newest state — so a backlog of frames
  // collapses into the latest render instead of stacking up and overwhelming the tab.
  let renderBusy = false;
  function requestRender(): void {
    if (renderBusy) return; // a pump is already running; it will pick up latestData
    renderBusy = true;
    pumpRender()
      .catch((e) => { console.error('[sync] pump THREW', String((e as any)?.stack || (e as any)?.message || e)); })
      .finally(() => { renderBusy = false; });
  }

  async function pumpRender(): Promise<void> {
    const rrweb = await loadRrweb(); // lazy: only fetched when a screen is opened
    while (live && latestData && stageEl.isConnected) {
      const data = latestData;
      if (!Array.isArray(data.events) || data.events.length === 0) return;
      // Monotonic guard. bufferId is the agent's checkout timestamp, so it only
      // ever increases for a live page. The same window can arrive via TWO
      // transports at once (WebRTC delta stream + RTDB full-snapshot fallback);
      // without this guard the pump rebuilds *backward* to an older/smaller
      // window on every interleaved frame, which flashes the stage white.
      if (replayer && curBufferId !== null) {
        if (data.bufferId < curBufferId) {
          console.log('[sync] skip stale window', { src: data._src, drop: data.bufferId, cur: curBufferId });
          return; // older checkout — ignore entirely
        }
        if (data.bufferId === curBufferId && data.events.length <= curCount) {
          return; // same window, no new (or duplicate/fewer) events — already shown
        }
      }
      // Same window grew → feed only the new events (chunked, yielding).
      if (replayer && data.bufferId === curBufferId && data.events.length > curCount) {
        console.log('[sync] pump -> feed', { src: data._src, bufferId: data.bufferId, have: curCount, now: data.events.length });
        await feedIncremental(data);
      } else {
        console.log('[sync] pump -> build', { src: data._src, reason: !replayer ? 'no-replayer' : 'new-bufferId', curBufferId, newBufferId: data.bufferId, curCount, now: data.events.length });
        // New (strictly newer) window or first frame → one full rebuild.
        if (!buildFresh(rrweb, data)) return;
      }
      // latestData may have advanced while we worked — loop again to catch up.
    }
  }

  function renderLegacyImage(data: any): void {
    stageEl.style.display = 'none';
    imgEl.style.display = 'block';
    imgEl.src = `data:image/jpeg;base64,${data.image}`;
  }

  // Transport controls (single-step playback).
  document.getElementById('pb-start')!.addEventListener('click', () => { live = false; if (playing) pausePlayback(); seekTo(0); });
  document.getElementById('pb-prev')!.addEventListener('click', () => stepFrame(-1));
  document.getElementById('pb-next')!.addEventListener('click', () => stepFrame(1));
  playBtn.addEventListener('click', () => { if (playing) pausePlayback(); else startPlayback(); });
  seekEl.addEventListener('input', () => { live = false; if (playing) pausePlayback(); seekTo(Number(seekEl.value)); });
  liveBtn.addEventListener('click', () => {
    live = true;
    if (playing) pausePlayback();
    if (latestData) requestRender();
    syncTransport();
  });

  // ── WebRTC peer path: screen frames arrive directly over a DataChannel, so
  // the heavy payload never touches the database. The RTDB screens/ fallback is
  // armed only if the peer can't connect within a few seconds, and is torn down
  // the moment the peer connects — so a healthy P2P session never hits the DB. ──
  const reasm = new Reassembler();
  let rtcPc: RTCPeerConnection | null = null;
  let answerSource: EventSource | null = null;
  let rtcConnected = false;
  let fallbackSource: EventSource | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  function applyFrame(data: any): void {
    data.kind = 'rrweb'; // events inside the frame are already a parsed array
    data._src = 'rtc';
    latestData = data;
    if (live) requestRender();
    const parts = [`${data.width}×${data.height}`, data.url || ''];
    if (data.title) parts.push(data.title);
    parts.push(new Date(data.timestamp).toLocaleTimeString());
    infoEl.textContent = parts.join(' · ');
  }

  // RTDB fallback: ask the agent to write screens/ and stream them over SSE.
  // Only engaged when WebRTC can't be established.
  function startRtdbFallback(): void {
    if (rtcConnected || fallbackSource) return;
    fbPut(`syncControl/${deviceId}`, { screenSync: true, logSync: true, fps: 1 });
    fallbackSource = fbListen(`screens/${deviceId}`, async () => {
      const data = await fbGet<any>(`screens/${deviceId}`);
      if (!data) return;

      if (data.kind === 'rrweb') {
        // Events arrive as a JSON string (RTDB can't store the deep tree).
        // Older agents may still send an array — handle both.
        if (typeof data.events === 'string') {
          try { data.events = JSON.parse(data.events); } catch { return; }
        }
        if (Array.isArray(data.events)) data.events = sanitizeEvents(data.events);
        data._src = 'rtdb';
        latestData = data;
        // While the user is stepping a frozen window, don't yank the view.
        if (live) requestRender();
      } else if (data.image) {
        renderLegacyImage(data);
      }

      const parts = [`${data.width}×${data.height}`, data.url || ''];
      if (data.title) parts.push(data.title);
      parts.push(new Date(data.timestamp).toLocaleTimeString());
      infoEl.textContent = parts.join(' · ');
      if (data.kind !== 'rrweb' && !data.image && data.visibleText) {
        infoEl.textContent += '\n' + data.visibleText.slice(0, 150);
      }
    });
    state.screenViewers.set(deviceId, fallbackSource);
  }

  // Peer is up: stop the database screen path entirely — close the SSE and tell
  // the agent it no longer needs to write screens/ (keep the light log stream).
  function onRtcConnected(): void {
    if (rtcConnected) return;
    rtcConnected = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    if (fallbackSource) { fallbackSource.close(); fallbackSource = null; state.screenViewers.delete(deviceId); }
    fbPut(`syncControl/${deviceId}`, { logSync: true, fps: 1 });
  }

  async function startWebRtc(): Promise<void> {
    try {
      const pc = new RTCPeerConnection(await getRtcConfig());
      rtcPc = pc;
      const session = Math.random().toString(36).slice(2);
      const ch = pc.createDataChannel('screen');
      ch.onopen = onRtcConnected;
      // The agent streams a 'full' window per checkout, then 'delta' frames with
      // only new events. Rebuild the running window locally so renderRrweb still
      // gets a complete event array — the wire just carries deltas.
      let rtcEvents: any[] = [];
      let rtcBufferId: any = null;
      let rtcMeta: any = {};
      ch.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const done = reasm.push(msg);
        if (!done) return;
        let frame: any;
        try { frame = JSON.parse(done.payload); } catch { return; }
        if (done.kind === 'full') {
          rtcBufferId = frame.bufferId;
          rtcEvents = sanitizeEvents(frame.events || []);
          rtcMeta = { url: frame.url, title: frame.title, width: frame.width, height: frame.height };
        } else if (done.kind === 'delta') {
          if (frame.bufferId !== rtcBufferId) return; // missed the base window; wait for next full
          rtcEvents = rtcEvents.concat(sanitizeEvents(frame.events || []));
        } else {
          return;
        }
        applyFrame({ bufferId: rtcBufferId, events: rtcEvents, ...rtcMeta, timestamp: frame.timestamp });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
      await fbPut(`rtc/${deviceId}/offer`, { sdp: pc.localDescription!.sdp, type: 'offer', session });
      answerSource = fbListen(`rtc/${deviceId}/answer`, async () => {
        const ans = await fbGet<any>(`rtc/${deviceId}/answer`);
        if (!ans || ans.session !== session || pc.currentRemoteDescription) return;
        try { await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp }); } catch {}
      });
    } catch { startRtdbFallback(); }
  }
  startWebRtc();
  // Arm the database fallback only if the peer hasn't connected in time. Allow
  // enough time for the non-trickle TURN handshake (offer+answer ICE gather,
  // then relay connectivity) before falling back to the DB.
  fallbackTimer = setTimeout(() => { if (!rtcConnected) startRtdbFallback(); }, 14000);

  const cleanup = () => {
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    if (fallbackSource) { fallbackSource.close(); fallbackSource = null; }
    logSource.close();
    if (answerSource) answerSource.close();
    if (rtcPc) { try { rtcPc.close(); } catch {} rtcPc = null; }
    fbDelete(`rtc/${deviceId}/offer`);
    fbDelete(`rtc/${deviceId}/answer`);
    stopRaf();
    if (replayer) { try { replayer.destroy(); } catch {} replayer = null; }
    state.screenViewers.delete(deviceId);
    fbPut(`syncControl/${deviceId}`, { screenSync: false, logSync: false });
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
        <p style="color:#59636e;margin-bottom:12px;font-size:13px">Describe the test scenario, then generate a prompt with project context to send to Claude/ChatGPT.</p>

        <label style="font-size:12px;font-weight:600;color:#1f2328;display:block;margin-bottom:4px">Project: ${esc(projectName)}</label>

        <label style="font-size:12px;color:#59636e;display:block;margin:12px 0 4px">Test scenario description:</label>
        <textarea id="ai-scenario" placeholder="e.g. Test the user registration flow: open /login, click Quick Login, complete onboarding with username and age, verify redirected to /home and rangers login_success event fires" style="width:100%;min-height:100px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:10px;font-size:12px;resize:vertical;font-family:inherit"></textarea>

        <div style="display:flex;gap:8px;margin-top:12px">
          <button id="ai-gen-prompt" style="padding:8px 16px;background:#1f883d;border:none;border-radius:6px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Generate Prompt</button>
          <span id="ai-status" style="font-size:12px;color:#59636e;line-height:36px"></span>
        </div>

        <div id="ai-prompt-area" style="display:none;margin-top:12px">
          <label style="font-size:12px;color:#59636e;display:block;margin-bottom:4px">Generated prompt (copy to Claude/ChatGPT):</label>
          <textarea id="ai-prompt-output" readonly style="width:100%;min-height:200px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:10px;font-family:'SF Mono',Consolas,monospace;font-size:11px;resize:vertical"></textarea>
          <button id="ai-copy-prompt" style="margin-top:8px;padding:6px 16px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;font-size:12px;cursor:pointer">📋 Copy to clipboard</button>
        </div>

        <div style="margin-top:16px;border-top:1px solid #d0d7de;padding-top:12px">
          <label style="font-size:12px;color:#59636e;display:block;margin-bottom:4px">Paste AI-generated JSON here:</label>
          <textarea id="ai-json-input" placeholder='{ "name": "...", "cases": [...] }' style="width:100%;min-height:100px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;padding:10px;font-family:'SF Mono',Consolas,monospace;font-size:11px;resize:vertical"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button id="ai-import-json" style="padding:8px 16px;background:#1f883d;border:none;border-radius:6px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Import & Add to Library</button>
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

function showGuide(): void {
  showModal('AutoBot 使用指南', `
<div style="font-size:13px;line-height:1.7;color:#1f2328">

<h3 style="color:#0969da;margin:0 0 12px;font-size:16px">快速开始</h3>

<p><strong style="color:#1f2328">1. 连接设备</strong></p>
<p style="color:#59636e">在目标网页的 DevTools Console 中粘贴以下代码：</p>
<pre style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:11px;margin:6px 0;overflow-x:auto;cursor:pointer" onclick="navigator.clipboard.writeText(this.innerText);this.style.borderColor='#1a7f37';setTimeout(()=>this.style.borderColor='#d0d7de',1000)">fetch('https://presence-io.github.io/sitin-pwa-automation/autobot.js').then(r=>r.text()).then(t=>{const s=document.createElement('script');s.textContent=t;document.body.appendChild(s)})</pre>
<p style="color:#59636e;font-size:11px">点击代码块可复制。设备将在数秒内出现在上方设备列表中。</p>

<p><strong style="color:#1f2328">2. 选择设备和用例</strong></p>
<p style="color:#59636e">勾选目标设备，然后从列表中选择测试用例。点击 <strong style="color:#1a7f37">▶ Run on selected devices</strong> 开始执行。</p>

<p><strong style="color:#1f2328">3. 查看结果</strong></p>
<p style="color:#59636e">结果实时显示在 Results 区域。点击 <strong>Report</strong> 查看详细报告：逐步结果、失败截图、埋点事件及参数。</p>

<hr style="border:none;border-top:1px solid #d0d7de;margin:16px 0">

<h3 style="color:#0969da;margin:0 0 12px;font-size:16px">功能说明</h3>

<p><strong style="color:#1f2328">📱 设备管理</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li>在线设备显示绿色圆点，离线显示红色</li>
  <li>点击 <strong>👁</strong> 实时查看设备当前页面截图</li>
  <li>可勾选多台设备同时执行测试</li>
</ul>

<p><strong style="color:#1f2328">📋 测试用例</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li><strong>远程用例</strong> — 从 GitHub Pages 加载（只读）</li>
  <li><strong>🔥 Firebase 用例</strong> — Agent 或 Dashboard 上传的，可编辑/删除</li>
  <li><strong>📹 录制</strong> — 在设备端录制的操作流程，通过 Firebase 同步</li>
  <li><strong>Preview</strong> — 点击查看/编辑 JSON，Save 保存修改</li>
  <li><strong>Import / Paste JSON</strong> — 从文件或剪贴板导入用例</li>
</ul>

<p><strong style="color:#1f2328">✨ AI 生成</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li>用自然语言描述测试场景</li>
  <li>点击 Generate Prompt — 自动注入项目配置和用例格式规范</li>
  <li>复制到 Claude/ChatGPT → 将生成的 JSON 粘贴回来 → 导入</li>
</ul>

<p><strong style="color:#1f2328">🚀 阶段任务 (Stages)</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li>Stage 1-5 预设流程，覆盖注册→提现的完整生命周期</li>
  <li>点击单个 <strong>▶</strong> 执行某个阶段，或 <strong>Run S1→S5 All</strong> 全部执行</li>
  <li>每台设备的进度实时更新</li>
  <li>阶段流程是可编辑的 JSON — 在 Preview 中修改即可</li>
</ul>

<p><strong style="color:#1f2328">📊 结果与历史</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li><strong>Results</strong> — 实时执行结果，刷新页面后自动恢复</li>
  <li><strong>History</strong> — 所有历史命令，每条都有 Report 按钮</li>
  <li><strong>Report</strong> — 通过率、逐步结果、失败截图、埋点事件及完整参数</li>
  <li>可单条删除或清空全部</li>
</ul>

<hr style="border:none;border-top:1px solid #d0d7de;margin:16px 0">

<h3 style="color:#0969da;margin:0 0 12px;font-size:16px">设备端 (Agent)</h3>

<p><strong style="color:#1f2328">录制操作</strong></p>
<ul style="color:#59636e;padding-left:20px;margin:4px 0">
  <li>打开 AutoBot 面板 → 教学模式 → 开始录制</li>
  <li>正常操作页面 — 点击、输入、滚动、导航全部自动捕获</li>
  <li>点击列表项时会弹出文本选择器，选择用于匹配的稳定文本</li>
  <li>点击 minibar 上的 <strong>[+断言]</strong> 插入断言（URL / 文案 / 埋点事件）</li>
  <li>停止录制 → 保存 → 点击 <strong>🧪</strong> 转为测试用例</li>
  <li>录制和转换的用例自动同步到 Firebase，Dashboard 中可见</li>
</ul>

<p><strong style="color:#1f2328">可用的 call 函数</strong></p>
<table style="font-size:11px;border-collapse:collapse;width:100%;margin:6px 0">
  <tr style="border-bottom:1px solid #d0d7de;color:#59636e"><th style="padding:4px;text-align:left">函数名</th><th style="padding:4px;text-align:left">参数</th><th style="padding:4px;text-align:left">说明</th></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">deleteAccount</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">注销当前账号（通过 /debug 页面）</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">quickLogin</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">快速登录</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">onboarding</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">自动完成注册流程</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">cashout</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">触发提现 + 自动关闭弹窗</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">completeTask</td><td style="padding:4px">[taskId, label]</td><td style="padding:4px;color:#59636e">通过 Debug 页面完成指定任务</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">mockCallsAuto</td><td style="padding:4px">[收益$, 时长min]</td><td style="padding:4px;color:#59636e">自动计算所需 Mock Call 次数</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">mockCalls</td><td style="padding:4px">[count]</td><td style="padding:4px;color:#59636e">执行指定次数的 Mock Call</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">clearLocalStorage</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">清除 localStorage（保留 autobot 配置）</td></tr>
  <tr><td style="padding:4px;color:#0969da">clearAll</td><td style="padding:4px">—</td><td style="padding:4px;color:#59636e">清除所有浏览器存储</td></tr>
</table>

<p><strong style="color:#1f2328">测试用例格式示例</strong></p>
<pre style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:11px;margin:6px 0;overflow-x:auto">{
  "name": "登录验证",
  "cases": [{
    "name": "快速登录并检查埋点",
    "steps": [
      { "action": "navigate", "url": "/login" },
      { "action": "click", "locators": [{"type":"text","value":"Quick Login"}], "tag": "button" },
      { "action": "assert", "assertType": "url", "expected": "/home" },
      { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "login_success" }
    ]
  }]
}</pre>

<p><strong style="color:#1f2328">支持的操作类型</strong></p>
<table style="font-size:11px;border-collapse:collapse;width:100%;margin:6px 0">
  <tr style="border-bottom:1px solid #d0d7de;color:#59636e"><th style="padding:4px;text-align:left">操作</th><th style="padding:4px;text-align:left">说明</th><th style="padding:4px;text-align:left">录制方式</th></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">click</td><td style="padding:4px;color:#59636e">点击元素</td><td style="padding:4px;color:#59636e">自动捕获</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">input</td><td style="padding:4px;color:#59636e">输入文字</td><td style="padding:4px;color:#59636e">自动捕获（连续输入合并）</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">scroll</td><td style="padding:4px;color:#59636e">页面滚动</td><td style="padding:4px;color:#59636e">自动捕获（300ms 防抖）</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">navigate</td><td style="padding:4px;color:#59636e">页面跳转</td><td style="padding:4px;color:#59636e">自动捕获（SPA 路由）</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">select</td><td style="padding:4px;color:#59636e">下拉选择</td><td style="padding:4px;color:#59636e">自动捕获</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">assert</td><td style="padding:4px;color:#59636e">插入断言</td><td style="padding:4px;color:#59636e">手动（minibar [+断言]）</td></tr>
  <tr style="border-bottom:1px solid #f6f8fa"><td style="padding:4px;color:#0969da">wait</td><td style="padding:4px;color:#59636e">等待 N 毫秒</td><td style="padding:4px;color:#59636e">手写 JSON</td></tr>
  <tr><td style="padding:4px;color:#0969da">call</td><td style="padding:4px;color:#59636e">调用内置函数</td><td style="padding:4px;color:#59636e">手写 JSON</td></tr>
</table>

</div>
  `);
}

function showConnectHelp(): void {
  const script = `fetch('https://presence-io.github.io/sitin-pwa-automation/autobot.js').then(r=>r.text()).then(t=>{const s=document.createElement('script');s.textContent=t;document.body.appendChild(s)})`;
  showModal('Add Device', `
    <p style="margin-bottom:12px;color:#59636e">Inject AutoBot agent into any web page to connect a device:</p>
    <p style="font-weight:600;margin-bottom:8px;color:#1f2328">Option 1: Browser Console</p>
    <p style="margin-bottom:4px;color:#59636e;font-size:12px">Open DevTools Console on the target page and paste:</p>
    <pre style="cursor:pointer" id="copy-script">${esc(script)}</pre>
    <p style="font-size:11px;color:#8c959f;margin-top:4px">Click to copy</p>
    <p style="font-weight:600;margin:16px 0 8px;color:#1f2328">Option 2: Script tag (permanent)</p>
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
    document.getElementById('copy-script')!.style.borderColor = '#1a7f37';
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

async function restoreLastResults(): Promise<void> {
  if (state.history.length === 0) return;
  // Find the most recent command that has results
  for (const cmd of state.history) {
    const data = await fbGet<Record<string, any>>(`results/${cmd.id}`);
    if (data && Object.keys(data).length > 0) {
      state.activeCmd = cmd.id;
      state.results = new Map(Object.entries(data));
      renderResults();
      // If still running, keep listening
      if (cmd.status === 'running') {
        startResultsListener(cmd.id);
      }
      break;
    }
  }
}

// ── Stages ──

const STAGE_DEFS = [
  { id: 's1', name: 'Stage 1', amount: '$0.50', desc: '注销→注册→提现' },
  { id: 's2', name: 'Stage 2', amount: '$7.00', desc: '任务+Mock→提现' },
  { id: 's3', name: 'Stage 3', amount: '$8.00', desc: '任务+Mock→提现' },
  { id: 's4', name: 'Stage 4', amount: '$12.00', desc: 'Mock→提现' },
  { id: 's5', name: 'Stage 5', amount: '$25.00', desc: 'Mock→提现' },
];

let stageProgressSource: EventSource | null = null;

function renderStages(): void {
  const el = document.getElementById('stage-list')!;
  const selectedDevices = [...state.selectedDevices];

  if (selectedDevices.length === 0) {
    el.innerHTML = '<div class="empty">Select device(s) first</div>';
    return;
  }

  el.innerHTML = STAGE_DEFS.map((s, i) => `
    <div class="suite-item" style="justify-content:space-between">
      <span class="name" style="font-weight:600">${esc(s.name)} <span style="color:#1a7f37">${s.amount}</span> <span style="color:#59636e;font-weight:400;font-size:11px">${esc(s.desc)}</span></span>
      <button class="btn btn-run btn-stage-single" data-stage="${i}" style="font-size:11px;padding:4px 12px">▶</button>
    </div>
  `).join('');

  el.querySelectorAll('.btn-stage-single').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt((btn as HTMLElement).dataset.stage!);
      await sendStageCommand(selectedDevices, idx);
    });
  });
}

async function sendStageCommand(targets: string[], stageIndex: number): Promise<void> {
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const stageName = stageIndex === -1 ? 'All Stages' : STAGE_DEFS[stageIndex]?.name || `Stage ${stageIndex + 1}`;
  const cmd: RemoteCommand = {
    id,
    targets,
    action: 'stage',
    project: state.project || 'default',
    suite: stageName,
    stageIndex,
    status: 'pending',
    createdBy: 'dashboard',
    createdAt: Date.now(),
  };
  await fbPut(`commands/${id}`, cmd);
  document.getElementById('stage-progress-info')!.textContent = `Sent ${stageName} to ${targets.length} device(s)...`;

  // Listen to stage progress
  startStageProgressListener(targets);
}

function startStageProgressListener(deviceIds: string[]): void {
  if (stageProgressSource) stageProgressSource.close();

  const infoEl = document.getElementById('stage-progress-info')!;
  const statusEl = document.getElementById('stage-status')!;

  // Poll each device's stage progress
  const poll = async () => {
    const lines: string[] = [];
    let allDone = true;
    for (const devId of deviceIds) {
      const p = await fbGet<any>(`stageProgress/${devId}`);
      if (!p) { lines.push(`📱 ${devId}: waiting...`); allDone = false; continue; }
      const icon = p.status === 'completed' ? '✅' : p.status === 'failed' ? '❌' : '⏳';
      const detail = p.status === 'running'
        ? `${p.stageName} · ${p.stepLabel} (step ${p.stepIndex + 1}/${p.totalSteps})`
        : p.status === 'completed' ? `${p.stageName} done` : `${p.stageName} failed: ${p.error || ''}`;
      lines.push(`${icon} ${devId}: ${detail}`);
      if (p.status === 'running') allDone = false;
    }
    infoEl.innerHTML = lines.join('<br>');

    const latestStatus = lines.some(l => l.includes('❌')) ? 'failed' : allDone ? 'done' : 'running';
    statusEl.textContent = latestStatus === 'done' ? '✅' : latestStatus === 'failed' ? '❌' : '⏳';
  };

  poll();
  const timer = setInterval(poll, 3000);
  // Stop after 30 min
  setTimeout(() => clearInterval(timer), 30 * 60 * 1000);
}

async function init(): Promise<void> {
  startDeviceListener();
  await loadSuites();
  await refreshHistory();

  // Restore last active command results from Firebase
  await restoreLastResults();

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
  document.getElementById('btn-clear-history')!.addEventListener('click', async () => {
    if (!confirm('Clear all command history and results?')) return;
    await fbDelete('commands');
    await fbDelete('results');
    await refreshHistory();
  });
  document.getElementById('btn-run')!.addEventListener('click', runOnDevices);
  document.getElementById('btn-connect-help')!.addEventListener('click', showConnectHelp);
  document.getElementById('btn-guide')!.addEventListener('click', showGuide);
  document.getElementById('btn-paste')!.addEventListener('click', showPasteModal);
  document.getElementById('btn-ai-gen')!.addEventListener('click', showAIGenerate);

  // Stage controls
  renderStages();
  document.getElementById('btn-stage-all')!.addEventListener('click', () => {
    const targets = [...state.selectedDevices];
    if (targets.length === 0) { alert('Select device(s) first'); return; }
    if (!confirm(`Run Stage 1→5 on ${targets.length} device(s)? This will delete accounts and restart.`)) return;
    sendStageCommand(targets, -1);
  });
  document.getElementById('btn-refresh-stages')!.addEventListener('click', () => {
    renderStages();
    if (state.selectedDevices.size > 0) startStageProgressListener([...state.selectedDevices]);
  });

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

  setInterval(refreshDevices, 60000);
}

init();
