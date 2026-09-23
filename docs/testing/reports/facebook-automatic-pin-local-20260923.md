# 本地 Messenger 自动 PIN 恢复验证（2026-09-23）

关联 #423 / PR #424。首轮验证代码提交 `4972d83`，后续修订及验证边界见各节。

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


## CAPTCHA 根因定位与人工验证后恢复（同日）

对之前拒绝运行的持久化会话进行只读复查，没有再次提交密码。新增私有网络诊断仅记录请求主机、路径、类型及开始/结束，不记录查询参数、正文、凭据或验证码。观察到 `www.fbsbx.com/captcha/recaptcha/iframe/` 与 Google reCAPTCHA Enterprise 资源全部完成；截图实际显示 Meta 页面和 “I'm not a robot” 控件。顶层可访问性快照只给出图片和 iframe，不能据此认定页面为空或网络仍在加载。

用户手动完成人机验证后，同一会话进入真实验证器页面。使用已保存密钥生成 TOTP 并单次提交，Facebook 随后显示已登录/信任设备提示；没有选择信任设备。继续自动导航 Messenger、单次提交已保存 PIN，最终运行模块返回 `ready`，且 `identityVerified=true`、`messengerRestored=true`。

修订包括：仅在审核的 pre-authentication 地址检查可见的嵌套 Facebook CAPTCHA frame，将其标为 checkpoint；检查所有祖先 frame 的可见性，隐藏容器不算交互挑战。验证码页面外不扫描 CAPTCHA frame。验证码表单和登录身份异步加载时允许最多 20 次、每次至多 500ms 的只读观察，仍受整体截止时间限制；错误站点或账号立即拒绝。观察器发生未知错误时保留 unknown，不错误降为已明确拒绝。19 项浏览器测试、流程状态机测试、27 项节点测试及固定 Camofox 插件装载/鉴权检查通过。

此次人工验证后的续跑包含开发调试与浏览器重启，使用私有短期运行许可，没有形成同一次正式 broker 授权的连续成功回执。它证明 CAPTCHA 完成后 TOTP/PIN 自动执行可恢复至真实 Messenger ready；**人工验证交接、恢复正式平台运行与 durable ready 回执的整体链路仍待验收**。不能把此前的 unknown 改写为成功，也不能宣称 CAPTCHA 可自动完成。没有发送消息或发布内容。


## 平台续跑的时间预算与挑战回执（同日）

使用同一已登录会话及正式 broker/执行器继续检查。复用本地测试夹具时先修复了安装标识与此前清理掉的原账号绑定；这些都是隔离数据库中的测试准备，不是对生产记录的修复，也不算业务验收。

一次可观察运行中，自动授权签发于 07:50:46 UTC，凭据领取于 07:51:01 UTC，授权截止 07:52:16 UTC。页面在 07:52:08 UTC 才出现 PIN，余下约 8 秒；提交前的固定出口复核随后耗时约 16 秒，插件拒绝了已经过期的 PIN 请求，broker 保持 needs_login。页面始终 visible 且有焦点，不能归因于后台标签节流。该结果没有算作成功，也没有改写旧回执。

修订将自动流程的绝对窗口设为最多 180 秒，仍保留独立续租的 90 秒容器租约、每次操作的租约检查及页面执行截止限制；旧版人工填充仍为 30 秒。新增测试确认超出 180 秒的请求、失效租约、过期授权的 ready 回执均被拒绝，续租后的有效操作可以继续。界面的等待判定也改用自动流程窗口，避免仍按人工填充 30 秒过早显示 unknown。

另外，正式登录回执可携带有限的人工处理原因，界面区分人机/设备验证、凭据拒绝和不支持的验证方式。自由文本原因、非拒绝结果携带挑战、冲突重放均被拒绝；原因不会自动授权重试。迁移 PostgreSQL 集成回归、执行器挑战回执和租约边界浏览器回归通过。新 180 秒窗口的真实完整 ready 回执仍待复测。

本地 UI 首次验证在等待内容时超时，随后复测遇到开发服务连接拒绝；已确认旧开发进程退出后重启。保留这些失败，不能把服务重启当作 UI 已通过的证据。

