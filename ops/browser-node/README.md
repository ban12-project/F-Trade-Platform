# 按需 Browser 节点（PR #323 / Part of #322）

这是多账号隔离浏览器的控制面和按需运行节点。一个 VPS 配置一个平台 Access Key，自动同步该节点的全部账号授权及资源策略；不是给每个浏览器配置一套平台密钥。不同 VPS 必须分别创建节点/Key，防止共享 Key 后无法单独撤销。Key 只允许访问绑定的账号，不能读取平台主加密密钥、其他节点账号或所有人的密码。

## 已实现与明确边界

- `/workspace/browsers`：节点创建/轮换/撤销、账号与加密凭据、排队状态、人工登录/2FA 接管。
- PostgreSQL 节点行锁串行预留容量；队列和租约持久化，不依赖 Vercel 进程内存。不同节点各自调度。
- 常驻的是轻量 Agent 与 HTTPS 网关，不是所有 Firefox。每个获租约账号启动独立容器/网络，使用账号独立 volume；结束后删除容器和网络，保留 volume。
- 一次性平台票据换取短期 viewer / WebSocket 能力；不依赖第三方 Cookie，不把节点 Key 或 Camofox API Key 发给前端。VNC 密码是每次运行生成的临时值，只在已授权 iframe 中使用。
- 内置执行能力仅 `interactive`。`inbox` 周期排队和 `publish` 优先级/未知结果策略已在调度核心实现，但不包含经过真实 Facebook 验证的入站采集、图片/视频发布或自动填入密码执行器。不能把开浏览器等同于完成原 Issue 的业务闭环。
- 账号密码可加密保存，当前不批量下发，也不自动输入；当前登录/2FA 在远程页面手动完成。验证码、TOTP 种子、恢复码不进入该协议。
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

`build-browser.sh` 固定 Camofox 源提交 e5a36f5cd0332fde6597de474329a308a53a0716，并构建附带看门狗的本地镜像。基础镜像、包源仍可能变化，正式部署应审核并按镜像 digest 固定供应链。Agent 仅使用启动时已存在的本地镜像 ID，平台任务不能指定任意镜像或挂载。

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

依据：PostgreSQL 行锁 https://www.postgresql.org/docs/current/explicit-locking.html；Docker socket 权限 https://docs.docker.com/engine/security/；Camofox 固定源 https://github.com/jo-inc/camofox-browser/tree/e5a36f5cd0332fde6597de474329a308a53a0716。

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

`facebook-adapter.mjs` 可作为 `BROWSER_TASK_ADAPTER` 的本地绝对路径。启用前必须配置 `FACEBOOK_DOM_PROFILES_FILE` 指向私有 JSON 文件；文件为 1–16 项数组，每项有 `version: 1`、`channelRef`、`accountRef`、`reviewRef`（`evidence-` 开头的审核引用）、ISO 时间 `reviewedAt` / `expiresAt`（最长 30 天）、固定 Facebook 页面 `url`、精确当前身份链接 `identityHref` 和 `selectors`。选择器键为 `identity`、`openComposer`、`composer`、`textbox`、`submit`、`fileInput`、`attachmentName`、`post`、`postAuthor`、`postText`、`postLink`。身份必须是当前操作身份，而非页面上任意作者链接。审核引用是运维声明，不是服务端自动证明页面契约已审核。

不提供声称适用于真实 Facebook 的默认选择器。配置应在获授权环境中核对唯一控件、身份链接、附件名称及帖子凭证，存于 VPS 私有配置并挂载给 Agent；不得放账号资料或私密页面证据进 Git。缺少配置、重复账号、过期审核、错误来源或歧义控件均拒绝执行。节点注册声明配置覆盖的账号及到期时间，平台在调度、领取、媒体读取和最终授权时限制范围。未声明范围的旧自定义适配器保持原有授权账号范围；它仍是受信任代码，不是安全沙箱。

驱动使用固定上游的 create/type/upload/evaluate 接口。最终点击在一次页面执行中重新核对身份、正文、附件、唯一按钮、配置有效期和授权截止时间；只执行一次 DOM click，不调用可能回退重试的通用 click API。上游 upload 选择全局第一个文件输入，因此这里要求整个页面恰好一个文件输入且属于已核对编辑器。浏览器与 Agent 必须在同一 VPS 使用宿主时钟。不得通过本驱动的 type/evaluate 输入保存密码；上游这些接口可能记录参数，密码执行仍未接入。

`tests/e2e/facebook-driver.spec.ts` 的 9 项 Chromium 测试拦截全部网络，仅使用合成 HTML 与 Camofox API 桥接，覆盖文本/图片/视频、身份变化、重复编辑器、错误附件、传输途中授权过期和额外文件输入。它验证实际 DOM 操作与拒绝路径，不证明真实 Facebook 接受合成 click、页面选择器长期稳定或实际 Camofox 媒体上传成功。默认能力保持人工交互，真实账号验收另行执行。

### 被动入站持久化边界

`ingestFacebookInboundBatch(tx, input, actorId)` 复用现有会话、消息加密及 30 天有效期。在同一事务内锁定渠道控制和会话，按渠道/账号/会话/消息标识去重；相同标识但正文或接收时间变化会拒绝整个批次，不静默覆盖。乱序消息不倒退 `lastMessageAt`，已删除消息不会被重新填充正文。暂停渠道、未来消息、超过保留期的消息和过期观察均拒绝。每批最多 20 条，审计不含正文。

