import { warn } from '../core/helpers';
import { configManager } from './config';
import type { TestManifest, ProjectEntry, SuiteEntry, TestSuite } from './types';

const LOCAL_DB_NAME = 'autobot_tests';
const LOCAL_STORE_NAME = 'local_suites';

export async function fetchManifest(): Promise<TestManifest | null> {
  try {
    const url = `${configManager.getTestsBaseUrl()}/manifest.json`;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    warn('Failed to fetch manifest');
    return null;
  }
}

export async function fetchRemoteSuite(projectId: string, file: string): Promise<TestSuite | null> {
  try {
    const url = `${configManager.getTestsBaseUrl()}/${projectId}/${file}`;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export async function fetchAllRemoteSuites(projectId: string, entries: SuiteEntry[]): Promise<TestSuite[]> {
  const results: TestSuite[] = [];
  for (const entry of entries) {
    const suite = await fetchRemoteSuite(projectId, entry.file);
    if (suite) results.push(suite);
  }
  return results;
}

function openLocalDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(LOCAL_STORE_NAME)) {
        req.result.createObjectStore(LOCAL_STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalSuite(suite: TestSuite): Promise<void> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
    tx.objectStore(LOCAL_STORE_NAME).put(suite);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllLocalSuites(): Promise<TestSuite[]> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, 'readonly');
    const req = tx.objectStore(LOCAL_STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLocalSuite(name: string): Promise<void> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
    tx.objectStore(LOCAL_STORE_NAME).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function importSuiteFromJSON(json: string): TestSuite {
  const data = JSON.parse(json);
  if (!data.name || !Array.isArray(data.cases)) throw new Error('Invalid suite format: need name + cases[]');
  return data as TestSuite;
}

export function exportSuiteToJSON(suite: TestSuite): string {
  return JSON.stringify(suite, null, 2);
}

export function copySuiteToClipboard(suite: TestSuite): Promise<void> {
  return navigator.clipboard.writeText(exportSuiteToJSON(suite));
}

export function downloadSuiteAsFile(suite: TestSuite): void {
  const json = exportSuiteToJSON(suite);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${suite.name.replace(/\s+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
