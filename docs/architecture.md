# 架构设计

## 概述

AutoBot v4 是一个浏览器端自动化测试工具，以单文件 IIFE 脚本形式注入到 PWA 页面中。通过浮动面板提供 UI 交互，支持预设流程（Stage 1-5）和用户自定义流程（教学模式）。

## 技术栈

- **语言**: TypeScript
- **构建**: tsup（基于 esbuild），输出单文件 IIFE bundle
- **运行环境**: 浏览器（Chrome / WebView）
- **存储**: IndexedDB（录制数据）+ localStorage（配置、状态）

## 模块架构

```
┌─────────────────────────────────────────┐
│                  main.ts                 │  入口，初始化面板
├──────────────┬──────────────────────────┤
│   ui/        │   stages/                │
│   panel.ts   │   stage1.ts  (注册流程)   │
│   styles.ts  │   stages.ts  (Stage 2-5) │
│              │   runner.ts  (编排执行)   │
├──────────────┼──────────────────────────┤
│   teaching/                              │
│   recorder.ts  (录制引擎)                │
│   player.ts    (回放引擎)                │
│   store.ts     (IndexedDB 存储)          │
│   ui.ts        (教学模式 UI)             │
├─────────────────────────────────────────┤
│   core/                                  │
│   helpers.ts   (DOM 操作、等待、导航)     │
│   config.ts    (配置管理)                │
│   tasks.ts     (任务完成 API)            │
│   mockCall.ts  (Mock 视频通话)           │
│   cashout.ts   (提现逻辑)               │
│   post.ts      (自动发帖)               │
└─────────────────────────────────────────┘
```

## 加载方式

1. PWA 的 `index.html` 检查 `localStorage.autobot_enabled === '1'`
2. 条件为真时动态创建 `<script src="/autobot.js">` 注入页面
3. 脚本加载后自动执行 `init()` → `createPanel()` 创建浮动面板

```html
<!-- index.html 中的加载逻辑 -->
<script>
  if (localStorage.getItem('autobot_enabled') === '1') {
    var s = document.createElement('script');
    s.src = '/autobot.js';
    document.body.appendChild(s);
  }
</script>
```

## UI 组成

| 组件 | 元素 ID | 说明 |
|------|---------|------|
| 浮动按钮 (FAB) | `#autobot-fab` | 可拖拽，点击展开/收起面板 |
| 主面板 | `#autobot-panel` | 包含配置、Stage 按钮、工具、教学模式 |
| 顶部提示条 | `#autobot-minibar` | 录制/回放时显示状态，替代面板避免遮挡 |

## 构建流程

```
TypeScript 源码 → tsup (esbuild) → dist/autobot.global.js → PWA public/autobot.js
```

tsup 配置要点：
- `format: ['iife']` — 自执行函数，无需模块加载器
- `platform: 'browser'` — 浏览器环境
- `noExternal: [/.*/]` — 所有依赖打包进 bundle

## 与 PWA 的关系

- AutoBot 作为独立脚本注入，不修改 PWA 源码（仅在 `index.html` 添加条件加载和 Debug 页添加开关）
- 通过标准 DOM API 与页面交互
- 通过 `localStorage` 读取 PWA 的认证信息（token、userInfo）
- 通过 PWA 的 API 端点完成业务操作（注册、提现等）