新会话保持 `leadId = null`，进入现有待分流列表；只有人工调用现有分流动作才会建立销售项目、Lead 和 RFQ 收集任务。真实 PostgreSQL 回归覆盖并发去重、批次回滚、加密与有效期、删除重放及人工分流后的继续入站。此函数是领域存储边界，不是认证接口：调用者仍须校验节点身份、有效 inbox 租约、账号范围、签名及重放约束。节点签名 HTTP 接口见下文；可配置页面采集器见下文；未配置经审核的真实页面契约时不能声称已完成私信接收。

### 租约签名入站接口

`inbox-messages` 已通过 `/api/browser-nodes` 接入上述领域事务。Bearer Key 先绑定节点、安装与启动身份，再验证 inbox 运行状态、租约、账号授权、凭据版本及消息签名。仅 inbox claim 返回当前租约的派生签名密钥；派生范围包含节点、账号和租约，平台 `SOCIAL_WORKER_SIGNING_KEY` 不离开服务端。Agent 向适配器提供 `reportInbound(messages, observedAt)`，不暴露签名密钥。回调先检查有效租约和浏览器出口，再签名上报；失败后本次运行不能继续上报，后续轮询依消息 ID 去重。

每个请求绑定 UUID 和载荷摘要，消息与回执同事务写入。相同请求重放返回原计数；相同编号改稿拒绝。每运行最多 100 个消息批次，每批 1–20 条，另加一个显式完成回执；HTTP 总请求最多 256 KiB，Agent 在 250000 字节处提前拒绝过大封包。正文超过单批容量时由采集器拆批，不能截断成另一条消息。运行终止后旧请求拒绝，内部摘要回执不进入管理 UI；消息正文不写入节点文档或审计。

数据库回归直接执行实际 Route Handler 和 broker，覆盖签名、HTTP 鉴权/大小限制、租约、过期与重放。尚未通过真实 HTTP 网络、VPS 或 Facebook 页面采集验收；内置适配器可显式配置发布或收件箱，默认 Agent 仍只有人工交互。轮询完成协议见下文；可配置页面采集见下文，不能通过空实现返回 completed 来宣称完成检查。

### 轮询完成回执

采集器完成当前可见收件箱检查后，调用 `reportInbound([], observedAt, completion)`。`completion` 含 `reviewRef`、`scanStartedAt`、`coverage: "visible_inbox"`、`conversationCount` 和 `messageCount`。服务端要求开始时间属于当前运行，消息总数等于该运行已提交批次的接受数与重复数之和，并再次检查渠道可用。无消息也必须提交这份显式回执；普通空消息批次无效。允许最多 100 个消息批次加 1 个完成回执。

完成回执与运行状态原子保存，精确重放幂等；完成后新消息批次拒绝。只有持久化完成回执且正常停止，才把 inbox 标记 completed 并以 observedAt 更新检查时间。仅返回 completed 的旧适配器会以 inbox_completion_missing 失败，检查时间不变。异常结束不推进检查时间。这里证明的是受信任驱动声明的可见范围，不是全部历史、隐藏线程或 Messenger 加密历史已完整收集；签名和审核引用不能自行证明页面观察真实性。

### 可配置的只读收件箱采集器

`facebook-adapter.mjs` 现在可分别读取 `FACEBOOK_DOM_PROFILES_FILE`（发布）和 `FACEBOOK_INBOX_PROFILES_FILE`（收件箱）。至少提供一类配置，只有存在相应已校验配置时才声明该能力。两类配置独立声明账号范围和到期时间；平台在收件箱调度、领取和上报时拒绝过期或未覆盖账号。默认 Agent 仍只启用人工交互，仓库没有真实 Facebook 选择器配置。

收件箱配置同样是 1–16 项数组，每项含 version/channelRef/accountRef/reviewRef/reviewedAt/expiresAt/url/identityHref。selectors 必须完整包含 `identity`、`inboxReady`、`conversationLink`、`emptyInbox`、`threadReady`、`threadIdentity`、`message`、`inbound`、`outbound`、`body`、`time`、`emptyThread`、`challenge`、`loading`、`moreThreads`、`moreMessages`。`attributes.conversationId` 和 `attributes.messageId` 指定经过核对的稳定 data-* 属性；message 的 inbound/outbound 选择器作用于消息元素自身。时间元素必须提供可解析的 datetime。不能用正文指纹冒充稳定消息 ID，不能把消息列表中的任意用户链接当作当前账号身份。

采集器在同一租约标签页内导航，只使用 create/navigate/evaluate，不使用 click/type/upload。线程链接必须属于固定 Facebook `/messages/t/` 路径并与会话 ID 一致。每个页面检查当前账号和加载/挑战状态；明确出站消息跳过，入站方向不明、ID 缺失或重复、时间无效、显示更多分页、列表变化均停止且不提交完成回执。已接受的前序批次保留，下一轮按稳定消息 ID 去重。观察范围明确为 visible_inbox，不声称已读取所有隐藏或加密历史；打开线程可能产生平台已读状态，不能解释为平台侧零副作用。

当前单次最多 20 个可见线程、每线程 100 个可见消息元素、总计 200 条入站消息；线程正文总量最多 200000 字符，响应最多 1000000 字节。每批最多 2 条，避免多字节正文超过上报容量。超限会失败，不静默截断并宣称完成；更大收件箱的分页/游标方案仍需独立实现与验证。

`tests/e2e/facebook-inbox.spec.ts` 在完全拦截网络的 Chromium 夹具上连接生产签名上报器，覆盖正常/空/仅出站、错误身份/线程、缺失或重复 ID、方向歧义、未完成分页、挑战、列表变化和回执丢失。真实 Camofox 网络、真实 Facebook DOM、VPS 日志/插件隐私和 Messenger PIN/历史行为仍未验收。固定上游 evaluate 会把返回值传给本地插件事件；不得添加未经审核的插件或把这些事件写入日志/遥测。
