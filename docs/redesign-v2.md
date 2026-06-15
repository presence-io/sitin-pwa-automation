# AutoBot v2 重新设计方案

## 一、现状问题

### 1.1 面板过载

Testing + Remote + Teaching 三大功能模块挤在同一个浮动小面板中。在手机 WebView 上，下拉框、按钮、列表密集排列，操作困难。每新增一个功能，面板就更臃肿一层。

### 1.2 角色不分离

当前每台设备既是"被控端"又是"控制端"。但实际使用场景高度不对称：

- **PC**：浏览用例、选择设备、查看报告 — 需要大屏和键盘
- **手机/WebView**：接收指令、执行测试、上报结果 — 只需最小交互

两端需求完全不同，却被迫共用一套 UI。

### 1.3 远程控制被埋没

F15 远程控制是最有价值的能力（跨设备协同测试），但在面板中只是一个折叠区块，与本地测试平级。用户很容易忽略它的存在。

### 1.4 流程断裂

完整的测试流程："写用例 → 推到 Git 仓库 → 部署到 GitHub Pages → 设备拉取 → 手动在面板中选择执行 → 看控制台结果"，步骤过多且分散在不同工具（IDE、Git、浏览器面板）中。

### 1.5 接入成本高

接入新项目需要：修改 HTML → 创建 `tests/` 目录 → 写 `project.json` → 更新 `manifest.json` → 提交并等待 GitHub Pages 部署。对于"快速验证一下"的场景来说门槛太高。

---

## 二、设计目标

1. **角色分离** — 控制端（Dashboard）和执行端（Agent）各有专属 UI
2. **大屏操控** — 设备管理、用例管理、结果查看全部在 PC 大屏 Dashboard 上完成
3. **设备端极简** — Agent 只负责连接、执行、上报，面板最小化
4. **流程连贯** — 从用例编写到批量执行到查看报告，在 Dashboard 内一站完成
5. **快速接入** — 30 秒内让一台新设备上线并执行第一个测试

---

## 三、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                   AutoBot Dashboard                          │
│              (独立 Web 页面，PC 浏览器打开)                    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 📱 设备墙 │  │ 📋 用例库 │  │ 🚀 执行  │  │ 📊 报告中心  │ │
│  │          │  │          │  │          │  │             │ │
│  │ 在线设备  │  │ 远程/本地 │  │ 选设备   │  │ 实时结果    │ │
│  │ 实时状态  │  │ 编辑/导入 │  │ 选用例   │  │ 历史记录    │ │
│  │ 一键连接  │  │ AI 生成  │  │ 一键跑   │  │ 导出分享    │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└──────────────────────┬──────────────────────────────────────┘
                       │ Firebase Realtime DB (SSE 实时通信)
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ 📱 Agent   │ │ 📱 Agent   │ │ 📱 Agent   │
   │ iPhone-01  │ │ Samsung-02 │ │ Pixel-03   │
   │            │ │            │ │            │
   │ 极简面板   │ │ 极简面板   │ │ 极简面板   │
   │ 状态+开关  │ │ 状态+开关  │ │ 状态+开关  │
   └────────────┘ └────────────┘ └────────────┘
```

### 部署方式

- **Dashboard**：`dashboard.html` 部署在 GitHub Pages，与 `autobot.js` 同域
  - URL: `https://presence-io.github.io/sitin-pwa-automation/dashboard.html`
- **Agent**：现有 `autobot.js` 注入方式不变，但 UI 大幅精简
- **通信**：Firebase Realtime Database（已有），利用 SSE 实时推送

---

## 四、Dashboard 设计

### 4.1 页面布局

