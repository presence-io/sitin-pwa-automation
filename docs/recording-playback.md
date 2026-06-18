# 录制与回放引擎 — 技术原理

## 概述

AutoBot 的录制回放引擎运行在浏览器页面内部，通过事件监听捕获用户操作，将操作序列化为 JSON 步骤，回放时按顺序重新定位元素并执行对应操作。

```
录制：用户操作 → 事件监听 → 生成 Locator → 序列化为 RecordingStep[]
回放：RecordingStep[] → 按 Locator 查找元素 → 执行操作 → 等待响应
```

## 一、录制原理

### 1.1 事件监听

录制器在 `document` 上挂四个事件监听器：

| 事件 | 捕获阶段 | 记录内容 | 为什么用这个阶段 |
|------|---------|---------|----------------|
| `click` | 冒泡 | 点击目标元素 + Locator | React 将事件代理挂在 `#root` 上，冒泡阶段确保 React 先完成处理 |
| `input` | 捕获 | 输入框元素 + 当前值 | 捕获阶段拿到最新 value |
| `change` | 捕获 | select 元素 + 选中值 | 同上 |
| `popstate` | — | URL 变化 | SPA 路由跳转 |

所有事件回调内部通过 **`queueMicrotask()`** 延迟执行，确保：
1. 事件派发完整走完冒泡链
2. React 的同步状态更新完成
3. AutoBot 的录制不阻塞用户交互

### 1.2 事件排除

以下元素上的操作不会被录制：

```typescript
function isAutobotElement(el: Element): boolean {
  return !!(
    el.closest('#autobot-panel')  ||  // 主面板
    el.closest('#autobot-fab')    ||  // 浮动按钮
    el.closest('#autobot-minibar')||  // 顶部状态条
    el.closest('#__vconsole')     ||  // vConsole 调试面板
    el.closest('.vc-mask')            // vConsole 遮罩
  );
}
```

### 1.3 点击目标识别

用户点击按钮内的图标 `<img>` 时，`e.target` 是 `<img>` 而不是外层 `<button>`。`getClickableAncestor()` 从 `e.target` 向上遍历 DOM 树，找到真正的可点击容器：

```
查找顺序（向上冒泡直到 body）：
1. <button> 或 <a> 标签 → 立即返回
2. 有 onclick 或 role="button" → 返回
3. cursor:pointer 且父元素不是 pointer → 返回（可点击容器边界）
4. 都没找到 → 返回原始 e.target
```

### 1.4 Locator 生成

每个元素生成一个 `Locator[]` 数组，包含多种定位方式，按优先级排列：

| 优先级 | 类型 | 生成条件 | 示例 |
|--------|------|----------|------|
| 1 | `id` | 元素有非 autobot 前缀的 id | `#login-btn` |
| 2 | `testid` | 有 `data-testid` 属性 | `login-btn` |
| 3 | `aria` | 有 `aria-label` 属性 | `Submit form` |
| 4 | `text` | 可点击元素的文案 < 80 字符 | `Claim $0.50` |
| 5 | `placeholder` | input/textarea 有 placeholder | `Enter your name` |
| 6 | `inputAttr` | input/select 的 name/type 组合 | `input[name="email"][type="email"]` |
| 7 | `css` | CSS 路径兜底（最多 5 层） | `div > div:nth-child(3) > button` |

一个元素可能同时命中多个 locator，全部记录。回放时按此优先级逐个尝试。

**"可点击元素"的判定**（决定是否生成 text locator）：
- `<button>` 或 `<a>` 标签
- `role="button"` 属性
- CSS `cursor: pointer` 样式

### 1.5 非可点击元素的处理（列表项）

聊天列表、联系人列表等场景，用户点击的是普通 `<div>`，不满足"可点击"条件。这类元素的文本通常混合了动态内容（用户名 + 消息预览 + 时间戳），直接取 `textContent` 会导致回放匹配失败。

**策略：弹出选择器让用户指定**

当点击非可点击元素且元素内有多个文本片段时，录制器不自动猜测，而是弹出一个浮层列出所有叶子文本节点，让用户点选哪个作为匹配依据：

```
┌─ 选择匹配文本 ──────────┐
│  [Sitin456]              │  ← 用户名（选这个）
│  [Hello, how are you?]   │  ← 消息预览
│  [16:02]                 │  ← 时间戳
│  [跳过（用 CSS 定位）]     │
└──────────────────────────┘
```

弹出逻辑：

```
用户点击列表项
  ↓
getClickableAncestor() 找不到 button/a → 返回原始容器 div
  ↓
判断非可点击元素 → 提取所有叶子文本节点
  ↓
叶子文本 > 1 个且有 onTextPick 回调？
  ↓ 是                    ↓ 否
弹出选择浮层             自动取第一个非动态文本
用户选择 → 作为 text locator
```

