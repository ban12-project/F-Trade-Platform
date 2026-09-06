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

经审核后用项目的 `pnpm db:migrate` 应用迁移。登录具有 `settings:manage` 权限的账户，打开 `/workspace/browsers`：创建节点，填写该节点的 HTTPS 接管域名，设置容量，保存只展示一次的 Key。然后为节点授权账号、固定 HTTP 代理及可选加密账号密码。

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

平台保存授权后，节点用同一个 Key 获得账号配置。点击“排队打开浏览器”，有容量时启动，状态变成运行中后点击“接入登录 / 2FA”。核对代理出口和目标账号，完成登录后关闭连接，再显式确认登录有效。人工接管不是自动内容发布授权。

无任务时只有 Agent/Caddy 在线。查看运行容器时按 `io.ftrade.node` 标签过滤，避免公开完整 `docker inspect`，它可能包含代理密码。不要运行 `docker compose down -v`，不要删除 `ftbrowser-*` 卷；账号会话只保存 Cookies/localStorage，默认不保存 IndexedDB 或完整 Messenger 历史。

轮换/撤销 Key、撤销账号授权会使旧续约失败，网关关闭连接；最长还可能存在当前租约加停止宽限期。新 Key 更新到 VPS 后重启 Agent。节点故障时不自动把账号移到另一台 VPS，需确认旧节点已停止并采用受控迁移流程，当前没有在线迁移功能。

## 后台执行器接口

Node Agent 可通过本地 `BROWSER_TASK_ADAPTER` 导入一个管理员审核的模块，模块声明 `capabilities: ["inbox", "publish"]` 的子集，并导出 `execute({ run, signal, browserRequest })`。模块必须响应中止信号，并在网络操作前验证有效租约、固定出口与账号。不能从平台任务传入适配器路径或脚本。

默认镜像没有这些业务能力，不会创建假收件箱检查记录。接入发布时还需把现有已人工确认的业务任务送入资源队列，并保留既有签名发布回执、Gate 01 和不确定结果的人工处理。当前 UI 不能绕过内容审核创建原始发布任务。

## 验证

```bash
node --import tsx --test scripts/test-browser-fleet.mjs scripts/test-browser-node.mjs scripts/test-browser-fleet-protocol.ts
pnpm typecheck
```

CI 还运行独立 PostgreSQL 容量并发/唯一绑定/迁移测试、Compose 校验与 Agent 镜像构建。真实浏览器镜像、真实代理、HTTPS/noVNC、FB 登录/2FA、重启恢复及压力测试必须在试运行 VPS 验收，合成测试不能替代这些验收。

依据：PostgreSQL 行锁 https://www.postgresql.org/docs/current/explicit-locking.html；Docker socket 权限 https://docs.docker.com/engine/security/；Camofox 固定源 https://github.com/jo-inc/camofox-browser/tree/e5a36f5cd0332fde6597de474329a308a53a0716。
