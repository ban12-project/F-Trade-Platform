# 本地 Messenger 自动 PIN 恢复验证（2026-09-23）

关联 #423 / PR #424。验证代码提交 `4972d83`。

## 实际环境

本机 Podman 运行 Camoufox 152.0.4-beta.30、camofox-browser v1.16.0，使用原固定代理的本地连接链路，没有 Vercel Sandbox 中转。兼容插件设置 `network.http.http2.websockets=false`。复用用户已授权的现有账号会话。

私有诊断插件导入当前 `createAutomaticLoginRuntime`，将鉴权的本地 observe/submit 路由绑定到一个指定账号和运行。该测试没有经过生产 `register` 环境配置或平台 broker，不能算整条自动登录验收。密码、TOTP 和 ready 选择器在这份临时页面契约中故意不匹配，只验证已审核的 PIN 阶段。

## 观察与结果

1. Messenger 的 PIN 对话框没有原契约要求的可见数字账号链接。真实页面结构化 JSON 存在 `CurrentUserInitialData`，可以由代码解析而无需执行页面提供的脚本。
2. 新版运行模块核对页面的 USER_ID、ACCOUNT_ID，以及浏览器会话 Cookie，目标账号来自已保存的登录名；返回 `state=pin`、`originVerified=true`、`identityVerified=true`。
3. 经专用本地插件路由提交一次用户已授权的 PIN，返回 `outcome=submitted`。未使用通用 type/evaluate 路由输入 PIN。
4. 提交后独立只读观察：PIN 输入框数量为 0，PIN 对话框消失，没有 “Verifying your PIN”，页面显示 Chats、No chats，且存在一个 Thread list 导航区域。没有发送消息。

首次重启后的两次导航失败在代理目标连接阶段，日志为 `route_timeout` / `NS_ERROR_PROXY_BAD_GATEWAY`，当时未提交 PIN。随后同线路的出口查询站和 Facebook TCP 探测均成功，重新建立测试运行后得到上述结果。先前失败没有记为通过。

## 验收范围与未完成项

证据证明当前 PIN 运行模块能够在这次真实 Camofox 会话中验证目标身份并完成单次 PIN 恢复。它不证明完整密码→TOTP→PIN 自动登录、应用 `ready` 回执、生产部署、退出重启后的加密历史持久化或 DM→RFQ 已验收。

真实 ready 页面契约仍需审核：页面可能先显示外层 Messenger，再异步出现 PIN 窗口；不能只用 Messenger/Chats 标题或短暂没有对话框作为恢复成功依据。本次成功由提交后实际空会话列表观察确认，未让临时插件自动回报 ready。

私有测试配置尚缺 TOTP 长期密钥。真实凭据、账号 ID、Cookie、PIN、截图和页面原始数据均未纳入此报告或 Git。
