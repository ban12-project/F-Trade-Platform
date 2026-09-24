# MVP1 真实账号发布与入站验收

本手册针对同一账号的 Vercel Sandbox、持久 Firefox profile 和固定浏览器代理。当前证据见 [生产会话检查点](../../docs/testing/reports/mvp1-production-session-checkpoint-20260924.md)。本地 Podman 的合成回归是开发检查，不代替 Sandbox 中同一镜像、账号卷与代理的生产观察。任何验收都不新建干净 profile，不因 CAPTCHA 循环登录，也不把人工核对的旧帖当作自动回执成功。

## 每次运行的共同前置检查

1. 在工作台确认账号绑定、出口 IP、`登录已就绪`、节点执行能力、渠道状态和当前页面审核期限。核对 Sandbox 中同一账号卷的 `native-profile.enabled`、浏览器／Agent 镜像和私有 manifest；先保留可回退快照。不要把凭据、PIN、Cookie、私有页面规则或 DM 正文写入仓库、Issue、PR、日志或截图。
2. 从已停止的 Sandbox 开始，让本项任务先完成只读预检：出口必须与审核 IP 一致，Facebook 当前身份与账号绑定一致；DM 检查还必须看到 Messenger `ready` 且恢复完成。若出现明确的密码／TOTP／PIN 恢复页，再走经复核的 version 2 交互恢复契约；当前生产 `observe-only` 配置会拒绝因素领取，不能假装已验收自动恢复。CAPTCHA 或设备批准交给人完成原运行，失败或不确定时停止，不重新提交已执行因素。
3. 每种外部效果使用独立审核范围、独立授权和独立结果。签名、租约、身份、受众、素材、版本或出口有一项不符即停止。已发生但无法确认的效果保持 `unknown`，不再次点击或自动重排。

## 文字发布：保留已完成验收的证据

2026-09-24 一条独立的私有测试正文已通过工作台内容 Gate 01、逐帖授权、停止状态自动唤醒、唯一提交、规范 permalink、签名回执及应用持久 `published` 的核对；详见[生产会话检查点](../../docs/testing/reports/mvp1-production-session-checkpoint-20260924.md)。旧帖的人工核对和原始 `unknown` 仍分开保存，不重试。再次验收时仍须使用没有工程事实、客户资料或报价的新正文，核对账号和 `Only me` 受众，并独立保留完整回执链。

## 视频：单独审核媒体页面和素材

1. 使用有明确对外发布权的素材重新制作视频，核对产品事实、素材授权期限、当前 Gate 01、最终 MP4 私有预览和下载。代码要求视频记录为 `VIDEO_APPROVED`、产品仍为 `PRODUCT_READY`、`mediaId` 等于已批准的 `renderedAssetRef`、私有视频可读取且为合规 `video/mp4`；内容里写着“仅内部审核，不发布”的旧版本不能作为授权。
2. 在同一 Sandbox 的隔离诊断副本中复核真实 Facebook 视频编辑器的身份、受众、编辑器内唯一文件输入和回执页。上传后 Facebook 可能替换编辑器并重置受众，须重新核对身份、恢复 `Only me`，再验证正文。视频编辑器不一定显示文件名；以唯一可见 blob 视频的 SHA-256 与已审核 MP4 的摘要一致作为附件证据，授权后和点击前各核对一次。把私有 `publication.json` 的审核范围扩展到视频后，才移除 `textOnly: true`；先用合成页面测试 `pnpm exec playwright test tests/e2e/facebook-driver.spec.ts` 与 `pnpm test:video-social-publication` 核对拒绝和回执路径。隔离副本的无点击预检不算真实投递。
3. 人工预览并逐帖确认**具体 MP4、账号、受众和文案**。从停止状态提交一次真实私有视频，核对媒体摘要、唯一唤醒、唯一点击、规范 permalink、签名回执及应用状态。附件不符或结果不明时保持 `unknown` 和渠道暂停；不得用文字发布结果替代视频验收。

## DM：先取得可核对的真实入站样本

1. 先由获同意的测试发送方给该账号发送一条不含客户资料的入站消息；Agent 不发送私信。当前生产只声明 `interactive, publish`、最近收件箱检查为“尚未执行”，所以不能先打开轮询再推断成功。只读观察同一持久 Messenger 会话中的一个非空线程，逐项复核 `inbox.json` 需要的身份、列表／线程就绪、方向、正文、可解析时间、稳定 `data-*` 会话和消息 ID、加载／挑战及分页边界。空收件箱无法证明消息选择器和稳定 ID。若真实页面不提供可证明稳定的 ID，先修订契约并重测，不以正文指纹代替。
2. 把已复核的私有配置和期限写入同一 Sandbox，启用 `manifest.inbox` 并确认节点实际声明 inbox 能力；渠道、账号和至少 300 秒的轮询间隔必须匹配。先运行 `pnpm exec playwright test tests/e2e/facebook-inbox.spec.ts`，再按 `.github/workflows/facebook-worker.yml` 的 PostgreSQL 配置运行 `node --conditions=react-server --import tsx scripts/test-facebook-publication-postgres.ts`；后者会执行入站 HTTP／数据库组合回归。然后从停止状态触发一轮真实检查，核对唯一唤醒、签名完成回执的 `coverage: visible_inbox`、消息加密入库及 `lastCheckedAt` 前进；空批次本身不算完成。
3. 再检查同一条入站消息：数据库应只保留一条，重复轮询返回 duplicate，未分流会话保持 `leadId = null`，不会自动回复、报价或创建销售项目。人工分流才进入现有 Lead/RFQ 流程。暂停渠道、挑战、缺 ID、方向歧义、列表变化、分页断层或回执丢失时，本轮不能标记完成；下一轮从头扫描并按稳定 ID 去重。Messenger `ready` 仅证明可进入页面，不证明历史聊天完整恢复。

每项生产验收都记录任务／发布 ID、审核引用、镜像修订、起止状态、可观察结果及失败阶段；只记录不含私有正文和凭据的最小证据。视频与 DM 分别通过后才能标记为已验收。
