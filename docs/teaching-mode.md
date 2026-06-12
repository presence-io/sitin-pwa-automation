# 教学模式 — 录制回放

## 概述

教学模式允许用户手动操作 PWA 页面，系统自动记录每一步操作，保存后可一键回放。适用于复杂流程的自动化，无需编写代码。

## 录制原理

### 事件监听

在 `document` 上挂事件监听器，捕获用户的真实交互：

| 事件 | 监听阶段 | 记录内容 |
|------|----------|----------|
| `click` | 冒泡阶段 | 元素定位器 + 文案 |
| `input` | 捕获阶段 | 元素定位器 + 输入值 |
| `change` | 捕获阶段 | select 定位器 + 选中值 |
| `popstate` | — | URL 路径变化 |

### 为什么 click 用冒泡阶段？

PWA 使用 React 18，React 将事件代理挂载在 `#root` 容器上。如果 autobot 用捕获阶段监听 click，会在 React 处理之前拦截事件，可能干扰 React Router 导航等功能。使用冒泡阶段确保 React 先完成处理。

### queueMicrotask 延迟

所有事件处理器内部通过 `queueMicrotask()` 延迟执行录制逻辑，确保：
1. 事件派发完整走完冒泡链
2. React 的同步状态更新完成
3. autobot 的录制工作不阻塞用户交互

### 录制排除

以下元素的操作不会被录制：
- `#autobot-panel` — 主面板
- `#autobot-fab` — 浮动按钮
- `#autobot-minibar` — 顶部状态条

### 智能点击目标识别

用户点击一个按钮内的图标 `<img>` 时，`e.target` 是 `<img>` 而不是外层 `<button>`。`getClickableAncestor()` 函数从 `e.target` 向上遍历 DOM 树，找到真正的可点击容器：

```
查找顺序：
1. button / a 标签
2. 有 onclick 或 role="button" 的元素
3. cursor:pointer 且父元素不是 pointer 的元素（可点击容器边界）
```

## 回放引擎

### 执行流程

```
for each step:
  1. 等待 delay 毫秒（上限 5 秒）
  2. 用 locators 逐级定位元素
  3. 元素不存在 → MutationObserver 等待最多 10 秒
  4. 执行操作（click / typeInto / navigate / select）
  5. 操作后等待 300ms 让页面响应
  6. 失败 → 报告错误步骤并停止
```

### 操作类型

| type | 执行方式 |
|------|----------|
| `click` | `element.click()` |
| `input` | `typeInto()` — 逐字符模拟输入 + 触发 React onChange |
| `select` | 设置 `value` + 派发 `change` 事件 |
| `navigate` | `spaNav(url)` — React Router 友好的 SPA 导航 |
| `scroll` | `window.scrollTo()` |

### 控制功能

- **暂停**: 设置 `paused = true`，回放循环中轮询等待
- **继续**: 设置 `paused = false`
- **终止**: 设置 `aborted = true`，立即退出回放循环

## 存储

### IndexedDB

- 数据库名: `autobot_db`
- Object Store: `recordings`
- Key: 录制名称（`name` 字段）

选择 IndexedDB 而非 localStorage 的原因：
- 容量更大（适合存大量步骤数据）
- 清除浏览器 cookie/localStorage 时通常不会丢失 IndexedDB
- 支持结构化存储

### 导入导出

- **导出**: Recording 对象序列化为 JSON 文件下载
- **导入**: 选择 `.json` 文件 → 解析 → 写入 IndexedDB
- 支持单条导出和批量全部导出

## UI 交互

### 录制时

1. 点击"开始录制" → 面板自动收起 + FAB 隐藏
2. 顶部出现红色脉冲指示条（minibar），显示步骤数
3. minibar 上有"停止"按钮
4. 停止后弹出 prompt 输入流程名称 → 保存到 IndexedDB

### 回放时

1. 点击某条录制的 ▶ 按钮 → 面板自动收起 + FAB 隐藏
2. 顶部出现蓝色指示条，显示当前步骤进度
3. minibar 上有"暂停"和"终止"按钮
4. 回放完成或终止后，minibar 消失，FAB 恢复显示
