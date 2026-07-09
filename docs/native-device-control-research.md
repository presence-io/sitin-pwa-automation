# 真机原生设备控制调研

> 日期：2026-07-08
> 状态：技术调研
> 范围：安卓 / iOS 真机的 OS 级远程控制与自动化方案选型、能力边界、成本。**本文档只做调研，不含落地实现设计。**

## 0. TL;DR

- **问题域**：如何对真机做**原生 OS 级控制** —— 看屏、注入触摸/输入、点原生系统弹窗（摄像头/麦克风/定位授权）、装/切/杀 App。这些是页面内 JS（网页层自动化）触碰不到的部分。
- **安卓**：成熟、免费、免 root。实时遥控/群控用 **scrcpy v4.0 / QtScrcpy**，脚本化自动化 + 自动授权用 **Appium UiAutomator2 + `pm grant`**。单机 USB 稳定上限约 **15–20 台**。
- **iOS**：昂贵、受限。现代机型（A12+，即 iPhone XS 及以后）**只能走非越狱 + 每台签名的 WebDriverAgent（Appium XCUITest）**。强制 macOS + Xcode 签名 + 证书 1 年轮换 + 无法用模拟器兜底，是 iOS 农场比安卓贵一个量级的根因。
- **架构模式**：业界（scrcpy / DeviceFarmer-STF）普遍采用**「投屏数据面」与「输入控制面」分离**；规模化多走**中心-边缘（hub-and-spoke）**拓扑，每台真机旁挂边缘机（PC / Mac mini / 树莓派）跑 adb / WDA。云真机平台（BrowserStack / Sauce / AWS）是免运维但受限的替代。
- **Python 可行**：安卓/iOS **都能全流程 Python 脚本化**（Python 跑在控制机上遥控设备，手机本身不跑 Python）。安卓主流组合 **adbutils + uiautomator2（+ scrcpy 投屏）**；iOS（17+）**pymobiledevice3 起隧道 + facebook-wda 注入触摸**，触摸永远绕不开 WDA。图片按钮/无 UI 树场景用 **Airtest（图像识别）**。

---

## 1. 问题定义：原生层 vs 网页层

对运行在浏览器 / WebView 里的 Web 应用做自动化，控制能力天然分两层：

| 层次 | 手段 | 能做 | 做不到 |
|------|------|------|--------|
| **网页层** | 页面内注入 JS（DOM 事件、fetch、读 localStorage） | 精准点按 DOM 元素、读埋点、读页面存储 | 碰不到页面**之外**的任何东西 |
| **原生层** | OS 级注入（adb / XCUITest 真实触摸事件） | 系统弹窗、装/切/杀 App、桌面、跨 App、页面崩溃后恢复 | 读不到页面内部语义（要靠坐标或无障碍树） |

**原生层专门补位网页层做不到的三类**：

1. **原生系统弹窗** —— `getUserMedia`（摄像头/麦克风）、定位授权等触发的对话框，由操作系统渲染在 App 之上，页面 JS 无法选中/点击。
2. **App 生命周期** —— 装 App、切换 App、回桌面，完全在 Web 作用域之外。
3. **故障恢复** —— 页面卡死 / WebView 白屏后，页面内 agent 随之失效，只有原生层能重启。

两层是**互补**关系，不是二选一：网页层更精准，原生层管边界。

---

## 2. 安卓原生控制

安卓系统开放，全部核心需求（看屏 + 注入真实触摸 + 点原生授权弹窗 + 装切 App）**都能在非 root 真机上完成**。

### 2.1 工具选型