```
┌─ AutoBot Dashboard ──────────────────────────────────────────┐
│  🤖 AutoBot                              Project: [GraceChat ▼] │
│                                                               │
│  ┌─ Devices (3 online) ───────────────────────────────────┐  │
│  │ ☑ 📱 iPhone-QA-01    GraceChat  🟢  Chrome iOS 17     │  │
│  │ ☑ 📱 Samsung-Test    GraceChat  🟢  Chrome Android 14 │  │
│  │ ☐ 📱 Pixel-Dev       GraceChat  🔴  offline (5m ago)  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ Test Suites ──────────────────────────────────────────┐  │
│  │ ● 冒烟测试 (3 cases)                 [Preview] [Edit]  │  │
│  │ ○ 注册流程 (1 case)                  [Preview]          │  │
│  │ ○ 提现流程 (2 cases)                 [Preview]          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  [▶ Run on 2 devices]     [+ Import]    [✨ AI Generate]      │
│                                                               │
│  ─── Live Results ────────────────────────────────────────── │
│  iPhone-QA-01:  ✅ 3/3 passed (12.3s)        [View Report]  │
│  Samsung-Test:  ⏳ running... case 2/3                       │
│                                                               │
│  ─── History ─────────────────────────────────────────────── │
│  Jun 15 14:30  冒烟测试  2 devices  5/6 passed  [Report]    │
│  Jun 15 11:00  注册流程  1 device   1/1 passed  [Report]    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 四大模块

#### 模块 A：设备墙

| 功能 | 说明 |
|------|------|
| 设备列表 | 实时展示所有在线/离线 Agent，包括设备名、项目、UA、最后活跃时间 |
| 实时状态 | Firebase SSE 推送，设备上下线无需刷新即可感知 |
| 多选 | 勾选框批量选择目标设备 |
| 设备详情 | 点击设备查看完整 UA、历史执行记录 |
| 连接指引 | 展示注入脚本的一行代码，方便快速接入新设备 |

#### 模块 B：用例库

| 功能 | 说明 |
|------|------|
| 远程用例浏览 | 从 GitHub Pages (`tests/`) 拉取项目用例列表 |
| 本地用例导入 | 粘贴 JSON / 上传文件 / 拖拽导入 |
| 用例预览 | 点击展开查看步骤列表和断言 |
| 用例编辑 | 内置 JSON 编辑器（基础文本编辑即可，不需要可视化拖拽） |
| AI 生成 | 带项目上下文的提示词生成，输出 JSON 后可直接导入 |

#### 模块 C：执行中心

| 功能 | 说明 |
|------|------|
| 选设备 + 选用例 | 勾选设备 + 选择用例套件 |
| 一键执行 | 向所有选中设备广播执行指令 |
| 实时进度 | Firebase SSE 推送每台设备的执行进度（第几个 case、通过/失败） |
| 中止命令 | 向设备发送 abort 指令，终止正在运行的测试 |

#### 模块 D：报告中心

| 功能 | 说明 |
|------|------|
| 实时结果 | 执行中的命令按设备展示进度和结果 |
| 历史记录 | 最近 N 次执行的摘要列表（时间、用例名、设备数、通过率） |
| 详细报告 | 展开查看每台设备的完整报告（步骤结果、失败截图、埋点事件） |
| 导出 | 下载 JSON 报告 / 复制到剪贴板 |

### 4.3 Dashboard 技术方案

- **纯静态页面**：HTML + CSS + JS，不需要后端，部署在 GitHub Pages
- **Firebase JS SDK**（Web）：用于实时监听设备状态、命令状态、结果上报
- **构建**：可以与 autobot.js 共用 tsup 构建，输出独立的 `dashboard.js` + `dashboard.html`
- **响应式**：PC 优先，但平板也可用

---

## 五、Agent 端设计

### 5.1 极简面板

Agent 端面板从当前的"全功能面板"精简为"状态卡片"：

```
┌─ 🤖 AutoBot Agent ──────────┐
│                              │
│  Device: iPhone-QA-01  [✎]  │
│  Status: 🟢 Connected        │
│  Project: GraceChat          │
│                              │
│  Remote: [ON ▼]              │
│                              │
│  ─── Quick Actions ──────── │
│  [▶ Run local]   [⏺ Record] │
│                              │
│  ─── Last Run ───────────── │
│  冒烟测试: 3/3 passed ✅     │
│  12.3s · Jun 15 14:30       │
│                              │
└──────────────────────────────┘
```

### 5.2 Agent 保留能力

| 能力 | 保留 | 说明 |
|------|------|------|
| 远程接收执行 | ✅ | 核心：接收 Dashboard 指令，执行测试，上报结果 |
| 设备注册/心跳 | ✅ | 自动注册到 Firebase，维持在线状态 |
| 录制模式 | ✅ | 必须在目标页面内操作，无法移到 Dashboard |
| 本地用例执行 | ✅ | 快捷入口，无需 Dashboard 也能跑 |
| 用例管理 | ❌ → Dashboard | 导入/导出/编辑/删除 全部移到 Dashboard |
| 设备列表/控制 | ❌ → Dashboard | 控制端功能全部移到 Dashboard |
| 报告详情查看 | ❌ → Dashboard | Agent 只显示摘要，详情在 Dashboard 看 |

### 5.3 Agent 新增能力

| 能力 | 说明 |
|------|------|
| 执行进度实时上报 | 每完成一个 case 向 Firebase 写入进度，Dashboard 实时展示 |
| 中止指令响应 | 监听 abort 命令，终止正在运行的测试 |
| 录制结果上传 | 录制完成后自动将 JSON 上传到 Firebase，Dashboard 端可直接管理 |

---

## 六、通信协议

### 6.1 Firebase 数据结构

```
autobot-remote-default-rtdb/
├── devices/
│   └── {deviceId}/
│       ├── deviceId: string
│       ├── project: string | null
│       ├── status: "online" | "offline"
│       ├── lastSeen: number (timestamp)
│       ├── userAgent: string
│       └── capabilities: { recording: boolean, testing: boolean }
│
├── commands/
│   └── {cmdId}/
│       ├── id: string
│       ├── targets: string[]              ← 改为数组，支持广播
│       ├── action: "run" | "abort" | "record"
│       ├── project: string
│       ├── suite: string                  ← 用例名或内联 JSON
│       ├── suiteData?: TestSuite          ← 可选：内联用例数据（不依赖远程拉取）
│       ├── status: "pending" | "running" | "completed" | "failed"
│       ├── createdBy: string              ← Dashboard 设备标识
│       └── createdAt: number
│
├── results/
│   └── {cmdId}/
│       └── {deviceId}/
│           ├── status: "running" | "completed" | "failed"
│           ├── progress: { current: number, total: number, currentCase: string }
│           ├── summary?: { total, passed, failed, skipped }
│           ├── duration?: number
│           ├── report?: TestReport        ← 完整报告（完成后写入）
│           └── updatedAt: number
│
└── recordings/                            ← 新增：Agent 录制结果上传
    └── {projectId}/
        └── {recordingId}/
            ├── name: string
            ├── deviceId: string
            ├── steps: RecordingStep[]
            ├── createdAt: number
            └── status: "draft" | "converted"
