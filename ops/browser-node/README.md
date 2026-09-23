# 按需 Browser 节点（PR #323 / Part of #322）

这是多账号隔离浏览器的控制面和按需运行节点。一个 VPS 配置一个平台 Access Key，自动同步该节点的全部账号授权及资源策略；不是给每个浏览器配置一套平台密钥。不同 VPS 必须分别创建节点/Key，防止共享 Key 后无法单独撤销。Key 只允许访问绑定的账号，不能读取平台主加密密钥、其他节点账号或所有人的密码。

## 已实现与明确边界

- `/workspace/browsers`：节点创建/轮换/撤销、账号与加密凭据、排队状态、人工登录/2FA 接管。
- PostgreSQL 节点行锁串行预留容量；队列和租约持久化，不依赖 Vercel 进程内存。不同节点各自调度。
- 常驻的是轻量 Agent 与 HTTPS 网关，不是所有 Firefox。每个获租约账号启动独立容器/网络，使用账号独立 volume；结束后删除容器和网络，保留 volume。
- 一次性平台票据换取短期 viewer / WebSocket 能力；不依赖第三方 Cookie，不把节点 Key 或 Camofox API Key 发给前端。VNC 密码是每次运行生成的临时值，只在已授权 iframe 中使用。
- 内置执行能力仅 `interactive`。`inbox` 周期排队和 `publish` 优先级/未知结果策略已在调度核心实现，但不包含经过真实 Facebook 验证的入站采集、图片/视频发布或自动填入密码执行器。不能把开浏览器等同于完成原 Issue 的业务闭环。
- 账号密码、Base32 TOTP 长期密钥和 Messenger PIN 可按账号加密保存。version 2 登录配置支持按租约自动登录；version 1 保留人工提交的填充流程。详见下文，本地单轮密码/TOTP/PIN 已验证，生产仍待验收。
- 新节点授权使用独立、带拥有者的记录。旧单账号环境变量和旧 Vault 不会自动变成全量节点授权；在新界面明确授权并保存配置后才能同步。旧 Worker 不得同时操作同一个账号。

## 资源和队列策略

有效并发取以下约束中最小值：平台并发上限、总内存预算/单浏览器内存、VPS 本地并发上限、当前可用内存扣除宿主机预留后的容量。Docker 对每个浏览器另设 memory / swap / CPU / PID 上限。`memoryBudgetMb` 等字段实际单位 MiB。

优先级默认人工接管 > 发布 > 收件箱检查，等待每五分钟增加优先级，避免长期饿死。运行中的任务不被高优先级请求强行抢占。同账号最多一个运行租约，不跨 VPS 自动迁移 profile。

租约 90 秒，Agent 每 10 秒轮询/续约；运行容器内另有看门狗，Agent 崩溃也不能无限在线。无用户连接的就绪浏览器 60 秒后回收；连接断开 15 秒后回收；人工接管最长 10 分钟。后台检查最长 2 分钟，发布预留最长 15 分钟。实际回收包含停止宽限期，不能当成硬实时 SLA。

过期但未确认停止的租约进入隔离状态，仍占用容量，不能仅看 TTL 就重复发任务。Agent 重启先停止自身节点标签的旧容器，再向平台确认恢复。发布结果不明不自动重试，也不会由“容器正常退出”产生发布成功记录。

账号不在线时无法实时接收浏览器私信。开启收件箱适配器后按 `pollSeconds`（至少 300 秒，默认 900 秒，0 停用）轮询，界面显示上次成功检查时间；实际延迟包含排队和启动时间。历史补采完整性取决于 Messenger 会话、可见窗口和适配器，不能保证离线期间所有消息均能恢复。

## 平台准备

在 PR 分支合入/部署前按现有流程审核迁移。`drizzle/0028_browser_fleet.sql` 是 SQL 管理的 broker 自定义迁移，包含 `browser_fleet_node`（版本化 JSONB 状态）和全局唯一账号绑定表。它不依赖原草案中尚未落迁移的 `facebook_account_runtime` 表，也不在 Worker 中自动运行迁移。

应用部署 Secret Store 设置：

```dotenv
BROWSER_FLEET_ENABLED=1
FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID=v1
FACEBOOK_CREDENTIAL_KEYS_JSON={"v1":"<32-byte base64 key>"}
```

不要替换已有有效 Vault Key。沿用现有 `DATABASE_URL`、Better Auth 配置。主加密密钥永远只在平台，不能复制到 VPS 或 NEXT_PUBLIC_*。

经审核后用项目的 `pnpm db:migrate` 应用迁移。登录具有 `settings:manage` 权限的账户，打开 `/workspace/browsers`：创建节点，填写该节点的 HTTPS 接管域名，设置容量，保存只展示一次的 Key。然后为节点授权账号、固定 HTTP 代理、由服务商确认的预期出口 IP 及可选加密账号密码。旧节点记录没有预期 IP 时必须重新保存授权，不能自动采用首次观测的地址。

## VPS 部署

使用专用 Linux VPS，安装 Docker Engine/Compose、Git。控制器具有 Docker socket 的宿主机级权限；浏览器容器不挂载该 socket。Docker `:ro` 挂载 socket 也不是只读 API，不能靠它保护宿主机。不要部署到不受信任的共享主机。正式使用前将 Docker 数据/账号卷/备份置于加密存储；普通 named volume 不自动加密。

在仓库根目录执行：

```bash
# 使用该 PR 分支的完整仓库
cp ops/browser-node/.env.example ops/browser-node/.env
chmod 600 ops/browser-node/.env
# 编辑 .env：平台 URL、唯一节点 Key、接管域名
sh ops/browser-node/build-browser.sh
docker compose --env-file ops/browser-node/.env -f ops/browser-node/compose.yaml config --quiet
docker compose --env-file ops/browser-node/.env -f ops/browser-node/compose.yaml up -d --build
```

最少配置项：

```dotenv
FTRADE_URL=https://your-ftrade.example
BROWSER_NODE_ACCESS_KEY=<平台生成的本节点Key>
BROWSER_DOMAIN=browser-a.example
```

域名需指向该 VPS，并开放 HTTPS 443 和证书签发需要的 80；Caddy 配置不要开启 access log，路径中含临时 viewer 能力。9400、随机浏览器 API/noVNC 端口只监听回环地址，不开放到公网。已有反向代理占用 80/443 时，不启动 Compose 的 `gateway` 服务，由现有代理转发该域名至 127.0.0.1:9400，并保留 WebSocket 升级。

没有 `SOCIAL_WORKER_*` 或逐账号代理变量：平台保存的固定代理在租约开始时按需下发，浏览器自己的访问密钥和临时 VNC 密码由节点生成。主 Key 支持 Secret 文件注入（Agent 的 `BROWSER_NODE_ACCESS_KEY_FILE`），示例 `.env` 本身仍是明文，权限控制不是加密。

`build-browser.sh` 固定 Camofox 源提交 79d425be26743883a06613eaa3be5e38e7ab5409，并构建附带看门狗的本地镜像。基础镜像、包源仍可能变化，正式部署应审核并按镜像 digest 固定供应链。Agent 仅使用启动时已存在的本地镜像 ID，平台任务不能指定任意镜像或挂载。

