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
import type { TestSuite, TestManifest, ProjectEntry, TestReport } from './types';

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

let manifest: TestManifest | null = null;
let remoteSuites: TestSuite[] = [];
let lastReport: TestReport | null = null;

function countCases(suite: TestSuite): number { return suite.cases.length; }

function renderProjectSelector(container: HTMLElement): string {
  const project = configManager.getProject();
  const projects = manifest?.projects ?? [];
  if (projects.length === 0 && !project) {
    return `<div style="font-size:10px;color:#888">No project configured</div>`;
  }
  const options = projects.map(p =>
    `<option value="${esc(p.id)}" ${p.id === project ? 'selected' : ''}>${esc(p.name)}</option>`
  ).join('');
  return `<div class="row" style="gap:4px">
    <select id="test-project-select" style="flex:1;padding:4px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#eee;font-size:10px">
      <option value="">-- Select project --</option>
      ${options}
    </select>
    <button type="button" id="test-refresh-btn" style="padding:4px 8px;font-size:10px">🔄</button>
  </div>`;
}

function renderRemoteSuites(): string {
  if (remoteSuites.length === 0) return `<div style="font-size:10px;color:#666">No remote suites</div>`;
  return remoteSuites.map((s, i) => `
    <div class="saved-item" data-remote-idx="${i}">
      <span class="name">📋 ${esc(s.name)} (${countCases(s)})</span>
      <button type="button" class="green btn-run-remote" data-idx="${i}" title="Run">▶</button>
    </div>
  `).join('');
}

function renderLocalSuites(suites: TestSuite[]): string {
  if (suites.length === 0) return `<div style="font-size:10px;color:#666">No local suites</div>`;
  return suites.map(s => `
    <div class="saved-item" data-local-name="${esc(s.name)}">
      <span class="name">📝 ${esc(s.name)} (${countCases(s)})</span>
      <button type="button" class="green btn-run-local" data-name="${esc(s.name)}" title="Run">▶</button>
      <button type="button" class="btn-copy-local" data-name="${esc(s.name)}" title="Copy JSON">📋</button>
      <button type="button" class="btn-dl-local" data-name="${esc(s.name)}" title="Download">↓</button>
      <button type="button" class="warn btn-del-local" data-name="${esc(s.name)}" title="Delete">✕</button>
    </div>
  `).join('');
}

function renderResults(): string {
  if (!lastReport) return '';
  const { summary } = lastReport;
  const color = summary.failed > 0 ? '#ff6b6b' : '#69db7c';
  let html = `<div style="font-size:11px;color:${color};margin-bottom:4px">${summary.passed}/${summary.total} passed</div>`;
  for (const r of lastReport.results) {
    if (r.status === 'failed') {
      html += `<div style="font-size:10px;color:#ff6b6b">⚠ ${esc(r.name)} — ${esc(r.error ?? 'failed')}</div>`;
    }
  }
  return html;
}

async function refreshAll(container: HTMLElement) {
  manifest = await fetchManifest();
  const project = configManager.getProject();
  if (manifest && project) {
    const entry = manifest.projects.find(p => p.id === project);
    if (entry) {
      remoteSuites = await fetchAllRemoteSuites(project, entry.suites);
    }
  }
  await renderTestingPanel(container);
}

async function renderTestingPanel(container: HTMLElement) {
  const localSuites = await getAllLocalSuites();

  const remoteHTML = renderRemoteSuites();
  const localHTML = renderLocalSuites(localSuites);
  const resultsHTML = renderResults();

  container.innerHTML = `
    <div class="grp" id="grp-testing">
      <div class="grp-hdr" data-grp="testing"><span>🧪 Testing</span><span class="arr open">▶</span></div>
      <div class="grp-body open"><div class="inner">
        ${renderProjectSelector(container)}

        <div style="font-size:10px;color:#888;margin:6px 0 2px">Remote suites:</div>
        <div id="test-remote-list">${remoteHTML}</div>

        <div style="font-size:10px;color:#888;margin:6px 0 2px">Local suites:</div>
        <div id="test-local-list">${localHTML}</div>

        <div class="row" style="margin-top:6px;gap:4px">
          <button type="button" id="test-import-btn" class="wide" style="font-size:10px">Import file</button>
          <button type="button" id="test-paste-btn" class="wide" style="font-size:10px">Paste JSON</button>
        </div>
        <input type="file" id="test-file-input" accept=".json" style="display:none">

        ${remoteSuites.length > 0 ? `
        <div style="margin-top:6px;border-top:1px solid #333;padding-top:4px">
          <div class="row" style="gap:4px">
            <button type="button" id="test-run-all-btn" class="accent wide" style="font-size:10px">Run all</button>
          </div>
        </div>` : ''}

        ${resultsHTML ? `
        <div style="margin-top:6px;border-top:1px solid #333;padding-top:4px">
          ${resultsHTML}
          <button type="button" id="test-export-report-btn" style="font-size:10px;margin-top:4px">Export report</button>
        </div>` : ''}
      </div></div>
    </div>
  `;

  bindEvents(container, localSuites);
}