```

### 6.2 通信流程

#### 执行测试

```
Dashboard                Firebase RTDB              Agent(s)
   │                         │                         │
   │  1. 写入 command         │                         │
   │  targets: [A, B]        │                         │
   │  suite: "smoke.json"    │                         │
   │ ──────────────────────> │                         │
   │                         │  2. Agent 监听到新指令   │
   │                         │     (SSE push)          │
   │                         │ ──────────────────────> │
   │                         │                         │  3. 写入 results/{cmdId}/{deviceId}
   │                         │                         │     status: "running"
   │                         │                         │     progress: { current: 1, total: 3 }
   │                         │ <────────────────────── │
   │  4. Dashboard 监听      │                         │
   │     results 变化        │                         │
   │     实时更新进度         │                         │
   │ <────────────────────── │                         │
   │                         │                         │  5. 每完成一个 case 更新 progress
   │                         │                         │  6. 全部完成，写入 report
   │                         │ <────────────────────── │
   │  7. 展示最终报告         │                         │
   │ <────────────────────── │                         │
```

#### 中止测试

```
Dashboard                Firebase RTDB              Agent
   │                         │                         │
   │  写入 abort command      │                         │
   │ ──────────────────────> │                         │
   │                         │  Agent 监听到 abort     │
   │                         │ ──────────────────────> │
   │                         │                         │  设置 aborted flag
   │                         │                         │  runner 检查 flag → 停止
   │                         │                         │  写入部分 report
   │                         │ <────────────────────── │
