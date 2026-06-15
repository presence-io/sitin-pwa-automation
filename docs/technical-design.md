# AutoBot 测试平台 — Phase 1 技术方案

## Context

根据 PRD（docs/prd.md），将 AutoBot 从操作工具升级为通用 Web 自动化测试平台。本技术方案覆盖 Phase 1 全部交付物的详细实现设计，包含每个模块的接口定义、核心算法、与现有代码的集成方式，以及构建和部署方案。

## 一、整体架构

### 1.1 目录结构（Phase 1 新增）

```
src/
  testing/                          # 全部新增
    types.ts                        # 所有 interface 定义（TestCase, TestSuite, TestAction 等）
    config.ts                       # 项目配置加载（project 参数、远程拉取）
    tracker.ts                      # 可插拔埋点 SDK Hook
    assertion.ts                    # 断言引擎（含轮询重试）
    variables.ts                    # 变量替换引擎
    screenshot.ts                   # 失败截图（Canvas API）
    cleanup.ts                      # 数据清理（内置 + 自定义）
    runner.ts                       # 用例执行器（生命周期编排）
    reporter.ts                     # 报告生成（JSON + console）
    repository.ts                   # 用例仓库（远程拉取 + 本地 IndexedDB）
    ui.ts                           # 测试模式面板 UI
    index.ts                        # 测试模块统一导出
tests/                              # 新增
  manifest.json                     # 项目索引
  gracechat/
    project.json                    # GraceChat 项目配置
    smoke.json                      # 冒烟测试用例
```

### 1.2 模块依赖图

```
types.ts ← 纯类型定义，所有模块依赖
  ↓
config.ts ← 读取 project 参数 + 远程拉取 project.json
  ↓
tracker.ts ← 依赖 config.trackers
  ↓
assertion.ts ← 依赖 tracker（埋点断言） + player.ts 的 findByLocator（元素断言）
  ↓
variables.ts ← 独立
  ↓
screenshot.ts ← 独立
  ↓
cleanup.ts ← 依赖 config.cleanupFunctions + helpers.ts
  ↓
runner.ts ← 依赖 assertion + variables + cleanup + screenshot + player.ts
  ↓
reporter.ts ← 依赖 runner 产出的 CaseResult[]
  ↓
repository.ts ← 依赖 config.testsBaseUrl + store.ts 的 IndexedDB 工具
  ↓
ui.ts ← 整合所有模块 + 接入 panel.ts
```

### 1.3 与现有代码的集成

| 现有模块 | 复用方式 |
|---------|---------|
| `src/teaching/player.ts` | 复用 `findByLocator()`、`waitForElement()` 做元素定位；复用 `Player.executeStep()` 做 click/input/select/scroll/navigate |
| `src/teaching/store.ts` | 复用 `Locator` 接口定义；复用 IndexedDB 工具函数模式 |
| `src/core/helpers.ts` | 复用 `sleep`、`spaNav`、`typeInto`、`setNativeValue`、`findBtn`、`log`、`warn` |
| `src/core/config.ts` | 复用 `getAuth`、`getToken` 供 GraceChat cleanup 使用 |
| `src/ui/panel.ts` | 在 `createPanel()` 中为测试模式预留容器 `#testing-section`，类似现有 `#teaching-section` |

**关键改造：**
- `src/teaching/player.ts` — 需要导出 `findByLocator` 和 `waitForElement` 函数（当前是模块私有）
- `src/ui/panel.ts` — 需要添加 `#testing-section` 容器
- `src/main.ts` — 需要在 init 时初始化 tracker（越早 Hook 越好，避免丢失事件）

---

## 二、模块详细设计

### 2.1 types.ts — 类型定义

