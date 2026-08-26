import type { ProjectPlugin } from './types';

// Runtime registry of compiled-in project plugins. Because autobot.js is a single
// injected IIFE (no dynamic import), plugins register themselves at module load
// and the active one is picked by the detected project id.

const GENERIC_PLUGIN: ProjectPlugin = { id: 'generic' };

const registry = new Map<string, ProjectPlugin>();
let defaultId: string | null = null;
let active: ProjectPlugin = GENERIC_PLUGIN;

export function registerPlugin(plugin: ProjectPlugin, opts?: { default?: boolean }): void {
  registry.set(plugin.id, plugin);
  if (opts?.default || defaultId === null) defaultId = plugin.id;
}

// projectId set + known → that plugin. Set + unknown → generic (truly app-agnostic,
// no app-specific UI). Unset → the default plugin (backward-compat: the current
// aifantasy injection carries no data-project).
export function resolveActivePlugin(projectId: string | null): ProjectPlugin {
  if (projectId) {
    active = registry.get(projectId) ?? GENERIC_PLUGIN;
  } else {
    active = (defaultId && registry.get(defaultId)) || GENERIC_PLUGIN;
  }
  return active;
}

export function getActivePlugin(): ProjectPlugin {
  return active;
}
