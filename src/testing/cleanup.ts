import { sleep, spaNav, findBtn, warn, log } from '../core/helpers';
import { CFG } from '../core/config';
import { configManager } from './config';
import { finishTaskViaDebug, completeTask } from '../core/tasks';
import { triggerMockCall, runMockCalls, removeAutoAccept, installAutoAccept } from '../core/mockCall';
import { doCashout } from '../core/cashout';
import {
  stepDeleteAccount, stepQuickLogin, stepOnboarding, stepStage1Cashout,
} from '../stages/stage1';
import type { CleanupFnConfig } from './types';

// Dummy status function for stage steps called via test cases
const dummySt = (key: string, state: string, msg: string) => log(`[${key}] ${msg}`);

// ── Built-in functions (no args) ──

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
      if (db.name && !db.name.startsWith('autobot_')) indexedDB.deleteDatabase(db.name);
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

  // Stage operation functions
  deleteAccount: async () => { await stepDeleteAccount(dummySt); },
  quickLogin: async () => { await stepQuickLogin(dummySt); },
  onboarding: async () => { await stepOnboarding(dummySt); },
  cashout: async () => { await doCashout(); },
  installAutoAccept: async () => { installAutoAccept(); },
  removeAutoAccept: async () => { removeAutoAccept(); },
};

// ── Functions with args ──

const argFunctions: Record<string, (args: any[]) => Promise<void>> = {
  completeTask: async (args) => {
    const taskId = Number(args[0]);
    const label = String(args[1] || '');
    await completeTask(taskId, label);
  },
  finishTask: async (args) => {
    await finishTaskViaDebug(Number(args[0]));
  },
  mockCalls: async (args) => {
    const count = Number(args[0]) || 1;
    await runMockCalls(count);
    removeAutoAccept();
  },
  mockCallsAuto: async (args) => {
    // Auto-calculate based on earnings requirement and mock price
    const earnRequired = Number(args[0]) || 0;
    const durationRequired = Number(args[1]) || 0;
    const pricePerMin = parseFloat(CFG.mockPrice) || 10;
    const callsForEarn = earnRequired > 0 ? Math.ceil(earnRequired / pricePerMin) : 0;
    const callsForDuration = durationRequired > 0 ? Math.ceil(durationRequired) : 0;
    const count = Math.max(callsForEarn, callsForDuration) + 1;
    log(`mockCallsAuto: earn=$${earnRequired}, dur=${durationRequired}min, price=$${pricePerMin}/min → ${count} calls`);
    await runMockCalls(count);
    removeAutoAccept();
  },
  triggerMock: async () => {
    await triggerMockCall();
  },
  wait: async (args) => {
    await sleep(Number(args[0]) || 1000);
  },
};

// ── Custom config-based functions ──

async function executeCustomCleanup(config: CleanupFnConfig, callFn: (name: string, args?: any[]) => Promise<void>): Promise<void> {
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
      Object.keys(localStorage).filter(k => !preserve.includes(k)).forEach(k => localStorage.removeItem(k));
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

// ── Unified call entry ──

export async function callCleanupFunction(name: string, args?: any[]): Promise<void> {
  // Built-in no-arg functions
  if (builtinFunctions[name]) {
    await builtinFunctions[name]();
    return;
  }

  // Built-in arg functions
  if (argFunctions[name]) {
    await argFunctions[name](args || []);
    return;
  }

  // Project custom functions from config
  const custom = configManager.getCleanupFunctions()[name];
  if (custom) {
    await executeCustomCleanup(custom, callCleanupFunction);
    return;
  }

  warn(`Unknown function: ${name}`);
}