另一台 VPS 重复部署步骤，但在平台创建另一个节点/Key。不要复制第一台的 `node-state` 或账号会话卷。同机运行多个 Agent 还需独立 Compose 项目名、Agent 9400 端口与反向代理配置；更简单的是一台 VPS 一个 Agent 管理多个独立账号容器。

## 使用与故障恢复

平台保存授权后，节点用同一个 Key 获得账号配置。点击“排队打开浏览器”，有容量时启动，状态变成运行中后点击“接入登录 / 2FA”。启动时节点通过同账号浏览器会话读取固定 IP 查询页并匹配预期 IP，通过后才打开 Facebook；运行中每 30 秒复查，校验失败会停止本次运行并暂停后台任务。校验只接受完整、单一地址且未跳转的页面；不可用同宿主机 HTTP 请求替代浏览器观测。此检查是周期检测，不保证两次检测之间出口绝不变化。人工仍需核对目标账号，完成登录后关闭连接，再显式确认登录有效。人工接管不是自动内容发布授权。

无任务时只有 Agent/Caddy 在线。查看运行容器时按 `io.ftrade.node` 标签过滤，避免公开完整 `docker inspect`，它可能包含代理密码。不要运行 `docker compose down -v`，不要删除 `ftbrowser-*` 卷；账号会话只保存 Cookies/localStorage，默认不保存 IndexedDB 或完整 Messenger 历史。

轮换/撤销 Key、撤销账号授权会使旧续约失败，网关关闭连接；最长还可能存在当前租约加停止宽限期。新 Key 更新到 VPS 后重启 Agent。节点故障时不自动把账号移到另一台 VPS，需确认旧节点已停止并采用受控迁移流程，当前没有在线迁移功能。

## 后台执行器接口

Node Agent 可通过本地 `BROWSER_TASK_ADAPTER` 导入一个管理员审核的模块，模块声明 `capabilities: ["inbox", "publish"]` 的子集，并导出 `execute({ run, signal, browserRequest })`。模块必须响应中止信号，并在网络操作前验证有效租约、固定出口与账号。不能从平台任务传入适配器路径或脚本。

默认 Agent 只启用人工交互，不会创建假收件箱检查记录。已确认发布任务通过下述节点预留、最终授权和租约回执接口接入；当前 UI 不能绕过内容审核创建原始发布任务。

## 验证

```bash
node --import tsx --test scripts/test-browser-fleet.mjs scripts/test-browser-node.mjs scripts/test-browser-fleet-protocol.ts
pnpm typecheck
```

CI 还运行独立 PostgreSQL 容量并发/唯一绑定/迁移测试、Compose 校验与 Agent 镜像构建。真实浏览器镜像、真实代理、HTTPS/noVNC、FB 登录/2FA、重启恢复及压力测试必须在试运行 VPS 验收，合成测试不能替代这些验收。

依据：PostgreSQL 行锁 https://www.postgresql.org/docs/current/explicit-locking.html；Docker socket 权限 https://docs.docker.com/engine/security/；Camofox 固定源 https://github.com/jo-inc/camofox-browser/tree/79d425be26743883a06613eaa3be5e38e7ab5409。

## 发布队列与节点预留（#322 迭代中）

迁移 `0031_browser_fleet_publication.sql` 为业务任务持久化唯一的节点/run 绑定。节点声明 `publish` 能力后，领取请求会为已授权、登录就绪的账号预留排队中的发布任务；实际租约领取时重新检查内容确认和媒体清单，并将载荷放入 `run.publication`。重复请求返回原租约，容量限制仍由同一个节点行锁控制。

绑定节点的账号不会再由旧单 Worker 领取或处理超时；已有节点预留也不能使用旧授权、媒体读取和结果回执接口。节点所有者可以停止自动调度的发布。租约隔离、浏览器停止、重启恢复不会证明发布成功：已披露载荷而没有业务回执的任务转为结果未知并暂停渠道，不自动重试。启动前校验拒绝的任务则暂停，保留人工重新确认路径。

这不是可上线的发布执行器：默认 Agent 仍仅声明 `interactive`。租约绑定的最终授权、媒体交付及幂等回执接口已实现；真实页面契约与被动私信适配器仍待完成。不能为了跑通而改用旧 Worker 的全局签名凭据。合成 PostgreSQL 回归已覆盖实际 broker 的并发预留、重放、跨 Worker 隔离、所有者停止与未知结果同步；没有执行真实 Facebook 发布。

### 租约内最终授权

迁移 `0032_browser_publication_authorization.sql` 为每个预留任务保存一次短期执行授权。节点请求 `authorize-publication` 时提交 `runId`、`leaseId` 和领取时的 `publicationDigest`。平台重新检查节点/安装/启动身份、有效运行租约、账号绑定及凭据版本、渠道、逐帖确认和当前媒体清单。授权最长 30 秒，且不超过租约与运行期限。同一任务重放只返回原授权；授权过期后不会生成第二次外部执行机会。

受审核的适配器现在接收 `authorizePublication()` 回调，应在最终发布操作前调用。回调重新检查浏览器出口与本地租约，并按网络往返时间扣减可用期限。适配器必须遵守返回的 `localExpiresAt`，且不能重复外部点击；并发授权调用会共享一次请求，失败或结果不明不会重试。`run` 是独立副本，适配器不能通过修改它改变内部授权范围。平台 key 仍由 Agent 持有，不传给适配器。

该授权不是发布回执；媒体和回执采用下面的独立接口。默认能力仍只有 `interactive`。

### 发布结果回执

迁移 `0033_browser_publication_receipt.sql` 保存节点观察结果。`publication-result` 必须携带原 run/lease、授权 ID、载荷摘要和 `published`（平台发布凭证）或 `unknown`（失败代码）。首次回执要求原租约仍运行、账号及授权范围有效；成功还会重新检查确认内容。授权的 30 秒限制的是发起外部操作，回执可以稍后到达，但首次回执不能越过原租约期限或停止请求。

同一回执重复发送返回已保存结果，不重复递增内容版本或写成功记录；不同结果或平台凭证被拒绝。成功事务同时更新任务、发布、内容和审计，未知结果暂停渠道。收到回执后请求关闭浏览器，但容量仍等确认停止才释放；已保存成功不会因停止/恢复变回未知。

适配器接收 `reportPublication({ authorizationId, outcome, externalPublicationRef?, failureCode? })`。响应丢失时可显式重发同一回执；这是重发观察结果，不是重新授权或点击。回调固定 run、lease 和摘要，不接受调用方覆盖；冲突的本地观察会被拒绝。回执依赖受信任节点的真实观察，不等同于已经完成 Facebook 实网验收。媒体交付及实际发布/私信适配器仍待实现，默认能力仍是 `interactive`。

### 租约内媒体交付

`publication-media` 仅接受 run/lease 与载荷摘要，不接受资产 URL、Blob key 或本地路径。平台在有效运行租约内重新检查账号绑定、任务、已确认媒体清单和当前素材权限，再读取对应私有 Blob。存储读取在释放节点数据库锁后进行；HTTP 只返回确认的媒体类型、长度和文件流，不返回私有路径。该读取不消耗最终发布授权：适配器应先准备媒体，再调用短期 `authorizePublication()`。