```typescript
// ── 项目配置 ──

export interface AutoBotProjectConfig {
  project: string;
  baseUrl?: string;
  testsBaseUrl?: string;
  trackers?: TrackerConfig[];
  cleanupFunctions?: Record<string, CleanupFnConfig>;
  panel?: { title?: string };
}

export interface TrackerConfig {
  name: string;                   // "rangers", "ga4", "mixpanel"...
  target: string;                 // "window.collectEvent", "window.gtag"...
  extractEvent: string;           // "args[0]", "args[1]"
  extractParams?: string;         // "args[1]", "args[2]"
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

// ── 测试用例 ──

export interface TestCase {
  name: string;
  description?: string;
  tags?: string[];
  variables?: Record<string, string>;
  setup?: TestAction[];
  steps: TestAction[];
  teardown?: TestAction[];
  teardownOnFail?: boolean;       // 默认 true
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
  locators?: Locator[];           // 复用 teaching/store.ts 的 Locator
  tag?: string;
  textHint?: string;
  value?: string;
  url?: string;
  fn?: string;
  args?: any[];
  delay?: number;
  timeout?: number;               // 默认 10000
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

// ── 埋点事件 ──

export interface TrackedEvent {
  sdk: string;
  event: string;
  params: Record<string, any>;
  timestamp: number;
  stepIndex?: number;
}

// ── 测试报告 ──

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
  screenshot?: string;             // base64
  trackedEvents: TrackedEvent[];
}

export interface StepResult {
  action: string;
  status: 'ok' | 'fail' | 'skip';
  duration: number;
  detail?: string;
}

// ── 远程用例仓库 ──

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
```

### 2.2 config.ts — 项目配置

**职责：** 确定当前项目、加载远程 project.json、合并默认值。

```typescript
// 默认远程 URL（GitHub Pages）
const DEFAULT_TESTS_BASE_URL = 'https://presence-io.github.io/sitin-pwa-automation/tests';

// 项目标识读取优先级:
// 1. script 标签 data-project 属性
// 2. localStorage autobot_project
// 3. 默认空（不加载远程用例）
function detectProject(): string | null {
  const script = document.querySelector('script[src*="autobot"]') as HTMLScriptElement | null;
  if (script?.dataset.project) return script.dataset.project;
  return localStorage.getItem('autobot_project') || null;
}

// 远程 URL 读取:
// 1. script 标签 data-tests-url 属性
// 2. localStorage autobot_tests_url
// 3. DEFAULT_TESTS_BASE_URL
function detectTestsBaseUrl(): string { ... }

// 加载远程 project.json
async function fetchProjectConfig(baseUrl: string, projectId: string): Promise<AutoBotProjectConfig | null> {
  try {
    const resp = await fetch(`${baseUrl}/${projectId}/project.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

// 导出: 单例 ConfigManager
export class ConfigManager {
  private project: string | null = null;
  private config: AutoBotProjectConfig | null = null;
  private testsBaseUrl: string = DEFAULT_TESTS_BASE_URL;

  async init(): Promise<void> {
    this.project = detectProject();
    this.testsBaseUrl = detectTestsBaseUrl();
    if (this.project) {
      this.config = await fetchProjectConfig(this.testsBaseUrl, this.project);
    }
  }

  getProject(): string | null { return this.project; }
  getConfig(): AutoBotProjectConfig | null { return this.config; }
  getTestsBaseUrl(): string { return this.testsBaseUrl; }
  getTrackers(): TrackerConfig[] { return this.config?.trackers ?? []; }
  getCleanupFunctions(): Record<string, CleanupFnConfig> { return this.config?.cleanupFunctions ?? {}; }
}

export const configManager = new ConfigManager();
```

### 2.3 tracker.ts — 可插拔埋点 Hook

**职责：** 根据 TrackerConfig 列表，Hook 对应的全局函数，记录所有事件调用。

```typescript
export class EventTracker {
  private events: TrackedEvent[] = [];
  private currentStepIndex = 0;
  private originals: Map<string, Function> = new Map();

  // 根据配置 Hook 所有 SDK
  install(trackers: TrackerConfig[]): void {
    for (const tracker of trackers) {
      this.hookTarget(tracker);
    }
  }

