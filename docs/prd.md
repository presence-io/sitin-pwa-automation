# AutoBot 自动化测试平台 — PRD

## Context

AutoBot 当前是一个浏览器端自动化操作工具，具备预设流程（Stage 1-5）和教学模式（录制/回放）。基于调研报告（docs/testing-tools-research.md）的结论，AutoBot 占据了一个独特生态位：声明式 JSON + 浏览器内执行 + 埋点验证 + WebView 原生支持。

本 PRD 将 AutoBot 从"操作工具"升级为"自动化测试平台"，定义完整功能集合、分期计划和使用流程。

---

## 一、产品定位

**一句话定位：** 面向 GraceChat PWA 的轻量级自动化测试平台，支持功能验证、埋点验证和测试数据清理，在浏览器和 WebView 中统一运行。

**目标用户：**
- QA 工程师：日常回归测试、新功能验证
- 开发工程师：开发自测、埋点验证
- 产品/运营：核心流程冒烟测试（通过面板操作，无需写代码）

**核心原则：**
1. **声明式优先** — 测试用例是 JSON，不是代码，AI 可生成、人可审查
2. **浏览器内优先** — 引擎运行在页面内部，零配置，双端通用
3. **埋点是一等公民** — 内置 SDK Hook + 断言，不是事后补丁
4. **渐进式** — 可以只用录制回放，也可以写完整断言用例，按需升级

---

## 二、功能集合

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

断言失败时：记录失败原因（expected vs actual）、自动截图、标记用例失败。

#### F2: 埋点验证
测试启动时自动 Hook 页面内所有埋点 SDK，记录事件，支持断言。

**Hook 覆盖的 SDK：**

| SDK | 全局入口 | Hook 方式 |
|-----|---------|-----------|
| BytePlus Rangers | `window.collectEvent` | 替换函数，记录参数，透传原始调用 |
| TikTok Pixel | `window.ttq.track` / `ttq.page` | 替换方法 |
| Meta Pixel | `window.fbq` | 替换函数 |
| AppsFlyer | `window.AF` | 替换函数 |

**埋点断言类型：**

| 断言 | 说明 |
|------|------|
| `eventFired` | 事件至少触发一次 |
| `eventNotFired` | 事件未触发 |
| `eventParams` | 事件的指定参数值匹配 |
| `eventCount` | 事件触发次数在范围内 |

无论是否有埋点断言，测试报告都自动附带完整事件列表。

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
- 断言支持轮询重试（最多 N 秒，适应异步渲染）
- 变量替换：`{{username}}`、`{{random:prefix_}}`、`{{timestamp}}`

#### F4: 数据清理
预置产品级清理函数，通过 `{ action: "call", fn: "xxx" }` 调用。

| 函数 | 说明 |
|------|------|
| `deleteAccount` | 通过 Debug 页面注销当前账号 |
| `clearLocalStorage` | 清除 localStorage（保留 autobot 配置） |
| `clearIndexedDB` | 清除应用 IndexedDB |
| `resetState` | 综合清理：注销 + 清 localStorage + 清 IndexedDB |

#### F5: 测试报告
每次执行完成后生成结构化报告。

**报告内容：**
- 套件/用例级别：通过/失败/跳过数量、总耗时
- 每步结果：操作类型、耗时、状态、失败原因
- 失败截图：自动通过 Canvas API 或 `html2canvas` 截取
- 埋点事件列表：所有 SDK 事件按时间排序，关联到步骤索引

**输出格式：**
- JSON（结构化，供 CI 消费）
- 控制台（摘要，开发调试用）
- 面板内（通过/失败状态 + 失败详情）

#### F6: 面板 UI — 测试模式

在现有面板中新增"测试模式" Tab，与教学模式并列：