适配器通过 `readPublicationMedia()` 获取 `{ bytes, media }`。Agent 固定请求范围、拒绝重定向，并在接收前后和读取期间检查本地租约；文件必须符合已确认的类型、精确长度、大小上限和 SHA-256 才会交给适配器。响应截断、超长、篡改或类型错误均拒绝。此实现最多暂存一份已确认的媒体文件（图片 20 MiB / 视频 200 MiB 上限），调用方仍应控制并发与释放内存。

嵌套媒体字段经 PostgreSQL JSONB 存储会重排，因此载荷摘要现对每层对象排序并保留数组顺序。升级前的嵌套载荷摘要不保证兼容，应结束旧运行并重新人工核对，不能用自动重试替代。数据库权限回归使用真实 broker 与注入的合成存储字节；节点字节校验独立通过，尚未作为真实 Blob/Facebook 交付验收。发布驱动见下文，被动私信适配器仍待实现。

### 浏览器容器内上传准备

固定版本 Camofox 的 `/tabs/:tabId/upload` 需要容器侧绝对路径。适配器可调用 `preparePublicationMedia()`：Agent 读取并校验当前清单，用摘要生成唯一文件名，再核对容器的节点/run/账号标签和运行状态，通过 Docker archive API 写入 `/tmp/ftrade-uploads`。任务不能传入路径、tar 元数据或目标容器。上传目录位于该运行的 tmpfs，随容器结束清除，不写入持久化账号 profile 卷。

同一执行上下文复用下载与准备结果；失败不会隐式重复写入。归档仅含固定目录和确认媒体的普通文件，不含链接。系统 tar 解包、二进制 Docker 传输及错容器拒绝已有本地回归。此测试没有实际启动 Camofox；后续适配器仍需核对页面唯一附件入口、附件预览和真实发布结果，不能把准备文件视为已上传或已发布。

### 发布执行顺序与页面驱动契约

`createPublicationExecutor(driver)` 定义发布执行顺序：打开页面并核对当前身份、记录已有帖子凭证、准备正文和附件、核对预览、取得短期授权、再次核对预览和期限、单次发布、观察新帖子并回传结果。提交前变化和中止不会点击；点击结果不明不会再次点击；成功回执响应丢失也不会被改写成相反的未知回执。已有帖子链接不能作为新发布凭证。

驱动接口见 `publication-executor.d.mts`。驱动必须提供唯一控件定位、真实身份、附件预览及新帖子观察证据；执行器本身不包含 Facebook 选择器，也不声明运行能力。`tests/e2e/browser-publication-executor.spec.ts` 已在 Chromium 本地合成页面通过 10 个场景，涵盖文本/图片/视频、身份变化、改稿、过期、中止和丢失响应。该证据只证明执行顺序及失败处理，不证明真实 Facebook DOM 契约或发布成功。

### 显式配置的 Facebook 页面驱动

`facebook-adapter.mjs` 可作为 `BROWSER_TASK_ADAPTER` 的本地绝对路径。启用前必须配置 `FACEBOOK_DOM_PROFILES_FILE` 指向私有 JSON 文件；文件为 1–16 项数组，每项有 `version: 1`、`channelRef`、`accountRef`、`reviewRef`（`evidence-` 开头的审核引用）、ISO 时间 `reviewedAt` / `expiresAt`（最长 30 天）、固定 Facebook 页面 `url`、精确当前身份链接 `identityHref` 和 `selectors`。发布配置还必须包含经审核的 `audienceText`（与受众控件可见文字完全一致）。选择器键为 `identity`、`openComposer`、`composer`、`textbox`、`submit`、`audience`、`fileInput`、`attachmentName`、`post`、`postAuthor`、`postText`、`postLink`。身份必须是当前操作身份，而非页面上任意作者链接。审核引用是运维声明，不是服务端自动证明页面契约已审核。

不提供声称适用于真实 Facebook 的默认选择器。配置应在获授权环境中核对唯一控件、身份链接、附件名称及帖子凭证，存于 VPS 私有配置并挂载给 Agent；不得放账号资料或私密页面证据进 Git。缺少配置、重复账号、过期审核、错误来源或歧义控件均拒绝执行。节点注册声明配置覆盖的账号及到期时间，平台在调度、领取、媒体读取和最终授权时限制范围。未声明范围的旧自定义适配器保持原有授权账号范围；它仍是受信任代码，不是安全沙箱。

驱动使用固定上游的 create/type/upload/evaluate 接口。最终点击在一次页面执行中重新核对身份、受众、正文、附件、唯一按钮、配置有效期和授权截止时间；只执行一次 DOM click，不调用可能回退重试的通用 click API。上游 upload 选择全局第一个文件输入，因此这里要求整个页面恰好一个文件输入且属于已核对编辑器。浏览器与 Agent 必须在同一 VPS 使用宿主时钟。不得通过本驱动的 type/evaluate 输入保存密码；上游这些接口可能记录参数，保存密码仅允许通过下文独立登录插件路径。

`tests/e2e/facebook-driver.spec.ts` 的 9 项 Chromium 测试拦截全部网络，仅使用合成 HTML 与 Camofox API 桥接，覆盖文本/图片/视频、身份变化、重复编辑器、错误附件、传输途中授权过期和额外文件输入。它验证实际 DOM 操作与拒绝路径，不证明真实 Facebook 接受合成 click、页面选择器长期稳定或实际 Camofox 媒体上传成功。默认能力保持人工交互，真实账号验收另行执行。

### 被动入站持久化边界

`ingestFacebookInboundBatch(tx, input, actorId)` 复用现有会话、消息加密及 30 天有效期。在同一事务内锁定渠道控制和会话，按渠道/账号/会话/消息标识去重；相同标识但正文或接收时间变化会拒绝整个批次，不静默覆盖。乱序消息不倒退 `lastMessageAt`，已删除消息不会被重新填充正文。暂停渠道、未来消息、超过保留期的消息和过期观察均拒绝。每批最多 20 条，审计不含正文。

新会话保持 `leadId = null`，进入现有待分流列表；只有人工调用现有分流动作才会建立销售项目、Lead 和 RFQ 收集任务。真实 PostgreSQL 回归覆盖并发去重、批次回滚、加密与有效期、删除重放及人工分流后的继续入站。此函数是领域存储边界，不是认证接口：调用者仍须校验节点身份、有效 inbox 租约、账号范围、签名及重放约束。节点签名 HTTP 接口见下文；可配置页面采集器见下文；未配置经审核的真实页面契约时不能声称已完成私信接收。

### 租约签名入站接口

`inbox-messages` 已通过 `/api/browser-nodes` 接入上述领域事务。Bearer Key 先绑定节点、安装与启动身份，再验证 inbox 运行状态、租约、账号授权、凭据版本及消息签名。仅 inbox claim 返回当前租约的派生签名密钥；派生范围包含节点、账号和租约，平台 `SOCIAL_WORKER_SIGNING_KEY` 不离开服务端。Agent 向适配器提供 `reportInbound(messages, observedAt)`，不暴露签名密钥。回调先检查有效租约和浏览器出口，再签名上报；失败后本次运行不能继续上报，后续轮询依消息 ID 去重。

