# sitin-pwa-automation

PWA 自动化油猴脚本：一键注销账号 → 重新注册 → 第一笔提现。

## 安装使用

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 在 Tampermonkey 中新建脚本，将 `src/auto-reregister.user.js` 的内容粘贴进去
3. 访问 PWA 页面（localhost / staging / production）
4. 右上角出现 **PWA AutoBot** 悬浮面板

## 功能说明

面板提供 6 个独立按钮和 1 个一键执行按钮：

| 步骤 | 按钮 | 操作 |
|------|------|------|
| 1 | 注销账号 | 跳转 Debug 页，自动点击删除账户 |
| 2 | 发送 OTP | 跳转手机登录页，填入手机号并发送验证码 |
| 3 | 等待登录 | 轮询 localStorage 等待 OTP 验证通过（需手动输入验证码） |
| 4 | 完成注册 | 自动填写 Username / Age / Photo 完成 Onboarding |
| 5 | 绑定 PayPal | 在 Cashout 页自动填入 PayPal 邮箱并提交 |
| 6 | 第一笔提现 | 触发 Stage 1 提现流程（$0.50） |

**一键执行**按钮会按顺序执行所有步骤，在第 3 步会等待用户手动输入 OTP 验证码。

## 配置

在面板顶部填写：
- **手机号**：美国号码（不含 +1 前缀），如 `2025551234`
- **用户名**：留空自动生成随机用户名
- **年龄**：默认 22
- **PayPal 邮箱**：用于绑定提现账号

## 注意事项

- OTP 验证码需要手动输入（无法自动化短信验证）
- Photo 步骤可能需要手动上传头像
- 确保已在 Debug 页面有删除账户权限
- 支持的域名：`pwa.aifantasy.com`、`pwa-staging.aifantasy.com`、`localhost`
