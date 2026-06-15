import { log, warn } from '../core/helpers';
import type { AutoBotProjectConfig, TrackerConfig, CleanupFnConfig } from './types';

const DEFAULT_TESTS_BASE_URL = 'https://presence-io.github.io/sitin-pwa-automation/tests';

function detectProject(): string | null {
  const scripts = document.querySelectorAll('script[src*="autobot"]');
  for (const s of scripts) {
    const p = (s as HTMLScriptElement).dataset.project;
    if (p) return p;
  }
  return localStorage.getItem('autobot_project') || null;
}

function detectTestsBaseUrl(): string {
  const scripts = document.querySelectorAll('script[src*="autobot"]');
  for (const s of scripts) {
    const u = (s as HTMLScriptElement).dataset.testsUrl;
    if (u) return u;
  }
  return localStorage.getItem('autobot_tests_url') || DEFAULT_TESTS_BASE_URL;
}

async function fetchProjectConfig(baseUrl: string, projectId: string): Promise<AutoBotProjectConfig | null> {
  try {
    const resp = await fetch(`${baseUrl}/${projectId}/project.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    warn('Failed to fetch project config for', projectId);
    return null;
  }
}

export class ConfigManager {
  private project: string | null = null;
  private config: AutoBotProjectConfig | null = null;
  private testsBaseUrl: string = DEFAULT_TESTS_BASE_URL;
  private initialized = false;

  async init(): Promise<void> {
    this.project = detectProject();
    this.testsBaseUrl = detectTestsBaseUrl();
    if (this.project) {
      this.config = await fetchProjectConfig(this.testsBaseUrl, this.project);
      if (this.config) log('Project config loaded:', this.project);
    }
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }
  getProject(): string | null { return this.project; }
  setProject(p: string | null): void { this.project = p; }
  getConfig(): AutoBotProjectConfig | null { return this.config; }
  setConfig(c: AutoBotProjectConfig | null): void { this.config = c; }
  getTestsBaseUrl(): string { return this.testsBaseUrl; }
  getTrackers(): TrackerConfig[] { return this.config?.trackers ?? []; }
  getCleanupFunctions(): Record<string, CleanupFnConfig> { return this.config?.cleanupFunctions ?? {}; }
  getPanelTitle(): string { return this.config?.panel?.title ?? 'AutoBot'; }

  async switchProject(projectId: string): Promise<boolean> {
    const config = await fetchProjectConfig(this.testsBaseUrl, projectId);
    if (config) {
      this.project = projectId;
      this.config = config;
      localStorage.setItem('autobot_project', projectId);
      log('Switched to project:', projectId);
      return true;
    }
    warn('Project not found:', projectId);
    return false;
  }
}

export const configManager = new ConfigManager();