  // Hook 单个 SDK
  private hookTarget(config: TrackerConfig): void {
    // 解析 target 路径: "window.collectEvent" → window, "collectEvent"
    // "window.ttq.track" → window.ttq, "track"
    const { obj, key } = resolvePath(config.target);
    if (!obj || typeof obj[key] !== 'function') return;

    const original = obj[key];
    this.originals.set(config.target, original);

    const self = this;
    obj[key] = function (...args: any[]) {
      // 提取事件名和参数
      const event = extractByRule(args, config.extractEvent);     // "args[0]" → args[0]
      const params = extractByRule(args, config.extractParams);   // "args[1]" → args[1]

      if (event && typeof event === 'string') {
        self.events.push({
          sdk: config.name,
          event,
          params: (params && typeof params === 'object') ? params : {},
          timestamp: Date.now(),
          stepIndex: self.currentStepIndex,
        });
      }
      // 透传原始调用
      return original.apply(this, args);
    };
  }

  setStepIndex(index: number): void { this.currentStepIndex = index; }
  getEvents(): TrackedEvent[] { return [...this.events]; }
  getEventsByName(sdk: string, event: string): TrackedEvent[] {
    return this.events.filter(e => e.sdk === sdk && e.event === event);
  }
  clear(): void { this.events = []; }

  // 卸载所有 Hook，恢复原始函数
  uninstall(): void {
    for (const [target, original] of this.originals) {
      const { obj, key } = resolvePath(target);
      if (obj) obj[key] = original;
    }
    this.originals.clear();
  }
}

// 解析 "window.ttq.track" → { obj: window.ttq, key: "track" }
function resolvePath(path: string): { obj: any; key: string } {
  const parts = path.split('.');
  let obj: any = window;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === 'window') continue;
    obj = obj?.[parts[i]];
  }
  return { obj, key: parts[parts.length - 1] };
}

// 解析 "args[0]" → args[0], "args[1]" → args[1]
function extractByRule(args: any[], rule?: string): any {
  if (!rule) return undefined;
  const match = rule.match(/^args\[(\d+)\]$/);
  if (match) return args[parseInt(match[1])];
  return undefined;
}

export const tracker = new EventTracker();
```

### 2.4 assertion.ts — 断言引擎

**职责：** 执行所有类型的断言，支持轮询重试。

```typescript
import { tracker } from './tracker';
import { findByLocator } from '../teaching/player';  // 需要从 player.ts 导出

export interface AssertResult {
  passed: boolean;
  actual?: string;
  detail?: string;
}

// 单次断言检查（不重试）
function checkOnce(action: TestAction): AssertResult {
  switch (action.assertType) {
    case 'url':
      const url = location.pathname + location.search + location.hash;
      return { passed: url.includes(action.expected!), actual: url };

    case 'textExists':
      const hasText = document.body.innerText.includes(action.expected!);
      return { passed: hasText, actual: hasText ? 'found' : 'not found' };

    case 'textNotExists':
      const noText = !document.body.innerText.includes(action.expected!);
      return { passed: noText, actual: noText ? 'not found' : 'found' };

    case 'elementExists':
      if (!action.locators?.length) return { passed: false, detail: 'no locators' };
      for (const loc of action.locators) {
        const el = findByLocator(loc, action.tag || '');
        if (el) return { passed: true };
      }
      return { passed: false, actual: 'element not found' };

    case 'elementNotExists':
      if (!action.locators?.length) return { passed: true };
      for (const loc of action.locators) {
        const el = findByLocator(loc, action.tag || '');
        if (el) return { passed: false, actual: 'element exists' };
      }
      return { passed: true };

    case 'eventFired':
      const fired = tracker.getEventsByName(action.sdk!, action.event!);
      return { passed: fired.length > 0, actual: `${fired.length} events` };

    case 'eventNotFired':
      const notFired = tracker.getEventsByName(action.sdk!, action.event!);
      return { passed: notFired.length === 0, actual: `${notFired.length} events` };

    case 'eventParams':
      const events = tracker.getEventsByName(action.sdk!, action.event!);
      const match = events.some(e => String(e.params[action.key!]) === action.expected);
      return { passed: match, actual: events[0]?.params[action.key!] ?? 'no event' };

    case 'eventCount':
      const count = tracker.getEventsByName(action.sdk!, action.event!).length;
      const inRange = (action.min == null || count >= action.min) && (action.max == null || count <= action.max);
      return { passed: inRange, actual: `${count} events`, detail: `expected ${action.min ?? 0}-${action.max ?? '∞'}` };

    case 'localStorage':
      const lsVal = localStorage.getItem(action.key!);
      return { passed: lsVal === action.expected, actual: lsVal ?? 'null' };

    case 'cookie':
      const cookies = Object.fromEntries(document.cookie.split('; ').map(c => c.split('=')));
      const cookieVal = cookies[action.key!] ?? null;
      return { passed: cookieVal === action.expected, actual: cookieVal ?? 'null' };

    case 'jsExpression':
      try {
        const result = new Function(`return (${action.expected})`)();
        return { passed: !!result, actual: String(result) };
      } catch (e) {
        return { passed: false, detail: String(e) };
      }

    default:
      return { passed: false, detail: `unknown assertType: ${action.assertType}` };
  }
}

