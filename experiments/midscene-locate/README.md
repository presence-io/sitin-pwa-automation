# midscene-locate（最小 locate 核心 spike）

把 [Midscene.js](https://github.com/web-infra-dev/midscene) 的**视觉定位（visual grounding）核心**抽出来，做成一个约 120 行、零依赖的 `locate.mjs`——验证「只借核心、不接整库」是否可行，以及不同 VLM 在「一句话 → 屏幕坐标」上的准确率/延迟差异。

## 这是什么

`locate({ 截图, 一句话描述 })` → 返回元素在截图上的**像素坐标**（bbox + center）。
拿到 center 就能驱动真机点击 / 投屏点击。

- `locate.mjs` — 核心。忠实移植自 Midscene，含**两套协议分支**：
  - `family='gpt'`：grounding 规则提示词（逐字照搬 `locate-grounding-rules.ts`）+ system/response 协议（`default-locate-protocol.ts`）+ 坐标编解码（`bbox.ts`/`pixel-bbox-mapper.ts`）
  - `family='deepseek'`：DeepSeek 原生 grounding 协议——native token（`<｜｜point｜｜>[[x,y]]<｜｜/point｜｜>`）、坐标**归一化 0–1000**（非像素）、非 JSON 模式、reasoning 兜底、`max_tokens≥1024`。另含 `searchArea()`（`<｜｜ref｜｜>…<｜｜box｜｜>` 粗定位）
  - 无 `@midscene/core` 依赖，只用 Node 内置 `fetch`
- `gen.mjs` — 生成 3 个合成场景（SVG→PNG：登录页/消息列表/工具栏）+ 静态 `realapp`（真机截图，12 个手标真值框）
- `run.mjs` — 跑用例，判定「预测中心是否落在真值框内」，输出命中率+延迟，出标注图到 `out/`（`SCENE=<名>` 只跑单场景）
- `ab.mjs` / `twostage.mjs` — DeepSeek 优化实验：4 组提示词 A/B、两段式（粗定位→裁剪放大→精定位）对比
- `pngbox.mjs` — 纯 Node（`zlib`）的 PNG 读写画框工具；这台机 librsvg 不合成大位图 `<image>`，标注图/真值图改用它
- `verify_truth.mjs` — 把手标真值框画到场景图上人工核对
- `manifest.json` + `img/` — 测试场景与真值

## 怎么跑

```bash
node gen.mjs                        # 重建合成 img/*.png 与 manifest.json（需 rsvg-convert，CJK 依赖系统 PingFang 字体；realapp 为静态截图不重建）
# GPT 家族（callapi.top）
API_KEY=sk-xxx MODEL=gpt-5.6-terra node run.mjs
# DeepSeek 家族（原生 grounding 协议，自动识别 family=deepseek）
API_KEY=sk-xxx ENDPOINT=https://api.deepseek.com/v1 MODEL=deepseek-v4-flash-vision-exp SCENE=realapp node run.mjs
```

环境变量：`ENDPOINT`、`API_KEY`（**必填，勿硬编码**）、`MODEL`、`FAMILY`（`gpt`/`deepseek`，默认按模型名推断）、`SCENE`（只跑单场景）、`USE_JSON=0`。
VLM 必须放服务端（持有 key），前端不碰。

## 实测

**合成 12 条**（含 6 行同类消歧、小图标、复选框/链接文字）：

| 模型 | 命中率 | 延迟 p50 / max | 结论 |
|------|--------|----------------|------|
| gpt-5.6-terra | **12/12 = 100%** | 27.8s / 122s | 准，但慢到不可用 |
| gpt-5.4-mini | 11/12 = 92% | 6.4s / 95s | 较准，仍有长尾 |
| deepseek 视觉（原生协议） | 9/12 = 75% | **~0.5s** | 快且准，近失都在紧贴的小控件上 |

**真机复杂页 `realapp`**（用户真实截图 1200×2608，12 个控件）：

| 模型 | 命中率 | 延迟 p50 / max | 误差 |
|------|--------|----------------|------|
| deepseek 视觉（原生协议） | **12/12 = 100%** | 1.3s / 1.6s | 4–26px（唯一 84px 仍在宽文字框内） |

> ⚠️ 早前记录的「deepseek 1/12 = 8%、坐标错乱」是**调用协议错误**（喂了 JSON+像素坐标）。改用 Midscene 的 DeepSeek 原生协议（native token + 归一化 0–1000）后结论逆转。

## 优化实验（DeepSeek）

- **提示词 A/B**（`ab.mjs`）：仅保留「精度」引导的 V1 小幅优于基线；堆规则的 V2 反而掉点——原生 grounding 模型不吃冗长英文规则。
- **两段式**（`twostage.mjs`）：粗定位→裁剪放大→精定位。能救合成图里「同行重复小图标」硬例（Bob 三点菜单），但会拖累简单工具栏例、延迟翻倍——**选择性用**。真机页单段已满分，两段式无必要。

## 结论

- **「只借核心」成立**：约 120 行零依赖代码即可复刻 Midscene 的定位能力，模型无关，且干净暴露各模型差异。
- **协议对不对是决定性的**：同一个 DeepSeek 模型，喂错协议 8%、喂对 75–100%。
- **DeepSeek 视觉在真机页上是快 + 准的**（100% / ~1.3s），远优于慢到不可用的 GPT-5.x（秒级到两分钟）。合成图上的近失多是紧贴小控件，真机页控件大反而更稳。
- 仍可进一步验证的方向：专为 UI 定位微调的模型（doubao-seed / qwen-vl / 自托管 UI-TARS）。

> spike 代码，不进主链路；仅供选型参考。
