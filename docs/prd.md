# AutoBot 自动化测试平台 — PRD

## Context

AutoBot 当前是一个浏览器端自动化操作工具，具备预设流程和教学模式（录制/回放）。基于调研报告（docs/testing-tools-research.md）的结论，AutoBot 占据了一个独特生态位：声明式 JSON + 浏览器内执行 + 埋点验证 + WebView 原生支持。

本 PRD 将 AutoBot 从"操作工具"升级为**通用 Web 自动化测试平台**，可用于任何 Web 应用 / PWA / WebView 应用的自动化测试。GraceChat 是首个接入项目，但平台能力不与之绑定。

---

## 一、产品定位

**一句话定位：** 通用的轻量级 Web 自动化测试平台，以单脚本注入方式运行在任何 Web 页面中，支持功能验证、埋点验证和测试数据清理。

**目标用户：**
- QA 工程师：日常回归测试、新功能验证
- 开发工程师：开发自测、埋点验证
- 产品/运营：核心流程冒烟测试（通过面板操作，无需写代码）

**核心原则：**
1. **通用优先** — 测试引擎与业务解耦，任何 Web 应用均可接入
2. **声明式优先** — 测试用例是 JSON，不是代码，AI 可生成、人可审查
3. **浏览器内优先** — 引擎运行在页面内部，零配置，浏览器和 WebView 双端通用
4. **埋点是一等公民** — 可插拔的 SDK Hook + 断言，不是事后补丁
5. **渐进式** — 可以只用录制回放，也可以写完整断言用例，按需升级

---

## 二、通用化架构

### 2.1 分层设计

```
┌─────────────────────────────────────────────────┐
│                  项目适配层                        │
│  app-plugins/gracechat/   (GraceChat 适配)        │
│  app-plugins/xxx/         (其他项目适配)           │
│  - plugin.ts              (清理函数、预设流程)      │
│  - tracker-config.ts      (埋点 SDK 配置)          │
│  - presets/               (预置测试用例)            │
├─────────────────────────────────────────────────┤
│                  测试引擎层（通用）                  │
│  src/testing/                                     │
│  assertion.ts  tracker.ts  runner.ts  reporter.ts │
│  variables.ts  screenshot.ts  cleanup.ts          │
├─────────────────────────────────────────────────┤
│                  基础能力层（通用）                  │
│  src/teaching/  recorder.ts  player.ts  store.ts  │
│  src/core/      helpers.ts   config.ts            │
│  src/ui/        panel.ts     styles.ts            │
└─────────────────────────────────────────────────┘
```

**关键原则：** 测试引擎层和基础能力层不包含任何业务逻辑。所有项目相关的代码（清理函数、埋点 SDK 配置、预设流程）都在适配层中。

### 2.2 接入方式

任何 Web 应用均可通过以下方式接入 AutoBot：

**方式 A：`<script>` 标签（推荐）**
```html
<script>
  if (localStorage.getItem('autobot_enabled') === '1') {
    var s = document.createElement('script');
    s.src = 'https://your-cdn.com/autobot.js';
    document.body.appendChild(s);
  }
</script>
```

**方式 B：浏览器扩展注入（未来）**
- Chrome Extension 自动向目标页面注入 autobot.js
- 无需修改目标应用代码

**方式 C：Playwright CLI 注入（CI 场景）**
```bash
npx autobot-test run tests/smoke.json --url=https://your-app.com
```
- Playwright 启动浏览器 → 导航到 URL → `page.addScriptTag()` 注入
- 目标应用无需任何修改

### 2.3 项目配置

通过 JSON 配置文件声明项目信息，AutoBot 根据配置加载对应的适配插件：

```typescript
interface AutoBotConfig {
  project: string;                   // 项目标识
  baseUrl?: string;                  // 应用基础 URL（CLI 模式使用）

  // 埋点 SDK 配置（可插拔）
  trackers?: TrackerConfig[];

  // 自定义清理函数（可插拔）
  cleanupFunctions?: Record<string, CleanupFnConfig>;

  // UI 配置
  panel?: {
    title?: string;                  // 面板标题（默认 "AutoBot"）
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  };
}

interface TrackerConfig {
  name: string;                      // SDK 标识，如 "rangers", "gtag", "mixpanel"
  type: 'function' | 'method';       // Hook 类型
  target: string;                    // 全局函数路径，如 "window.collectEvent", "window.gtag"
  extractEvent?: string;             // 事件名提取方式，如 "args[0]"（第一个参数）
  extractParams?: string;            // 参数提取方式，如 "args[1]"（第二个参数）
}
```

