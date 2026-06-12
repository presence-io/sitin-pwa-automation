# 自动化测试框架设计方案（草案）

> 状态：讨论中，待确认标注为 **[待讨论]** 的部分

## 1. 目标

将 AutoBot 从"操作自动化工具"升级为"自动化测试框架"，覆盖：

- **功能验证**：操作后页面状态是否符合预期
- **埋点验证**：操作是否触发了正确的埋点事件和参数
- **数据清理**：测试完成后自动清除产生的脏数据
- **双端运行**：浏览器（headless Chrome）和 WebView（APK）共用同一套测试引擎

## 2. 整体架构

```
┌─────────────────────────────────────────────────┐
│              Test Cases (JSON)                    │
│  录制生成 / 模板生成 / 手写 / Stage 转换          │
└──────────┬──────────────────┬────────────────────┘
           │                  │
    ┌──────▼──────┐   ┌──────▼──────┐
    │  Browser     │   │  WebView    │
    │  Runner      │   │  (APK)     │
    │  (Node.js)   │   │            │
    │  Playwright  │   │  面板触发   │
    │  启动+注入    │   │  bridge    │
    └──────┬──────┘   └──────┬──────┘
           │                  │
    ┌──────▼──────────────────▼──────┐
    │     AutoBot Test Engine         │
    │     (in-browser, 两端共用)       │
    │                                 │
    │  Tracker → Runner → Asserter   │
    │  埋点Hook   逐步执行   断言验证  │
    │                    ↓            │
    │              Reporter           │
    │        JSON 报告 + 截图 + 埋点   │
    │                    ↓            │
    │              Cleanup            │
    │          数据清理 + 状态重置      │
    └─────────────────────────────────┘
```

## 3. 测试用例格式

### 3.1 数据结构

```typescript
interface TestCase {
  name: string;
  description?: string;
  tags?: string[];                // 分类标签: ['smoke', 'stage1', 'regression']
  variables?: Record<string, string>;  // 变量: { username: '{{random}}', age: '22' }
  setup?: TestAction[];           // 前置操作
  steps: TestAction[];            // 测试步骤
  teardown?: TestAction[];        // 清理操作
  teardownOnFail?: boolean;       // 失败时是否执行清理（默认 true）
}

interface TestSuite {
  name: string;
  cases: TestCase[];
  globalSetup?: TestAction[];     // 套件级前置
  globalTeardown?: TestAction[];  // 套件级清理
}

// 操作步骤 = 现有 RecordingStep 的超集
interface TestAction {
  // 基础操作（复用录制格式）
  action: 'click' | 'input' | 'select' | 'navigate' | 'scroll'
        | 'assert' | 'wait' | 'call' | 'screenshot';
  
  // 元素定位（多 locator 策略）
  locators?: Locator[];
  tag?: string;
  textHint?: string;

  // 操作参数
  value?: string;                 // input 的值，支持变量 {{username}}
  url?: string;                   // navigate 的 URL
  fn?: string;                    // call 类型：调用内置函数名
  args?: any[];                   // call 类型：函数参数
  delay?: number;

  // 断言参数
  assertType?: 'url' | 'textExists' | 'textNotExists' | 'elementExists' 
             | 'elementNotExists' | 'eventFired' | 'eventParams' | 'eventCount'
             | 'localStorage' | 'custom';
  expected?: string;
  sdk?: string;                   // 埋点断言：rangers / tiktok / meta
  event?: string;                 // 埋点断言：事件名
  key?: string;                   // 埋点/localStorage 断言：字段名
  min?: number;                   // eventCount 断言：最少次数
}
```

### 3.2 用例示例

```json
{
  "name": "Stage 1 注册流程",
  "tags": ["smoke", "stage1"],
  "variables": {
    "username": "{{random:autotest_}}",
    "age": "22",
    "paypal": "test@example.com"
  },
  "setup": [
    { "action": "call", "fn": "deleteAccount" },
    { "action": "call", "fn": "clearLocalStorage" }
  ],
  "steps": [
    { "action": "navigate", "url": "/login" },
    { "action": "click", "locators": [{ "type": "text", "value": "Quick Login" }], "tag": "button" },
    { "action": "assert", "assertType": "url", "expected": "/onboarding" },
    { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "login_success" },

    { "action": "input", "locators": [{ "type": "placeholder", "value": "Enter your name" }], "tag": "input", "value": "{{username}}" },
    { "action": "click", "locators": [{ "type": "text", "value": "Next" }], "tag": "button" },

    { "action": "assert", "assertType": "textExists", "expected": "Welcome" },
    { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "onboarding_complete" },
    { "action": "assert", "assertType": "eventParams", "sdk": "rangers", "event": "onboarding_complete", "key": "username", "expected": "{{username}}" }
  ],
  "teardown": [
    { "action": "call", "fn": "deleteAccount" },
    { "action": "call", "fn": "clearLocalStorage" }
  ],
  "teardownOnFail": true
}
```

