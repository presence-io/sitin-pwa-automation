# 元素定位策略

## 背景

最初版本使用单一 CSS 选择器定位元素，在列表场景（如聊天列表、动态 feed）中多个元素生成相同选择器，导致回放命中错误元素。

v4 借鉴 Playwright（角色+文案优先）和 Chrome DevTools Recorder（多选择器 fallback）的思路，升级为多 Locator 策略。

## 业界方案对比

| 工具 | 定位策略 | 列表处理 | 稳定性 |
|------|----------|----------|--------|
| **Playwright** | 角色 + 文案优先 | `filter({ hasText })` | 极高 |
| **Chrome Recorder** | 多选择器逐级 fallback | 依赖 aria/text | 高 |
| **rrweb** | 节点 ID 映射（快照） | 无此问题 | 极高（仅录像） |
| **AI 自愈 (Testim)** | 指纹向量 + ML 打分 | 综合匹配 | 极高 |
| **Selenium IDE** | id / xpath / css | 弱 | 低 |

## AutoBot v4 方案

### 核心思路

**录制时采集所有可用的定位器，回放时按优先级逐个尝试。**

每个元素生成一个 `Locator[]` 数组，包含多种定位方式：

### 数据结构

```typescript
interface Locator {
  type: 'id' | 'testid' | 'aria' | 'text' | 'placeholder' | 'inputAttr' | 'css';
  value: string;
}

interface RecordingStep {
  type: 'click' | 'input' | 'navigate' | 'select' | 'scroll';
  locators: Locator[];    // 多个定位器，按优先级排列
  tag: string;            // 元素标签名，辅助缩小匹配范围
  textHint?: string;      // 文案，用于展示 + 最终兜底
  // ...
}
```

### 录制：Locator 生成优先级

| 优先级 | 类型 | 生成条件 | 示例 |
|--------|------|----------|------|
| 1 | `id` | 元素有非 autobot 前缀的 id | `#login-btn` |
| 2 | `testid` | 有 `data-testid` 属性 | `login-btn` |
| 3 | `aria` | 有 `aria-label` 属性 | `Submit form` |
| 4 | `text` | 可点击元素 + 文案 < 80 字符 | `Claim $0.50` |
| 5 | `placeholder` | input/textarea 有 placeholder | `Enter your name` |
| 6 | `inputAttr` | input/select 的 name/type 组合 | `input[name="email"][type="email"]` |
| 7 | `css` | CSS path fallback（最多 5 层） | `div > div:nth-child(3) > button` |

一个元素会命中多个 locator，全部记录。例如一个按钮可能同时有 id、aria-label 和 text 三种 locator。

### "可点击元素"的判定

只有以下元素才会生成 `text` 类型 locator：
- `<button>` / `<a>` 标签
- `role="button"` 属性
- `cursor: pointer` CSS 样式

这避免了对所有 `<div>`/`<span>` 生成文案 locator（会导致大量无意义匹配）。

### 回放：匹配流程

```
遍历 step.locators（按录制时的优先级顺序）:

  id        → document.querySelector('#xxx')
  testid    → document.querySelector('[data-testid="xxx"]')
  aria      → document.querySelector('[aria-label="xxx"]')
  text      → 遍历同 tag 的可见元素:
                1. 精确匹配: textContent.trim() === value
                2. 包含匹配: textContent.trim().includes(value)
  placeholder → document.querySelector('[placeholder="xxx"]')
  inputAttr → document.querySelector(value)
  css       → document.querySelector(value)

  ↓ 每个找到的元素都做可见性检查 (offsetParent !== null)
  ↓ 找到第一个可见元素即返回

全部 locator 失败 → 兜底: 用 textHint 对全页面做模糊搜索
全部失败 → MutationObserver 等待最多 10 秒后重试
```

### 关键改进：列表场景

旧方案（单一 CSS 选择器）：
```
聊天列表 item 1: div > div:nth-child(1) > div  ← 录制这个
聊天列表 item 2: div > div:nth-child(2) > div
聊天列表 item 3: div > div:nth-child(3) > div
→ 列表刷新后顺序变了，nth-child 命中错误元素
```

新方案（多 Locator）：
```
聊天列表 item "John":
  locators: [
    { type: 'text', value: 'John\nHey, how are you?\n2 min ago' },
    { type: 'css', value: 'div > div:nth-child(1) > div' }
  ]
→ 回放时优先用 text 匹配 "John"，不依赖位置
→ CSS path 只作为最后兜底
```

### 局限性

1. **纯图片元素无文案**: 没有 alt/aria-label 的图片按钮只能靠 CSS path 定位
2. **文案完全相同的不同元素**: 如页面有多个 "确定" 按钮，text 匹配会命中第一个可见的
3. **动态文案**: 如果文案包含时间戳、数字等动态内容，文案匹配可能失效

### 未来改进方向

1. **data-testid 覆盖**: 在 PWA 源码中为关键交互元素添加 `data-testid`，最稳定的定位方式
2. **AI 自愈匹配**: 当所有 locator 失败时，将页面 DOM 结构 + 步骤描述发给 LLM 定位元素
3. **视觉位置辅助**: 录制时记录元素的视口坐标比例，作为额外打分信号