**预置 SDK 配置（开箱即用）：**

| SDK | name | target | 说明 |
|-----|------|--------|------|
| BytePlus Rangers | `rangers` | `window.collectEvent` | 事件名 = args[0]，参数 = args[1] |
| TikTok Pixel | `tiktok` | `window.ttq.track` | 事件名 = args[0] |
| Meta Pixel | `meta` | `window.fbq` | 事件名 = args[1]（args[0] = "track"） |
| Google Analytics 4 | `ga4` | `window.gtag` | 事件名 = args[1]（args[0] = "event"） |
| Mixpanel | `mixpanel` | `window.mixpanel.track` | 事件名 = args[0]，参数 = args[1] |
| Amplitude | `amplitude` | `window.amplitude.track` | 事件名 = args[0] |
| AppsFlyer | `appsflyer` | `window.AF` | 事件名 = args[1] |
| Segment | `segment` | `window.analytics.track` | 事件名 = args[0]，参数 = args[1] |

用户也可以自定义任意 SDK 的 Hook 配置。

### 2.4 自定义清理函数

清理函数通过配置注册，不再硬编码：

```typescript
interface CleanupFnConfig {
  type: 'navigate-click' | 'api' | 'localStorage' | 'indexedDB' | 'custom';

  // type = 'navigate-click': 导航到页面 → 点击按钮
  url?: string;                       // 导航目标
  clickText?: string;                 // 点击的按钮文案
  confirmDialog?: boolean;            // 是否自动确认弹窗

  // type = 'api': 调用 HTTP API
  apiUrl?: string;
  apiMethod?: string;
  apiHeaders?: Record<string, string>;
  apiTokenSource?: string;            // token 来源，如 "localStorage:haven_token"

  // type = 'localStorage': 清除 localStorage
  preserveKeys?: string[];            // 保留的 key 列表

  // type = 'indexedDB': 清除 IndexedDB
  dbNames?: string[];                 // 要清除的数据库名

  // type = 'custom': 自定义 JS 函数体
  script?: string;                    // JS 代码字符串
}
```

**示例 — GraceChat 的清理配置：**
```json
{
  "deleteAccount": {
    "type": "navigate-click",
    "url": "/debug",
    "clickText": "删除账户",
    "confirmDialog": true
  },
  "clearLocalStorage": {
    "type": "localStorage",
    "preserveKeys": ["autobot_config", "autobot_enabled"]
  },
  "clearIndexedDB": {
    "type": "indexedDB"
  },
  "resetState": {
    "type": "custom",
    "script": "await this.call('deleteAccount'); await this.call('clearLocalStorage'); await this.call('clearIndexedDB');"
  }
}
```

**示例 — 通用电商项目：**
```json
{
  "logout": {
    "type": "navigate-click",
    "url": "/account/settings",
    "clickText": "Log Out"
  },
  "clearCart": {
    "type": "api",
    "apiUrl": "/api/cart/clear",
    "apiMethod": "POST",
    "apiTokenSource": "localStorage:auth_token"
  },
  "resetState": {
    "type": "custom",
    "script": "await this.call('logout'); await this.call('clearCart');"
  }
}
```

---

## 三、功能集合

### P0 — 核心能力（Phase 1）

#### F1: 断言引擎
用例中的每一步操作后可插入断言，验证页面状态。

| 断言类型 | 说明 | 示例 |
|---------|------|------|
| `url` | 当前 URL 包含指定路径 | `{ assertType: "url", expected: "/home" }` |
| `textExists` | 页面可见区域存在指定文案 | `{ assertType: "textExists", expected: "Welcome" }` |
| `textNotExists` | 页面不存在指定文案 | `{ assertType: "textNotExists", expected: "Error" }` |
| `elementExists` | 指定元素存在且可见 | `{ assertType: "elementExists", locators: [...] }` |
| `elementNotExists` | 指定元素不存在 | `{ assertType: "elementNotExists", locators: [...] }` |
| `localStorage` | localStorage 指定 key 的值匹配 | `{ assertType: "localStorage", key: "token", expected: "..." }` |
| `cookie` | 指定 cookie 的值匹配 | `{ assertType: "cookie", key: "session", expected: "..." }` |
| `jsExpression` | 自定义 JS 表达式返回 truthy | `{ assertType: "jsExpression", expected: "document.title === 'Home'" }` |

