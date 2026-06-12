# AutoBot v4

PWA 自动化测试工具，支持 Stage 1-5 全流程自动化 + 教学模式（录制回放）。

## 快速开始

```bash
pnpm install
pnpm build            # 构建 IIFE bundle → dist/autobot.global.js
pnpm copy             # 复制到 sitin-next PWA 的 public/autobot.js
```

## 在 PWA 中启用

1. 访问 PWA 的 Debug 页面
2. 开启 AutoBot 开关（写入 `localStorage.autobot_enabled = '1'`）
3. 刷新页面，右下角出现 `⚡` 浮动按钮

## 项目结构

```
src/
  core/           # 基础工具：API 请求、配置、helpers
  stages/         # Stage 1-5 自动化流程
  teaching/       # 教学模式：录制、回放、存储
  ui/             # 面板 UI + 样式
  main.ts         # 入口
docs/             # 设计文档
```

## 文档

- [架构设计](docs/architecture.md)
- [教学模式 — 录制回放](docs/teaching-mode.md)
- [元素定位策略](docs/locator-strategy.md)

## 构建

使用 [tsup](https://tsup.egoist.dev/) 打包为单文件 IIFE，直接通过 `<script>` 标签加载到 PWA 中。

```bash
pnpm build   # → dist/autobot.global.js
```