```
┌─ 🧪 测试模式 ─────────────────────────────┐
│                                            │
│  ⬜ 导入用例  [选择文件]                     │
│                                            │
│  📋 Stage 1 注册 (5步 3断言)  [▶] [✕]      │
│  📋 Stage 2 提现 (8步 4断言)  [▶] [✕]      │
│  📋 聊天发消息 (6步 2断言)    [▶] [✕]      │
│                                            │
│  ─── 批量 ────────────────────────────     │
│  [全部执行]  标签: [smoke ▼]               │
│                                            │
│  ─── 结果 ────────────────────────────     │
│  最近: 2/3 通过  [导出报告]                │
│  ⚠ Stage 2 — 步骤4失败: 文案未找到        │
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
| `{{自定义key}}` | 从 variables 字段取值 | 用例中定义 |

#### F9: Stage 转换工具
将现有 Stage 1-5 代码自动转换为声明式 JSON 测试用例。

已有 Stage 函数（`stepDeleteAccount`、`stepQuickLogin` 等）本质上是完整的自动化流程。提供一键转换：
- 分析 Stage 函数中的 DOM 操作 → 生成对应的 TestAction
- 自动补充关键断言（登录后检查 token、注册后检查 userState）
- 生成 setup/teardown（前置清理 + 后置清理）

输出 JSON 可直接导入测试模式执行。

#### F10: AI 辅助生成
提供结构化提示词模板，用户将模板 + 埋点文档 + 功能描述喂给 LLM，生成测试用例 JSON。

**已有：** `docs/ai-test-generation.md` 中的提示词模板

**增强：** 面板中增加"AI 生成"入口 → 弹出对话框 → 展示提示词 → 用户复制到 LLM → 将生成的 JSON 粘贴回来 → 导入执行。

---

### P2 — CI + 多端（Phase 3）

#### F11: Playwright CLI Runner
Node.js CLI 工具，用 Playwright 启动 headless Chrome，注入 AutoBot，执行用例，收集报告。

```bash
npx autobot-test run tests/smoke.json --headless --report=json
npx autobot-test run tests/ --tag=smoke --report=html
```

**执行流程：**
1. Playwright 启动 headless Chrome
2. 导航到 PWA URL（可配置）
3. `page.addScriptTag()` 注入 autobot.js
4. `page.evaluate()` 调用测试引擎执行用例
5. 轮询等待完成，拉取报告
6. 输出 JSON/HTML 报告到文件系统

#### F12: HTML 报告
可视化 HTML 报告，CI 产物可直接浏览。

包含：
- 用例列表 + 通过/失败/跳过状态
- 失败用例的截图 + 错误详情
- 埋点事件时间线
- 执行耗时柱状图

#### F13: GitHub Actions CI
提供开箱即用的 workflow 配置。

```yaml
name: E2E Tests
on: [push, workflow_dispatch]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: npx playwright install chromium
      - run: npx autobot-test run tests/ --tag=smoke --report=html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report
          path: reports/
```

#### F14: WebView 端触发
WebView 内通过面板手动触发测试（P0 已支持）。扩展方案：

- **URL Scheme 触发**：`gracechat://autotest?suite=smoke` → 自动执行 → 结果存 IndexedDB
- **结果提取**：通过 ADB + Chrome DevTools Protocol 从 IndexedDB 读取报告

---

## 三、测试用例数据结构（最终版）

```typescript
interface TestCase {
  name: string;
  description?: string;
  tags?: string[];                           // smoke, regression, stage1...
  variables?: Record<string, string>;        // 变量定义
  setup?: TestAction[];                      // 前置操作
  steps: TestAction[];                       // 测试步骤
  teardown?: TestAction[];                   // 清理操作
  teardownOnFail?: boolean;                  // 失败时是否清理（默认 true）
}

interface TestSuite {
  name: string;
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
  value?: string;                            // input 值，支持 {{variable}}
  url?: string;                              // navigate 的 URL
  fn?: string;                               // call: 内置函数名
  args?: any[];                              // call: 函数参数
  delay?: number;                            // wait: 毫秒数
  timeout?: number;                          // 本步骤超时（默认 10000）

  // 滚动
  scrollX?: number;
  scrollY?: number;

  // 断言参数
  assertType?: 'url' | 'textExists' | 'textNotExists'
             | 'elementExists' | 'elementNotExists'
             | 'eventFired' | 'eventNotFired' | 'eventParams' | 'eventCount'
             | 'localStorage';
  expected?: string;
  sdk?: string;                              // 埋点: rangers / tiktok / meta / appsflyer
  event?: string;                            // 埋点: 事件名
  key?: string;                              // 埋点参数名 / localStorage key
  min?: number;                              // eventCount: 最少次数
  max?: number;                              // eventCount: 最多次数
}
```