断言失败时：记录失败原因（expected vs actual）、自动截图、标记用例失败。

**断言行为：**
- 轮询重试：最多等待 N 秒（默认 5 秒），每 200ms 重试一次（参考 Playwright auto-retry）
- 适用场景：异步渲染、SPA 路由跳转后 DOM 更新延迟
- 配置：通过 `timeout` 字段覆盖默认超时

#### F2: 可插拔埋点验证
测试启动时根据配置自动 Hook 页面内指定的埋点 SDK，记录事件，支持断言。

**核心机制：**
1. 读取 `trackers` 配置（预置 or 自定义）
2. 对每个 SDK，在目标函数上包一层代理（保留原始调用）
3. 记录每次调用的事件名、参数、时间戳、关联步骤索引
4. 测试结束后，事件队列供断言引擎查询 + 写入报告

**埋点断言类型：**

| 断言 | 说明 |
|------|------|
| `eventFired` | 事件至少触发一次 |
| `eventNotFired` | 事件未触发 |
| `eventParams` | 事件的指定参数值匹配 |
| `eventCount` | 事件触发次数在范围内 |

无论是否有埋点断言，测试报告都自动附带完整事件列表。

**通用性：** 任何通过全局函数上报事件的 SDK 都可以被 Hook，只需在配置中声明 `target`（函数路径）和事件/参数的提取规则。

#### F3: 测试用例执行器
按 `setup → steps → teardown` 生命周期执行声明式 JSON 用例。

```
TestSuite
├── globalSetup          // 套件前置
├── TestCase 1
│   ├── setup            // 用例前置（清理脏数据）
│   ├── steps            // 测试步骤 + 断言
│   └── teardown         // 用例清理
├── TestCase 2
│   ├── setup
│   ├── steps
│   └── teardown
└── globalTeardown       // 套件收尾
```

**关键行为：**
- `teardownOnFail: true`（默认）：用例失败时仍执行 teardown
- 每步操作前自动等待元素出现（MutationObserver，可配置超时）
- 断言支持轮询重试
- 变量替换：`{{username}}`、`{{random:prefix_}}`、`{{timestamp}}`

#### F4: 可插拔数据清理
通过 `{ action: "call", fn: "xxx" }` 调用注册的清理函数。

**内置通用函数（任何项目可用）：**

| 函数 | 说明 |
|------|------|
| `clearLocalStorage` | 清除 localStorage（保留 autobot 配置） |
| `clearSessionStorage` | 清除 sessionStorage |
| `clearIndexedDB` | 清除所有 IndexedDB 数据库 |
| `clearCookies` | 清除所有 cookie |
| `clearAll` | 综合清理：localStorage + sessionStorage + IndexedDB + cookies |

**项目自定义函数：** 通过 `cleanupFunctions` 配置注册，在用例中以相同的 `call` 方式调用。

#### F5: 测试报告
每次执行完成后生成结构化报告。

**报告内容：**
- 套件/用例级别：通过/失败/跳过数量、总耗时
- 每步结果：操作类型、耗时、状态、失败原因
- 失败截图：自动通过 Canvas API 截取
- 埋点事件列表：所有 SDK 事件按时间排序，关联到步骤索引
- 环境信息：浏览器 UA、页面 URL、执行时间

**输出格式：**
- JSON（结构化，供 CI 消费、第三方工具对接）
- 控制台（摘要，开发调试用）
- 面板内（通过/失败状态 + 失败详情）

#### F6: 面板 UI — 测试模式

在面板中新增"测试模式"区域：