每个请求绑定 UUID 和载荷摘要，消息与回执同事务写入。相同请求重放返回原计数；相同编号改稿拒绝。每运行最多 100 个消息批次，每批 1–20 条，另加一个显式完成回执；HTTP 总请求最多 256 KiB，Agent 在 250000 字节处提前拒绝过大封包。正文超过单批容量时由采集器拆批，不能截断成另一条消息。运行终止后旧请求拒绝，内部摘要回执不进入管理 UI；消息正文不写入节点文档或审计。

数据库回归直接执行实际 Route Handler 和 broker，覆盖签名、HTTP 鉴权/大小限制、租约、过期与重放。后续回环 HTTP 组合回归见下文；VPS 或真实 Facebook 页面采集仍未验收；内置适配器可显式配置发布或收件箱，默认 Agent 仍只有人工交互。轮询完成协议见下文；可配置页面采集见下文，不能通过空实现返回 completed 来宣称完成检查。

### 轮询完成回执

采集器完成当前可见收件箱检查后，调用 `reportInbound([], observedAt, completion)`。`completion` 含 `reviewRef`、`scanStartedAt`、`coverage: "visible_inbox"`、`conversationCount` 和 `messageCount`。服务端要求开始时间属于当前运行，消息总数等于该运行已提交批次的接受数与重复数之和，并再次检查渠道可用。无消息也必须提交这份显式回执；普通空消息批次无效。允许最多 100 个消息批次加 1 个完成回执。

完成回执与运行状态原子保存，精确重放幂等；完成后新消息批次拒绝。只有持久化完成回执且正常停止，才把 inbox 标记 completed 并以 observedAt 更新检查时间。仅返回 completed 的旧适配器会以 inbox_completion_missing 失败，检查时间不变。异常结束不推进检查时间。这里证明的是受信任驱动声明的可见范围，不是全部历史、隐藏线程或 Messenger 加密历史已完整收集；签名和审核引用不能自行证明页面观察真实性。

### 可配置的只读收件箱采集器

`facebook-adapter.mjs` 现在可分别读取 `FACEBOOK_DOM_PROFILES_FILE`（发布）和 `FACEBOOK_INBOX_PROFILES_FILE`（收件箱）。至少提供一类配置，只有存在相应已校验配置时才声明该能力。两类配置独立声明账号范围和到期时间；平台在收件箱调度、领取和上报时拒绝过期或未覆盖账号。默认 Agent 仍只启用人工交互，仓库没有真实 Facebook 选择器配置。

收件箱配置同样是 1–16 项数组，每项含 version/channelRef/accountRef/reviewRef/reviewedAt/expiresAt/url/identityHref。selectors 必须完整包含 `identity`、`inboxReady`、`conversationLink`、`emptyInbox`、`threadReady`、`threadIdentity`、`message`、`inbound`、`outbound`、`body`、`time`、`emptyThread`、`challenge`、`loading`、`moreThreads`、`moreMessages`。`attributes.conversationId` 和 `attributes.messageId` 指定经过核对的稳定 data-* 属性；message 的 inbound/outbound 选择器作用于消息元素自身。时间元素必须提供可解析的 datetime。不能用正文指纹冒充稳定消息 ID，不能把消息列表中的任意用户链接当作当前账号身份。

采集器在同一租约标签页内导航，只使用 create/navigate/evaluate，不使用 click/type/upload；可选滚动分页也只由固定页面程序操作经审核的容器。线程链接必须属于固定 Facebook `/messages/t/` 路径并与会话 ID 一致。每个页面检查当前账号和加载/挑战状态；明确出站消息跳过，入站方向不明、ID 缺失或重复、时间无效、未配置分页时的显示更多标记、列表变化均停止且不提交完成回执。已接受的前序批次保留，下一轮按稳定消息 ID 去重。观察范围明确为 visible_inbox，不声称已读取所有隐藏或加密历史；打开线程可能产生平台已读状态，不能解释为平台侧零副作用。

未启用分页时单页最多 20 个可见线程、每线程 100 个可见消息元素。启用下述滚动分页后，每个列表／线程最多累计收集 40 页，合并最多 200 个会话、每轮共 200 条入站消息；线程正文累计最多 200000 字符，单个响应最多 1000000 字节。每批最多 2 条，跨会话保留单条余量，确保 200 条消息不超过服务端 100 个消息批次。超限失败，不静默截断并宣称完成。

`tests/e2e/facebook-inbox.spec.ts` 在完全拦截网络的 Chromium 夹具上连接生产签名上报器，覆盖正常/空/仅出站、错误身份/线程、缺失或重复 ID、方向歧义、未完成分页、挑战、列表变化和回执丢失。真实 Camofox 网络、真实 Facebook DOM、VPS 日志/插件隐私和 Messenger PIN/历史行为仍未验收。固定上游 evaluate 会把返回值传给本地插件事件；不得添加未经审核的插件或把这些事件写入日志/遥测。

### 浏览器到入站分流的组合回归

`test-browser-inbox-roundtrip.ts` 已纳入迁移后的 PostgreSQL 测试主程序，并由 Facebook worker CI 安装 Chromium 后执行。测试将实际 Chromium 页面采集、生产签名上报器、真实回环 HTTP、生产 Route Handler、数据库加密/去重和现有人工分流放在同一次运行中。第一次提交成功后故意销毁 HTTP 响应连接：该轮不重发、不推进检查时间；下一轮读取同一消息返回 duplicate，存储仍只有一条，随后人工分流得到 Lead/RFQ 收集任务。浏览器对 Facebook 地址的请求全部拦截为合成 HTML。

初次组合运行在 HTTP 之前失败：tsx 对函数加入的 `__name` 辅助调用经 `.toString()` 进入页面，但页面没有该宿主辅助函数。页面代码现保存在固定的 `facebook-inbox-page.js` / `facebook-publication-page.js`，由 `page-programs.cjs` 按固定本地路径读入，避免宿主编译器改写代码。不得从任务传入程序或路径；镜像必须连同这些资源一起打包。修复后组合回归与 23 项页面回归通过，原失败不记为成功。

该组合测试的 Camofox REST 接口由 Chromium 桥接，Node HTTP 服务调用生产 Route Handler，未启动 Next.js HTTP 服务或真实 Camofox 进程。固定代理/出口检查在此处是测试替身，其独立回归不能被合并描述为本次真实代理验证；容器、真实 Facebook、页面契约和运维隐私仍须分别证明。

### 收件箱异常与人工恢复

页面采集现在返回固定的关注状态：明确登录标记为 `needs_login`，明确 2FA 标记为 `needs_2fa`，安全挑战为 `checkpoint`，身份/消息标识/方向/分页等页面契约失效为 `page_contract_failed`。配置可增加经审核的 `selectors.loginRequired` 和 `selectors.twoFactorRequired`；未配置时不会猜测登录或 2FA 原因。多种关注标记同时出现按页面契约失效处理。页面程序只返回固定状态，不把 DOM 错误正文或消息内容拼入诊断。