---

## 四、使用流程

### 流程 A：QA 日常回归测试（面板操作）

```
1. 打开 PWA → Debug 页开启 AutoBot
2. 点击浮动按钮 → 展开面板
3. 切换到"测试模式"Tab
4. 点击"导入用例" → 选择 smoke.json
5. 面板展示用例列表
6. 选择标签 "smoke" → 点击"全部执行"
7. minibar 展示执行进度: "执行中 2/5: Stage 1 注册..."
8. 执行完成 → 面板展示: "4/5 通过"
9. 点击失败用例 → 查看失败步骤和截图
10. 点击"导出报告" → 下载 JSON 文件
```

### 流程 B：开发自测（录制 + 断言）

```
1. 打开 PWA → 开启 AutoBot
2. 教学模式 → "开始录制"
3. 手动操作功能流程（如：注册 → 进入首页）
4. 录制过程中，关键节点点击 minibar 的 [+断言]:
   - 登录成功后: 添加 URL 断言 "/home"
   - 首页显示后: 添加文案断言 "Welcome"
   - 点击按钮后: 添加埋点断言 "button_click"
5. 停止录制 → 保存为 "注册流程"
6. 切换到测试模式 → 执行刚录制的用例
7. 验证断言全部通过
8. 导出 JSON → 提交到 tests/ 目录
```

### 流程 C：AI 生成用例

```
1. 打开 docs/ai-test-generation.md → 复制提示词模板
2. 在 Claude/ChatGPT 中粘贴提示词
3. 附上：
   - 埋点文档（事件名、参数）
   - 功能描述 或 PRD 或代码改动
4. AI 生成 JSON 测试用例
5. 复制 JSON → 保存为 .json 文件
6. 导入 AutoBot → 执行验证
7. 根据结果微调 → 确认后提交到 tests/
```

### 流程 D：CI 自动执行（Phase 3）

```
1. 开发者推送代码到 GitHub
2. GitHub Actions 触发 E2E workflow
3. CI 环境:
   a. pnpm install
   b. npx playwright install chromium
   c. npx autobot-test run tests/ --tag=smoke --report=html
4. Playwright 启动 headless Chrome → 打开 PWA → 注入 AutoBot
5. 执行所有 smoke 标签的测试用例
6. 生成 HTML 报告 → 上传为 CI artifact
7. 测试失败 → CI 标红 → 开发者下载报告查看详情
```

### 流程 E：WebView 端测试

```
1. 安装 APK → 打开 GraceChat
2. 进入 Debug 页 → 开启 AutoBot
3. AutoBot 加载在 WebView 内 → 展示浮动面板
4. 操作方式与浏览器端完全相同（流程 A/B）
5. 测试报告存储在 IndexedDB → 通过面板导出
```

---

## 五、分期计划

### Phase 1（4-6 周）— 核心测试能力

**目标：** 在浏览器和 WebView 中可以导入、执行、验证测试用例

**交付物：**

| 模块 | 文件 | 说明 |
|------|------|------|
| 断言引擎 | `src/testing/assertion.ts` | 所有断言类型实现 + 断言重试轮询 |
| 埋点 Hook | `src/testing/tracker.ts` | 4 个 SDK 的 Hook + 事件队列 |
| 用例执行器 | `src/testing/runner.ts` | setup → steps → teardown 生命周期 |
| 数据清理 | `src/testing/cleanup.ts` | 内置清理函数 |
| 变量引擎 | `src/testing/variables.ts` | `{{variable}}` 替换 |
| 报告生成 | `src/testing/reporter.ts` | JSON 报告 + 控制台摘要 |
| 失败截图 | `src/testing/screenshot.ts` | Canvas API 截图 |
| 面板 UI | `src/testing/ui.ts` | 测试模式 Tab |
| 预置用例 | `tests/smoke.json` | Stage 1 的测试用例（含断言） |