```
┌─ 🧪 测试模式 ─────────────────────────────┐
│                                            │
│  ⬜ 导入用例  [选择文件]                     │
│                                            │
│  📋 用户注册流程 (5步 3断言)    [▶] [✕]     │
│  📋 商品下单流程 (8步 4断言)    [▶] [✕]     │
│  📋 搜索功能 (6步 2断言)       [▶] [✕]     │
│                                            │
│  ─── 批量 ────────────────────────────     │
│  [全部执行]  标签: [smoke ▼]               │
│                                            │
│  ─── 结果 ────────────────────────────     │
│  最近: 2/3 通过  [导出报告]                │
│  ⚠ 商品下单 — 步骤4失败: 文案未找到        │
│                                            │
└────────────────────────────────────────────┘
```

**交互流程：**
1. 导入 JSON 用例文件 → 面板展示用例列表
2. 点击单条 [▶] → 执行单个用例 → minibar 展示进度
3. 点击 [全部执行] → 按标签过滤后批量执行
4. 执行完成 → 面板展示通过/失败摘要
5. 点击失败用例 → 展开失败步骤详情
6. [导出报告] → 下载 JSON 报告文件

---

### P1 — 用例生成（Phase 2）

#### F7: 录制 + 断言插入
在现有录制模式基础上，支持录制过程中插入断言。

**交互方式：** 录制状态的 minibar 增加 [+断言] 按钮 → 弹出断言类型选择：
- URL 断言：自动填充当前 URL
- 文案存在：手动输入文案，或点击页面元素自动提取
- 埋点触发：从已记录的事件列表中选择

录制停止时生成的 JSON 自动包含断言步骤。

#### F8: 变量替换引擎
支持用例中使用变量，执行时动态替换。

| 变量格式 | 说明 | 示例值 |
|---------|------|--------|
| `{{random:prefix_}}` | 前缀 + 随机字符串 | `prefix_xk9m2a` |
| `{{timestamp}}` | 当前时间戳 | `1718438400000` |
| `{{date:YYYY-MM-DD}}` | 格式化日期 | `2026-06-15` |
| `{{env:VAR_NAME}}` | 环境变量（CLI 模式） | CLI 传入 |
| `{{自定义key}}` | 从 variables 字段取值 | 用例中定义 |

#### F9: AI 辅助生成
提供结构化提示词模板，用户将模板 + 埋点文档 + 功能描述喂给 LLM，生成测试用例 JSON。

**已有：** `docs/ai-test-generation.md` 中的提示词模板

**增强：** 面板中增加"AI 生成"入口 → 弹出对话框 → 展示提示词（自动注入当前项目配置）→ 用户复制到 LLM → 将生成的 JSON 粘贴回来 → 导入执行。

---

### P2 — CLI + 多端（Phase 3）

#### F10: Playwright CLI Runner
Node.js CLI 工具，用 Playwright 启动 headless Chrome，注入 AutoBot，执行用例，收集报告。

```bash
# 对任意 Web 应用运行测试
npx autobot-test run tests/smoke.json --url=https://your-app.com --report=json

# 使用项目配置文件
npx autobot-test run tests/ --config=autobot.config.json --tag=smoke

# 传入环境变量
npx autobot-test run tests/ --url=https://staging.app.com --env USER=test --env PASS=1234
```

**执行流程：**
1. 读取配置文件（`autobot.config.json`）
2. Playwright 启动 headless Chrome
3. 导航到目标 URL
4. `page.addScriptTag()` 注入 autobot.js
5. `page.evaluate()` 传入配置 + 用例，调用测试引擎
6. 轮询等待完成，拉取报告
7. 输出 JSON/HTML 报告到文件系统

#### F11: HTML 报告
可视化 HTML 报告，CI 产物可直接浏览。

包含：
- 用例列表 + 通过/失败/跳过状态
- 失败用例的截图 + 错误详情
- 埋点事件时间线
- 执行耗时柱状图

#### F12: GitHub Actions CI
提供开箱即用的 workflow 模板，适用于任何项目。

```yaml
name: E2E Tests
on: [push, workflow_dispatch]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g autobot-test
      - run: npx playwright install chromium
      - run: autobot-test run tests/ --url=${{ secrets.APP_URL }} --tag=smoke --report=html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: reports/
```

#### F13: 浏览器扩展（未来）
Chrome Extension 形式，无需修改目标应用即可注入 AutoBot。

- 点击扩展图标 → 注入 autobot.js 到当前页面
- 在任意网站上即可录制、回放、执行测试
- 配置保存在 extension storage 中

#### F14: WebView 端支持
WebView 内通过面板手动触发测试（P0 已支持）。扩展方案：