function bindEvents(container: HTMLElement, localSuites: TestSuite[]) {
  const grpHdr = container.querySelector('.grp-hdr');
  grpHdr?.addEventListener('click', () => {
    const body = grpHdr.nextElementSibling as HTMLElement;
    const arr = grpHdr.querySelector('.arr') as HTMLElement;
    body.classList.toggle('open');
    arr.classList.toggle('open');
  });

  container.querySelector('#test-project-select')?.addEventListener('change', async (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) {
      await configManager.switchProject(val);
      tracker.uninstall();
      tracker.install(configManager.getTrackers());
      await refreshAll(container);
    }
  });

  container.querySelector('#test-refresh-btn')?.addEventListener('click', () => refreshAll(container));

  container.querySelectorAll('.btn-run-remote').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-idx')!);
      const suite = remoteSuites[idx];
      if (suite) await executeSuite(suite, container);
    });
  });

  container.querySelectorAll('.btn-run-local').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-name')!;
      const suite = localSuites.find(s => s.name === name);
      if (suite) await executeSuite(suite, container);
    });
  });

  container.querySelectorAll('.btn-copy-local').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-name')!;
      const suite = localSuites.find(s => s.name === name);
      if (suite) { await copySuiteToClipboard(suite); log('Copied:', name); }
    });
  });

  container.querySelectorAll('.btn-dl-local').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name')!;
      const suite = localSuites.find(s => s.name === name);
      if (suite) downloadSuiteAsFile(suite);
    });
  });

  container.querySelectorAll('.btn-del-local').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-name')!;
      if (!confirm(`Delete "${name}"?`)) return;
      await deleteLocalSuite(name);
      await renderTestingPanel(container);
    });
  });

  const fileInput = container.querySelector('#test-file-input') as HTMLInputElement | null;
  container.querySelector('#test-import-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const suite = importSuiteFromJSON(text);
      await saveLocalSuite(suite);
      log('Imported:', suite.name);
      await renderTestingPanel(container);
    } catch (e) {
      warn('Import failed:', e);
      alert('Import failed: invalid JSON format');
    }
    fileInput.value = '';
  });

  container.querySelector('#test-paste-btn')?.addEventListener('click', async () => {
    const json = prompt('Paste test suite JSON:');
    if (!json) return;
    try {
      const suite = importSuiteFromJSON(json);
      await saveLocalSuite(suite);
      log('Pasted:', suite.name);
      await renderTestingPanel(container);
    } catch (e) {
      warn('Paste failed:', e);
      alert('Invalid JSON format');
    }
  });

  container.querySelector('#test-run-all-btn')?.addEventListener('click', async () => {
    const allSuites = [...remoteSuites, ...localSuites];
    if (allSuites.length === 0) return;
    const merged: TestSuite = {
      name: 'All Suites',
      cases: allSuites.flatMap(s => s.cases),
    };
    await executeSuite(merged, container);
  });

  container.querySelector('#test-export-report-btn')?.addEventListener('click', () => {
    if (lastReport) downloadReport(lastReport);
  });
}

async function executeSuite(suite: TestSuite, container: HTMLElement) {
  log('Running suite:', suite.name, `(${suite.cases.length} cases)`);

  const results = await runSuite(suite, (msg) => {
    log(msg);
  });

  lastReport = generateReport(suite.name, results);
  printReportToConsole(lastReport);
  await renderTestingPanel(container);
}

export async function createTestingUI(container: Element) {
  manifest = await fetchManifest();
  const project = configManager.getProject();
  if (manifest && project) {
    const entry = manifest.projects.find(p => p.id === project);
    if (entry) {
      remoteSuites = await fetchAllRemoteSuites(project, entry.suites);
    }
  }
  await renderTestingPanel(container as HTMLElement);
}