// 带轮询重试的断言执行
export async function runAssert(action: TestAction): Promise<AssertResult> {
  const timeout = action.timeout ?? 5000;
  const interval = 200;
  const deadline = Date.now() + timeout;

  let lastResult = checkOnce(action);
  if (lastResult.passed) return lastResult;

  // 轮询直到通过或超时
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    lastResult = checkOnce(action);
    if (lastResult.passed) return lastResult;
  }

  // 最终仍失败
  lastResult.detail = `${lastResult.detail ?? ''} (timeout ${timeout}ms)`.trim();
  return lastResult;
}
```

### 2.5 variables.ts — 变量替换

```typescript
export function resolveVariables(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    // {{random:prefix_}} → prefix_ + 6位随机字符
    if (expr.startsWith('random:')) {
      const prefix = expr.slice(7);
      return prefix + Math.random().toString(36).slice(2, 8);
    }
    // {{timestamp}} → 当前毫秒时间戳
    if (expr === 'timestamp') return String(Date.now());
    // {{date:YYYY-MM-DD}} → 格式化日期（简化实现）
    if (expr.startsWith('date:')) {
      const fmt = expr.slice(5);
      const d = new Date();
      return fmt
        .replace('YYYY', String(d.getFullYear()))
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(d.getDate()).padStart(2, '0'));
    }
    // {{key}} → 从 variables 中取值
    return vars[expr] ?? `{{${expr}}}`;
  });
}