| 工具 | 版本/状态 | 定位 | 关键能力 | 适用 |
|------|-----------|------|----------|------|
| **scrcpy** | v4.0（2026-05，Apache-2.0，活跃） | 投屏 + 真实触摸注入底座 | USB / ADB-over-WiFi 投屏 + 反控，低延迟 35–70ms，免 root 免装 App；虚拟显示 `--new-display`、OTG 硬件 HID 模式、`--no-window` 无头 | 实时人肉遥控单台 |
| **QtScrcpy** | barry-ran，Apache-2.0，活跃 | scrcpy 协议的**群控面板** | 一台主机同步操作多台，开箱即用（官方宣称 OTG 低分辨率下单机 500+，为极限值） | 群控 / 批量同步操作 |
| **Appium + UiAutomator2** | driver v8.1.0（2026-07，Apache-2.0，活跃） | 按元素的自动化 | 按 id/xpath/accessibility 定位（不依赖坐标，跨分辨率稳定）、读 UI 树、`autoGrantPermissions` 自动授权 | 脚本化自动跑流程 |
| **ADB `input tap/swipe/text`** | 系统自带 | 最轻量脚本 | 直接点坐标 | 固定机型的极简脚本，不推荐规模化 |
| **DeviceFarmer / STF** | fork 续命，维护龟速 | 网页版设备墙 | 浏览器里实时操作多台真机 | 谨慎，对 Android 14/15 支持滞后 |
| **GADS** | shamanec/GADS，活跃 | 现代设备农场 | Web 控制台 + Appium，iOS/Android | STF 的现代替代，优先评估 |

