import { sleep, spaNav, findBtn, warn } from '../core/helpers';
import { configManager } from './config';
import type { CleanupFnConfig } from './types';

const builtinFunctions: Record<string, () => Promise<void>> = {
  clearLocalStorage: async () => {
    const keys = Object.keys(localStorage).filter(k => !k.startsWith('autobot_'));
    keys.forEach(k => localStorage.removeItem(k));
  },
  clearSessionStorage: async () => {
    sessionStorage.clear();
  },
  clearIndexedDB: async () => {
    if (!indexedDB.databases) return;
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name && !db.name.startsWith('autobot_')) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  },
  clearCookies: async () => {
    document.cookie.split(';').forEach(c => {
      const name = c.trim().split('=')[0];
      if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  },
  clearAll: async () => {
    await builtinFunctions.clearLocalStorage();
    await builtinFunctions.clearSessionStorage();
    await builtinFunctions.clearIndexedDB();
    await builtinFunctions.clearCookies();
  },
};

async function executeCustomCleanup(config: CleanupFnConfig, callFn: (name: string) => Promise<void>): Promise<void> {
  switch (config.type) {
    case 'navigate-click':
      if (config.url) { spaNav(config.url); await sleep(1500); }
      if (config.clickText) {
        const orig = config.confirmDialog ? window.confirm : null;
        if (config.confirmDialog) window.confirm = () => true;
        for (let i = 0; i < 10; i++) {
          const btn = findBtn(config.clickText);
          if (btn) { btn.click(); break; }
          await sleep(500);
        }
        await sleep(2000);
        if (orig) window.confirm = orig;
      }
      break;

    case 'api': {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(config.apiHeaders ?? {}) };
      if (config.apiTokenSource) {
        const idx = config.apiTokenSource.indexOf(':');
        if (idx > 0) {
          const source = config.apiTokenSource.slice(0, idx);
          const key = config.apiTokenSource.slice(idx + 1);
          if (source === 'localStorage') {
            const token = localStorage.getItem(key);
            if (token) headers['Authorization'] = `Bearer ${token}`;
          }
        }
      }
      await fetch(config.apiUrl!, { method: config.apiMethod ?? 'POST', headers });
      break;
    }

    case 'localStorage': {
      const preserve = config.preserveKeys ?? [];
      Object.keys(localStorage)
        .filter(k => !preserve.includes(k))
        .forEach(k => localStorage.removeItem(k));
      break;
    }

    case 'indexedDB': {
      if (!indexedDB.databases) return;
      const dbs = await indexedDB.databases();
      const targets = config.dbNames ?? dbs.map(d => d.name!).filter(Boolean);
      for (const name of targets) indexedDB.deleteDatabase(name);
      break;
    }

    case 'custom':
      if (config.script) {
        const fn = new Function('call', `return (async function() { this.call = call; ${config.script} }).call({ call })`);
        await fn(callFn);
      }
      break;
  }
}

export async function callCleanupFunction(name: string): Promise<void> {
  if (builtinFunctions[name]) {
    await builtinFunctions[name]();
    return;
  }

  const custom = configManager.getCleanupFunctions()[name];
  if (custom) {
    await executeCustomCleanup(custom, callCleanupFunction);
    return;
  }

  warn(`Unknown cleanup function: ${name}`);
}