开发服务重启后的定向 UI 复测通过，确认未知结果文案及人工验证原因可通过实际页面的状态轮询显示，页面不包含凭据。该次本地配置将断言等待上限提高到 30 秒以应对调试环境延迟；不将其作为 UI 性能验收。

180 秒窗口的首次真实复测在出口探测页创建阶段失败，当时尚未领取登录凭据，未提交任何验证因素。它不能用于证明新窗口有效；后续须在出口恢复后重新验证完整回执。


## 冷启动就绪检查（同日）

出口页失败后，日志明确记录创建标签页请求在 30000ms 超时；随后的只读标签列表却发现同一次请求创建的出口页。固定上游使用 Promise.race 返回超时，后台创建没有同步取消。节点此前只等待 HTTP 服务响应，可能在 Firefox 预启动完成前发出第一个导航。

节点现读取实际健康状态，只有 engine=camoufox、browserRunning=true、browserConnected=true 且 ok=true 时才开始首次导航；每次等待前后复核租约和停止状态，最多 60 次。新回归覆盖未连接、未运行、等待中租约失效及持续未就绪；28 项节点测试通过。私有真实续跑改用该正式检查后，已通过出口检查并领取一次凭据进入 Messenger；最终回执需等待本轮结果。


## 正式 broker 续跑及持久化 ready 通过（同日）

采用 180 秒自动窗口及 Firefox 预启动检查后，本地真实运行通过：`messenger` → 单次导航 → `loading` → `pin` → 单次 PIN `submitted` → `ready`。执行器报告 `claims=1`、`receipts=1`；broker 的账号状态和保存的授权结果均为 ready。该运行复用了前面已完成人工 CAPTCHA、密码与 TOTP 的同一账号浏览器资料，没有重放密码或 TOTP，没有发送消息。

执行进程结束后，通过另一个 PostgreSQL 连接独立复核：运行 completed、账号 ready、授权回执 ready、原账号/渠道绑定唯一、加密登录数据存在且节点文档没有密码或 TOTP 明文。此前 3 条 refused/unknown 登录回执仍保留。Camofox 健康检查显示 activeTabs=0、activeSessions=0，说明该次浏览器会话已关闭。

这证明正式本地 HTTP broker、一次性加密凭据领取、节点执行器、固定出口复核、插件 PIN 恢复及 durable ready 回执能够在同一新运行中闭环。它是**已登录会话续跑**的真实验收，不是全新匿名会话在一个授权内完成密码、TOTP、CAPTCHA 和 PIN 的证据。原运行中的人工验证交接/自动续跑、生产部署、非空收件箱、跨重启历史恢复、发布回执、自动唤醒与视频/DM 闭环仍分别待验收。


## 原运行人工验证交接实现与回归

新增受租约、账号绑定、凭据版本、一次性领取状态及授权截止时间约束的 `login-challenge` 回执。运行遇到 checkpoint 时通知工作台并在原 180 秒绝对窗口内等待；人工完成后继续原流程，既不延长授权也不重复领取或提交因素。自动任务执行期间，查看器断开不再提前回收容器；显式停止、撤销和过期检查保留。最终 ready/unknown 清除待处理挑战，拒绝结果保留处理原因。

验证通过：登录状态机回归、29 项节点测试、5 项空闲退出测试、2 项执行器浏览器测试、完整本地 PostgreSQL 回归及实际 Next.js 的状态轮询测试。数据库用例覆盖领取前、过期、凭据轮换、终态之后的挑战拒绝和幂等回执；执行器用例在一次授权内模拟人工完成 CAPTCHA 后继续 TOTP/PIN 至 ready。隔离校验目录的 TypeScript 检查通过；格式检查仅有既存 optional-chain 警告。

这些是实现与合成回归证据，尚未新增真实 CAPTCHA 在同一次正式授权内恢复的验收。此前真实已登录会话续跑的 ready 证据和各失败回执均保留。生产工作台登录待完成，生产状态尚未重新确认。