**依赖关系：**
```
tracker.ts（独立，最先实现）
  ↓
assertion.ts（依赖 tracker 做埋点断言）
  ↓
variables.ts（独立）
  ↓
screenshot.ts（独立）
  ↓
runner.ts（依赖 assertion + variables + player.ts）
  ↓
reporter.ts（依赖 runner 的执行结果）
  ↓
cleanup.ts（复用现有 stage1.ts 的 stepDeleteAccount）
  ↓
ui.ts（整合以上所有，接入面板）
```

### Phase 2（2-4 周）— 用例生成

**目标：** 多种方式生成测试用例，降低编写门槛

| 模块 | 说明 |
|------|------|
| 录制断言插入 | minibar [+断言] 按钮 + 断言类型选择弹窗 |
| Stage 转换 | 分析 Stage 代码 → 生成 JSON 用例 |
| AI 生成增强 | 面板内提示词展示 + JSON 粘贴导入 |

### Phase 3（4-6 周）— CI + 扩展

**目标：** 支持 headless 执行和 CI 集成

| 模块 | 说明 |
|------|------|
| CLI Runner | `cli/run.ts` — Playwright 启动 + 注入 + 执行 + 收集 |
| HTML 报告 | `cli/report.ts` — 可视化报告渲染 |
| GitHub Actions | `.github/workflows/e2e.yml` |
| npm 包 | 发布 `autobot-test` CLI 包 |

---

## 六、关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构 | 浏览器内注入 | 零配置，双端通用，可直接 Hook SDK（参考 Cypress） |
| 用例格式 | 声明式 JSON | 低学习成本，AI 可生成，可版本控制（参考 Maestro YAML） |
| 定位策略 | 多 Locator 回退 | 文案优先 + 7 级回退，已实现（参考 Playwright + Chrome Recorder） |
| 埋点验证 | 函数级 Hook | 直接替换 SDK 函数，记录调用参数（行业独有） |
| 截图 | Canvas API / html2canvas | 浏览器内可用，无需外部依赖 |
| 断言重试 | 轮询式 | 最多等待 N 秒，每 200ms 重试（参考 Playwright auto-retry） |
| CLI | Playwright | 成熟稳定，`page.evaluate()` 可调用浏览器内引擎 |

**明确不做：**
- 视觉回归测试 — 复杂度高，与当前需求正交
- AI 驱动执行 — 太慢太不稳定，AI 只用于生成
- 原生 App 测试 — 超出范围，WebView 方式已覆盖 PWA
- 自定义 DSL — 坚持 JSON，不造语言
- 网络拦截 — 浏览器内限制，如需要委托给 Playwright CLI

---

## 七、验证方式

Phase 1 完成后的验证清单：

1. **功能验证**
   - 导入 `tests/smoke.json` → 面板显示用例列表
   - 执行 Stage 1 测试用例 → 所有断言通过
   - 人为制造失败（改 expected 值）→ 断言正确报错 + 截图生成

2. **埋点验证**
   - 执行包含埋点断言的用例 → `eventFired` / `eventParams` 正确通过
   - 验证报告中的 `trackedEvents` 列表完整

3. **数据清理**
   - 用例失败时 teardown 仍执行 → 账号被正确注销
   - teardown 失败不影响报告（记录 warning）

4. **双端验证**
   - Chrome 浏览器中执行 → 通过
   - APK WebView 中执行 → 通过（同一用例同一引擎）

5. **构建验证**
   - `pnpm build` 编译通过
   - 部署到 GitHub Pages → 外部加载正常