## 4. 测试用例生成方式

### 4.1 录制生成（现有）

通过教学模式录制用户操作，导出 JSON 后手动补充断言。

- **优点**：门槛低，所见即所得
- **缺点**：只记录操作不记录预期结果，需要手动补充断言
- **适合**：UI 交互流程、不熟悉代码结构的使用者

### 4.2 Stage 转换

将现有的 Stage 1-5 代码自动转换为测试用例格式。Stage 函数本身就是完整的自动化流程，加上断言就是测试用例。

- **优点**：已有完整流程代码，转换成本低
- **缺点**：Stage 代码是命令式的 TypeScript，转为声明式 JSON 需要适配
- **适合**：核心业务流程的回归测试

### 4.3 模板生成

提供常见场景的测试模板，用户只需填参数：

```
模板: "注册流程"
参数: { username, age, paypal }
→ 自动生成完整的注册测试用例（含断言）
```

预置模板：
- 注册 → 首次提现
- 发帖 → 验证帖子存在
- Mock 通话 → 验证时长和收入
- 任务完成 → 验证余额变化

- **优点**：标准化，断言预设好
- **缺点**：灵活性低，仅覆盖已知场景
- **适合**：回归测试、新环境验证

### 4.4 手写 JSON

直接编写测试用例 JSON 文件，完全控制每一步操作和断言。

- **优点**：最灵活，支持复杂逻辑
- **缺点**：门槛高，需要了解 locator 和断言格式
- **适合**：开发/测试工程师编写精确的测试用例

### 4.5 AI 生成 **[待讨论]**

输入自然语言描述，LLM 生成测试用例：

```
输入: "测试用户注册后能否成功提现 $0.50"
→ LLM 分析 PWA 页面结构 + 已有 Stage 代码
→ 生成完整的测试用例 JSON
```

- **优点**：极低门槛
- **缺点**：需要 API 调用，生成质量不稳定，需要人工 review
- **适合**：快速生成初始用例，再人工调优

### 4.6 可视化编排 **[待讨论]**

在面板中拖拽/选择步骤组合测试用例，类似低代码平台：

```
[选择操作: 点击] → [选择元素: 按钮"Claim"] → [添加断言: URL变为/cashout]
```

- **优点**：直观，不需要写 JSON
- **缺点**：开发成本高，面板空间有限
- **适合**：非技术人员

## 5. 埋点验证

### 5.1 Hook 机制

在测试模式启动时，自动 hook PWA 中的所有埋点 SDK：

| SDK | 全局函数 | Hook 方式 |
|-----|---------|-----------|
| BytePlus Rangers | `window.collectEvent` | 替换函数，记录调用参数 |
| TikTok Pixel | `window.ttq.track` / `ttq.page` | 替换方法 |
| Meta Pixel | `window.fbq` | 替换函数 |
| AppsFlyer | `window.AF` | 替换函数 |

所有 hook 都保留原始函数引用并透传调用，不影响正常上报。

### 5.2 事件队列

```typescript
interface TrackedEvent {
  sdk: 'rangers' | 'tiktok' | 'meta' | 'appsflyer';
  event: string;
  params: Record<string, any>;
  timestamp: number;
  stepIndex?: number;  // 关联到第几步操作触发的
}
```

### 5.3 断言类型

| 断言 | 说明 | 示例 |
|------|------|------|
| `eventFired` | 某事件至少被触发一次 | `{ event: "login_success", sdk: "rangers" }` |
| `eventNotFired` | 某事件未被触发 | 验证误报场景 |
| `eventParams` | 事件的某个参数值匹配 | `{ event: "cashout", key: "amount", expected: "0.50" }` |
| `eventCount` | 事件触发次数在范围内 | `{ event: "page_view", min: 1, max: 3 }` |

### 5.4 报告中的埋点信息

无论是否写了埋点断言，测试报告都会自动附带完整的埋点事件列表，方便人工 review：

```json
{
  "trackedEvents": [
    { "sdk": "rangers", "event": "page_view", "params": { "page": "/login" }, "stepIndex": 0 },
    { "sdk": "rangers", "event": "login_success", "params": { "method": "quick" }, "stepIndex": 1 },
    { "sdk": "tiktok", "event": "CompleteRegistration", "params": {}, "stepIndex": 5 }
  ]
}
```