- **URL Scheme 触发**：`your-app://autotest?suite=smoke` → 自动执行 → 结果存 IndexedDB
- **结果提取**：通过 ADB + Chrome DevTools Protocol 从 IndexedDB 读取报告

---

## 四、测试用例数据结构（最终版）

```typescript
// ── 项目配置 ──

interface AutoBotConfig {
  project: string;
  baseUrl?: string;
  trackers?: TrackerConfig[];
  cleanupFunctions?: Record<string, CleanupFnConfig>;
  panel?: { title?: string; position?: string };
}

interface TrackerConfig {
  name: string;                       // SDK 标识
  target: string;                     // 全局函数路径
  extractEvent?: string;              // 事件名提取规则
  extractParams?: string;             // 参数提取规则
}

// ── 测试用例 ──

interface TestCase {
  name: string;
  description?: string;
  tags?: string[];                    // smoke, regression, checkout...
  variables?: Record<string, string>; // 变量定义
  setup?: TestAction[];               // 前置操作
  steps: TestAction[];                // 测试步骤
  teardown?: TestAction[];            // 清理操作
  teardownOnFail?: boolean;           // 失败时是否清理（默认 true）
}

interface TestSuite {
  name: string;
  config?: AutoBotConfig;             // 套件级配置（覆盖全局）
  cases: TestCase[];
  globalSetup?: TestAction[];
  globalTeardown?: TestAction[];
}

interface TestAction {
  // 操作类型
  action: 'click' | 'input' | 'select' | 'navigate' | 'scroll'
        | 'assert' | 'wait' | 'call' | 'screenshot';

  // 元素定位（复用现有 Locator 体系）
  locators?: Locator[];
  tag?: string;
  textHint?: string;

  // 操作参数
  value?: string;                     // input 值，支持 {{variable}}
  url?: string;                       // navigate 的 URL
  fn?: string;                        // call: 函数名（内置或自定义）
  args?: any[];                       // call: 函数参数
  delay?: number;                     // wait: 毫秒数
  timeout?: number;                   // 本步骤超时（默认 10000）

  // 滚动
  scrollX?: number;
  scrollY?: number;

  // 断言参数
  assertType?: 'url' | 'textExists' | 'textNotExists'
             | 'elementExists' | 'elementNotExists'
             | 'eventFired' | 'eventNotFired' | 'eventParams' | 'eventCount'
             | 'localStorage' | 'cookie' | 'jsExpression';
  expected?: string;
  sdk?: string;                       // 埋点: 配置中的 tracker name
  event?: string;                     // 埋点: 事件名
  key?: string;                       // 参数名 / storage key / cookie name
  min?: number;                       // eventCount: 最少次数
  max?: number;                       // eventCount: 最多次数
}
```

---

## 五、使用流程

### 流程 A：快速接入新项目

```
1. 在目标 Web 应用的 HTML 中添加 AutoBot script 标签
   （或使用浏览器扩展 / CLI 注入，无需改代码）

2. 创建 autobot.config.json:
   {
     "project": "my-ecommerce",
     "baseUrl": "https://my-app.com",
     "trackers": [
       { "name": "ga4", "target": "window.gtag" }
     ],
     "cleanupFunctions": {
       "logout": { "type": "navigate-click", "url": "/settings", "clickText": "Sign Out" }
     }
   }

3. 打开应用 → 激活 AutoBot → 开始录制/编写用例
```

### 流程 B：QA 日常回归测试（面板操作）

```
1. 打开目标 Web 应用 → 激活 AutoBot
2. 点击浮动按钮 → 展开面板
3. 切换到"测试模式"
4. 点击"导入用例" → 选择 smoke.json
5. 选择标签 "smoke" → 点击"全部执行"
6. minibar 展示执行进度
7. 执行完成 → 面板展示通过/失败摘要
8. 点击失败用例 → 查看失败步骤和截图
9. [导出报告] → 下载 JSON 文件
```

### 流程 C：开发自测（录制 + 断言）

```
1. 打开目标 Web 应用 → 激活 AutoBot
2. 教学模式 → "开始录制"
3. 手动操作功能流程
4. 录制过程中，关键节点点击 [+断言]:
   - 页面跳转后: 添加 URL 断言
   - 内容显示后: 添加文案断言
   - 操作完成后: 添加埋点断言
5. 停止录制 → 保存
6. 切换到测试模式 → 执行验证
7. 导出 JSON → 提交到 tests/ 目录
```