```

### 6.3 与现有实现的差异

| 维度 | 当前实现 | 新设计 |
|------|---------|--------|
| command.targets | `targetDevice: string`（单设备） | `targets: string[]`（支持广播） |
| 结果存储 | 写在 `commands/{id}.result` | 独立 `results/{cmdId}/{deviceId}/`（分设备） |
| 进度上报 | 无 | `results/{cmdId}/{deviceId}/progress` 实时更新 |
| abort | 不支持 | 新增 `action: "abort"` 指令类型 |
| 用例传输 | Agent 自己 fetch 远程用例 | 可选：command 内联 `suiteData`，Agent 无需自己拉取 |
| 录制上传 | 不支持 | 新增 `recordings/` 节点，Agent 录制后上传 |

---

## 七、快速接入方式

### 7.1 Console 一行注入（最快 — 30 秒）

不修改任何代码，在目标页面的 DevTools Console 中粘贴：

```javascript
fetch('https://presence-io.github.io/sitin-pwa-automation/autobot.js').then(r=>r.text()).then(t=>{const s=document.createElement('script');s.textContent=t;document.body.appendChild(s)})
```

效果：Agent 面板立即弹出 → 自动注册到 Firebase → Dashboard 上看到设备上线。

### 7.2 Bookmarklet

浏览器书签栏拖入 Bookmarklet，在任意页面点击即可注入：

```
javascript:void(fetch('https://presence-io.github.io/sitin-pwa-automation/autobot.js').then(r=>r.text()).then(eval))
```

### 7.3 Script 标签（正式接入）

保持不变：

```html
<script>
  if (localStorage.getItem('autobot_enabled') === '1') {
    var s = document.createElement('script');
    s.src = 'https://presence-io.github.io/sitin-pwa-automation/autobot.js';
    s.dataset.project = 'gracechat';
    document.body.appendChild(s);
  }
</script>
```

### 7.4 Dashboard 连接指引

Dashboard 页面提供"Add Device"按钮，点击后展示以上注入方式的代码片段，带复制按钮。

---

## 八、AI 用例生成升级

### 8.1 当前方式

用户手动复制 `docs/ai-test-generation.md` 中的提示词模板，粘贴到 LLM（Claude/ChatGPT），再把生成的 JSON 复制回来导入。

### 8.2 升级方式

Dashboard 内置 AI 生成面板：

```
┌─ ✨ AI Generate Test Case ────────────────────────────────┐
│                                                            │
│  Project: GraceChat (auto-loaded config)                   │
│                                                            │
│  Describe the test scenario:                               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 测试用户注册后首次提现 $0.50 的完整流程，              │ │
│  │ 验证 rangers 埋点 cashout_success 是否触发             │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  [Generate Prompt]  → 生成带项目上下文的完整提示词          │
│  [Copy to clipboard] → 复制到 Claude/ChatGPT               │
│                                                            │
│  Paste generated JSON:                                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ { "name": "...", "cases": [...] }                     │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  [Preview]  [Save to library]  [▶ Run immediately]         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**自动注入的上下文：**
- 项目配置（tracker、cleanup 函数）
- 已有用例示例（从用例库中取一个作为 few-shot）
- TestAction 类型定义和 locator 规范

用户只需要描述场景，其余上下文 Dashboard 自动拼接。

---

## 九、实施计划

### Phase A — Dashboard MVP + 屏幕同步（1-2 周）

核心目标：用 PC 大屏取代手机面板做远程控制，且能实时看到设备画面。

| 任务 | 文件 | 说明 |
|------|------|------|
| Dashboard 页面 | `src/dashboard/index.html` | 静态 HTML + 内联 CSS |
| Dashboard 逻辑 | `src/dashboard/app.ts` | Firebase 连接、设备监听、命令发送 |
| 设备墙 + 缩略图 | `src/dashboard/devices.ts` | 实时设备列表 + 截图缩略图 + 点击放大预览 |
| 执行中心 | `src/dashboard/executor.ts` | 选设备+选用例→一键执行，实时进度 |
| 结果展示 | `src/dashboard/results.ts` | 实时结果 + 历史记录 |
| 屏幕同步（Dashboard） | `src/dashboard/screen-viewer.ts` | SSE 接收截图、渲染缩略图/大图、控制同步开关 |
| 构建配置 | `tsup.config.ts` | 新增 dashboard 入口，输出 `dist/dashboard.html` + `dist/dashboard.js` |
| 部署 | `.github/workflows/deploy.yml` | dashboard.html 一起部署到 GitHub Pages |