## 6. 数据清理

### 6.1 清理策略

| 层级 | 方式 | 说明 |
|------|------|------|
| **应用层** | 调用 `stepDeleteAccount` | 通过 Debug 页面删除账号，清除关联数据 |
| **API 层** | 调用后端测试清理接口 | 批量删除测试期间产生的数据（需后端支持） |
| **标记隔离** | 测试账号前缀 `autotest_` | 定时任务清理带此前缀的账号 |
| **本地状态** | 清除 localStorage / IndexedDB | 重置前端状态 |

### 6.2 生命周期中的清理时机

```
globalSetup     → 套件开始前：确保干净环境
  ├ case.setup     → 每条用例前：注销账号、清状态
  ├ case.steps     → 执行测试
  ├ case.teardown  → 每条用例后：清理本次产生的数据
globalTeardown  → 套件结束后：最终清理
```

### 6.3 清理可靠性

- `teardownOnFail: true`（默认）确保用例失败时也执行清理
- teardown 本身失败不影响报告（记录 warning，不标记 fail）
- 清理操作有超时限制，避免卡死

### 6.4 内置清理函数

通过 `{ action: "call", fn: "xxx" }` 调用：

| fn | 说明 |
|----|------|
| `deleteAccount` | 注销当前账号（调用 Debug API） |
| `clearLocalStorage` | 清除 localStorage（保留 autobot 配置） |
| `clearIndexedDB` | 清除应用的 IndexedDB 数据 |
| `resetState` | 综合清理：注销 + 清 localStorage + 清 IndexedDB |

## 7. 测试报告

### 7.1 报告结构

```typescript
interface TestReport {
  suite: string;
  environment: 'browser' | 'webview';
  userAgent: string;
  timestamp: number;
  duration: number;
  results: CaseResult[];
  trackedEvents: TrackedEvent[];    // 全部埋点事件
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

interface CaseResult {
  name: string;
  tags: string[];
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  steps: StepResult[];
  failedStep?: number;
  error?: string;
  screenshot?: string;             // 失败时自动截图，base64
  trackedEvents: TrackedEvent[];   // 该用例触发的埋点
}

interface StepResult {
  action: string;
  status: 'ok' | 'fail' | 'skip';
  duration: number;
  detail?: string;                 // 断言失败原因、实际值等
}
```

### 7.2 报告输出

| 格式 | 说明 | 使用场景 |
|------|------|----------|
| JSON | 结构化数据 | CI 消费、数据分析 |
| HTML | 可视化报告 | 人工 review、分享 |
| IndexedDB | 浏览器内存储 | WebView 端查看历史 |
| 控制台 | 简要 pass/fail | 开发调试 |

## 8. 面板 UI **[待讨论]**

教学模式面板需要扩展为"测试模式"，初步设想：

```
🧪 测试模式
  ┌─ 用例管理 ─────────────────────────┐
  │  📋 Stage 1 注册 (5步, 3断言)  [▶] [✎] [✕] │
  │  📋 Stage 2 提现 (8步, 4断言)  [▶] [✎] [✕] │
  │  📋 聊天发消息 (6步, 2断言)    [▶] [✎] [✕] │
  ├─ 批量执行 ─────────────────────────┤
  │  [全部执行]  [按标签过滤: smoke ▼]       │
  ├─ 录制 ─────────────────────────────┤
  │  [开始录制]  [插入断言 ▼]               │
  │  断言类型: URL / 文案存在 / 埋点触发     │
  ├─ 结果 ─────────────────────────────┤
  │  最近执行: 2/3 通过  [查看报告]         │
  │  ⚠ Stage 2 提现 — 步骤4失败           │
  ├─ 导入导出 ─────────────────────────┤
  │  [导入用例]  [导出全部]  [导出报告]      │
  └────────────────────────────────────┘
```

需要讨论的问题：
- 面板空间有限，测试功能和现有录制功能怎么共存？合并还是分 tab？
- 录制中插入断言的交互方式：弹窗选择？还是 minibar 上加按钮？
- 测试结果的查看：面板内展示摘要 + 导出详细报告？还是面板内完整展示？
- 是否需要用例编辑功能（在面板内修改步骤/断言），还是只在 JSON 层面编辑？

## 9. 双端执行

### 9.1 浏览器端（Playwright Runner）

```bash
# CLI 用法
npx autobot-test run tests/stage1.json --headless --report=html
npx autobot-test run tests/ --tag=smoke --report=json
```

