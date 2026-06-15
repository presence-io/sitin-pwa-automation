import { log, warn } from '../core/helpers';

const DB_NAME = 'autobot_db';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;

export interface Locator {
  type: 'id' | 'testid' | 'aria' | 'text' | 'placeholder' | 'inputAttr' | 'css';
  value: string;
}

export interface RecordingStep {
  type: 'click' | 'input' | 'navigate' | 'select' | 'scroll' | 'assert';
  locators: Locator[];
  tag: string;
  textHint?: string;
  value?: string;
  url?: string;
  delay: number;
  scrollX?: number;
  scrollY?: number;
  assertType?: string;
  expected?: string;
  sdk?: string;
  event?: string;
}

export interface Recording {
  name: string;
  steps: RecordingStep[];
  createdAt: number;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { warn('IndexedDB open failed'); reject(req.error); };
  });
}

export async function saveRecording(rec: Recording): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(rec);
    tx.oncomplete = () => { log('Recording saved:', rec.name); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRecording(name: string): Promise<Recording | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllRecordings(): Promise<Recording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecording(name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(name);
    tx.oncomplete = () => { log('Recording deleted:', name); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export function exportRecordingsJSON(recordings: Recording[]): string {
  return JSON.stringify(recordings, null, 2);
}

export function importRecordingsJSON(json: string): Recording[] {
  const data = JSON.parse(json);
  const arr = Array.isArray(data) ? data : [data];
  for (const rec of arr) {
    if (!rec.name || !Array.isArray(rec.steps)) throw new Error('Invalid recording format');
  }
  return arr;
}

export async function importAndSaveJSON(json: string): Promise<number> {
  const recordings = importRecordingsJSON(json);
  for (const rec of recordings) {
    rec.updatedAt = Date.now();
    await saveRecording(rec);
  }
  return recordings.length;
}