**Agent 端改动：**
- `remote.ts`：command.targets 支持数组；新增 progress 实时上报；新增 abort 监听
- `runner.ts`：新增 abort flag 支持；执行中回调上报进度
- `testing/screensync.ts`（新增）：截图流上报 — Canvas 截图 → JPEG 压缩 → Firebase 上传；监听 syncControl 指令按需启停

### Phase B — Agent 精简（1 周）

| 任务 | 说明 |
|------|------|
| 重构 `testing/ui.ts` | 移除控制端 UI（设备列表、发送命令），只保留状态卡片 |
| 精简面板 | 设备名 + 状态 + Remote 开关 + 快捷操作（Run local / Record） |
| 最近结果摘要 | 面板底部展示最近一次执行的通过率 |

### Phase C — Dashboard 增强 + rrweb 升级（1-2 周）

| 任务 | 说明 |
|------|------|
| 用例浏览器 | 展开查看步骤列表和断言 |
| JSON 编辑器 | 内置文本编辑器，编辑后可保存到 Firebase 或下载 |
| 项目配置管理 | 在 Dashboard 上创建/编辑 `project.json`，存 Firebase |
| 详细报告页 | 步骤级别结果 + 失败截图 + 埋点事件列表 |
| 录制上传 | Agent 录制完成后上传到 Firebase，Dashboard 可浏览/转换 |
| rrweb 屏幕同步 | 引入 rrweb，Agent 端录制 DOM 增量 → Firebase 传输 → Dashboard 端 Replayer 实时回放，取代截图流 |

### Phase D — 便利性增强（可选）

| 任务 | 说明 |
|------|------|
| AI 生成面板 | Dashboard 内置场景描述 → 提示词生成 → JSON 导入 |
| 连接指引 | "Add Device" 按钮 + Console 注入代码 + Bookmarklet |
| 报告分享 | 生成可分享的报告链接（存 Firebase，分享 URL） |

---

## 十、技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Dashboard 框架 | 纯 HTML + TypeScript（无框架） | 保持轻量，与 autobot.js 共用构建工具链。Dashboard 页面不复杂，不需要 React/Vue |
| Dashboard 部署 | GitHub Pages（与 autobot.js 同域） | 零成本，同域避免 CORS 问题，CI 已有 |
| 实时通信 | Firebase RTDB SSE | 已有基础设施，SSE 实时推送，免费额度充足（100 并发） |
| 用例存储 | Firebase RTDB（可选） + GitHub Pages（主） | 小团队可以直接存 Firebase 省去 Git 流程；正式用例仍走 Git |
| Agent 构建 | 保持单文件 IIFE | 注入方式不变，向后兼容 |
| Dashboard 构建 | 独立入口，输出 `dashboard.html` + `dashboard.js` | tsup 多入口构建 |

---

## 十一、屏幕同步 — 在 Dashboard 上看到设备画面

### 11.1 需求场景

控制端（Dashboard）不仅能向设备发指令、看结果，还能**实时看到设备当前的页面画面**：

- 测试执行过程中观察 UI 变化，不用盯着手机屏幕
- 远程协助时看到对方设备的页面状态
- 多设备并行测试时在 Dashboard 上同时监控所有设备画面

### 11.2 方案对比

| 方案 | 原理 | 帧率 | 保真度 | 实现复杂度 | Bundle 影响 |
|------|------|------|--------|-----------|------------|
| **A. 截图流** | Canvas API / html2canvas 定时截图 → 上传 → Dashboard 展示 | 1-2 FPS | 中（跨域资源丢失） | 低 | 无额外依赖 |
| **B. DOM 快照同步（rrweb）** | rrweb 录制 DOM 增量变化 → Firebase 传输 → Dashboard 回放 | 接近实时 | 高（完整 DOM 重建） | 中 | +50KB gzip |
| **C. WebRTC 屏幕共享** | getDisplayMedia 视频流 → WebRTC 点对点传输 | 30 FPS | 极高 | 高（需信令服务器） | +WebRTC SDK |

