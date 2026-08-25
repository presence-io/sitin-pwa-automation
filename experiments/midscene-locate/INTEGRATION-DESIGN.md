# AI 定位接入设计方案 v2（贴合真实架构：注入式 + rrweb + 选择器用例）

> **v1 作废**：v1 按「控制端只有画面、需 VLM 像素定位 + 坐标映射」写，前提错了。
> 真实架构（读码确认）：`autobot.js` 注入被测页面、跑在页面 JS 上下文、**本地有完整 DOM**；
> 屏幕同步走 **rrweb 序列化 DOM**（非截图），Dashboard 用 Replayer 重建真实 DOM；
> 定位走 `player.ts` 的**七级 querySelector**（id/testid/aria/text/placeholder/inputAttr/css），
> 动作是 `el.click()`/`typeInto`，**全程无坐标**；无 CDP/Puppeteer/ADB，唯一依赖 rrweb。
>
> 结论：AI 在这里的价值**不是像素 grounding，而是 DOM 语义推理**。落地顺序 **B（自愈）→ A（生成）**，共用一个原语。

---

## 0. 核心原语：`resolveElement(intent, DOM) → locator[]`

**给「一句话意图 + 一棵 DOM」，返回按你们七级格式排好序的候选选择器（或先定位节点再派生选择器）。**

- A 和 B 都调它：A 在写用例时逐步调，B 在运行时 miss 时调。**建一次，两用。**
- **默认用文本 LLM**（读序列化 DOM，上下文大、便宜）；**只有视觉消歧**（两个元素 DOM 几乎一样、靠外观区分）才加一张渲染图升级成 VLM。像素 grounding（spike 那套）在这退居 C 的可选兜底。
- key 只在服务端。

---

## 1. 分层（在你们现有模块上加，不另起炉灶）

```
控制端 Dashboard(app.ts) ──┐                        ┌── 设备端(注入 autobot.js，页面内)
  A: 用例生成 UI           │   Firebase RTDB / WebRTC │   B: player.ts findByLocator 兜底钩子
  (读 rrweb 重建 DOM)      │   (现有通道)             │   (本地 live DOM)
                          └──────────┬───────────────┘
                                     │ HTTPS（不带 key）
                          ┌──────────▼───────────┐
                          │  Model 服务(新, 服务端) │  持 key、family/model 可换
                          │  /resolve  /generate   │  复用 spike 的 endpoint/key/family 管线
                          └────────────────────────┘
```

**新增件**
1. **Model 服务**（服务端，持 key）：`POST /resolve`（意图+DOM[+图]→候选 locator+置信度+reasoning）、`POST /generate`（需求+DOM→TestAction[]+断言）。family/model env 可换（沿用 `locate.mjs` 的模型管线）。
2. **DOM 序列化/裁剪器**（shared）：把 live DOM(设备) 或 rrweb 重建 DOM(控制) 压成 LLM 友好表示（可见文本 + role + testid + 结构，去噪、限长、必要时分块）。`screenshot.ts` 已在用 `XMLSerializer`，复用其思路。
3. **B 自愈钩子** → 挂在 `teaching/player.ts` 的 `findByLocator`。
4. **A 生成器** → 挂在 Dashboard/teaching，产出 `testing/types.ts` 的 `TestAction`。
5. **缓存**：`(页面签名=rrweb DOM hash, 意图) → locator`。
6. **可观测**：扩现有 `testing/reporter.ts`，记每次自愈/生成的输入输出。

---

## 2. B — 选择器自愈（先做，面最小 ROI 最高）

**流程**（`findByLocator` 七级全失手时才触发，成本随破损）：

```
七级 querySelector 全 miss
  → 序列化当前 DOM + 原步骤意图(textHint/tag/原 locators)
  → 调 Model /resolve → 候选 locator[]
  → 活体校验：候选在当前 DOM 能唯一 querySelector 命中吗？
  → 命中 → el.click()/typeInto → 回写该步 locator + 写缓存 → 发 "healed" 事件
  → 全不命中 → 按失败处理
```

