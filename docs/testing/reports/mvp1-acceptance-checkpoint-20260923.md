# MVP1 验收检查点 — 2026-09-23

关联 #32。核对源版本 `d9af21c164ca3de7edfddb7bf85dc1cec7c5ce72`，结论为 **pending**。本记录区分当前执行、既有证据和仍需验收的项目，不作人工 Go/No-Go 决定。

## 当前执行与交付

- `pnpm demo:synthetic`、`pnpm test:demo`、`pnpm test:mvp-acceptance` 均通过。合成链路到达 PRODUCT_READY、CONTENT_PUBLISHED、VIDEO_APPROVED、RFQ_READY、QUOTE_SENT、OPPORTUNITY 和 DELIVERY_CONFIRMATION_CONFIRMED；包含三个模拟人工 Gate、入站去重及签名发布结果。它不证明真实资料、实际投递或真实人工审批。
- PIN 修复 #420 已 squash 合并，全部 PR 检查通过。Camoufox 152.0.4-beta.30 配合固定 camofox-browser 在本地 Podman 经代理运行：默认配置卡在 PIN 验证；设置 `network.http.http2.websockets=false` 后成功进入 Messenger Chats，再用实际项目插件重启复测也成功。后续只读快照仍显示 Chats、没有 PIN 验证窗口。
- AMD64 与 ARM64 镜像 smoke test 均实际启动 Firefox 并检查 prefs.js 中该设置为 false。主分支镜像发布与生产运行时切换是后续独立步骤，不能以 PR 镜像测试替代部署验收。
- #420 最初继承了无关分支提交，已在合并前整理为仅五个修复文件。最终提交的首轮 Playwright 在工作台键盘打开弹窗断言失败，196 项通过；未改代码，重跑失败任务后全部通过。保留首次失败，不声称已修复其偶发原因。

PIN 兼容配置有 Mozilla [Bug 2055521](https://bugzilla.mozilla.org/show_bug.cgi?id=2055521) 的绕过记录和 [Bug 2037813](https://bugzilla.mozilla.org/show_bug.cgi?id=2037813) 的代理 HTTP/2 WebSocket 请求头修复依据。后者在 Firefox 154 修复。当前证据支持采用兼容配置，无需为本次 PIN 问题 fork 内核；跨重启 WebCrypto 密钥持久化仍由 #414 跟踪。

## 尚未达到整体验收的项目

| 范围 | 已有证据及边界 | 后续验收 |
| --- | --- | --- |
| 产品识别与事实来源 | [最新 300 次模型比较](product-agent-model-selection-20260922.md)中所有候选均未达到 60/60；组件 OE 提升为整件 OE 的错误尝试被生产来源校验拒绝 | #392/#268：保持冻结失败结果，修复后独立新批次；真实工厂资料留出集及 #6 授权不能由模型代替 |
| 内容与视频制作 | [9 月 18 日生产受控补测](mvp1-production-content-video-20260918.md)通过，但临时云素材和成片已删除 | 发布前必须有当前可访问、有权利证据且已审核的素材和成片 |
| 应用文字发布回执 | #383 最后记录为一条 unknown，#409 已提供带人工来源的核对入口 | 核对生产当前状态及原帖；保留原始回执、不重复发布，不把人工核对冒充平台观察 |
| 发布自动唤醒 | #386/#408 已实现并通过合成并发与权限测试 | 真实合格任务唤醒停止节点、执行同一 job 并产生持久结果 |
| 应用视频发布 | 最近生产范围为 text only，手动视频帖不能替代应用队列验收 | 核验私有页面契约、附件、身份、受众和逐帖确认后的应用回执 |
| 被动 DM → RFQ | 本地 PIN 可进入空 Chats；此前生产 inbox disabled | 核验当前配置、授权用户主动入站消息、去重、持久化和 RFQ 关联；空收件箱不能算通过 |
| 报价、交期、跟单 | 合成链路及既有模拟销售批次通过 | 正式报价、交期及最终 Go/No-Go 仍须相应人工负责人确认 |

## 生产证据限制

本次未取得新的生产回执或渠道状态：桌面浏览器连接工具返回认证方式不支持；旧临时数据库配置不可用。已提出使用本地 Camofox 登录生产工作台的访问方案，等待用户完成登录。不能把旧报告状态当作当前生产查询结果。

本次没有新增 Facebook 帖子、DM、报价、真实产品批准或生产数据库写入。账号、PIN、凭据、原始聊天、私有帖子链接与截图均不进入本报告。MVP1 保持待验收。