节点停止确认会持久化账号关注状态，后续后台轮询和发布均被阻止，检查时间不推进。人工交互入口仍可用；操作者应处理登录/2FA/安全挑战，或更新并重新审核失效的页面配置、重启加载配置，再通过现有账号确认动作恢复。旧配置若已过期，即使账号重新确认也仍被范围有效期检查拒绝。普通传输失败保持本次运行失败和已有退避策略，允许后续轮询依稳定消息 ID 去重；不会将网络错误伪装成已识别的登录挑战。

19 项收件箱页面场景、63 项节点回归，以及真实 PostgreSQL 的暂停/人工恢复与浏览器-HTTP-入站分流组合回归已在本地通过。真实平台页面和账号恢复仍未验收。

### Agent 打包边界检查

`node scripts/test-browser-agent-payload.mjs` 从 Dockerfile 的 COPY 声明与 Git 跟踪文件构造临时运行目录，不安装应用依赖，使用原生 Node 24 执行 `ops/browser-node/smoke.mjs`。它核对运行模块可加载、固定页面资源可解析、Agent 入口语法，以及未配置页面契约时适配器明确拒绝启动。反向对照删除临时目录中的收件箱页面资源，确认同一检查因 ENOENT 失败，避免把遗漏资源的包记为通过。

镜像检查脚本也在 `--network none` 下调用同一 smoke。离线目录检查已在本地通过正反对照，但不等于镜像构建或容器启动通过：当前主机没有 Docker，实际 amd64/arm64 镜像检查仍需可运行的 Docker/CI 环境。该检查不会启动真实账号或读取私人配置，也不能验证代理、Camofox 页面行为或运维日志隐私。

### 收件箱瞬时状态重试

明确的 loading 标记现在返回固定瞬时状态；驱动只在当前标签页重新 evaluate，最多 9 次读取、8 次各 250ms 等待。每次读取前重新检查配置期限和取消信号，等待可被取消。等待结束仍在加载、本轮列表发生变化或传输失败均返回 failed，不提交完成回执、不将账号设置为页面契约失效；既有退避轮询随后重试，已提交消息按稳定 ID 去重。等待时间不包含浏览器请求耗时，不宣称整个请求在两秒内完成。

明确挑战先于 loading 判断；身份、消息字段、分页和过期配置等安全拒绝保持原有人工处理。19 项 Chromium 合成场景覆盖加载后恢复、持续加载的次数上限、等待取消及原有拒绝路径；真实回环 HTTP／PostgreSQL／人工分流组合回归也已通过。真实 Facebook 的加载标记仍需要经审核的页面配置。

### 经审核的滚动分页

私有配置可增加 `pagination.list` 和／或 `pagination.thread`；每项严格只含 `container`、`start`、`end` 三个选择器。它们分别指向列表／线程根节点内唯一的垂直滚动容器，以及容器可见窗口中的开始／结束标记。列表从起点向下、线程从最新端向上；起点标记必须在第一次观察时可见，终点必须明确出现，不能把“没有新记录”当作结束。没有配置的模式沿用原先遇到分页即拒绝的行为。仓库不提供真实平台选择器。

固定页面程序每次先核对身份、挑战、页面位置和记录，再核对上一观察的 ID 序列与 scrollTop，随后只滚动半个窗口。宿主保存本轮临时游标；相邻观察必须保留稳定 ID 重叠，出站和超过正文保留期限的消息也参与连续性检查，但不入站上报。跨页消息按稳定 ID 合并，正文／时间冲突、缺起点、ID 断层和超限需要人工关注。滚动停滞、加载超时或滚动前页面变化使本轮失败；不会发送完成回执。所有等待可取消，后续轮询从起点重扫并由数据库去重，不持久化跨轮 DOM 游标。

完成前会重新遍历列表并比较会话集合。完成范围仍为 `visible_inbox`，仅表示经审核的当前可访问窗口已遍历，不证明隐藏请求、加密历史、Messenger PIN 或平台全量历史完整。没有可验证的起终标记或连续锚点时，不能启用这份分页契约。

分页测试使用 Chromium 的真实容器滚动，覆盖四会话／二十消息的跨页合并（十个消息批次）、缺失边界、页面断层、消息冲突、取消及滚动前变化。真实回环 HTTP／PostgreSQL 组合回归也跨页采集，并在首次入库后丢失回执，验证下一轮重扫不会重复落库。页数上限测试首轮夹具仍只有四个会话，未触达上限而失败；修正夹具为一百个会话后，完整 27 项浏览器回归通过，并确认最多 39 次滚动、40 页收集，原失败不记为通过。实际 Camofox、真实平台页面和持久化跨轮游标仍未验证或实现。

### 已保存登录的独立填充边界（version 1，按账号显式配置）

固定上游通用 `/tabs/:id/type` 会将输入全文交给 `tab:type` 插件事件，其异常还可能包含输入值；因此保存密码不能直接通过该接口执行。新增 `login-plugin/` 作为浏览器镜像内的独立插件，模块随镜像加载，但没有匹配运行的私有登录页面配置时不注册路由。Agent 与人工入口已接通；真实 Camofox 容器及页面契约尚未验证。

该插件仅在明确启用、存在浏览器 Access Key、具备固定账号／运行／interactive 类型及经审核登录页面配置时注册 `/ftrade/login-fill`，再使用上游的鉴权中间件。目标标签页必须属于指定账号的指定运行分组，弹窗组或其他运行不可使用。每个独立运行最多尝试一次，调用浏览器前消耗机会；输入授权最多 30 秒，并与本地租约文件和页面配置期限取最早时间，在页面执行时再次拒绝过期。

页面程序要求精确 Facebook 登录 URL、唯一且可见的同一 POST 表单、同源登录提交地址、可编辑的账号字段和 password 类型字段。已有其他账号或非空密码不覆盖。只设置值并派发 input/change，不点击、不按 Enter、不调用 submit、不把账号标记为已登录；页面自身事件行为仍属于真实页面契约的验证范围。人工后续提交及 2FA 不由本插件代办。

独立路径直接调用页面对象，避开上游通用输入／evaluate 路由的内容事件，不记录请求或异常正文，响应只有 filled/refused/unknown。填值前校验异常归为 refused，开始填值后的异常为 unknown，均不重试；函数结束时移除请求对象的用户名和密码属性，但这不是 JavaScript 内存可靠清零。浏览器、页面脚本、上游内部调试和其他进程的隐私仍需独立验证，不把此单一路径测试解释为所有日志均无敏感信息。

15 项拦截网络的 Chromium 场景覆盖字段填充且不提交、错误来源／表单／字段、已有密码、账号／运行隔离、两层过期、并发和丢失响应／包含合成密码的异常。首轮重复字段返回 unknown，暴露填值前后错误未区分；修复后全部 15 项通过。Agent 离线打包检查加载该模块，镜像检查也加入实际浏览器镜像中的加载与默认关闭检查。上游浏览器基础镜像使用 Node 22，本地应用／Agent 测试使用 Node 24；当前没有 Docker，不能把本地结果记为 Node 22 容器或固定 Camofox 运行通过。

