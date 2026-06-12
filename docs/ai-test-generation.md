# AI 生成测试用例 — 提示词模板

## 使用方式

将以下提示词复制给 AI（Claude / ChatGPT），并附上相关文档内容，AI 会生成符合框架格式的测试用例 JSON。

---

## 提示词模板

```
你是一个自动化测试专家。请根据以下信息，生成符合我们测试框架格式的测试用例 JSON。

## 测试框架格式规范

测试用例格式如下：

interface TestCase {
  name: string;                          // 用例名称
  description?: string;                  // 描述
  tags?: string[];                       // 标签: smoke, regression, stage1...
  variables?: Record<string, string>;    // 变量，支持 {{random:prefix_}}, {{timestamp}}
  setup?: TestAction[];                  // 前置操作
  steps: TestAction[];                   // 测试步骤
  teardown?: TestAction[];               // 清理操作
  teardownOnFail?: boolean;              // 失败时是否清理（默认 true）
}

TestAction 支持以下 action 类型：

1. 页面操作：
   - click: 点击元素
     { "action": "click", "locators": [{ "type": "text", "value": "按钮文案" }], "tag": "button" }
   - input: 输入文字
     { "action": "input", "locators": [{ "type": "placeholder", "value": "placeholder文案" }], "tag": "input", "value": "输入值" }
   - select: 选择下拉选项
     { "action": "select", "locators": [{ "type": "inputAttr", "value": "select[name=\"xxx\"]" }], "tag": "select", "value": "选项值" }
   - navigate: 页面跳转
     { "action": "navigate", "url": "/path" }
   - scroll: 滚动页面
     { "action": "scroll", "scrollX": 0, "scrollY": 500 }
   - wait: 等待
     { "action": "wait", "delay": 2000 }

2. 断言：
   - URL 断言:
     { "action": "assert", "assertType": "url", "expected": "/expected-path" }
   - 文案存在:
     { "action": "assert", "assertType": "textExists", "expected": "期望存在的文字" }
   - 文案不存在:
     { "action": "assert", "assertType": "textNotExists", "expected": "不应出现的文字" }
   - 元素存在:
     { "action": "assert", "assertType": "elementExists", "locators": [{ "type": "id", "value": "#element-id" }] }
   - 埋点触发:
     { "action": "assert", "assertType": "eventFired", "sdk": "rangers", "event": "事件名" }
   - 埋点参数:
     { "action": "assert", "assertType": "eventParams", "sdk": "rangers", "event": "事件名", "key": "参数名", "expected": "期望值" }
   - localStorage:
     { "action": "assert", "assertType": "localStorage", "key": "键名", "expected": "期望值" }

3. 内置函数调用：
   - { "action": "call", "fn": "deleteAccount" }        — 注销账号
   - { "action": "call", "fn": "clearLocalStorage" }     — 清除 localStorage
   - { "action": "call", "fn": "resetState" }            — 综合清理

4. Locator 类型（按优先级）：
   - id: CSS ID 选择器，如 "#login-btn"
   - testid: data-testid 属性值
   - aria: aria-label 属性值
   - text: 元素文案内容（可点击元素优先使用）
   - placeholder: 输入框 placeholder
   - inputAttr: input/select 属性组合，如 "input[name=\"email\"]"
   - css: CSS 选择器路径（最后使用）

## 埋点文档

[在这里粘贴埋点文档内容，包括事件名、触发时机、参数说明]

## 需要测试的功能

[在这里描述要测试的功能，例如：]
- 功能名称：xxx
- 操作路径：用户从哪个页面开始，经过哪些步骤
- 预期结果：每步操作后应该看到什么
- 需要验证的埋点：哪些事件应该被触发
- 测试数据：使用什么样的测试数据

## 要求

1. 生成完整的 JSON 测试用例，可以直接保存为 .json 文件使用
2. 每步关键操作后添加适当的断言（功能断言 + 埋点断言）
3. 包含 setup（前置清理）和 teardown（后置清理）
4. 变量使用 {{variable}} 格式，支持 {{random:prefix_}} 生成随机值
5. locators 优先使用 text 和 placeholder 类型（比 CSS 选择器更稳定）
6. 输出格式为 JSON，不需要额外解释
```

---

## 使用示例

### 示例 1：根据 PRD 生成

将提示词 + 埋点文档 + PRD 需求描述一起发给 AI：

```
[提示词模板]

## 埋点文档
- register_complete: 注册完成时触发，参数 { method: "quick"|"google", username: string }
- onboarding_step: 每步 onboarding 完成触发，参数 { step: number, name: string }
- first_cashout: 首次提现触发，参数 { amount: number, method: "paypal" }

## 需要测试的功能
新用户注册流程：
1. 打开登录页 /login
2. 点击 Quick Login 按钮
3. 进入 onboarding 页面，依次填写用户名、年龄、上传头像、填手机号
4. 完成注册后跳转到首页
5. 验证首页显示了欢迎文案和用户名
6. 验证注册相关的埋点全部触发
```

### 示例 2：根据代码改动生成

```
[提示词模板]

## 埋点文档
[粘贴埋点文档]

## 需要测试的功能
本次代码改动：
- 修改了提现流程，增加了 PayPal 邮箱验证步骤
- 在 /cashout 页面新增了邮箱输入框（placeholder: "Enter PayPal email"）
- 输入邮箱后需要点击 "Verify" 按钮
- 验证成功后 "Withdraw" 按钮变为可点击
- 新增埋点 paypal_verify_success

请生成覆盖该改动的测试用例，包括正常路径和边界情况（空邮箱、格式错误）
```

### 示例 3：根据 bug 报告生成

```
[提示词模板]

## 埋点文档
[粘贴埋点文档]

## 需要测试的功能
Bug 报告：用户在 Stage 2 完成任务后余额没有更新
- 复现路径：完成 Stage 2 的 mock call → 回到首页 → 余额仍显示旧值
- 修复方案：mock call 结束后增加了余额刷新 API 调用
- 需要验证：mock call 完成后余额正确更新，相关埋点正确触发
```

---

## 进阶用法

### 批量生成

如果有多个功能要测试，可以一次提供多个功能描述，要求 AI 生成 TestSuite 格式：

```
请生成一个完整的测试套件（TestSuite），包含以下测试用例：
1. 新用户注册流程
2. Stage 1 提现流程
3. 聊天发送消息
4. Mock 通话完成

输出格式：
{
  "name": "Smoke Test Suite",
  "globalSetup": [...],
  "cases": [...]
  "globalTeardown": [...]
}
```

### 迭代优化

生成后如果需要调整，可以追加指令：

- "给每个 click 步骤后都加上 URL 断言"
- "增加聊天列表页的埋点验证"
- "把 setup 改为使用 Quick Login 而不是 deleteAccount"
- "添加网络异常情况的测试用例"