// 递归替换 TestAction 中所有字符串字段的变量
export function resolveActionVariables(action: TestAction, vars: Record<string, string>): TestAction {
  const resolved = { ...action };
  if (resolved.value) resolved.value = resolveVariables(resolved.value, vars);
  if (resolved.url) resolved.url = resolveVariables(resolved.url, vars);
  if (resolved.expected) resolved.expected = resolveVariables(resolved.expected, vars);
  if (resolved.event) resolved.event = resolveVariables(resolved.event, vars);
  if (resolved.key) resolved.key = resolveVariables(resolved.key, vars);
  return resolved;
}
```

### 2.6 screenshot.ts — 失败截图

```typescript
export async function captureScreenshot(): Promise<string | null> {
  try {
    // 方案 1: 原生 Canvas（仅截取可见区域，无跨域资源）
    // 最轻量，无需外部依赖，适合 IIFE bundle

    const canvas = document.createElement('canvas');
    const rect = document.documentElement.getBoundingClientRect();
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d')!;

    // 使用 svg foreignObject 渲染 DOM 到 canvas
    const data = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">${document.documentElement.outerHTML}</div>
        </foreignObject>
      </svg>`;

    const img = new Image();
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}
```

> 注意: foreignObject 方案有跨域限制（外部图片、样式会丢失）。如果效果不理想，后续可引入 html2canvas 作为可选依赖。对于 Phase 1，"有截图但不完美"优于"无截图"。

### 2.7 cleanup.ts — 数据清理

```typescript
import { sleep, spaNav, findBtn } from '../core/helpers';
import { configManager } from './config';
import type { CleanupFnConfig } from './types';

// 内置通用清理函数
const builtinFunctions: Record<string, () => Promise<void>> = {
  clearLocalStorage: async () => {
    const preserve = ['autobot_config', 'autobot_enabled', 'autobot_project'];
    const keys = Object.keys(localStorage).filter(k => !preserve.includes(k) && !k.startsWith('autobot_'));
    keys.forEach(k => localStorage.removeItem(k));
  },
  clearSessionStorage: async () => {
    sessionStorage.clear();
  },
  clearIndexedDB: async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name && !db.name.startsWith('autobot_')) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  },
  clearCookies: async () => {
    document.cookie.split(';').forEach(c => {
      document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });
  },
  clearAll: async () => {
    await builtinFunctions.clearLocalStorage();
    await builtinFunctions.clearSessionStorage();
    await builtinFunctions.clearIndexedDB();
    await builtinFunctions.clearCookies();
  },
};

// 执行自定义清理函数（基于配置）
async function executeCustomCleanup(config: CleanupFnConfig, callFn: (name: string) => Promise<void>): Promise<void> {
  switch (config.type) {
    case 'navigate-click':
      if (config.url) { spaNav(config.url); await sleep(1500); }
      if (config.clickText) {
        if (config.confirmDialog) {
          const orig = window.confirm; window.confirm = () => true;
          const btn = findBtn(config.clickText);
          if (btn) btn.click();
          await sleep(2000);
          window.confirm = orig;
        } else {
          const btn = findBtn(config.clickText);
          if (btn) btn.click();
          await sleep(2000);
        }
      }
      break;

    case 'api':
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(config.apiHeaders ?? {}) };
      if (config.apiTokenSource) {
        const [source, key] = config.apiTokenSource.split(':');
        if (source === 'localStorage') {
          const token = localStorage.getItem(key);
          if (token) headers['Authorization'] = `Bearer ${token}`;
        }
      }
      await fetch(config.apiUrl!, { method: config.apiMethod ?? 'POST', headers });
      break;

    case 'localStorage':
      const preserve = config.preserveKeys ?? [];
      const allKeys = Object.keys(localStorage);
      allKeys.filter(k => !preserve.includes(k)).forEach(k => localStorage.removeItem(k));
      break;

    case 'indexedDB':
      const dbs = await indexedDB.databases();
      const targetDbs = config.dbNames ?? dbs.map(d => d.name!).filter(Boolean);
      for (const name of targetDbs) indexedDB.deleteDatabase(name);
      break;

    case 'custom':
      if (config.script) {
        const fn = new Function('call', `return (async function() { this.call = call; ${config.script} }).call({ call })`);
        await fn(callFn);
      }
      break;
  }
}

// 导出统一调用入口
export async function callCleanupFunction(name: string): Promise<void> {
  // 优先查找内置
  if (builtinFunctions[name]) {
    await builtinFunctions[name]();
    return;
  }

  // 查找项目自定义
  const custom = configManager.getCleanupFunctions()[name];
  if (custom) {
    await executeCustomCleanup(custom, callCleanupFunction);
    return;
  }

  throw new Error(`Unknown cleanup function: ${name}`);
}
```

### 2.8 runner.ts — 用例执行器

**职责：** 编排 globalSetup → case.setup → case.steps → case.teardown → globalTeardown，输出 CaseResult[]。

```typescript
import { sleep } from '../core/helpers';
import { tracker } from './tracker';
import { runAssert } from './assertion';
import { resolveActionVariables } from './variables';
import { captureScreenshot } from './screenshot';
import { callCleanupFunction } from './cleanup';
import { waitForElement, executeStep } from '../teaching/player';  // 需要导出
import { log, warn } from '../core/helpers';
import type { TestSuite, TestCase, TestAction, CaseResult, StepResult } from './types';

export type RunnerStatusFn = (msg: string) => void;

// 执行单个 TestAction
async function runAction(action: TestAction, vars: Record<string, string>, stepIndex: number): Promise<StepResult> {
  const start = Date.now();
  const resolved = resolveActionVariables(action, vars);

  tracker.setStepIndex(stepIndex);

  try {
    switch (resolved.action) {
      case 'assert': {
        const result = await runAssert(resolved);
        return {
          action: `assert:${resolved.assertType}`,
          status: result.passed ? 'ok' : 'fail',
          duration: Date.now() - start,
          detail: result.passed ? undefined : `expected: ${resolved.expected}, actual: ${result.actual}. ${result.detail ?? ''}`,
        };
      }

      case 'wait':
        await sleep(resolved.delay ?? 1000);
        return { action: 'wait', status: 'ok', duration: Date.now() - start };

      case 'call':
        await callCleanupFunction(resolved.fn!);
        return { action: `call:${resolved.fn}`, status: 'ok', duration: Date.now() - start };

      case 'screenshot': {
        await captureScreenshot();
        return { action: 'screenshot', status: 'ok', duration: Date.now() - start };
      }

      // click / input / select / navigate / scroll — 复用 Player 的逻辑
      default: {
        // 转换为 RecordingStep 格式供 player 使用
        const step = {
          type: resolved.action as any,
          locators: resolved.locators ?? [],
          tag: resolved.tag ?? '',
          textHint: resolved.textHint,
          value: resolved.value,
          url: resolved.url,
          delay: 0,
          scrollX: resolved.scrollX,
          scrollY: resolved.scrollY,
        };

        if (step.type === 'navigate') {
          // navigate 不需要元素定位
          const ok = await executeStep(step);
          return { action: resolved.action, status: ok ? 'ok' : 'fail', duration: Date.now() - start };
        }

        // 等待元素
        const el = await waitForElement(step, resolved.timeout ?? 10000);
        if (!el) {
          return {
            action: resolved.action,
            status: 'fail',
            duration: Date.now() - start,
            detail: `element not found: ${resolved.textHint ?? JSON.stringify(resolved.locators?.[0])}`,
          };
        }
        const ok = await executeStep(step);
        return { action: resolved.action, status: ok ? 'ok' : 'fail', duration: Date.now() - start };
      }
    }
  } catch (e) {
    return {
      action: resolved.action,
      status: 'fail',
      duration: Date.now() - start,
      detail: String(e),
    };
  }
}

// 执行一组 actions（setup / steps / teardown）
async function runActions(actions: TestAction[], vars: Record<string, string>, startIndex: number): Promise<{ steps: StepResult[]; failed: boolean; failedStep?: number }> {
  const steps: StepResult[] = [];
  for (let i = 0; i < actions.length; i++) {
    const result = await runAction(actions[i], vars, startIndex + i);
    steps.push(result);
    if (result.status === 'fail') {
      return { steps, failed: true, failedStep: startIndex + i };
    }
    await sleep(300);  // 步骤间短暂等待
  }
  return { steps, failed: false };
}

// 执行单个 TestCase
async function runCase(testCase: TestCase, statusFn?: RunnerStatusFn): Promise<CaseResult> {
  const start = Date.now();
  const vars = { ...(testCase.variables ?? {}) };
  // 预处理变量中的 random/timestamp
  for (const [k, v] of Object.entries(vars)) {
    vars[k] = resolveVariables(v, vars);
  }

  const allSteps: StepResult[] = [];
  let caseStatus: 'passed' | 'failed' = 'passed';
  let failedStep: number | undefined;
  let error: string | undefined;
  let screenshot: string | null = null;

  tracker.clear();

  // Setup
  if (testCase.setup?.length) {
    statusFn?.(`[${testCase.name}] setup...`);
    const result = await runActions(testCase.setup, vars, 0);
    allSteps.push(...result.steps);
    if (result.failed) {
      caseStatus = 'failed';
      failedStep = result.failedStep;
      error = `setup failed at step ${result.failedStep}`;
    }
  }

  // Steps（仅 setup 通过后执行）
  if (caseStatus === 'passed') {
    statusFn?.(`[${testCase.name}] running...`);
    const setupLen = testCase.setup?.length ?? 0;
    const result = await runActions(testCase.steps, vars, setupLen);
    allSteps.push(...result.steps);
    if (result.failed) {
      caseStatus = 'failed';
      failedStep = result.failedStep;
      error = result.steps.find(s => s.status === 'fail')?.detail;
      screenshot = await captureScreenshot();
    }
  }

  // Teardown（根据 teardownOnFail 决定）
  if (testCase.teardown?.length && (caseStatus === 'passed' || testCase.teardownOnFail !== false)) {
    statusFn?.(`[${testCase.name}] teardown...`);
    try {
      const teardownOffset = (testCase.setup?.length ?? 0) + testCase.steps.length;
      await runActions(testCase.teardown, vars, teardownOffset);
    } catch (e) {
      warn('teardown error (ignored):', e);
    }
  }

  return {
    name: testCase.name,
    tags: testCase.tags ?? [],
    status: caseStatus,
    duration: Date.now() - start,
    steps: allSteps,
    failedStep,
    error,
    screenshot: screenshot ?? undefined,
    trackedEvents: tracker.getEvents(),
  };
}

// 执行 TestSuite
export async function runSuite(suite: TestSuite, statusFn?: RunnerStatusFn): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  // globalSetup
  if (suite.globalSetup?.length) {
    statusFn?.('globalSetup...');
    const result = await runActions(suite.globalSetup, {}, 0);
    if (result.failed) {
      warn('globalSetup failed, aborting suite');
      return results;
    }
  }

  // 逐个执行 case
  for (let i = 0; i < suite.cases.length; i++) {
    const tc = suite.cases[i];
    statusFn?.(`(${i + 1}/${suite.cases.length}) ${tc.name}`);
    const result = await runCase(tc, statusFn);
    results.push(result);
    log(`[${result.status}] ${tc.name} (${result.duration}ms)`);
  }

  // globalTeardown
  if (suite.globalTeardown?.length) {
    statusFn?.('globalTeardown...');
    try {
      await runActions(suite.globalTeardown, {}, 0);
    } catch (e) {
      warn('globalTeardown error (ignored):', e);
    }
  }

  return results;
}
```

### 2.9 reporter.ts — 报告生成

```typescript
import { tracker } from './tracker';
import { configManager } from './config';
import { log } from '../core/helpers';
import type { TestReport, CaseResult } from './types';

export function generateReport(suiteName: string, results: CaseResult[]): TestReport {
  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
  };

  const report: TestReport = {
    suite: suiteName,
    project: configManager.getProject() ?? 'unknown',
    environment: (window as any).pwaBridge ? 'webview' : 'browser',
    userAgent: navigator.userAgent,
    url: location.href,
    timestamp: Date.now(),
    duration: results.reduce((sum, r) => sum + r.duration, 0),
    results,
    trackedEvents: tracker.getEvents(),
    summary,
  };

  return report;
}

export function printReportToConsole(report: TestReport): void {
  const { summary } = report;
  console.group(`%c[AutoBot] ${report.suite}`, 'color:#00bcd4;font-weight:bold');
  console.log(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${report.duration}ms)`);

  for (const result of report.results) {
    const icon = result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '○';
    const color = result.status === 'passed' ? 'green' : result.status === 'failed' ? 'red' : 'gray';
    console.log(`%c  ${icon} ${result.name} (${result.duration}ms)`, `color:${color}`);
    if (result.error) console.log(`    → ${result.error}`);
  }

  if (report.trackedEvents.length > 0) {
    console.log(`\n  Tracked events: ${report.trackedEvents.length}`);
  }
  console.groupEnd();
}