### 平台一次性登录凭据授权

节点必须通过 recover 显式声明有期限的 `loginFillScopes`；缺省为空；只有配置 `FACEBOOK_LOGIN_PROFILES_FILE` 的 Agent 才声明匹配范围，因此默认不能申请保存密码填充。所有者通过已有 Server Action 的 `use-saved-login` 命令明确请求，必须与当前已接入交互运行使用同一有效登录会话。服务端检查节点归属、管理权限、运行状态、一次性接入票已消费、剩余租约／运行期限、账号启用、固定出口配置、凭据版本、绑定记录及能力范围。每个交互运行只允许一次请求，过期后需结束并重新打开，不能重新授权同一运行。

请求仅保存随机授权 ID、申请／过期／领取时间；授权最多 60 秒，且不超过当前租约和运行期限。普通同步只显示 requested/claimed 状态，隐藏授权 ID。经验证的该租约 heartbeat 可收到待处理授权的 ID 和期限；`claim-login` 还必须携带正确授权 ID，并重新检查全部边界和所有者会话。它在同一节点行锁事务中解密并消费授权，返回最多 30 秒有效的凭据，只有这次节点响应含明文；重复领取、并发失败方或丢失响应后的重试均拒绝，不重新发送密码。领取不代表登录成功，不自动改变账号就绪状态。

迁移后的 PostgreSQL 回归调用实际所有者领域命令、节点处理器和生产 HTTP Route Handler，验证五个并发授权只有一个成功、八个并发 HTTP 领取只有一个响应含合成凭据。范围／绑定／会话／凭据版本／租约失效、后台运行冒用及节点撤销均拒绝；同步与审计无明文或领取标识，放弃成功响应后再领取仍拒绝。该测试只验证 HTTP 处理器，没有新建网络服务或真实账号。现有收件浏览器／回环 HTTP／数据库组合也在同一次回归通过；不能将它混作本次密码已穿过完整 Agent／Camofox 链路。


### Agent 与人工填充入口

可选 `FACEBOOK_LOGIN_PROFILES_FILE` 指向 Agent 容器中的私有 JSON 文件，例如已有 node-state 挂载内的 `/var/lib/browser-node/login-profiles.json`（实际路径以 compose 挂载为准）。文件为 1–16 个 `{channelRef, accountRef, profile}` 条目的数组；profile 使用插件校验的 version、reviewRef、reviewedAt、expiresAt、url、form、username、password 字段，其中 username/password 是选择器，不是凭据。必须由页面审核提供真实规则，配置有效期最多 30 天。修改文件后重启 Agent；配置时要求浏览器镜像标记 `io.ftrade.login-fill=1`。不提交私有配置或真实账号。

Agent 仅向匹配的 interactive 运行注入非凭据页面配置。人工接入后点击“填入已保存账号和密码”，平台记录一次授权；Agent 检查插件运行身份、当前接管连接和出口，打开精确登录页，再次检查后领取一次短期凭据并调用专用填充接口。任务异步执行以保持其他租约心跳。密码不写入运行日志、检查点或容器环境变量。结果未知时停止运行，永不自动重发密码。

`login-result` 只记录 filled/refused/unknown，重复同值幂等、冲突拒绝；领取前拒绝也可结束授权，阻止后续领取。界面显示结果，但 filled 仅证明填字段成功；提交登录、2FA 和确认就绪仍由人工完成。

当前验证分为两段：拦截网络的 Chromium 执行器测试覆盖插件与一次性执行顺序；本地 Next.js／PostgreSQL 页面测试通过实际 Server Action、接入票、heartbeat、claim-login 和 login-result 验证 UI 状态及凭据不返回页面。后者使用模拟远程查看器及节点结果，不能据此声称真实 Agent／Docker／noVNC／Camofox 全链路已通过。


### 填充中断与回执等待

公开状态不会把无回执的请求永远显示为等待。未领取的授权在过期、停止或租约失效后显示 refused；已领取但无回执的运行在停止／失效后显示 unknown。运行仍有效时，最多等到授权期限与领取后 30 秒的较早值，再加节点结果传输的 10 秒窗口。这里的 refused/unknown 是只读状态推断，不会写成节点回执，也不会刷新授权、重发凭据或改变账号就绪状态。

真实回执优先于该推断。同一节点启动实例、运行和授权的有效晚到回执仍可按既有规则落库并更新显示；节点已重启或授权不匹配仍拒绝。中断后的数据库与实际 UI 回归验证从 unknown 更新到 filled，且账号仍为 needs_login。该验证使用合成节点回执，不代表真实 Camofox 登录成功。

### 实际编辑器重置与隐藏旧表单

生产人工试发观察到：视频上传会开启新编辑器并重置文案及受众，旧编辑器仍留在 DOM，
仅检查布局矩形无法排除 `aria-hidden` 祖先。发布驱动先上传附件，再重新检查当前编辑器、
清空文本并以键盘事件输入文案；页面检查与输入定位都排除 `aria-hidden` 和 inert 子树。
最终身份、正文、附件及租约检查仍必须通过，多个可用编辑器仍拒绝发布。

新增的浏览器回归覆盖上传后文案重置及隐藏旧编辑器；这是合成页面执行器回归，
不等于生产节点已启用自动发布。真实受众设置、附件输入选择及发布回执契约仍须单独接入并验收。

### Managed Sandbox private Facebook configuration

A reviewed Sandbox template containing this runtime can load node-specific Facebook configuration from `/var/lib/ftrade-sandbox/facebook`. The startup script creates this directory as root with mode `0700`; Compose mounts it read-only at `/run/facebook-config` inside the Agent. An empty directory retains interactive-only operation. Missing directories, symlinks, permissive ownership/modes, invalid manifests and conflicting legacy adapter environment settings fail startup rather than silently changing capabilities.

Provision only while the node has no running or unknown leases. Use the existing authorized Sandbox administration channel, never a task payload, public repository, template snapshot, or browser form. Place private files owned by root with mode `0600` in this directory. Write the selected profile files first and atomically rename `manifest.json` last:

```json
{
  "version": 1,
  "nodeId": "00000000-0000-4000-8000-000000000001",
  "publish": false,
  "inbox": false,
  "login": false
}
```

The example node ID is synthetic and all capabilities are disabled. The real `nodeId` must equal the node encoded in the Agent access key. Enabled switches select fixed filenames only: `publication.json` uses the existing publication-profile array schema, `inbox.json` the inbox-profile array schema, and `login.json` the saved-login profile array schema documented above. Disabled files are not loaded. Each selected file is limited to 64 KB and 1–16 entries; existing loaders still enforce reviewed selectors, account/channel scope, duplicate rejection and expiry. The loader cannot select arbitrary adapter code. Private files remain in this dedicated VM across ordinary stops/starts; provision them again if the VM is replaced. Never include them in a reusable template.