执行流程：
1. Playwright 启动 headless Chrome
2. 导航到 PWA URL
3. `page.addScriptTag()` 注入 autobot
4. `page.evaluate()` 调用测试引擎执行用例
5. 轮询等待完成，拉取报告
6. 输出 HTML/JSON 报告

### 9.2 WebView 端 **[待讨论]**

WebView 内无法用 Playwright 控制，需要其他方式触发测试和收集结果：

**方案 A: 面板手动触发**
- 在面板内选择用例 → 点击执行 → 面板内查看结果 → 导出报告
- 最简单，但不支持 CI

**方案 B: Bridge 通信**
- 通过 `pwaBridge` 接收 Android 原生层指令
- 原生层可由 ADB 命令触发
- `adb shell am broadcast -a com.autobot.RUN_TEST --es suite "stage1"`
- 结果通过 bridge 回传给原生层 → 写入文件 → ADB pull

**方案 C: URL Scheme 触发**
- 打开特定 URL 自动执行测试：`gracechat://autotest?suite=stage1`
- 结果存 IndexedDB，通过 Chrome DevTools Protocol (ADB) 读取

**方案 D: WebSocket Server**
- autobot 启动一个 WebSocket 连接到本地 runner
- runner 发指令、收结果
- 需要网络连通性

## 10. CI 集成

### 10.1 GitHub Actions（浏览器端）

```yaml
name: E2E Tests
on: [push, workflow_dispatch]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm build
      - run: npx playwright install chromium
      - run: npx autobot-test run tests/ --tag=smoke --report=html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: reports/
```

### 10.2 WebView CI **[待讨论]**

需要真机/模拟器环境，可能的方案：
- Firebase Test Lab
- 自托管 Android 模拟器 + ADB
- BrowserStack App Automate

## 11. 项目结构（完整）

```
sitin-pwa-automation/
  src/
    core/               # 现有：helpers, config, API
    stages/             # 现有：预设流程 Stage 1-5
    teaching/           # 现有：录制回放
      recorder.ts       # 录制引擎（多 locator）
      player.ts         # 回放引擎（多 locator 匹配）
      store.ts          # IndexedDB 存储
      ui.ts             # 录制/回放 UI
    testing/            # 新增：测试框架
      assertion.ts      # 断言引擎
      tracker.ts        # 埋点 Hook + 事件收集
      runner.ts         # 用例执行器（setup → steps → teardown）
      reporter.ts       # 报告生成（JSON / HTML）
      cleanup.ts        # 数据清理工具
      suite.ts          # 测试套件管理
      variables.ts      # 变量替换引擎 ({{random}}, {{timestamp}})
    ui/                 # 现有：面板 + 样式
  cli/                  # 新增：Node.js CLI
    run.ts              # Playwright 启动 + 注入 + 收集
    report.ts           # HTML 报告渲染
    index.ts            # CLI 入口
  tests/                # 新增：测试用例
    stage1.json
    stage2.json
    smoke.json          # smoke 测试套件
  templates/            # 新增：用例模板
    register.template.json
    cashout.template.json
  docs/
  .github/workflows/
    deploy.yml          # 现有：GitHub Pages 部署
    e2e.yml             # 新增：E2E 测试 CI
```

## 12. 实施计划

### Phase 1 — 断言 + 埋点 + 报告（in-browser）

核心能力，两端立即可用：
- `testing/assertion.ts` — 断言引擎
- `testing/tracker.ts` — 埋点 hook
- `testing/runner.ts` — 用例执行（含 setup/teardown）
- `testing/reporter.ts` — JSON 报告
- `testing/cleanup.ts` — 数据清理
- 面板 UI 扩展：执行用例、查看结果

### Phase 2 — 用例生成 + 套件管理

- 录制时插入断言的交互
- Stage 代码 → 测试用例转换工具
- 模板系统
- 变量替换引擎
- 测试套件批量执行

### Phase 3 — CLI + CI

- `cli/` Node.js CLI 工具
- Playwright 集成
- GitHub Actions workflow
- HTML 报告生成
- WebView 端自动化触发方案

## 13. 待讨论清单

1. **面板 UI**：测试功能和录制功能合并还是分 tab？录制中插入断言的交互方式？
2. **用例生成**：除了录制和手写，模板/AI/可视化编排哪些值得投入？
3. **WebView 触发**：手动面板 / Bridge / URL Scheme / WebSocket 哪个方案？
4. **埋点覆盖**：是否需要验证埋点上报到服务端成功（网络层），还是只验证 SDK 函数被调用（JS 层）？
5. **清理策略**：是否需要后端提供专门的测试数据清理 API？
6. **WebView CI**：是否需要 WebView 端也接入 CI？用什么基础设施？
