# AutoBot

通用 Web 自动化测试平台 — 以单脚本注入方式运行在任何 Web 页面中，支持功能验证、埋点验证和测试数据清理。

## 特性

- **声明式 JSON 用例** — 非开发人员也能编写和维护测试用例，AI 可生成
- **浏览器内执行** — 注入脚本即可运行，浏览器 + WebView 双端通用
- **多 Locator 定位** — 7 级回退策略（id → testid → aria → text → placeholder → inputAttr → css）
- **可插拔埋点验证** — 配置化 Hook 任意 SDK（Rangers、GA4、Mixpanel、TikTok Pixel 等）
- **分项目管理** — 按项目隔离用例和配置，远程加载 + 本地存储
- **录制回放** — 录制操作流程，自动生成多 Locator 步骤
- **一键分享** — 复制 JSON / 导出文件 / 提交到用例仓库

## 快速开始

```bash
pnpm install
pnpm build       # 构建 → dist/autobot.js
pnpm dev         # 开发模式（watch）
```

## 接入方式

### 方式 A：Script 标签

```html
<script>
  if (localStorage.getItem('autobot_enabled') === '1') {
    var s = document.createElement('script');
    s.src = 'https://presence-io.github.io/sitin-pwa-automation/autobot.js';
    s.dataset.project = 'gracechat';  // 指定项目（可选）
    document.body.appendChild(s);
  }
</script>
```

### 方式 B：CLI 注入（Phase 3）

```bash
npx autobot-test run tests/smoke.json --url=https://your-app.com
```

## 项目结构

```
src/
  core/             # 基础工具：DOM helpers, config, API
  stages/           # GraceChat Stage 1-5 预设流程
  teaching/         # 录制回放引擎
    recorder.ts     # 多 Locator 录制
    player.ts       # 多 Locator 回放 + 元素匹配
    store.ts        # IndexedDB 存储
    ui.ts           # 录制/回放 UI
  testing/          # 自动化测试引擎
    types.ts        # 类型定义
    config.ts       # 项目配置加载
    tracker.ts      # 可插拔埋点 SDK Hook
    assertion.ts    # 断言引擎（11 种 + 轮询重试）
    variables.ts    # {{variable}} 替换
    screenshot.ts   # 失败截图
    cleanup.ts      # 数据清理（内置 + 自定义）
    runner.ts       # 用例执行器（生命周期编排）
    reporter.ts     # JSON 报告 + 控制台摘要
    repository.ts   # 远程用例拉取 + 本地管理
    ui.ts           # 测试模式面板
  ui/               # 面板 + 样式
  main.ts           # 入口
tests/              # 测试用例仓库
  manifest.json     # 项目索引
  gracechat/        # GraceChat 项目
    project.json    # 项目配置（tracker, cleanup）
    smoke.json      # 冒烟测试用例
docs/               # 设计文档
```

## 文档

| 文档 | 说明 |
|------|------|
| [PRD](docs/prd.md) | 产品需求：功能集合、使用流程、分期计划 |
| [技术方案](docs/technical-design.md) | Phase 1 详细实现设计 |
| [架构设计](docs/architecture.md) | 模块架构、加载方式、构建流程 |
| [元素定位策略](docs/locator-strategy.md) | 多 Locator 设计、业界对比 |
| [教学模式](docs/teaching-mode.md) | 录制回放原理 |
| [测试框架设计](docs/testing-framework.md) | 测试框架设计草案 |
| [工具调研](docs/testing-tools-research.md) | 14 款工具对比调研 |
| [AI 生成用例](docs/ai-test-generation.md) | 提示词模板 |

## 项目配置

每个项目通过 `project.json` 声明埋点 SDK 和清理函数：

```json
{
  "project": "gracechat",
  "trackers": [
    { "name": "rangers", "target": "window.collectEvent", "extractEvent": "args[0]", "extractParams": "args[1]" },
    { "name": "ga4", "target": "window.gtag", "extractEvent": "args[1]" }
  ],
  "cleanupFunctions": {
    "deleteAccount": {
      "type": "navigate-click",
      "url": "/debug",
      "clickText": "删除账户",
      "confirmDialog": true
    }
  }
}
```

## 测试用例格式

```json
{
  "name": "Smoke Tests",
  "cases": [
    {
      "name": "User Login",
      "tags": ["smoke"],
      "steps": [
        { "action": "navigate", "url": "/login" },
        { "action": "click", "locators": [{ "type": "text", "value": "Sign In" }], "tag": "button" },
        { "action": "assert", "assertType": "url", "expected": "/home" },
        { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "login_success" }
      ]
    }
  ]
}
```

## 构建 & 部署

使用 [tsup](https://tsup.egoist.dev/) 打包为单文件 IIFE，通过 GitHub Pages 自动部署。

```bash
pnpm build   # → dist/autobot.js (IIFE, ~92KB)
```

推送到 `main` 分支后 GitHub Actions 自动构建并部署到 GitHub Pages，`tests/` 目录同时部署供远程用例加载。