如果 5 秒无操作自动跳过，回退到 CSS 路径定位。

**自动模式**（无选择器弹出时）使用 `extractStableText()`：
- 遍历元素内所有叶子文本节点
- 过滤掉动态内容：时间戳（`16:02`）、相对时间（`2m`、`Yesterday`）、纯数字（`3`）
- 取第一个符合条件的文本

### 1.6 输入合并

连续在同一个输入框中输入时，每次 `input` 事件都会触发。为避免生成大量重复步骤，录制器会**合并连续输入**：

```typescript
// 如果上一步也是 input 且定位相同 → 只更新 value，不新增步骤
if (last.type === 'input' && last.locators[0]?.value === locators[0]?.value) {
  last.value = value;  // 更新为最新值
  return;
}
```

### 1.7 导航检测

SPA 路由变化通过 `popstate` 事件检测。当 URL 变化时生成 navigate 步骤：

```typescript
{
  type: 'navigate',
  url: '/chats?tab=chat-list',  // pathname + search + hash
  locators: [],
  tag: '',
}
```

### 1.8 录制时插入断言

录制状态下，minibar 上有 **[+断言]** 按钮。点击弹出断言类型选择：

| 断言类型 | 数据来源 |
|---------|---------|
| URL 断言 | 自动填充当前 `location.pathname` |
| 文案存在 | 用户手动输入 |
| 文案不存在 | 用户手动输入 |
| 埋点触发 | 从 tracker 已捕获的事件列表中选择 |

断言作为 `type: 'assert'` 步骤插入到录制序列中，转测试用例时自动保留。

### 1.9 数据结构

```typescript
interface RecordingStep {
  type: 'click' | 'input' | 'navigate' | 'select' | 'scroll' | 'assert';
  locators: Locator[];     // 多个定位器，按优先级排列
  tag: string;             // 元素标签名
  textHint?: string;       // 文案提示，用于展示 + 兜底匹配
  value?: string;          // input 的值
  url?: string;            // navigate 的 URL
  delay: number;           // 与上一步的时间间隔（ms）
  scrollX?: number;
  scrollY?: number;
  // 断言字段（type='assert' 时使用）
  assertType?: string;
  expected?: string;
  sdk?: string;
  event?: string;
}

interface Locator {
  type: 'id' | 'testid' | 'aria' | 'text' | 'placeholder' | 'inputAttr' | 'css';
  value: string;
}
```

### 1.10 存储

录制数据存储在 **IndexedDB**（数据库 `autobot_db`，表 `recordings`）中。

选择 IndexedDB 而非 localStorage：
- 容量更大（适合存大量步骤数据）
- 清除浏览器 cookie/localStorage 时通常不会丢失
- 支持结构化存储

录制完成后自动同步到 **Firebase** `recordings/{project}/{name}`，Dashboard 端可见。

---

## 二、回放原理

### 2.1 整体流程

```
for each step:
  1. 等待 delay 毫秒（上限 5 秒）
  2. 用 locators 逐级定位元素
  3. 全部 locator 失败 → textHint 全局兜底搜索
  4. 仍未找到 → MutationObserver 等待最多 10 秒
  5. 执行操作（click / typeInto / navigate / select / scroll）
  6. 操作后等待 300ms 让页面响应
  7. 失败 → 报告错误步骤并停止
```

### 2.2 元素定位 — 多 Locator 回退

回放时，按 `locators[]` 数组的顺序逐个尝试定位：

```
Locator 1 (id)        → document.querySelector('#xxx') → 可见? → 返回
    ↓ 没找到
Locator 2 (testid)    → document.querySelector('[data-testid="xxx"]') → 可见?
    ↓ 没找到
Locator 3 (aria)      → document.querySelector('[aria-label="xxx"]') → 可见?
    ↓ 没找到
Locator 4 (text)      → 遍历同 tag 元素:
                          精确匹配: textContent.trim() === value
                          包含匹配: textContent 包含 value（取最小匹配元素）
    ↓ 没找到
Locator 5 (placeholder) → document.querySelector('[placeholder="xxx"]') → 可见?
    ↓ 没找到
Locator 6 (css)       → document.querySelector(value) → 可见?
    ↓ 全部失败
textHint 兜底         → 全页面搜索: 精确匹配 → 包含匹配
    ↓ 仍未找到
MutationObserver      → 等待 DOM 变化后重试，最多 10 秒
```

**每个找到的元素都做可见性检查**：`(el as HTMLElement).offsetParent !== null`

**text 匹配的特殊处理**：

精确匹配优先。如果精确匹配失败，做包含匹配时**选择最小的匹配元素**（`textContent.length` 最短的），避免匹配到包含目标文本的外层容器：

