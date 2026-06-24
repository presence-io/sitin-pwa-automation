import { log, warn } from '../core/helpers';
import { configManager } from './config';
import { tracker } from './tracker';
import { runSuite } from './runner';
import { generateReport, printReportToConsole, downloadReport } from './reporter';
import {
  fetchManifest, fetchAllRemoteSuites,
  getAllLocalSuites, saveLocalSuite, deleteLocalSuite,
  importSuiteFromJSON, copySuiteToClipboard, downloadSuiteAsFile,
} from './repository';
import { getDeviceId, setDeviceId, startRemote, stopRemote } from './remote';
import type { TestSuite, TestManifest, TestReport } from './types';

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

let manifest: TestManifest | null = null;
let remoteSuites: TestSuite[] = [];
let lastReport: TestReport | null = null;

function renderResults(): string {
  if (!lastReport) return '';
  const { summary } = lastReport;
  const color = summary.failed > 0 ? '#cf222e' : '#1a7f37';
  let html = `<div style="font-size:11px;color:${color};margin-bottom:4px">${summary.passed}/${summary.total} passed (${(lastReport.duration / 1000).toFixed(1)}s)</div>`;
  for (const r of lastReport.results) {
    if (r.status === 'failed') {
      html += `<div style="font-size:10px;color:#cf222e">⚠ ${esc(r.name)} — ${esc(r.error ?? 'failed')}</div>`;
    }
  }
  return html;
}

async function refreshSuites(): Promise<void> {
  manifest = await fetchManifest();
  const project = configManager.getProject();
  if (manifest && project) {
    const entry = manifest.projects.find(p => p.id === project);
    if (entry) remoteSuites = await fetchAllRemoteSuites(project, entry.suites);
  }
}

async function renderTestingPanel(container: HTMLElement) {
  const localSuites = await getAllLocalSuites();
  const deviceId = getDeviceId();
  const project = configManager.getProject();
  const resultsHTML = renderResults();
  const allSuites = [...remoteSuites, ...localSuites];

  container.innerHTML = `
    <div class="grp" id="grp-agent">
      <div class="grp-hdr" data-grp="agent"><span>📡 Agent</span><span class="arr open">▶</span></div>
      <div class="grp-body open"><div class="inner">
        <div class="row" style="gap:4px;align-items:center">
          <span style="font-size:10px;color:#656d76;white-space:nowrap">Device:</span>
          <input id="agent-device-id" value="${esc(deviceId)}" style="flex:1;padding:5px 7px;background:#fff;border:1px solid #d0d7de;border-radius:6px;color:#1f2328;font-size:10px;margin-bottom:0">
          <button type="button" id="agent-save-id" style="padding:5px 8px;font-size:10px">Save</button>
        </div>
        <div style="font-size:10px;color:#1a7f37;margin:6px 0">● Online${project ? ` · ${esc(project)}` : ''}</div>
        <div style="font-size:9px;color:#8c959f;margin-bottom:4px">Dashboard: <a href="https://presence-io.github.io/sitin-pwa-automation/dashboard.html" target="_blank" style="color:#0969da">Open ↗</a></div>
      </div></div>
    </div>

    <div class="grp" id="grp-quick">
      <div class="grp-hdr" data-grp="quick"><span>🚀 Quick Run</span><span class="arr">▶</span></div>
      <div class="grp-body"><div class="inner">
        ${allSuites.length > 0 ? allSuites.map((s, i) => `
          <div class="saved-item">
            <span class="name">${i < remoteSuites.length ? '📋' : '📝'} ${esc(s.name)} (${s.cases.length})</span>
            <button type="button" class="green btn-run-suite" data-idx="${i}" title="Run">▶</button>
          </div>
        `).join('') : '<div style="font-size:10px;color:#666">No suites</div>'}
        <div class="row" style="margin-top:6px;gap:4px">
          <button type="button" id="agent-import-btn" class="wide" style="font-size:10px">Import</button>
          <button type="button" id="agent-paste-btn" class="wide" style="font-size:10px">Paste JSON</button>
        </div>
        <input type="file" id="agent-file-input" accept=".json" style="display:none">
      </div></div>
    </div>

    ${resultsHTML ? `
    <div class="grp" id="grp-result">
      <div class="grp-hdr" data-grp="result"><span>📊 Last Result</span><span class="arr open">▶</span></div>
      <div class="grp-body open"><div class="inner">
        ${resultsHTML}
        <button type="button" id="agent-export-report" style="font-size:10px;margin-top:4px">Export report</button>
      </div></div>
    </div>` : ''}
  `;

  bindEvents(container, [...remoteSuites, ...localSuites]);
}

function bindEvents(container: HTMLElement, allSuites: TestSuite[]) {
  container.querySelectorAll('.grp-hdr').forEach(grpHdr => {
    grpHdr.addEventListener('click', () => {
      const body = grpHdr.nextElementSibling as HTMLElement;
      const arr = grpHdr.querySelector('.arr') as HTMLElement;
      body.classList.toggle('open');
      arr.classList.toggle('open');
    });
  });

  container.querySelector('#agent-save-id')?.addEventListener('click', () => {
    const input = container.querySelector('#agent-device-id') as HTMLInputElement;
    if (input?.value.trim()) {
      setDeviceId(input.value.trim());
      stopRemote();
      startRemote();
      log('Device ID saved:', input.value.trim());
    }
  });

  container.querySelectorAll('.btn-run-suite').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-idx')!);
      const suite = allSuites[idx];
      if (!suite) return;
      if (!confirm(`Run "${suite.name}" (${suite.cases.length} cases)?`)) return;
      await executeSuite(suite, container);
    });
  });

  const fileInput = container.querySelector('#agent-file-input') as HTMLInputElement | null;
  container.querySelector('#agent-import-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const suite = importSuiteFromJSON(text);
      await saveLocalSuite(suite);
      await refreshSuites();
      await renderTestingPanel(container);
    } catch { alert('Invalid JSON format'); }
    fileInput.value = '';
  });

  container.querySelector('#agent-paste-btn')?.addEventListener('click', async () => {
    const json = prompt('Paste test suite JSON:');
    if (!json) return;
    try {
      const suite = importSuiteFromJSON(json);
      await saveLocalSuite(suite);
      await refreshSuites();
      await renderTestingPanel(container);
    } catch { alert('Invalid JSON format'); }
  });

  container.querySelector('#agent-export-report')?.addEventListener('click', () => {
    if (lastReport) downloadReport(lastReport);
  });
}

async function executeSuite(suite: TestSuite, container: HTMLElement) {
  log('Running suite:', suite.name, `(${suite.cases.length} cases)`);
  const results = await runSuite(suite, (msg) => log(msg));
  lastReport = generateReport(suite.name, results);
  printReportToConsole(lastReport);
  await renderTestingPanel(container);
}

export async function createTestingUI(container: Element) {
  await refreshSuites();
  await renderTestingPanel(container as HTMLElement);
}