### 11.3 推荐方案：A（截图流 MVP）→ B（rrweb 增强）

#### 阶段一：截图流（Phase A 一起交付）

最小可用方案，纯前端实现，无额外依赖：

**Agent 端：**

```typescript
// screensync.ts — Agent 端截图上报

async function captureAndUpload(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // 方案 1: 原生 Canvas（轻量，但跨域资源丢失）
  // 使用 svg foreignObject 渲染 DOM
  // 方案 2: html2canvas（更完整，但需要额外依赖）

  const dataUrl = canvas.toDataURL('image/jpeg', 0.4);  // 压缩到 40% 质量
  // 裁剪 base64 头部，减少传输体积
  const base64 = dataUrl.split(',')[1];

  await fbPut(`screens/${deviceId}`, {
    image: base64,
    width: window.innerWidth,
    height: window.innerHeight,
    url: location.href,
    timestamp: Date.now(),
  });
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

function startScreenSync(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => captureAndUpload(), 1000);  // 1 FPS
}

function stopScreenSync(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  fbDelete(`screens/${deviceId}`);
}
```

**Dashboard 端：**

```typescript
// 监听设备截图更新
function watchDeviceScreen(deviceId: string, imgElement: HTMLImageElement): void {
  const url = `${DB_URL}/screens/${deviceId}.json`;
  const source = new EventSource(url);

  source.addEventListener('put', (e: MessageEvent) => {
    const data = JSON.parse(e.data).data;
    if (data?.image) {
      imgElement.src = `data:image/jpeg;base64,${data.image}`;
    }
  });
}
```

**Dashboard UI：**

```
┌─ 📱 iPhone-QA-01 ─────────────────────┐
│  ┌─────────────────────────────────┐  │
│  │                                 │  │
│  │        (设备实时截图)            │  │
│  │         375 × 812              │  │
│  │                                 │  │
│  │                                 │  │
│  └─────────────────────────────────┘  │
│  🟢 Online · /home · 1s ago          │
│  [▶ Run]  [⏹ Stop sync]              │
└────────────────────────────────────────┘
```

**限制和优化：**

| 限制 | 应对 |
|------|------|
| JPEG 质量 vs 体积 | 默认 40% 质量（约 30-80KB/帧），Dashboard 可调节 |
| Firebase RTDB 单节点 10MB | 只保留最新一帧，不累积历史 |
| 跨域图片/样式丢失 | Canvas 截图的固有限制，首期可接受 |
| 上传带宽 | Agent 端检测 WiFi/4G，低带宽时自动降频或暂停 |
| 非活跃时浪费资源 | Dashboard 不看某设备时发 stopSync 指令，Agent 停止截图 |

**按需启停机制：**

截图上报不应默认开启（耗电、耗流量），而是 Dashboard 按需触发：

```
Dashboard                Firebase RTDB              Agent
   │                         │                         │
   │  1. 用户点击设备缩略图   │                         │
   │  → 写入 sync 指令       │                         │
   │    screenSync: true     │                         │
   │ ──────────────────────> │                         │
   │                         │  2. Agent 监听到指令     │
   │                         │ ──────────────────────> │
   │                         │                         │  3. 开始截图上报
   │                         │                         │     screens/{deviceId}
   │                         │ <────────────────────── │
   │  4. Dashboard SSE       │                         │
   │     实时收到截图         │                         │
   │ <────────────────────── │                         │
   │                         │                         │
   │  5. 用户关闭预览         │                         │
   │  → screenSync: false    │                         │
   │ ──────────────────────> │                         │
   │                         │ ──────────────────────> │
   │                         │                         │  6. 停止截图
```

#### 阶段二：rrweb 增量同步（Phase C 或 D）

截图流验证可行后，升级为 rrweb DOM 增量同步：

**Agent 端：**