```typescript
// 包含匹配 — 取最小（最具体）的匹配元素
let best: Element | null = null;
let bestLen = Infinity;
for (const el of candidates) {
  const t = el.textContent?.trim() || '';
  if (t.includes(locator.value) && t.length < bestLen) {
    best = el;
    bestLen = t.length;
  }
}
```

### 2.3 等待元素出现

元素可能因异步加载（API 响应、SPA 路由切换后 DOM 更新）而延迟出现。使用 **MutationObserver** 监听 DOM 变化：

```typescript
async function waitForElement(step, timeoutMs = 10000): Promise<Element | null> {
  // 先尝试立即查找
  const el = findElementByStep(step);
  if (el) return el;

  // 等待 DOM 变化后重试
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const obs = new MutationObserver(() => {
      const found = findElementByStep(step);
      if (found) { obs.disconnect(); resolve(found); }
      else if (Date.now() > deadline) { obs.disconnect(); resolve(null); }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    // 超时保底
    setTimeout(() => { obs.disconnect(); resolve(findElementByStep(step)); }, timeoutMs);
  });
}
```

### 2.4 操作执行

| 操作类型 | 执行方式 | 关键细节 |
|---------|---------|---------|
| `click` | `element.click()` | 等 500ms 让页面响应 |
| `input` | `typeInto()` 逐字符模拟输入 | 绕过 React 的受控组件机制 |
| `select` | 设值 + 派发 `change` 事件 | `sel.value = x; sel.dispatchEvent(new Event('change'))` |
| `navigate` | `spaNav(url)` | React Router 友好的 SPA 导航 |
| `scroll` | `window.scrollTo()` | — |

**`typeInto()` 的实现**（逐字符输入模拟）：

React 使用受控组件时，直接修改 `input.value` 不会触发状态更新。`typeInto()` 通过 React 内部的 property setter 绕过：

```typescript
async function typeInto(el: HTMLInputElement, text: string) {
  el.focus();
  // 清空 — 通过原型链上的 setter 设值，触发 React 内部响应
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));

  // 逐字符输入
  for (const ch of text) {
    const cur = el.value || '';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, cur + ch);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(15);  // 每字符间隔 15ms
  }
}
```

**`spaNav()` 的实现**（SPA 友好导航）：

不能直接 `location.href = url`（会导致整页刷新）。通过 `pushState` + `popstate` 事件通知 React Router：

```typescript
function spaNav(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
```

### 2.5 控制功能

| 功能 | 实现 |
|------|------|
| 暂停 | 设置 `paused = true`，回放循环中 `while (paused) await sleep(200)` 轮询等待 |
| 继续 | 设置 `paused = false` |
| 终止 | 设置 `aborted = true`，立即退出回放循环 |

### 2.6 UI 交互

**录制时**：
1. 面板自动收起 + FAB 隐藏
2. 顶部出现红色脉冲 minibar，显示步骤数
3. minibar 上有 [+断言] 和 [停止] 按钮
4. 停止后弹出 prompt 输入名称 → 保存到 IndexedDB + Firebase

**回放时**：
1. 面板收起 + FAB 隐藏
2. 顶部出现蓝色 minibar，显示当前进度
3. minibar 上有 [暂停] 和 [终止] 按钮
4. 完成或终止后 minibar 消失，FAB 恢复

---

## 三、录制转测试用例

录制产出的是操作序列（`RecordingStep[]`），不包含断言。通过"转为测试用例"功能转换为 `TestSuite` 格式：

```
RecordingStep[]                      TestSuite
──────────────                       ──────────
click locators tag textHint    →     { action: 'click', locators, tag, textHint }
input locators tag value       →     { action: 'input', locators, tag, value }
navigate url                   →     { action: 'navigate', url }
                                     { action: 'assert', assertType: 'url', expected: url }  ← 自动插入
assert assertType expected     →     { action: 'assert', assertType, expected, sdk, event }  ← 保留
```

**自动增强**：
- navigate 步骤后自动插入 URL 断言
- 录制时手动插入的断言步骤原样保留

转换后的 TestSuite 保存到 IndexedDB 本地用例库 + Firebase 远程同步。

---

## 四、已知限制

| 限制 | 原因 | 缓解方式 |
|------|------|---------|
| 纯图片按钮无文案 | 没有 alt/aria-label 的图片只能靠 CSS 定位 | 在源码中添加 `data-testid` |
| 文案完全相同的元素 | 多个 "确定" 按钮会匹配第一个可见的 | 使用 id/testid 区分 |
| 动态文案（数字/时间） | 文案匹配失效 | text picker 让用户选择稳定部分 |
| 跨标签页 | 浏览器内脚本无法控制其他标签页 | 需要 Playwright CLI |
| iframe 内元素 | 跨域 iframe 无法访问内部 DOM | 仅支持同域 iframe |