export function exportReportJSON(report: TestReport): string {
  return JSON.stringify(report, null, 2);
}
```

### 2.10 repository.ts — 用例仓库

```typescript
import { log, warn } from '../core/helpers';
import { configManager } from './config';
import type { TestManifest, ProjectEntry, SuiteEntry, TestSuite } from './types';

const LOCAL_DB_NAME = 'autobot_tests';
const LOCAL_STORE_NAME = 'local_suites';

// ── 远程用例 ──

export async function fetchManifest(): Promise<TestManifest | null> {
  try {
    const url = `${configManager.getTestsBaseUrl()}/manifest.json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export async function fetchRemoteSuite(projectId: string, file: string): Promise<TestSuite | null> {
  try {
    const url = `${configManager.getTestsBaseUrl()}/${projectId}/${file}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export async function fetchAllRemoteSuites(projectId: string, entries: SuiteEntry[]): Promise<TestSuite[]> {
  const suites: TestSuite[] = [];
  for (const entry of entries) {
    const suite = await fetchRemoteSuite(projectId, entry.file);
    if (suite) suites.push(suite);
  }
  return suites;
}

// ── 本地用例（IndexedDB）──

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

// ── JSON 导入导出 ──

export function importSuiteFromJSON(json: string): TestSuite {
  const data = JSON.parse(json);
  if (!data.name || !Array.isArray(data.cases)) throw new Error('Invalid suite format');
  return data as TestSuite;
}

export function exportSuiteToJSON(suite: TestSuite): string {
  return JSON.stringify(suite, null, 2);
}

export function copySuiteToClipboard(suite: TestSuite): void {
  navigator.clipboard.writeText(exportSuiteToJSON(suite));
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
```

### 2.11 ui.ts — 测试模式面板 UI

**职责：** 渲染测试模式 Tab，处理所有面板交互。

核心交互:
1. 项目下拉选择 + 刷新按钮
2. 远程用例列表（只读，可执行）
3. 本地用例列表（可执行/复制/导出/删除）
4. 导入/粘贴 JSON
5. 批量执行 + 标签过滤
6. 执行结果 + 导出报告

> 代码细节不在此列出（主要是 DOM 拼接 + 事件绑定），参考现有 `src/teaching/ui.ts` 的模式：grpHTML 生成 HTML、事件委托绑定。执行时复用 minibar 展示进度。

### 2.12 现有代码改造

#### player.ts — 导出内部函数

当前 `findByLocator` 和 `waitForElement` 是模块私有函数，需要导出供 `assertion.ts` 和 `runner.ts` 使用。

`executeStep` 也需要导出，或者将其中 click/input/select/navigate/scroll 的执行逻辑抽取为独立函数。

#### panel.ts — 添加测试模式容器

在 `createPanel()` 中 `#teaching-section` 之后添加 `#testing-section`：
```html
<div id="teaching-section"></div>
<div id="testing-section"></div>
```

#### main.ts — 初始化 tracker

```typescript
import { configManager } from './testing/config';
import { tracker } from './testing/tracker';
import { createTestingUI } from './testing/ui';

async function init() {
  log('AutoBot v4 loaded');
  // 先初始化配置和 tracker（尽早 Hook，避免丢失事件）
  await configManager.init();
  tracker.install(configManager.getTrackers());

  createPanel();
}
```

### 2.13 构建配置

当前 `tsup.config.ts` 已配置为 IIFE 格式，新增模块会自动打包进 `dist/autobot.js`。无需修改构建配置。

`tests/` 目录需要一起部署到 GitHub Pages。修改 `.github/workflows/deploy.yml`，将 `tests/` 复制到 `dist/` 后再部署：

```yaml
- run: pnpm build
- run: cp -r tests dist/tests    # 新增
- uses: actions/upload-pages-artifact@v3
  with:
    path: dist
```

---

## 三、验证方式

1. `pnpm build` 编译通过
2. 在 GraceChat PWA 中加载 → 面板显示测试模式 Tab
3. 创建 `tests/gracechat/project.json` + `tests/gracechat/smoke.json` + `tests/manifest.json`
4. 面板中选择 GraceChat 项目 → 远程用例列表加载正常
5. 执行 smoke 用例 → 断言通过 → 报告生成
6. 人为制造断言失败 → 截图生成 → 报告正确记录失败
7. 本地导入用例 → 复制 JSON → 导出文件 → 删除 → 全部正常
8. 埋点 Hook → 报告中 trackedEvents 列表完整
9. 部署到 GitHub Pages → 远程拉取用例正常