### 流程 D：AI 生成用例

```
1. 复制 docs/ai-test-generation.md 中的提示词模板
2. 在 LLM 中粘贴提示词 + 项目配置 + 功能描述 + 埋点文档
3. AI 生成 JSON 测试用例
4. 导入 AutoBot → 执行验证 → 微调 → 提交
```

### 流程 E：CI 自动执行（Phase 3）

```
1. 代码推送到仓库
2. CI 触发 workflow
3. autobot-test CLI:
   a. 读取 autobot.config.json
   b. Playwright 启动 headless Chrome → 打开目标 URL
   c. 注入 autobot.js → 执行测试用例
   d. 生成报告 → 上传为 CI artifact
4. 测试失败 → CI 标红 → 下载报告查看详情
```

### 流程 F：WebView 端测试

```
1. 在原生 App 的 WebView 中加载 AutoBot
2. 面板操作方式与浏览器端完全一致
3. 测试报告存储在 IndexedDB → 通过面板导出
```

---

## 六、GraceChat 适配示例

GraceChat 作为首个接入项目，展示适配层如何工作：

**配置文件 `autobot.config.gracechat.json`：**
```json
{
  "project": "gracechat",
  "baseUrl": "https://gracechat.com",
  "trackers": [
    { "name": "rangers", "target": "window.collectEvent", "extractEvent": "args[0]", "extractParams": "args[1]" },
    { "name": "tiktok", "target": "window.ttq.track", "extractEvent": "args[0]" },
    { "name": "meta", "target": "window.fbq", "extractEvent": "args[1]" },
    { "name": "appsflyer", "target": "window.AF", "extractEvent": "args[1]" }
  ],
  "cleanupFunctions": {
    "deleteAccount": {
      "type": "navigate-click",
      "url": "/debug",
      "clickText": "删除账户",
      "confirmDialog": true
    },
    "clearLocalStorage": {
      "type": "localStorage",
      "preserveKeys": ["autobot_config", "autobot_enabled"]
    },
    "resetState": {
      "type": "custom",
      "script": "await this.call('deleteAccount'); await this.call('clearLocalStorage');"
    }
  },
  "panel": {
    "title": "AutoBot — GraceChat"
  }
}
```

**预置测试用例 `tests/gracechat/smoke.json`：**
```json
{
  "name": "GraceChat Smoke Tests",
  "cases": [
    {
      "name": "新用户注册流程",
      "tags": ["smoke", "registration"],
      "variables": { "username": "{{random:autotest_}}" },
      "setup": [
        { "action": "call", "fn": "resetState" }
      ],
      "steps": [
        { "action": "navigate", "url": "/login" },
        { "action": "click", "locators": [{ "type": "text", "value": "Quick Login" }], "tag": "button" },
        { "action": "assert", "assertType": "url", "expected": "/onboarding" },
        { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "login_success" },
        { "action": "input", "locators": [{ "type": "placeholder", "value": "Enter your name" }], "tag": "input", "value": "{{username}}" },
        { "action": "click", "locators": [{ "type": "text", "value": "Claim" }], "tag": "button" },
        { "action": "assert", "assertType": "textExists", "expected": "Welcome" }
      ],
      "teardown": [
        { "action": "call", "fn": "resetState" }
      ]
    }
  ]
}
```

---

## 七、分期计划

### Phase 1（4-6 周）— 核心测试能力

**目标：** 通用测试引擎可在任何 Web 应用中运行

| 模块 | 文件 | 说明 |
|------|------|------|
| 项目配置 | `src/testing/config.ts` | 配置加载 + 验证 + 默认值 |
| 埋点 Hook | `src/testing/tracker.ts` | 可插拔 SDK Hook + 事件队列 |
| 断言引擎 | `src/testing/assertion.ts` | 所有断言类型 + 轮询重试 |
| 用例执行器 | `src/testing/runner.ts` | setup → steps → teardown 生命周期 |
| 数据清理 | `src/testing/cleanup.ts` | 内置通用函数 + 自定义函数注册 |
| 变量引擎 | `src/testing/variables.ts` | `{{variable}}` 替换 |
| 报告生成 | `src/testing/reporter.ts` | JSON 报告 + 控制台摘要 |
| 失败截图 | `src/testing/screenshot.ts` | Canvas API 截图 |
| 面板 UI | `src/testing/ui.ts` | 测试模式 Tab |

