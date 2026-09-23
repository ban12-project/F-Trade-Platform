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

首轮未配置 ready 页面契约，只进行了提交后独立观察。随后完成下面的模块级就绪复测；平台回执仍未验收。

首轮测试时尚缺 TOTP 长期密钥，后续由用户补齐并完成下述验证。真实凭据、账号 ID、Cookie、PIN、截图和页面原始数据均未纳入此报告或 Git。


## 就绪判定复测（同日）

采用 `3be47b0` 基础上按精确文案过滤空列表元素的修订。真实列表内存在其他界面标签，因此先按审核文案匹配空状态，再检查唯一性及与会话项的冲突，不能把所有 span 都视为空状态。

重启本地浏览器后，私有测试程序调用当前模块反复观察，记录顺序为：`messenger` → `loading` → `pin` → 单次 `submitted` → `ready`。最终同时返回 `originVerified=true`、`identityVerified=true`、`messengerRestored=true`。PIN 窗口尚未恢复时没有回报 ready。

本次使用已审核的 Thread list 根节点与精确 No chats 空状态；未发送消息。存在会话的真实列表选择器尚未审核，临时配置将该分支禁用，不把本次空账号结果扩大为任意收件箱验收。就绪规则的合成浏览器回归覆盖加载壳、非匹配文案、对话框、空列表/会话冲突和已加载会话。

仍未通过生产注册路径、平台 broker/登录回执、真实密码及 TOTP 流程；生产配置尚未更新。


## 完整登录前半段检查（同日）

用户随后补齐私有 TOTP 密钥，已验证可在本地生成六位验证码，未输出密钥或验证码。释放旧活动会话后，用同一代理建立新的隔离浏览器会话，保留旧账号持久化资料。

真实密码页的提交控件是表单内 `div role="button" tabindex="0"`。代码增加该已观察结构的支持，并通过正常、禁用及表单外按钮拒绝回归。随后本地诊断装载器调用正式 `register`，配置真实账号/运行范围和本地租约文件；`/ftrade/login-status` 返回正确 v2 范围。通过正式 `/ftrade/login-submit` 路由单次提交已保存密码后，真实页面进入 “Go to your authentication app”。

2FA 页面包含每次登录变化的加密上下文 URL、无 name 的输入框和输入前禁用的 Continue 控件；现有静态页面契约尚不能正确执行这一阶段，未提交 TOTP。页面原始结构仅保存在忽略的本地私有文件。平台 broker 和完整端到端验收仍未完成。


## 真实 TOTP → Messenger → PIN → ready 复测（同日）

在上述已通过密码验证的会话中，审核了 Facebook 验证器页面并增加专用 `facebook-authenticator` 契约。使用正式 `/ftrade/login-observe`、`/ftrade/login-submit` 插件路由，顺序得到：

- `totp`：首次使用本地密钥生成当前验证码，单次提交返回 `submitted`。
- Facebook 显示 “You’re logged in. Trust this device?”；模块确认 `identityVerified=true`。没有选择信任设备。
- 通过模块的 Messenger 导航进入消息页，观察到加载中和 PIN 窗口。
- PIN 单次提交返回 `submitted`；随后 `state=ready`、`identityVerified=true`、`messengerRestored=true`。

观察阶段曾发现真实页面的 `URLSearchParams.keys()` 返回不可迭代对象；此时尚未提交验证码。改为 `forEach` 后通过，合成测试也覆盖这个行为。动态按钮测试还覆盖输入后启用、持续禁用及错误流程参数拒绝。密钥和验证码均未输出。

这些结果来自同一账号会话的分阶段开发调试，中途为更新模块重启了本地容器，并在各阶段使用新的短期请求。它们证明密码、TOTP、PIN 的真实页面步骤可执行，但不证明一次 `createSavedLoginExecutor` 调用、同一平台授权、同一租约和最终平台回执已全部连通。下一项验收应针对该完整链路，不再重复把各阶段通过记成端到端通过。


## 本地 broker 与执行器集成检查（同日）

新增本地私有验收程序，在隔离 PostgreSQL 中通过正式账号授权逻辑加密保存真实密码、TOTP 和 PIN，使用每次生成的私有加密密钥。程序调用正式 browser-nodes HTTP 处理器、一次性凭据领取、`createSavedLoginExecutor` 和正式 Camofox 插件路由，并核对浏览器会话出口。整个链路没有 Vercel Sandbox 中转。

首轮运行遇到容器重启后的服务启动窗口；当时尚未领取凭据。补充服务就绪探测后，broker 成功自动授予一次性授权，每轮仅一次 claim 和一次结果回执；拒绝时保持 `needs_login`，保存的节点文档不含凭据明文。

真实密码提交后的快速观察发现 `/two_step_verification/authentication/`、`flow=pre_authentication` 中间页，仅有图片和 iframe。旧观察器将其判为 invalid 并停止。现仅在已审核的验证器模式、确切路径和受限查询参数下将此地址视为 loading；仍受执行器租约、授权截止时间和观察次数上限限制，不能在中间页提交验证码或回报就绪。新增浏览器回归覆盖中间页等待、提交拒绝和错误 flow 拒绝；18 项页面及执行器测试通过。

修订后再次执行同一授权范围的完整流程，得到 `password` → 单次密码 `submitted` → `loading`，随后授权窗口内未进入验证码页，结果为 `unknown`。broker 记录一次 claim、一次结果回执，账号仍为 `needs_login`，未错误标记 ready。本轮诊断未记录代理连接错误；请求日志有 Facebook/Instagram 的 `NS_BINDING_ABORTED`，不足以判断根因。不得据此宣称 TOTP 错误或代理正常无疑，也不应自动重放密码。

当前结论：真实分阶段密码、TOTP、PIN 可用；本地完整自动登录仍受 pre-authentication 中间页停留影响，尚未通过。生产部署、真实非空收件箱、跨重启历史恢复及 DM→RFQ 仍不在已验收范围。