**关于 ADB `input` 的坑**（解释为何不作主力）：坐标写死强依赖分辨率、旋屏即失效；`input text` **只支持 ASCII，中文必须装 [ADBKeyBoard](https://github.com/senzhk/ADBKeyBoard)** 走广播输入；且读不到 UI 树是"盲点"。

### 2.2 原生权限弹窗处理（安卓）

按可靠性排序：

1. **`adb shell pm grant <pkg> <permission>` 预授权（最可靠）** —— 启动流程前静默授予 `CAMERA` / `RECORD_AUDIO` / `ACCESS_FINE_LOCATION`，弹窗根本不出现。
2. **改 App 的 `WebChromeClient.onPermissionRequest()`**（若能改 App 代码，最干净）—— WebView 权限是**两层**：系统层（App 的运行时权限）+ WebView 层（`onPermissionRequest` 里对 `RESOURCE_VIDEO_CAPTURE`/`AUDIO_CAPTURE` 调 `grant()`）。两层都放行才通；缺 `MODIFY_AUDIO_SETTINGS` 会报 `NotReadableError`。
3. **Appium `appium:autoGrantPermissions: true`** —— 底层就是遍历 `pm grant`。**已知坑**：Android 12+ 上仍偶发弹窗、部分机型/权限失效（appium issues #17169 / #17877）。生产建议用显式 `pm grant` 兜底。
4. **坐标点"允许"** —— 最脆弱（不同 ROM 按钮位置/文案不同），仅作最后兜底。

> ⚠️ **`--use-fake-ui-for-media-stream` 不要指望**：这是 Chromium content 层的命令行标志，**主要对 headless Chrome / ChromeDriver 生效**。生产 App 内嵌的 WebView 在 `user` 版系统上只能切一小撮 curated flag，任意 flag 仅在 debuggable/userdebug 版生效且需重启 App。对生产 WebView 场景**不可靠**。

### 2.3 免 root 边界

- **免 root 可做**：投屏、录屏、注入触摸/键盘/文本（含点系统权限弹窗）、`pm grant`、装卸/切换 App、启动 Activity、读 UI 树、OTG HID 键鼠。**覆盖全部核心需求。**
- **需 root**：App **自身**（非经 ADB）向其它 App 注入事件（`INJECT_EVENTS` 是 signature 级权限）、静默安装、跨 App 读私有数据、系统级 GPS 伪造。—— 常规遥控/自动化用不到。

---

## 3. iOS 原生控制（难点）

结论前置：**现代 iPhone（A12+）只有一条路 —— 非越狱 + 每台签名的 WebDriverAgent（Appium XCUITest）**。越狱不是可规模化选项（见 3.6）。

### 3.1 Appium XCUITest + WebDriverAgent

- **栈**：XCUITest driver 主线 v10.x/v11.x（v10+ 需 Appium 3），底层是设备上跑的 WDA（一个 XCTest server），Appium 团队活跃维护。
- **硬性前置（无法回避）**：
  1. **必须 macOS + Xcode**（签名和启动 WDA 都要 Xcode 工具链）。版本要对齐：iOS 17 需 Xcode ≥15，iOS 18 需 Xcode ≥16。
  2. **真机必须签名 WDA**：需 Apple Developer 账号，给 WebDriverAgentLib / Runner 两个 target 配开发证书 + provisioning profile，设备 trust。
  3. **iOS 16+ 真机必须开 Developer Mode**（手动开 + 重启）。
- **能力**：按元素（accessibility id / class chain / predicate）和按坐标两种，tap/scroll/swipe/输入齐全，可启动/杀 App。

### 3.2 原生权限弹窗（iOS）

- **`autoAcceptAlerts`（授予）/ `autoDismissAlerts`（拒绝）** 处理系统隐私弹窗（定位/相机/麦克风等）。
- **⚠️ iOS 13+ 陷阱**：弹窗**超过两个按钮**时，两个 capability **行为反转**（`autoAcceptAlerts` 反而变成全 dismiss）。精准控制用 `acceptAlertButtonSelector`（class chain）指定点哪个按钮（如 "Allow Once"）。
- **真机不能预授权**：`permissions` capability 仅模拟器有效；`tccutil` 是 macOS 命令，iOS 真机无非越狱预授权通道。真机只能运行时跑弹窗。

### 3.3 iOS 17+ 的额外复杂度

Xcode 15 / iOS 17 起，设备通信从旧 lockdownd/DVT 迁到 **CoreDevice + `devicectl`**，并引入 **RemoteXPC/tunnel** 机制：多数开发者服务（DVT、装包、截图）**必须先建一条受信任隧道**才能访问。这就是下面 go-ios / pymobiledevice3 都要先跑 `tunnel` 的原因。

### 3.4 辅助工具与投屏

| 工具 | 能力 | 触摸注入 | 投屏 |
|------|------|----------|------|
| **go-ios** | 跨平台，装 App / 启杀进程 / 截图，可拉起 WDA | ❌（仍靠 WDA） | MJPEG（`ios screenshot`） |
| **pymobiledevice3** | 纯 Python，装包 / DVT 服务 / 截图 / 性能，iOS 17+ 自建 tunneld | ❌（仍靠 WDA） | 截图 |
| **WDA MJPEG** | Appium 生态标准"看屏" | ✅ 注入触摸的主体 | MJPEG，够用非直播级 |
| **QuickTime / AVFoundation** | Mac USB 拿 **低延迟 H.264 流** | — | 延迟最低，**强依赖 Mac** |

常见分工：**go-ios / pymobiledevice3 管隧道 + 装包 + 截图，WDA 管注入触摸**。要低延迟投屏基本绕不开 Mac 的 QuickTime 通道，纯 Linux 农场只能接受 MJPEG 级延迟。

### 3.5 证书成本（关键）

| 账号类型 | 证书有效期 | 设备上限 | 农场可用性 |
|----------|-----------|----------|-----------|
| 免费 Apple ID | **仅 7 天**（每 7 天重签重装 WDA） | 受限 | ❌ 基本不可用 |
| 付费个人/公司（$99/年） | 1 年 | 100 台/类 | ✅ 主力方案，到期需批量重签 |
| 企业证书（$299/年） | 可绕 100 台限制 | 内部分发 | ⚠️ Apple 严查农场滥用，有吊销风险 |

### 3.6 越狱现状（为何不是选项）

主力 **palera1n**（基于硬件级 checkm8 漏洞，Apple 无法软件修复）**仅限 A11 及更早（iPhone X 及以前）**，且越狱后必须关密码锁、Face ID/Apple Pay 不可用。**A12 及以后（iPhone XS 起，即绝大多数在役机型）无公开越狱**。所以现代机型**实质只能非越狱 + WDA**。

### 3.7 为什么 iOS 群控贵一个量级

强制 macOS 硬件（签名 + Xcode 构建 + 低延迟投屏都要 Mac，几十台 iPhone 要配若干台 Mac mini）＋ 强制签名/证书 1 年轮换 ＋ 不能用模拟器兜底（Face ID、相机、真机弹窗只能真机验证）—— 三者叠加。安卓农场纯 Linux/x86 即可，没有这些固定成本。

---

## 4. 业界架构模式调研

> 本节调研业界如何组织真机控制系统，供架构参考，不含针对具体系统的实现设计。

### 4.1 数据面 / 控制面分离

主流真机控制工具都把「投屏（video）」和「输入注入（control）」拆成**独立通道**：

- **scrcpy**：设备上跑 `scrcpy-server.jar`（经 adb push + app_process 启动），经 adb tunnel 开最多 3 个 socket —— **video / audio / control**，自定义二进制协议；control socket 双向（输入下行 + 剪贴板上行）。
- **DeviceFarmer / STF**：**minicap** 负责屏幕流（30–40 FPS）、**minitouch** 负责多点触控注入、minirev 做反向端口转发，前端浏览器 + Node.js。同样是"投屏一条路、注入一条路"。

**启示**：低频命令（点坐标、装 App、授权）和高频视频流应走**不同传输**。命令通道对可靠性/顺序敏感、带宽极小；视频流对带宽/延迟敏感、可丢帧。混在一个通道里两头都不讨好。

### 4.2 三种系统拓扑

| 形态 | 说明 | 优势 | 取舍 |
|------|------|------|------|
| **(a) 中心-边缘（自建）** | 每台设备旁挂 PC / Mac mini / 树莓派跑 adb / WDA，边缘机订阅中心指令、本地执行、回传流 | 设备在手、自由度高、可长驻自建 agent | 要自己管边缘机和 USB；**设备与边缘机需 USB 直连或同局域网**（中心只发指令，不必与设备同网） |
| (b) 云真机平台 API | Sauce Labs Real Device Access / BrowserStack / AWS Device Farm，WebSocket 隧道跑原生 adb / xcrun | 免运维、免签名、免 Mac 集群 | 设备不在手里、原生注入自由度受限、难长驻自建进程、按并发/分钟计费 |
| (c) Appium Grid / appium-device-farm | 多设备并发调度标准协议 | 标准化、适合测试编排 | 长驻"生产 agent"不如自建边缘机灵活 |

**规模化普遍选 (a)**：iOS 农场因为签名 + 低延迟投屏都要 Mac，边缘机往往就是 Mac mini；安卓边缘机可以是廉价 x86 或树莓派。

### 4.3 网页层与原生层协同的通用模式

当一个系统**同时有**网页层自动化（页面内 agent）和原生层控制时，业界常见的协同是：

- **网页层主导，原生层兜底**：绝大多数操作由页面内 agent 精准完成（按 DOM 语义），只有遇到系统弹窗 / 装切 App / 页面崩溃时才移交原生层。
- **移交信号**：网页层无法处理时发出信号（如"检测到 getUserMedia 弹窗但点不掉"），由原生层执行 `pm grant`（安卓）或 WDA `acceptAlert`（iOS）。
- **能力标记**：设备清单区分"仅网页层"和"网页+原生"两类，调度时据此决定哪些流程能在哪些设备上跑。

---

## 5. 用 Python 脚本驱动

> **概念澄清**：这里指 Python 解释器跑在**控制机 / 边缘机（PC / Mac / Linux）**上，通过 adb（安卓）或 USB 隧道 + WebDriverAgent（iOS）**遥控**真机。**手机本体不运行 Python** —— 所有库本质是"PC 端 Python ↔ 设备端 agent/server"的客户端。因此所有方案都**需要电脑常驻**（host 进程 + USB/局域网连接），群控即"一台机器接多部真机"。

**结论：安卓和 iOS 都能全流程 Python 脚本化**（装包 / 授权 / 元素定位 / 坐标 / 截图 / 文件）。安卓成熟度很高；iOS 也可全流程，但**触摸注入永远绕不开 WDA**，且 iOS 17+ 还要先用 Python 起隧道，链路更长、更依赖 macOS。

### 5.1 安卓 Python 库

| 库 | 版本/状态 | 原理 | 特点 |
|----|-----------|------|------|
| **Appium-Python-Client**（官方） | v5.3.1（2026-04，Apache-2.0，活跃） | Appium Server + UiAutomator2 的 Python 客户端 | 元素/坐标定位，`autoGrantPermissions` 自动授权；**重**（要 Node + Server 常驻），但跨语言、云测生态最全 |
| **openatx/uiautomator2 (u2)** | v3.2.9（活跃，~8k★，中文社区主力） | 设备装 uiautomator server，PC 经 HTTP + adb forward 直连（3.x 已去掉 atx-agent 守护） | 纯 Python、**启动快、比 Appium 轻**，适合快速脚本与群控 |
| **openatx/adbutils** | v2.12.0（2025-11，活跃，Apache-2.0） | 纯 Python 直连 adb server | 装卸包/截图/input/文件/shell，是 u2 的底层依赖，**推荐** |
| **pure-python-adb / ppadb** | 0.3.0.dev0（2020，**停更**） | 纯 Python adb | 仅历史项目沿用，新项目改用 adbutils |
| **Airtest + Poco（网易）** | Airtest 1.3.x（活跃，Apache-2.0） | **Airtest 图像识别（模板匹配）** + Poco UI 树定位 | 跨 Android/iOS，**图片按钮/无 UI 树/游戏自绘界面的杀手锏**；配 AirtestIDE 可视化录制；支持多设备并发 |
| **py-scrcpy-client**（leng-yue） | 对齐 scrcpy server 1.20（成熟度中等） | Python 取 H.264 投屏帧 + 注入触摸/按键 | 本地延迟 <100ms，做**投屏 + 控制**，不做元素定位；更新偏慢 |

### 5.2 iOS Python 库

| 库 | 版本/状态 | 作用 | 备注 |
|----|-----------|------|------|
| **pymobiledevice3**（doronz88） | 活跃，iOS 17+ 核心底座 | 装卸包/截图/syslog/文件、**iOS 17+ 信任隧道（RemoteXPC/CoreDevice，`tunneld` 常驻）** | **本身不做触摸注入** —— 点击/滑动仍要把坐标转发给 WDA |
| **openatx/facebook-wda** | 活跃（2026-01 仍更新） | 通过设备上的 WDA 做点击/输入/截图/滑动/处理弹窗、元素定位 | 只负责"发指令"，WDA 的启动与端口转发需另配 |
| **openatx/tidevice** | **不做 iOS 17**，转 tidevice3（0.11.3，2024-05，iOS17 仅 macOS） | 曾经的装包/起 WDA/截图主力 | **已被 pymobiledevice3 / tidevice3 / go-ios 取代**，新项目别用旧 tidevice 上 iOS 17+ |
| **Airtest（iOS）** | 活跃 | 图像识别可用 | 依赖设备上 WDA + iproxy 端口转发；iOS 元素树支持弱于安卓，触摸同样经 WDA |

> **iOS 17+ 的 Python 标准组合 = pymobiledevice3（隧道 + 装包）+ facebook-wda（触摸）**。跨平台但非 Python 的 **go-ios（Go）** 常被当作 iOS 后端补充。

### 5.3 Python vs 其它编程方式

| 方式 | 元素语义 | 轻重 | 取舍 |
|------|----------|------|------|
| **Appium（多语言）** | ✅ | 重（Node + Server） | 跨语言、云测生态最全 |
| **u2 / adbutils / facebook-wda（纯 Python）** | ✅（u2/wda） | 轻、启动快 | 适合群控；功能更"手工"、需自己拼装 |
| **纯 CLI（adb / scrcpy）** | ❌ 无元素语义 | 最轻 | 只有坐标，跨机型脆弱 |
| **Airtest（Python + 图像识别）** | 图像匹配 | 中 | 无 UI 树 / 图片按钮 / 游戏的最佳选择 |

**中文团队群控/农场的主流 Python 组合**：安卓 = **adbutils + uiautomator2（+ scrcpy 投屏）**，或游戏场景 **Airtest + Poco**；iOS = **pymobiledevice3 + facebook-wda**（iOS 17+）。跨端统一层多用 **Airtest**。

---

## 6. 规模化与稳定性坑（通用）

| 问题 | 表现 | 应对 |
|------|------|------|
| **USB 稳定性（安卓瓶颈）** | 超 ~20 台 USB 开始不稳，普通主板 9–12 台就可能出问题 | 工业级**独立供电** USB hub；Intel 平台 BIOS 关 USB 3.0；或 PCIe 扩展卡；再多则**横向扩机** |
| **ADB 断连** | daemon 掉线 | `adb reconnect` / 重启 adb server；大规模用 adb over TCP + 心跳自愈 |
| **WDA 崩溃（iOS）** | 常在 120s 超时内起不来、会话中断、Appium 不自动恢复 | 自管 WDA 生命周期，跑几个用例就重启 WDA；卡死则删 WebDriverAgentRunner + 重启设备 |
| **设备息屏** | 锁屏后无法操作 | `svc power stayon` 保持常亮 + 禁锁屏 |
| **多设备并发** | 拖垮性能 | 每设备独立 Appium/WDA 端口 + 资源隔离 |
| **无线降 USB 压力** | — | scrcpy `--tcpip` 免线缆，牺牲部分稳定性 |

---

## 7. 选型决策树

```
需要控制真机？
├─ 只需操作页面内 DOM（不碰系统弹窗/装切 App）
│   └─ 不必上原生层，网页层自动化即可
│
├─ 安卓
│   ├─ 实时人肉遥控单台 …………… scrcpy v4.0
│   ├─ 群控 / 多台同步操作 ……… QtScrcpy
│   ├─ 脚本化自动跑流程 + 自动授权 … Appium UiAutomator2 + pm grant
│   └─ 要网页版设备墙 ……………… GADS（优先于半死的 STF）
│      → 单机 USB 上限约 15–20 台，全部免 root
│
└─ iOS
    ├─ 现代机型（A12+，绝大多数）… 非越狱 + 每台签名 WDA（Appium XCUITest）
    │   → 强制 Mac + 证书轮换 + 不能模拟，成本高，单独立项/预算
    ├─ 只有 A11 及更早老机 ………… palera1n 越狱（但要关密码锁、丢 Face ID，不推荐规模化）
    └─ 不想自建 …………………… 云真机平台（BrowserStack / Sauce），按量付费
```

**总体建议**：安卓路线便宜、快、免 root、覆盖大部分设备，应作首选与主力；iOS 成本结构（Mac + 证书 + 无法模拟）与安卓完全不是一个量级，若确需覆盖 iOS，应作为独立项目单独评估预算。

---

## 附：来源

**安卓**：scrcpy(github.com/Genymobile/scrcpy) · QtScrcpy(github.com/barry-ran/QtScrcpy) · appium-uiautomator2-driver releases · ADBKeyBoard(github.com/senzhk/ADBKeyBoard) · DeviceFarmer/stf · GADS(github.com/shamanec/GADS) · appium issue #17169/#17877
**iOS**：appium-xcuitest-driver + WebDriverAgent(github.com/appium/…) · go-ios(github.com/danielpaulus/go-ios) · pymobiledevice3(github.com/doronz88/pymobiledevice3) · pymobiledevice3 ios17-tunnels 指南 · palera1n(github.com/palera1n/palera1n)
**权限/架构**：Android `PermissionRequest`(developer.android.com) · Chromium android_webview commandline-flags.md · BrowserStack/TestingBot 权限弹窗文档 · scrcpy develop.md（video/control 协议）· DeviceFarmer/STF 架构 · Sauce Labs Real Device Access API · appium issue #21643（WDA 稳定性）
**Python 库**：Appium-Python-Client(pypi.org/project/Appium-Python-Client) · uiautomator2 + adbutils(github.com/openatx) · pure-python-adb(pypi，停更) · Airtest + Poco(github.com/AirtestProject) · py-scrcpy-client(github.com/leng-yue/py-scrcpy-client) · facebook-wda(github.com/openatx/facebook-wda) · tidevice/tidevice3(github.com/alibaba/tidevice) · pymobiledevice3(github.com/doronz88/pymobiledevice3)
