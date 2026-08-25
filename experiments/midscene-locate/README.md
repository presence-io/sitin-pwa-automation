# midscene-locate（最小 locate 核心 spike）

把 [Midscene.js](https://github.com/web-infra-dev/midscene) 的**视觉定位（visual grounding）核心**抽出来，做成一个约 120 行、零依赖的 `locate.mjs`——验证「只借核心、不接整库」是否可行，以及不同 VLM 在「一句话 → 屏幕坐标」上的准确率/延迟差异。

## 这是什么

`locate({ 截图, 一句话描述 })` → 返回元素在截图上的**像素坐标**（bbox + center）。
拿到 center 就能驱动真机点击 / 投屏点击。

- `locate.mjs` — 核心。忠实移植自 Midscene 的 gpt-family 分支：
  - grounding 规则提示词（逐字照搬 `locate-grounding-rules.ts`）
  - system / response 提示词（`default-locate-protocol.ts`）
  - 坐标编解码（`bbox.ts` / `pixel-bbox-mapper.ts`：点扩框、clamp、order 校验）
  - 无 `@midscene/core` 依赖，只用 Node 内置 `fetch`
- `gen.mjs` — 生成 3 个已知真值坐标的测试场景（SVG→PNG）：登录页 / 消息列表 / 工具栏图标
- `run.mjs` — 跑全部用例，判定「预测中心点是否落在真值框内」，输出命中率+延迟，并生成标注图（绿=真值框，红虚线=预测框，红点=预测中心）到 `out/`
- `manifest.json` + `img/` — 测试场景与真值（`gen.mjs` 产物，可重建）

## 怎么跑

```bash
node gen.mjs                        # 重建 img/*.png 与 manifest.json（需 rsvg-convert，CJK 依赖系统 PingFang 字体）
API_KEY=sk-xxx MODEL=gpt-5.6-terra node run.mjs
```

环境变量：`ENDPOINT`（默认 callapi.top/v1）、`API_KEY`（**必填，勿硬编码**）、`MODEL`、`USE_JSON=0` 关闭 json_object 模式。
VLM 必须放服务端（持有 key），前端不碰。

## 三模型实测（12 条用例：含 6 行同类干扰消歧、小图标、复选框/链接文字）

| 模型 | 命中率 | 延迟 p50 / max | 结论 |
|------|--------|----------------|------|
| gpt-5.6-terra | **12/12 = 100%** | 27.8s / 122s | 准，但慢到不可用 |
| gpt-5.4-mini | 11/12 = 92% | 6.4s / 95s | 较准，仍有长尾 |
| deepseek 视觉 | 1/12 = 8% | ~0.5s | 快，但坐标系错乱（返回自身缩放尺寸下的坐标，x_max 超过图宽）——非 grounding 微调模型，不可用 |

## 结论

- **「只借核心」成立**：约 120 行零依赖代码即可复刻 Midscene 的定位能力，且是模型无关的——它干净地暴露了三个模型的差异。
- 准确率在**密集页面**上也很好（6 行同类头像消歧、小齿轮图标都能命中）。
- 真正的瓶颈是**延迟**：通用大模型（GPT-5.x）准但慢（秒级到两分钟），DeepSeek 这类非定位微调的视觉模型快但坐标不可用。
- 要同时拿到**快 + 准**，得换**为 UI 定位专门微调的模型**（doubao-seed / qwen-vl / 自托管 UI-TARS，走国内端点）。这是下一步要验证的。

> spike 代码，不进主链路；仅供选型参考。