**治理红线（必须实现，否则有害）**
- 自愈只兜「**定位漂移**」（选择器变了、元素还在、语义没变）。
- 动作后的**断言若失败**（预期屏/状态没出现）→ 判定**真回归**→ **报错停住，绝不自愈盖过去**。
- 低置信度 / 多候选歧义 → 不自动点，标注待人工。
- 每次自愈进报告：旧 locator、DOM 变化点、新 locator、置信度、reasoning——可回溯、可否决。

**为什么先做**：一个兜底钩子的改动面；只在坏的时候烧 token；直接砍用例维护成本；和七级选择器模型天然契合。

---

## 3. A — 用例生成（后做，对上「在控制端生成用例」）

**流程**（控制端 Dashboard，authoring-time）：

```
输入需求(自然语言/流程) + 当前页面 DOM(rrweb 重建)
  → 调 Model /generate → 候选 TestAction[](选择器式) + 每步断言
  → 逐步活体 dry-run（走现有 run 命令下发到设备，验证每步 locator 真能命中/动作可执行）
  → 只保留能跑通的步骤，脆/错的标出
  → 人工过一遍 → 存成 suite(repository/store，沿用 recorder 的 locator 格式)
```

- 复用 B 的 `resolveElement` 逐步定位，额外加**断言生成**（DOM 能判的优先，判不了才视觉断言）。
- **活体 dry-run 门禁**是关键：生成即验证，不落地没跑通的用例。

---

## 4. 缓存 / 回放

- 页面签名 = rrweb 全量快照的 DOM 结构 hash（已有 rrweb，直接算）。
- `(签名, 意图) → locator`；自愈命中即回写，回放全命中 → 零 token、确定性。
- 缓存放哪待定：设备 IndexedDB(`teaching/store.ts` 现成) / 控制端 / `tests/` 仓库。

---

## 5. 可观测性

- 扩 `testing/reporter.ts`：自愈事件 + 生成记录。
- 需要视觉证据时复用 `pngbox` 出标注图（渲染图 + 命中框）。对标 Midscene 报告：调错靠"看模型看到的 DOM/图"。

---

## 6. 里程碑

| 里程碑 | 内容 | 产出 |
|--------|------|------|
| **M1** | Model 服务（`/resolve`）+ DOM 序列化/裁剪器；key 服务端、family 可换（复用 spike 管线） | 「意图+DOM→选择器」原语可用 |
| **M2** | **B 自愈**：`player.ts` 兜底钩子（miss→resolve→活体校验→点击→回写+缓存）+ 治理红线 + 报告事件 | 用例自愈、维护成本下降 |
| **M3** | **A 生成**：Dashboard `/generate` UI（需求+DOM→步骤+断言→活体 dry-run 门禁→人工审→存 suite） | 控制端半自动产用例 |
| **M4** | 缓存/回放 + （可选）C：canvas/跨域 iframe 像素兜底 tier（**仅当真有此类目标且能截到那块像素**） | 稳、省、边角覆盖 |

先选 20–30 条关键流程做种子集。

---

## 7. 待确认

1. **Model 服务谁调**：设备端直连 HTTPS（低延迟）还是经控制端中转（集中门禁）？——B 自愈的关键选择。
2. **模型选型**：DOM 推理**文本 LLM 优先**（更大上下文、更便宜）还是直接 VLM？建议文本优先，视觉消歧才加图。
3. **大页面 DOM**：超上下文时的裁剪/分块策略。
4. **缓存位置**：设备 IndexedDB / 控制端 / tests 仓库。
5. DeepSeek key 轮换。

---

## 附：spike 的留存价值（诚实说明）

- 像素 grounding（`locate.mjs` + DeepSeek 真机页 100%）**在你们架构里只对 C（canvas/iframe 兜底）有用**，不是 A/B 主路径。
- 真正留下来的是：**模型接入管线**（endpoint/key/family 抽象、fetch、非 JSON/reasoning 处理）、**选型认知**（专用 grounding vs 通用模型的快慢准差异）、**自愈治理红线**、`pngbox`（可视化）。A/B 会把定位换成 DOM 语义推理的路子。

### 2026 调研搬进本版的 3 条
1. **自愈超越 locator 打补丁**：不是修字符串，是按意图在当前 DOM 重新识别 → 正是 B。
2. **自愈须分清小改 vs 真回归**，别藏 bug → 第 2 节红线。
3. **成本与难度成正比**：确定性七级选择器先跑，AI 只在 miss/生成时上 → 天然贴合。