Start a fresh operation after provisioning and verify the node's reported capabilities and expiring scopes before queuing a test. Updating files does not change a running Agent; stop through the platform and start a new operation. To disable automation, set all manifest switches to false before that new start. Login configuration only enables the existing explicitly requested, once-per-interactive-run saved-credential fill flow; it does not bypass 2FA or checkpoints. This provisioning support does not implement DM reply execution and is not evidence of real Facebook automation acceptance.

发布受众必须在编辑器预检与最终点击的同一次页面执行中匹配 `audienceText`；控件缺失、歧义或文字改变均拒绝点击。缺少受众声明的旧发布配置必须重新审核后补齐，不能默认沿用 Facebook 当前受众。合成测试覆盖授权期间与最终点击前受众变化，但不能替代真实账号受众与回执验收。

可选的 `audienceSelection` 包含 `dialog`、`option`、`defaultCheckbox`、`confirm` 四个已审核选择器；原生 radio 可用 `optionLabel` 按关联 label 的完整文字匹配。驱动只选择本次帖子的受众，默认受众复选框仍被勾选时拒绝确认。`openComposerText` 可对没有 aria-label 的打开按钮做完整文字匹配；仍须唯一。`selectors.composerIdentity` 可指定编辑器中的当前作者链接；身份比较只移除 Facebook 的 `__tn__` 导航跟踪参数，账号 ID、路径和其他查询参数均必须一致。异步界面切换只轮询可见状态，不重试发布点击。

A privately reviewed profile can set `resolvePostLinks: true` when Facebook resolves timestamps on native hover. The driver hovers only the scoped post links and then requires a recognized Facebook post permalink; navigation tracking is removed consistently from the baseline and receipt. An unresolved placeholder, changed author, or duplicate new post cannot produce a published receipt. `textOnly: true` restricts a partially reviewed production profile to text before opening a browser tab. Keep this restriction until the live media input and attachment preview are independently reviewed; the global file-input ambiguity guard remains active.

`receiptUrl`, when configured, must equal the reviewed account `identityHref` and have a separate `selectors.receiptIdentity`. Baseline and receipt scans use that page; the driver returns to the publishing page and rechecks the acting identity before preparing. After the single publish click it waits for the composer to close before navigating to read the receipt. `selectors.postHover` can target a reviewed timestamp wrapper when the link itself is replaced during hover.

The optional `selectors.postsReady` marks the reviewed profile feed readiness before its baseline is read. The baseline also records existing author/text pairs and refuses an identical text before preparing, even if an old timestamp has not resolved. Receipt resolution applies to the requested text, so unrelated old video placeholders cannot be mistaken for or prevent observation of the new post. Read-only timestamp observations have bounded retries; the publish click is never retried.

### 发布冷启动与回执传输

已确认发布提交后，应用在响应结束后尝试唤醒其绑定的受管节点。每五分钟的认证调度入口也会扫描持久化发布队列，恢复提交后进程中断的情况；扫描只预留原任务、保存启动 outbox，不创建人工交互任务。启动前、取得唯一 dispatch claim 后和释放节点密钥前，分别重新验证节点所有者、明确的未过期发布 scope、账号授权与登录状态、原确认人的当前项目编辑权限、启用的渠道、有效内容确认及 Gate 01。项目归档、未知结果和已披露任务不授权新的冷启动。外部效果仍由原发布授权与租约规则控制。

执行器在成功观察后最多传输同一份回执三次，不重新授权或重复点击。无法确认回执仍为 unknown；已保存的 unknown 不被此次改动覆盖。失败代码仅包含固定阶段 `publication_publish_unknown`、`publication_observe_unknown` 或 `publication_validate_unknown`，不保存异常正文、账号或页面内容。这些阶段诊断与合成回归不能证明既有生产 unknown 已确认，也不等同于真实视频和 DM 验收。

### 未知文字发布的人工核对

发布面板对 unknown 文字任务提供人工核对表单。原节点所有者必须重新登录，具有管理、内容审核及项目编辑权限，核对实际账号、完整文案、受众与正式帖子链接，并填写私有 evidence 编号。服务端拒绝仍占用租约的任务、跨项目／跨所有者请求、变化的内容版本或当前 Gate 01，以及冲突的既有确认。

核对事务只确认原任务，更新发布与内容状态并追加 `social_publication.reconciled` 审计；精确重复请求幂等。原节点回执和观察时间不改写，渠道与账号继续保持暂停状态。平台发布时间未知时保持空值，不能用人工确认时间代替。界面标注“已发布（人工核对）”，避免将人工核对描述为平台成功回执。表单确认依赖人的实际核对，不是 Agent 自动验证帖子真实性，也不适用于视频未知结果。

### 私信实时连接诊断

`ftrade-diagnostics` 仅在平台创建的 `interactive` 容器中启用，并要求节点访问密钥。内部接口 `GET /ftrade/connection-diagnostics?userId=…&runId=…&tabId=…` 重新核对运行、账号、标签页及本地租约；该接口不经过公开接管网关。非人工任务、缺失密钥、越权或过期租约均不能读取。

诊断仅保存当前页的 `wss://gateway.facebook.com` WebSocket 创建、关闭、错误及收发帧次数，不读取或保存帧内容、PIN、完整 URL、查询参数、请求头和异常文本。每页最多跟踪 128 个连接，超出计入 dropped，页面关闭后清除。通过 session-created 的 page 事件在首次导航前接入，避免遗漏加载时建立的连接。

创建事件不等于握手成功，收发帧也不等于聊天恢复成功；零计数不能证明连接正常。计数只为排查提供证据，不改变账号、渠道、收件箱同步或安全存储状态。合成 Chromium 测试通过本地拒绝连接的代理验证实际 socket 错误，未连接 Facebook；真实 Messenger 诊断和修复仍需单独验收。


## 自动登录配置 version 2（#423，生产待验收）

节点在首次导航前必须等待 `/health` 同时返回 Camoufox 引擎、浏览器运行和连接就绪；HTTP 监听成功不代表 Firefox 预启动完成。检查受当前租约和取消信号约束，最多进行 60 次，不重发创建标签页请求。固定版本上游创建标签页请求超时后仍可能在后台完成，因此不得仅凭超时断言没有创建页面。


按 ADR 0002 的 2026-09-23 修订，保存账号时可以同时保存 Base32 TOTP 密钥及六位 Messenger PIN。二者复用账号登录凭据的加密封装与账号/渠道绑定，不另存明文；表单留空保留原值，清除登录会同时移除所有因素。这里的 Base32 是长期密钥，不是短信码或当前六位 OTP。节点本地生成 TOTP，不调用第三方 OTP API。

`FACEBOOK_LOGIN_PROFILES_FILE` 仍是私有页面契约数组。将匹配账号的 profile 设为 `version: 2`，保留 version 1 的全部字段并增加 `automation`：