**依赖关系：**
```
config.ts（独立，最先实现 — 其他模块读取配置）
  ↓
tracker.ts（依赖 config 获取 SDK 列表）
  ↓
assertion.ts（依赖 tracker 做埋点断言）
  ↓
variables.ts（独立）
  ↓
screenshot.ts（独立）
  ↓
cleanup.ts（依赖 config 获取自定义函数）
  ↓
runner.ts（依赖 assertion + variables + cleanup + player.ts）
  ↓
reporter.ts（依赖 runner 的执行结果）
  ↓
ui.ts（整合以上所有，接入面板）
```

### Phase 2（2-4 周）— 用例生成

| 模块 | 说明 |
|------|------|
| 录制断言插入 | minibar [+断言] 按钮 + 断言类型选择弹窗 |
| AI 生成增强 | 面板内提示词展示（自动注入项目配置） |
| 预置 SDK 库 | 内置 8+ 常见 SDK 的 Hook 配置模板 |

### Phase 3（4-6 周）— CLI + 扩展

| 模块 | 说明 |
|------|------|
| CLI Runner | `cli/run.ts` — Playwright 注入 + 执行 + 收集 |
| HTML 报告 | `cli/report.ts` — 可视化报告 |
| CI 模板 | GitHub Actions / GitLab CI 模板 |
| npm 包 | 发布 `autobot-test` CLI |
| 浏览器扩展 | Chrome Extension（未来） |

---

## 八、关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构 | 浏览器内注入 | 零配置，双端通用，可直接 Hook SDK（参考 Cypress） |
| 用例格式 | 声明式 JSON | 低学习成本，AI 可生成，可版本控制（参考 Maestro YAML） |
| 定位策略 | 多 Locator 回退 | 文案优先 + 7 级回退，已实现（参考 Playwright + Chrome Recorder） |
| 埋点验证 | 可插拔函数 Hook | 配置化声明 SDK 入口，通用适配任意 SDK |
| 数据清理 | 配置化注册 | 清理函数通过 JSON 配置声明，不硬编码业务逻辑 |
| 截图 | Canvas API | 浏览器内可用，无需外部依赖 |
| 断言重试 | 轮询式 | 最多等待 N 秒，每 200ms 重试（参考 Playwright auto-retry） |
| CLI | Playwright | 成熟稳定，`page.evaluate()` 可调用浏览器内引擎 |

**明确不做：**
- 视觉回归测试 — 复杂度高，与当前需求正交
- AI 驱动执行（Stagehand 模式） — 太慢太不稳定，AI 只用于生成
- 原生 App 测试 — 超出范围，WebView 方式已覆盖
- 自定义 DSL — 坚持 JSON，不造语言
- 协议级网络拦截 — 浏览器内限制，需要时委托给 Playwright CLI

---

## 九、验证方式

Phase 1 完成后的验证清单：

1. **通用性验证**
   - 在 GraceChat PWA 中注入 → 执行测试 → 通过
   - 在任意第三方网站（如 GitHub）中通过 CLI 注入 → 录制回放正常
   - 自定义 tracker 配置（如 GA4）→ 埋点 Hook 正常工作

2. **功能验证**
   - 导入测试用例 JSON → 面板显示用例列表
   - 执行测试 → 所有断言通过
   - 人为制造失败 → 断言正确报错 + 截图生成

3. **埋点验证**
   - 配置自定义 SDK Hook → `eventFired` / `eventParams` 断言正确
   - 报告中的 `trackedEvents` 列表完整

4. **数据清理**
   - 配置自定义清理函数 → `call` 执行正常
   - 用例失败时 teardown 仍执行
   - teardown 失败不影响报告（记录 warning）

5. **双端验证**
   - Chrome 浏览器中执行 → 通过
   - WebView 中执行 → 通过（同一用例同一引擎）

6. **构建验证**
   - `pnpm build` 编译通过
   - 部署到 GitHub Pages → 外部加载正常