```typescript
import { record } from 'rrweb';

let stopRecording: (() => void) | null = null;

function startDOMSync(): void {
  stopRecording = record({
    emit(event) {
      // 增量事件推送到 Firebase
      fbPut(`domstream/${deviceId}/events/${Date.now()}`, event);
    },
    sampling: {
      mousemove: false,      // 不同步鼠标移动（减少数据量）
      scroll: 150,           // 滚动采样 150ms
      input: 'last',         // 只记录输入最终值
    },
    blockClass: 'autobot',   // 不录制 AutoBot 自身 UI
  });
}

function stopDOMSync(): void {
  stopRecording?.();
  stopRecording = null;
  fbDelete(`domstream/${deviceId}`);
}
```

**Dashboard 端：**

```typescript
import { Replayer } from 'rrweb';

function watchDeviceDOM(deviceId: string, container: HTMLElement): void {
  const replayer = new Replayer([], {
    root: container,
    liveMode: true,       // 实时回放模式
    insertStyleRules: [],
  });
  replayer.startLive();

  // SSE 监听增量事件
  const source = new EventSource(`${DB_URL}/domstream/${deviceId}/events.json`);
  source.addEventListener('put', (e: MessageEvent) => {
    const data = JSON.parse(e.data).data;
    if (data) replayer.addEvent(data);
  });
}
```

**rrweb 方案的优势：**

| 维度 | 截图流 | rrweb |
|------|--------|-------|
| 帧率 | 1-2 FPS | 接近实时（增量） |
| 数据量 | 30-80KB/帧 | 首次快照 + 小增量（通常 <1KB/event） |
| 保真度 | JPEG 有损 + 跨域丢失 | 完整 DOM 重建，CSS 完整 |
| Dashboard 交互 | 只能看图 | 可以在回放中审查 DOM 元素 |
| 依赖 | 无 | rrweb ~50KB gzip |

### 11.4 Firebase 数据结构扩展

```
autobot-remote-default-rtdb/
├── ... (已有结构)
│
├── screens/                           ← 截图流（Phase A）
│   └── {deviceId}/
│       ├── image: string              ← base64 JPEG
│       ├── width: number
│       ├── height: number
│       ├── url: string                ← 当前页面 URL
│       └── timestamp: number
│
├── domstream/                         ← rrweb 流（Phase C/D）
│   └── {deviceId}/
│       └── events/
│           └── {timestamp}: RRWebEvent
│
└── syncControl/                       ← 同步控制指令
    └── {deviceId}/
        ├── screenSync: boolean        ← Dashboard 控制开/关
        ├── mode: "screenshot" | "rrweb"
        └── fps: number                ← 截图帧率（默认 1）
```

### 11.5 Dashboard 设备墙更新

集成屏幕同步后，Dashboard 设备墙升级为"缩略图墙"：

```
┌─ AutoBot Dashboard ──────────────────────────────────────────┐
│                                                               │
│  Devices (3 online)                   Project: [GraceChat ▼] │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │              │       │
│  │ │  (截图)   │ │  │ │  (截图)   │ │  │   🔴 offline │       │
│  │ │ 375×812  │ │  │ │ 360×800  │ │  │              │       │
│  │ └──────────┘ │  │ └──────────┘ │  │              │       │
│  │ 📱 iPhone-01 │  │ 📱 Samsung-02│  │ 📱 Pixel-03  │       │
│  │ 🟢 /home     │  │ 🟢 /cashout  │  │ 5m ago       │       │
│  │ [▶] [👁 View]│  │ [▶] [👁 View]│  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                               │
│  点击 [👁 View] → 展开大图实时预览                             │
│  点击 [▶] → 在该设备上执行选中的测试套件                        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 十二、迁移策略

- **向后兼容**：`autobot.js` 的注入方式和基本功能不变，已接入的项目无需修改
- **渐进升级**：Dashboard 是新增能力，不依赖 Agent 端改动。Phase A 完成后就可以开始使用 Dashboard，此时 Agent 端仍保持旧 UI
- **Phase B 可选**：Agent 端精简不是必须的，只是让体验更好。如果时间紧可以先跳过
