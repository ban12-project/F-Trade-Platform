# MVP1 验收检查点 — 2026-09-23

关联 #32。初次核对源版本 `d9af21c164ca3de7edfddb7bf85dc1cec7c5ce72`；同日增补核对已合并 #422 及 #424 的 `6dfb0dc`，结论为 **pending**。本记录区分当前执行、既有证据和仍需验收的项目，不作人工 Go/No-Go 决定。

## 当前执行与交付

- `pnpm demo:synthetic`、`pnpm test:demo`、`pnpm test:mvp-acceptance` 均通过。合成链路到达 PRODUCT_READY、CONTENT_PUBLISHED、VIDEO_APPROVED、RFQ_READY、QUOTE_SENT、OPPORTUNITY 和 DELIVERY_CONFIRMATION_CONFIRMED；包含三个模拟人工 Gate、入站去重及签名发布结果。它不证明真实资料、实际投递或真实人工审批。
- PIN 修复 #420 已 squash 合并，全部 PR 检查通过。Camoufox 152.0.4-beta.30 配合固定 camofox-browser 在本地 Podman 经代理运行：默认配置卡在 PIN 验证；设置 `network.http.http2.websockets=false` 后成功进入 Messenger Chats，再用实际项目插件重启复测也成功。后续只读快照仍显示 Chats、没有 PIN 验证窗口。
- AMD64 与 ARM64 镜像 smoke test 均实际启动 Firefox 并检查 prefs.js 中该设置为 false。主分支镜像发布工作流 `35816270756` 已完成并成功；生产运行时切换仍待确认，不能以镜像发布替代部署验收。
- #420 最初继承了无关分支提交，已在合并前整理为仅五个修复文件。最终提交的首轮 Playwright 在工作台键盘打开弹窗断言失败，196 项通过；未改代码，重跑失败任务后全部通过。保留首次失败，不声称已修复其偶发原因。

PIN 兼容配置有 Mozilla [Bug 2055521](https://bugzilla.mozilla.org/show_bug.cgi?id=2055521) 的绕过记录和 [Bug 2037813](https://bugzilla.mozilla.org/show_bug.cgi?id=2037813) 的代理 HTTP/2 WebSocket 请求头修复依据。后者在 Firefox 154 修复。当前证据支持采用兼容配置，无需为本次 PIN 问题 fork 内核；跨重启 WebCrypto 密钥持久化仍由 #414 跟踪。

## 自动登录及存储补充证据

- #424 已完成密码、Base32 TOTP 和 PIN 的加密保存及本地自动执行。真实已登录会话经正式本地 broker、单次凭据领取和 PIN 恢复取得持久 ready；独立数据库查询确认运行 completed，旧失败回执仍保留。完整边界见 [本地自动登录报告](facebook-automatic-pin-local-20260923.md)。
- 原运行 CAPTCHA 人工交接已实现，并通过合成执行器、数据库及实际 UI 回归。全新真实会话在一次授权内完成所有验证仍待验收，PR 保持 draft；生产工作台随后已完成登录，最新只读核对见下文。
- #414 的合成实验已验证 Camoufox 152.0.4-beta.30 在写入容器退出并删除后，通过同一持久化卷在新容器恢复不可导出的 CryptoKey，并成功加解密。该实验使用禁网容器和虚构站点，不含真实账号。它不证明 Messenger 使用同类密钥，也不证明历史消息或被动 DM 恢复。
- 当前固定上游 `79d425be26743883a06613eaa3be5e38e7ab5409` 的 `server.js` 仍在 `session:creating` 钩子后固定调用 `newContext(contextOptions)`；持久化插件只注入 storageState。启用 IndexedDB 或修改目录配置无法实现原生 profile 生命周期，需要独立修改会话创建及关闭契约，并验证账号隔离、租约回收和回滚。生产配置未改变。

## 尚未达到整体验收的项目

| 范围 | 已有证据及边界 | 后续验收 |
| --- | --- | --- |
| 产品识别与事实来源 | 旧 [300 次模型比较](product-agent-model-selection-20260922.md)失败记录保留；#422 已合并，修复后的 [Kimi K3 独立合成回归](product-component-oe-regression-20260923.md)为 20 场景 × 3 次，60/60 首次通过 | 真实工厂资料留出集及 #6 授权仍待完成；合成回归不能替代真实资料验收 |
| 内容与视频制作 | [9 月 18 日生产受控补测](mvp1-production-content-video-20260918.md)通过，但临时云素材和成片已删除 | 发布前必须有当前可访问、有权利证据且已审核的素材和成片 |
| 应用文字发布回执 | 当前生产详情显示“已发布（人工核对）”，注明节点所有者已核对实际帖子；节点运行的原始 unknown 仍保留 | 人工核对已落库；本次仅核对应用展示，没有再次访问原帖，不能将其作为自动观察回执成功的证据 |
| 发布自动唤醒 | #386/#408 已实现并通过合成并发与权限测试 | 真实合格任务唤醒停止节点、执行同一 job 并产生持久结果 |
| 应用视频发布 | 最近生产范围为 text only，手动视频帖不能替代应用队列验收 | 核验私有页面契约、附件、身份、受众和逐帖确认后的应用回执 |
| 被动 DM → RFQ | 本地 PIN 可进入空 Chats；最新生产只读接口确认 pollSeconds=0，节点仅有 interactive/publish 能力，账号 needs_login，尚无收件箱检查 | 核验当前配置、授权用户主动入站消息、去重、持久化和 RFQ 关联；空收件箱不能算通过 |
| 报价、交期、跟单 | 合成链路及既有模拟销售批次通过 | 正式报价、交期及最终 Go/No-Go 仍须相应人工负责人确认 |

## 生产证据限制

用户完成工作台登录后，本地 Camofox 已访问生产工作台。发布详情与带所有者认证的只读 browserNodesAction 分别确认：一条发布已人工核对为成功，原发布运行仍为 unknown；账号 needs_login、收件箱轮询为 0，节点仅声明 interactive/publish 能力。节点生命周期记录为 stopped，页面明确该记录并非云端实时状态，本次没有唤醒节点验证。

旧版 Facebook 单账号管理页显示“无法读取账号状态”，其“凭据未保存”占位不能作为实际凭据缺失的证据；节点管理页及接口确认登录和代理凭据已保存。错误的具体原因尚未确定，不推断为密码失败或数据丢失。此接口不暴露发布类型契约，先前 text-only 范围尚未获得新的独立确认。

本次只读取现有记录，没有执行人工核对写入、恢复渠道、确认登录有效、重试发布或排队打开生产浏览器。生产访问阻塞已解除；真实自动登录、自动发布回执、自动唤醒、应用视频与被动 DM 的剩余验收仍分别开放。

本次没有新增 Facebook 帖子、DM、报价、真实产品批准或生产数据库写入。账号、PIN、凭据、原始聊天、私有帖子链接与截图均不进入本报告。MVP1 保持待验收。
