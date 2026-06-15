import type { Locator } from '../teaching/store';

export type { Locator };

export interface AutoBotProjectConfig {
  project: string;
  baseUrl?: string;
  testsBaseUrl?: string;
  trackers?: TrackerConfig[];
  cleanupFunctions?: Record<string, CleanupFnConfig>;
  panel?: { title?: string };
}

export interface TrackerConfig {
  name: string;
  target: string;
  extractEvent: string;
  extractParams?: string;
}

export interface CleanupFnConfig {
  type: 'navigate-click' | 'api' | 'localStorage' | 'indexedDB' | 'custom';
  url?: string;
  clickText?: string;
  confirmDialog?: boolean;
  apiUrl?: string;
  apiMethod?: string;
  apiHeaders?: Record<string, string>;
  apiTokenSource?: string;
  preserveKeys?: string[];
  dbNames?: string[];
  script?: string;
}

export interface TestCase {
  name: string;
  description?: string;
  tags?: string[];
  variables?: Record<string, string>;
  setup?: TestAction[];
  steps: TestAction[];
  teardown?: TestAction[];
  teardownOnFail?: boolean;
}

export interface TestSuite {
  name: string;
  config?: AutoBotProjectConfig;
  cases: TestCase[];
  globalSetup?: TestAction[];
  globalTeardown?: TestAction[];
}

export interface TestAction {
  action: 'click' | 'input' | 'select' | 'navigate' | 'scroll'
        | 'assert' | 'wait' | 'call' | 'screenshot';
  locators?: Locator[];
  tag?: string;
  textHint?: string;
  value?: string;
  url?: string;
  fn?: string;
  args?: any[];
  delay?: number;
  timeout?: number;
  scrollX?: number;
  scrollY?: number;
  assertType?: AssertType;
  expected?: string;
  sdk?: string;
  event?: string;
  key?: string;
  min?: number;
  max?: number;
}

export type AssertType =
  | 'url' | 'textExists' | 'textNotExists'
  | 'elementExists' | 'elementNotExists'
  | 'eventFired' | 'eventNotFired' | 'eventParams' | 'eventCount'
  | 'localStorage' | 'cookie' | 'jsExpression';

export interface TrackedEvent {
  sdk: string;
  event: string;
  params: Record<string, any>;
  timestamp: number;
  stepIndex?: number;
}

export interface TestReport {
  suite: string;
  project: string;
  environment: string;
  userAgent: string;
  url: string;
  timestamp: number;
  duration: number;
  results: CaseResult[];
  trackedEvents: TrackedEvent[];
  summary: { total: number; passed: number; failed: number; skipped: number };
}

export interface CaseResult {
  name: string;
  tags: string[];
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  steps: StepResult[];
  failedStep?: number;
  error?: string;
  screenshot?: string;
  trackedEvents: TrackedEvent[];
}

export interface StepResult {
  action: string;
  status: 'ok' | 'fail' | 'skip';
  duration: number;
  detail?: string;
}

export interface TestManifest {
  projects: ProjectEntry[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  description?: string;
  suites: SuiteEntry[];
}

export interface SuiteEntry {
  file: string;
  name: string;
  tags?: string[];
}
