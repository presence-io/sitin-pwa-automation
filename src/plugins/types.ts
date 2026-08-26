// Project-plugin contract. Everything app-specific (the aifantasy onboarding/
// cashout/task flows, its panel UI, its Firebase suites key) lives behind this
// interface so core/stages/panel/cleanup stay generic. Adding a new target app
// = adding one plugin file that registers itself; no edits to the generic layers.

export type StatusFn = (key: string, state: string, msg: string) => void;
export type DisableAllFn = (v: boolean) => void;

export interface StageDefinition {
  id: string;
  name: string;
  amount: string;
  suiteFile: string;
}

// Handed to a plugin's mountPanel() so it can draw its own controls inside the
// floating panel and drive the shared status/disable helpers.
export interface PanelHost {
  container: HTMLElement;
  st: StatusFn;
  disableAll: DisableAllFn;
}

export interface ProjectPlugin {
  // Stable id, matched against the detected project (script[data-project] /
  // localStorage autobot_project). One plugin registers as the default so the
  // current single-app injection (no data-project) keeps working unchanged.
  id: string;
  panelTitle?: string;
  // Firebase suites namespace: suites/{firebaseProject}. Defaults to `id`.
  firebaseProject?: string;
  stages?: StageDefinition[];
  // Named functions callable from test suites via the `call` action.
  callFunctions?: Record<string, (args: any[]) => Promise<void>>;
  // App-specific identity line shown at the top of the panel (e.g. login state).
  identityHtml?(): string;
  // Draw the plugin's own panel sections (config, quick flows, tools…).
  mountPanel?(host: PanelHost): void;
}