- `accountRef`：目标 Facebook 数字账号 ID，必须等于运行绑定账号。
- `identity: { selector, attribute }`：唯一可见身份元素；属性只允许 `data-account-id`、`data-profile-id` 或可解析为数字账号的同源 `href`。 对没有可见身份元素的 Messenger PIN 页，可审核后使用 `attribute: "facebook-current-user"` 和固定 `selector: 'script[type="application/json"]'`：只解析结构化 `CurrentUserInitialData`，要求所有非匿名记录的 USER_ID/ACCOUNT_ID 与目标账号一致，并由插件逐次核对浏览器会话的 c_user 及可选 i_user。Cookie 值不传给页面或写入结果；缺少 Cookie、冲突记录或切换身份不能确认就绪。解析有节点数、深度和字节上限。
- `passwordSubmit`：密码登录的唯一提交按钮选择器。
- `totp: { url, marker, input, submit }`：TOTP 页精确 URL、阶段标记、输入框和按钮。 对已审核的 Facebook 验证器页面，可增加 `mode: "facebook-authenticator"`，URL 固定为 `/two_step_verification/two_factor/` 的完整 Facebook 地址。此模式只接受唯一的 encrypted_context、flow、next 参数及已知登录流程，核对英文验证器标题与唯一 Continue 按钮，允许输入后最多等待 1.5 秒启用按钮；始终禁用、页面改变或超时均不点击。它只点击审核过的 ARIA 按钮，不原生提交页面上的 GET 表单。其他语言或验证方式须另行审核。
- `pin: { url, marker, input, submit }`：PIN 对话框契约；输入后自动提交的页面可以将 `submit` 设为 `null`。
- `ready: { url, marker, empty, emptyText, thread }`：Messenger 就绪页面、唯一列表根节点、列表内的空状态选择器与精确文案、列表内会话项选择器。必须看到唯一空状态或至少一个会话项，两者冲突、只有标题/加载壳或存在可见对话框都不能就绪；必须同时验证当前账号身份。
- `checkpoint`、`rejected`、`loading`：安全挑战、拒绝及加载状态的选择器。

所有 URL 必须是 `https://www.facebook.com` 来源，选择器和 URL 必须来自实际页面审核；不能直接将测试夹具选择器用于真实账号。配置仍有最长 30 天有效期，更新后重启 Agent。仅配置因素但未安装匹配 version 2 页面契约不会启用自动提交。模板和 Git 中不得包含真实账号、私有规则或任何凭据。

所有者打开账号后，匹配 version 2 范围的 interactive 运行在就绪心跳中获得一次性授权，不要求先连接 VNC。平台重新检查有效所有者会话、节点/账号绑定、凭据版本、代理出口配置及租约；普通同步、容器环境和日志不包含因素明文。自动授权和凭据释放的绝对截止时间最多 180 秒，不能通过心跳无限续期，并受运行及配置期限限制。容器租约仍为独立的 90 秒：每次观察或提交重新读取当前租约并将页面操作期限截断到该租约；租约过期会立即拒绝操作。人工填充仍最多 30 秒。过期的自动授权不能提交 ready 回执。旧版填充运行只获得用户名和密码，不能读取 TOTP/PIN 或回报自动登录就绪。

节点通过专用鉴权插件观察页面并单次提交密码、当前 TOTP 和 PIN。PIN 输入前要求账号身份匹配；就绪要求身份与 Messenger 页面同时匹配。提交后的页面上下文销毁只允许有限重试读取，不重发密码或验证码。缺少因素、凭据拒绝、不支持的验证方式、页面不匹配、撤销及未知结果停止本轮；自动拒绝或未知结果以 `page_contract_failed` 暂停后台任务并回收容器；加载超时、观察失败和回执丢失不构成确认掉线的证据。具体挑战仍保留在受限回执字段中。已领取凭据的自动运行可随拒绝回执报告受限枚举 `checkpoint`、`rejected` 或 `unsupported_factor`；平台保存并显示对应处理提示，拒绝任意自由文本及冲突重放。遇到人机或设备验证时，节点先提交受限的 `login-challenge` 回执，界面提示接入远程页面；在本次自动授权剩余时间内只观察页面，人工完成后继续原流程，不重新领取凭据、不重复提交已执行因素、不延长授权。自动任务仍执行时关闭远程查看窗口不会触发查看器断线回收；显式停止、撤销、租约或授权到期仍终止运行。该交接已通过合成执行器、数据库与 UI 测试，真实全流程仍待验收。只有有效的 `ready` 回执可更新账号登录状态，不能自动解除渠道暂停或授权内容发布。

验证证据：加密因素保留/轮换/清除测试、RFC TOTP 向量、PostgreSQL 无 VNC 授权/并发单次领取/旧版隔离/撤销检查，以及 Chromium 完整执行器密码→TOTP→PIN→Chats 链路。合成浏览器网络全部拦截；另有真实本地密码、TOTP、PIN 和 CAPTCHA 人工处理后恢复证据，见 `docs/testing/reports/facebook-automatic-pin-local-20260923.md`。本地正式 broker 的已登录会话→PIN→持久化 ready 续跑，以及需重新认证会话的一次授权密码→TOTP→PIN→持久化 ready 均已通过。后者复用前次 CAPTCHA 会话资料但重新提交全部因素；真实 CAPTCHA 在原运行内人工完成后的续跑及生产部署仍待验收。
## Native Firefox profile 试验接入（#414）

`BROWSER_NATIVE_PROFILES=1` 为节点级显式开关，默认关闭。镜像必须带
`io.ftrade.native-profile=1` 标签。启用后，所有任务仍挂载同一账号的
`ftbrowser-<node UUID>-<account UUID>` 卷，但使用其中的 `native-profile-v1/firefox`
作为原生 Firefox profile；任务不能指定任意路径。缺少初始化记录、账号/节点不匹配、
源快照改变或 profile 被占用时拒绝启动，不退回临时 profile。

迁移前停止该账号的任务，确认所有访问该卷的容器均已停止，并保留受保护的卷备份。
在受信任的本机管理环境将**已有**账号卷挂载为 `/data`，使用已审核镜像中的
`/app/ftrade-native-profile.mjs` 导出的 `initializeNativeProfile`，传入绑定的
`accountId`、`nodeId` 和 `source: "legacy-json"`。该操作不能由任务调用。
初始化记录源快照摘要；首次启动导入一次，之后只使用 native profile。
原 JSON 文件保留，不再由旧 persistence 插件恢复或覆盖。包含 IndexedDB 的旧 JSON
会拒绝迁移，因为这不能证明其中的加密密钥可恢复。

只有确认不存在旧会话的新账号才可显式选择 `source: "empty"`。不要因登录检查失败、
CAPTCHA 或网络错误重新初始化。Native 模式关闭了旧 persistence 插件的重置接口；
重置必须作为单独的人工运维操作，在停止任务并确认备份后执行，不能依赖旧接口清除
原生状态。回滚时停止容器、关闭开关并恢复已确认的备份；旧 JSON 不包含迁移后的活动，
因此回滚后必须重新检查会话有效性。

该开关目前仍在验收中。原生 profile 保留不等于网站会话永不失效，尤其不能保证
session-only Cookie 跨浏览器退出保留。每次任务应先观察账号身份和 Messenger 状态，
确认失效后才进入有限恢复；本地同账号连续性已验证，先观察再领取凭据的执行器及数据库门控也已接入测试；
组合版本联调和生产接入仍待验收，不应仅凭本地证据开启生产自动恢复。
