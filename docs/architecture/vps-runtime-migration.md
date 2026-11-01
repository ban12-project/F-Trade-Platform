# VPS 执行服务迁移与验收（#722）

> Compute-only update (#801): the owner now requests Vercel Sandbox for document/media/render compute. See [the current compute decision](vercel-compute-return.md). The VPS browser decision remains in force; the report below records the earlier migration.

状态：执行服务迁移、生产部署及旧云端资源退役已完成。记录日期：2026-11-01。

实现见 PR #723；实际计算、私有存储与隔离证据见 `docs/testing/reports/vps-compute-20261101.md`。应用、数据库、Blob 和 Workflow 控制面仍保留在原平台，业务发布／DM 验收不因本次基础设施迁移自动通过。

## 目标与边界

将浏览器、文档解析、素材探测、视频抽帧以及 FFmpeg／Remotion 渲染的全部生产 Vercel Sandbox 执行迁移到专用 VPS。OpenShip 管理服务器、域名和 TLS；受限业务服务由原生 Compose 部署；应用、数据库、授权、业务状态机及 Workflow 控制面本次仍使用原部署。

这不是把整个应用迁到 VPS，也不要求迁移 Vercel Blob。保留 Blob 存储及其短期私有下载授权，不等于仍在使用 Vercel Sandbox。旧 provider 的只读检查和删除能力仅供迁移与清理；最终交付永久拒绝新建／恢复 Vercel Sandbox，旧环境开关不能重新启用。VPS 发生错误不得自动创建 Vercel 实例。

本文使用 `panel.example.com`、`browser.example.com`、`runtime.example.com` 作为部署占位域名。真实账号、邮箱、节点标识、密钥、profile、签名 URL 和私有环境配置不得进入 Git。迁移回执如含账号／节点关联标识，也应放在受限运维存储中，而非公开测试报告。

## OpenShip 与执行隔离的分工

[OpenShip 官方安装文档](https://openship.io/docs/getting-started/installation)推荐 Linux VPS 使用 Docker Compose 模式。其部署栈包含数据库、Redis、API、管理界面及 OpenResty 入口；部署平台对 Docker socket 的访问具有宿主机级权限，不能把管理面板凭据下发给业务任务。

OpenShip 的部署和命令接口不能直接替代本项目的 Sandbox 契约。核对官方仓库源码时，`apps/api/src/modules/system/server-resource.routes.ts` 的服务器 exec 接口运行宿主机 shell，`apps/api/src/modules/services/service.routes.ts` 的 exec 接口进入已有服务容器；两者说明的命令上限为 120 秒，并截断合并输出。它们本身不证明独立任务容器、十分钟处理期限、文件传输、账号持久化和回收语义已经实现。

因此分工为：

- OpenShip：服务器、域名、证书和运维入口；本次受限服务的镜像版本及部署仍使用原生 Compose。
- 浏览器 Agent：保持账号授权、独占租约、按需浏览器、一次性接管票据、固定代理和持久 profile。
- 计算服务：独立短期任务容器、服务鉴权、资源与并发上限、文件限制、网络限制和独立期限回收。
- 原应用：请求认证与授权、输入验证、业务状态、审核 Gate、任务调度及私有资产归档。

浏览器改为常驻轻量 Agent 时，按需启动的是浏览器容器；不能继续执行原 VM 停机脚本关闭整台 VPS 的 Docker daemon。原托管脚本的会话和快照语义也不能直接套用到共享宿主机。

### OpenShip 0.9.5 的 Compose 限制与部署决策

对照已安装版本的 `v0.9.5` 源码，常规 Compose 导入／部署不是原生 `docker compose` 的完整透传：

| 字段 | OpenShip 0.9.5 行为 | 对本迁移的影响 |
| --- | --- | --- |
| `network_mode: host` | 明确拒绝；advanced service 字段也不能绕过 | broker／Agent 的宿主机回环监听不能原样部署 |
| `cap_drop`、`security_opt`、`read_only`（根文件系统）、`pids_limit`、`init`、`logging` | 不建模，通常仅给 warning | 会丢失现有权限、文件系统、进程或日志限制 |
| service-level `tmpfs` | 不建模 | 内存挂载及其容量约束不会保留 |
| long-form `volumes[].type: tmpfs` | 阻止导入 | 防止被错误转换为持久磁盘卷，但不提供兼容运行方式 |
| `mem_limit`／`cpus`／`deploy.resources.limits` | 转换为资源限制 | 支持这部分不代表其他保护字段被保留 |
| bind 的 `:ro` | 支持 | 只读挂载不等于根文件系统只读 |

证据为 [v0.9.5 Compose parser 的不支持字段表](https://github.com/oblien/openship/blob/v0.9.5/packages/platform/src/engine/lib/compose-parser.ts#L674)和 [host namespace 拒绝规则](https://github.com/oblien/openship/blob/v0.9.5/packages/core/src/compose-namespace.ts#L72)。不能为消除导入警告而删除上述安全字段。

最终部署决策：**OpenShip 管理服务器和 edge，受限 broker／Agent 仍由原生 Docker Compose 执行**。服务版本、更新与回滚使用审核后的 Compose 文件和固定镜像 digest；启动后读取必要的 Docker 配置字段验证网络模式、只读根、capabilities、security options、tmpfs、内存、PID 限制及挂载。应用仅持有专用任务服务凭据，不持有 OpenShip 宿主机管理员 token。

不采用 `attach-live` adoption。虽然同机 reuse 能保留当前运行容器，后续 OpenShip Redeploy／环境重应用仍从其不完整服务模型重建，可能丢失保护；没有证据表明 adoption 自动禁止这类重建。不能把本方案描述为 OpenShip 原生应用部署已完全接管。

TLS 入口由明确维护的 OpenShip edge 路由指向宿主机 `127.0.0.1:9400`（浏览器）与 `127.0.0.1:9500`（计算服务）。管理面板证书通过不代表这两条路由成立：需分别验证证书、鉴权、浏览器 WebSocket 升级／过期撤销及 edge 重启后的路由持久化。原始服务端口不得因此改为公网监听。

## 必须逐项验收的范围

| 生产用途 | 代码入口／契约 | 必须取得的直接证据 |
| --- | --- | --- |
| 浏览器启动、恢复、停止 | `lib/browser-fleet/sandbox-provider.ts`、`sandbox-runtime.ts`、`sandbox-session.ts`；`workflows/browser-sandbox.ts` | VPS 实际启动及空闲／撤销回收；刷新列表不启动；响应丢失、重复投递、旧会话不得创建重复执行 |
| 浏览器状态与存储检查 | `lib/actions/browser-nodes.ts` → `sandbox-inspection.ts` | 只读检查不恢复运行、不调用 Vercel；原 `Snapshot.get` 状态已有明确替代或按托管类型正确禁用 |
| 发布页面只读检查 | `lib/browser-fleet/publication-page-inspection.ts` | 自管节点走已绑定网关；保留拥有者、租约、票据及 origin 校验；不再要求 VPS 域名以 `.vercel.run` 结尾 |
| 文档／PDF／OCR 解析 | `lib/product/document-source.ts`；`uploaded-document.ts`、`claimed-document.ts`、`workflows/product-catalog-import.ts` | 真实应用入口到 VPS 的合成 PDF／表格转换；预置 OCR 模型；禁网；失败和超时清理；不凭空生成工程事实 |
| 产品媒体探测 | `lib/actions/product-media.ts` → `media-sandbox-probe.ts` | Action 授权后下载确切私有素材，运行 ffprobe 并保存结果；不是仅验证 Workflow 路径 |
| AI 视频初稿素材分析 | `workflows/marketing-video-processing.ts` → `extractMarketingVisualSamplesInSandbox` | 视频抽帧、镜头分析和后续 AI 初稿贯通；渲染成功不能代替本项 |
| FFmpeg 时间线成片 | 同 Workflow → `renderMarketingTimelineInSandbox` | 字幕、音轨、时长、尺寸、编码及成片验收；结果沿用私有资产交付 |
| Remotion ABCD 成片 | 同 Workflow 的 `VIDEO_COMPOSITOR=remotion` 分支 → `remotion-sandbox.ts` | 显式启用该分支的真实渲染及 ffprobe；默认 FFmpeg 测试不能证明该分支已迁移 |

应用仍在 Vercel，必须从实际应用部署验证长任务 HTTP、文件传输与 Workflow 重试。VPS 本机 smoke、类型检查或控制面健康检查，都不足以证明上述端到端路径。

## 已观察证据与未知

以下是主迁移执行者的实测回报，记录在本次操作过程中；不是本审计文档重新执行的测试，也不包含业务验收结论。

| 项目 | 已观察结果 | 证明边界 |
| --- | --- | --- |
| 旧 Coolify 卸载 | 按官方文档删除容器、卷、网络、镜像及数据；撤销其 SSH 公钥授权和 Docker daemon 配置；复查无相关运行资源 | 证明旧部署基座已移除；保留事先安装的 Docker 和原有 SSH 登录配置 |
| OpenShip 安装 | 0.9.5 的五个容器就绪 | 不证明业务服务或宿主机重启恢复已验收 |
| 管理域名 HTTPS | 公网 TLS 验证结果为 0 | 证明该管理入口证书通过验证；不代表浏览器 WebSocket 或计算服务入口已部署 |
| 管理员访问 | 登录及 session 请求 HTTP 200 | 不包含真实管理员标识、密码或会话；不证明业务用户授权 |
| 宿主机控制通道 | API 容器通过 SSH 8488 到宿主机，Docker 29.1.3 可访问 | 证明实际连接，不只是配置里填写了端口 |

安装过程中存在两项需要保留的限制记录：

1. OpenShip CLI 的宿主机连通性检查调用了容器内不存在的 `bun`，产生诊断失败。执行者通过容器内真实 SSH 和 Docker 命令另行验证成功。不能把 CLI 诊断错误解释成已解决的上游缺陷；后续升级需复查。
2. 首次管理域名注册遗留 `external_ingress=true`，安装器提示完成但公网返回自签名证书。执行者在核对域名记录及实现后，定点修正这一字段，再调用官方 self-register 流程完成证书签发，公网验证通过。复装／升级时必须验证实际证书，不能只检查 CLI 的成功文字。该修正仅作用于管理域名，不应泛化为批量修改其他域名数据库记录。

后续实测回报（仍不是完整业务验收）：浏览器迁移 plan／apply 已提交；目标 Agent 已就绪；独立 verify 确认源端仍停止、5 条结果未知历史保持、过期交互隔离通过正常恢复协议结清。切换前界面节点／账号状态与数据库一致。生产环境已配置 VPS 入口和独立凭据；本地应用构建通过。Workflow 生产与 preview 环境的 running／pending 枚举均为空，分页游标均已结束。

安装和切换阶段证据本身不能代替生产调用、浏览器接管及资源退役验证。此后取得的实际验收与退役结果见下节；未覆盖的业务功能和异地灾备恢复不得据此宣称通过。

## 最终执行证据

- 生产应用已发布 PR #723 的永久退役实现。计算默认使用 VPS；陈旧 provider 参数直接拒绝；托管创建 UI、store、provider create/resume、旧 smoke/template 入口及派发 cron 已退役。
- 12 个卷、Facebook 私有配置的内容／所有者／权限／链接指纹一致，434 个 SQLite 副本含 WAL/SHM/journal 全部完整。原浏览器镜像在两次独立容器中保持 Cookie、localStorage、IndexedDB 非导出密钥与解密能力，并拒绝跨账号访问。
- 正常 Agent 恢复协议完成隔离交互结清；5 条原有 unknown 发布历史未变。旧节点密钥实际返回 403。实际账号冷启动后保留登录状态，独立 HTTPS/WebSocket 接管画面及键鼠输入通过；结束接管后旧连接撤销、任务容器释放。未发送消息或发布内容。
- 嵌入窗口在浏览器自动化中未得到加载证据，工具报告正在处理暂停的文档响应；独立窗口验证成功。不能把独立窗口证据描述为嵌入模式通过，也不能据此单独认定服务器故障。
- 在隔离、未绑定正式域名的 Vercel 生产环境验收部署上，真实 Workflow step 调用了同一组文档、探测、抽帧、FFmpeg、Remotion 领域函数，使用自动 OIDC 和合成私有 Blob，五条路径全部通过。测试未写业务数据库；精确测试对象删除后以 Blob 列表独立复核为空。临时入口与三个验收部署均已删除，正式应用返回 404。
- 当前计算镜像通过原生 PDF、套件 PDF 及真实 Tesseract 八列表格 OCR 回归，覆盖损坏输入、行间隔离、超时降级；生产原有 OCR 开关保留。
- 项目 Pro／Fluid 已核实，默认函数期限配置为 800 秒。旧版本粘滞窗口关闭；旧部署 URL 仍要求 Vercel SSO。生产和 preview 的旧 running／pending Workflow 均已完整分页确认为空。
- 最终删除 3 个命名实例及 4 份有效快照，连续两次分页复核均为实例 0、有效快照 0；101 条 deleted 历史记录仍可被 API 列出，不是仍存储的有效快照。初始 101 条总记录的大小合计不能用于估算当前计费。
- 专用 VCR 仓库删除后，仓库列表为空且 next 游标为 null。旧模板、镜像及 vCPU 环境配置已移除；共享 platform origin 保留供 VPS 页面检查使用。
- 复查未发现 Coolify 控制面资源／数据目录／计划任务或临时接收器、夹具端口。原生服务仅监听回环，任务无 Docker socket，TLS 和续期定时器有效；空闲时实际重启 edge 后三个入口的配置和证书仍有效。未用全局 prune 删除共享依赖，也未把 edge 重启表述为整机重启验证。

完整迁移归档保留在 VPS 的 root 私有目录；本机保存数据库切换回执和关键配置。没有宣称本机已保存完整 profile／镜像副本，也没有验证异地灾备恢复。全部云端快照退役后，回滚必须使用这些 VPS／本机材料，不能依赖旧 Vercel 快照。用户手动恢复旧应用版本或重新配置云端创建能力不属于本次运行中的费用阻断范围；已产生的历史费用仍按平台账单结算。

## 切换前的约束

- 容量按整机预算计算：OpenShip、Agent、浏览器与计算任务可能同时占用资源。各自限制一个任务不等于总内存可控；验证并发时的拒绝、排队和正常服务响应。
- 计算任务不得获取 Docker socket、宿主机挂载、应用数据库凭据、平台管理 token 或其他账号文件。文档任务禁网；媒体只允许确切批准的私有 Blob 来源，拒绝任意 URL、私网、DNS 重绑定及重定向绕过。
- 不能以缩小输入范围冒充等价迁移：`lib/video/upload-contracts.ts` 已允许单个视频接近 1 GiB、批次接近 3 GiB。计算服务下载上限、工作区容量及渲染临时文件空间必须与该契约一致，并测试边界；仅验证小型样例不足以通过切换门槛。
- 验证文件大小、路径、输出和命令期限限制。客户端断开、服务进程崩溃和重启后，独立期限仍必须回收任务。失败不能静默回退 Vercel。
- 浏览器同账号只允许一个执行方。`ftbrowser-${nodeId}-${accountId}` 账号卷与 Agent 的 `node-state` 均要迁移；还需保留 installation 身份、native profile 模式、私有审核配置和对应镜像版本。
- `vercel.json` 的浏览器派发 cron、outbox、publication／inbox wakeup、reconcile 和已有 Workflow 需一起核对。关闭 `BROWSER_SANDBOX_ENABLED` 不能替代队列及租约排空，也不能证明已有任务不会继续运行。
- 真实发布结果不明时不得重试；迁移测试以合成任务及授权的只读检查为主。业务 Human Gate 和原有真实账号验收限制继续适用。

## 切换步骤及证据门槛

1. **锁定交付版本。** 记录应用 commit、Agent／浏览器／计算镜像 digest 和 OpenShip 版本。Remotion renderer 版本、执行时传入的 bundle 与应用 revision 必须匹配；核对 `package.json` 的 `build:remotion`、`next.config.ts` 的 `.remotion` tracing 和构建流程后再决定是否移除旧打包行为。
2. **部署但不接收生产任务。** 配置独立的计算服务鉴权和 HTTPS；原始 API、浏览器端口仅由预定入口访问。验证未授权请求拒绝、正确证书、健康检查、重启恢复及日志不包含密钥／签名 URL。
3. **验证计算执行。** 逐项运行范围矩阵中的合成文档、素材探测、抽帧、FFmpeg 和 Remotion；增加超时、容量不足、服务重启、下载拒绝和输出超限测试。保留实际输出验收结果及失败清理回执。
4. **冻结并清点浏览器源端。** 停止新的账号任务流入；等待已知任务完成，隔离结果不明的发布。确认源 Agent、浏览器和相关 Workflow／租约不再执行。只在一致停止状态导出全部账号卷、node-state 和私有配置，包含当前列表之外仍保留的账号数据。
5. **恢复与比对。** 将私有归档直接传入受限目标存储，保留文件权限和归属；比对源／目标内容哈希、卷名称、installation 身份、模式及镜像。`verifyBrowserVpsRestore` 只校验提供的回执，不能代替实际读取、传输、恢复和重启验证。
6. **一次性切换浏览器执行归属。** 在数据库事务和独占控制下调整节点托管状态、网关及密钥配置，保留需要保留的节点身份；阻断旧派发后再启动目标 Agent。只读发布检查也必须走自管节点契约。不能仅改一项环境变量后让两端并行消费。
7. **验证应用端到端。** 使用实际部署验证账号 profile 重启保留、代理出口、HTTPS/noVNC、一次性票据、WebSocket 到期、画面和键鼠、空闲停止，以及未授权／旧租约拒绝。业务发布验证不由基础设施测试自动授权。
8. **切换计算提供方。** 在应用部署中显式选择 VPS，回读生产环境配置并再次执行所有计算入口。观察期间检查 Vercel Sandbox 无新增实例及调用，验证故障会清晰失败而非回退。
9. **清空旧计费资源。** 原云端快照只保留至迁移验收完成；先确认 VPS／本地备份可独立恢复，再清空全部已纳入迁移范围的 Sandbox 实例、快照、模板及专用 VCR 镜像。取消生产、预览、旧部署、Workflow、cron、smoke 和构建中的创建／推送入口；保留删除回执，并以全量分页清单和计费用量只读复核。不得为了云端回滚继续保留收费快照。

## 回滚

回滚必须显式执行并留证，不是适配器的自动 fallback。最终交付已永久退役旧 provider 的创建／恢复入口；回滚只依赖 VPS／本地已验证备份及镜像，不重新启用云端收费资源。

- **计算服务尚未写入业务结果时：** 先停止新的 VPS 任务提交，等待完成或确认终止现有任务；回退已验证的 VPS 应用／镜像和服务配置。只有重新确认授权与任务幂等性后才能重新提交。不能因为请求超时就推断远端任务没有执行。
- **浏览器尚未在目标运行时：** 保持目标停止，从已核验本地归档修复目标配置和数据，在确认旧会话与租约一致后启动目标；源云端只作为验收期间的只读比对来源。
- **浏览器已经在目标运行后：** 先停止目标接单并一致排空，导出目标最新账号卷和 node-state，再决定是否回传。直接恢复迁移前快照会丢失迁移后的会话和密钥状态，不是安全回滚。
- **发布结果未知时：** 保持隔离并人工核实，不重新发布。原节点、目标节点、队列和票据的独占关系必须再次核对。
- **旧云端资源已删除后：** 不能承诺立即回滚；需从已核验备份恢复运行环境和数据。删除前应明确这一恢复成本与证据。

## 创建入口永久退役与旧部署边界

仓库中的浏览器 provision 对 create／resume 无条件拒绝；authorization 不再释放旧密钥；旧派发路由即使开关为 `1` 也返回 disabled，cron 已移除。设置页移除托管节点注册表单，store 在身份校验后拒绝 `create-sandbox`；自管节点 create、查看、轮换、撤销及正常接管继续保留。只读页面检查适用于迁移后的自管节点，不能再用旧托管 metadata 是否存在来隐藏入口。旧 live 模板／浏览器／Remotion smoke 脚本已改为立即失败，不再上传素材或创建实例。

上述改变只约束部署了新代码的执行。旧部署绑定的 Workflow 与其旧配置必须另外排空／取消；发布新代码或删除显式 Vercel token 不证明旧部署失去能力。官方认证说明确认生产 OIDC 自动管理有效期。当前公开项目 API 的 Sandbox 配置只有区域和故障转移区域，未查得可独立禁止项目 Sandbox 创建的受支持开关，不能虚构 `sandbox.enabled=false`。[项目配置 API](https://vercel.com/docs/rest-api/projects/update-an-existing-project) · [Sandbox 认证](https://vercel.com/docs/sandbox/concepts/authentication)

本地 Workflow CLI `4.3.12` 可使用 `workflow inspect runs --backend vercel --env production --status running --json`，另枚举 pending 和 preview，遍历游标；以实际完整 workflowName、deploymentId 识别旧浏览器／文档／视频运行，再按确定 run ID 执行 `workflow cancel RUN_ID --backend vercel --env production`。使用显式 project／team，以及环境变量 `WORKFLOW_VERCEL_AUTH_TOKEN`，不把凭据写在命令参数，不启用输入输出详情或解密。取消后再次只读枚举；不能仅按名称批量取消新 VPS 版本的同名任务。

## 最终零新增 Sandbox 费用门槛

停止实例不等于删除存储。核对本项目安装的 `@vercel/sandbox` 3.2.1：`sandbox.delete()` 默认保留孤立快照；`delete({ deleteOrphanSnapshots: true })` 才请求异步删除未被其他实例引用的快照。因此必须独立复核快照清单，不能只凭实例删除响应完成验收。

清理执行顺序与范围：

1. 使用明确的 team／project 凭据，先完整收集 `Sandbox.list` 的所有分页，再逐项 `Sandbox.get({ name, resume: false, ...credentials })` 和 `delete({ deleteOrphanSnapshots: true })`。枚举不得仅按浏览器名称前缀筛选，否则会漏掉文档、视频、模板及测试实例；不要一边删除一边依赖正在变化的分页游标。
2. 独立完整收集 `Snapshot.list` 分页，对仍存在的快照通过 `Snapshot.get({ snapshotId, ...credentials })` 后 `delete()`。轮询只读清单确认异步删除完成；“deleted”历史记录与仍可使用的快照需区分。模板若为快照或命名实例，按实际资源类型删除，不能假定存在额外的统一 template API。[官方快照文档](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)
3. VCR 镜像存储独立计费，Sandbox 实例删除不证明镜像已删除。[官方 VCR 计费说明](https://vercel.com/docs/container-registry/limits-and-pricing) 核对 `vercel vcr ls --project PROJECT --format json` 及每个仓库的 `vercel vcr image ls REPOSITORY --project PROJECT --format json`，包括无标签镜像和全部分页。专用仓库可用 `vercel vcr rm REPOSITORY --project PROJECT --yes` 连同镜像删除；共享仓库使用 `vercel vcr image rm REPOSITORY IMAGE_ID --project PROJECT --yes` 精确删除，不能误删主应用仍依赖的镜像。分页参数以所安装 CLI 的 help 为准。[官方 VCR CLI](https://vercel.com/docs/container-registry/cli-reference)
4. 若实际资源清单出现独立 Drive 或其他附加持久存储，必须先确认归属、备份和消费者，再按对应资源接口清理；本地当前 SDK 未提供 Drive 导出，不能由“未搜索到调用”推断远端不存在。保留中的 Blob、主应用及数据库不属于本次 Sandbox 清空范围。
5. 对所有使用过的项目／环境执行第二次只读清点，确认实例、可用快照及专用镜像为零，并复核创建计数和存储用量不再增长。账单可能仍显示删除前已经产生的用量；目标是清理后不再新增这些资源的费用，不能承诺历史账单归零。若异步资源或计费统计仍未收敛，明确标记待核验，不写“已确保零费用”。

## 验证与交付规则

通过 Issue → 分支 → PR → squash merge 交付。当前存在用户明确要求的临时自动 CI 暂停，准确范围及恢复步骤见 [temporary-ci-pause.md](../operations/temporary-ci-pause.md)：适用本地验证必须运行并在 PR 记录；没有运行 CI 不代表通过。浏览器镜像发布及其发布验证仍保持，自动应用部署也未暂停。

最终 MVP1 验收前按该文档恢复自动检查和必要分支保护，再运行最终提交对应的适用检查。既有浏览器会话／控制器／恢复、PostgreSQL 并发、页面检查、文档容器、媒体和 Remotion 测试应按改动范围复用；Vercel 专用 smoke 不能证明 VPS 等价，新增 VPS 验收也不能代替业务授权与数据完整性测试。

结束条件是范围矩阵每一行具备对应真实证据，生产流量已切到 VPS，旧实例、快照、模板及专用 VCR 镜像清空，创建入口停用、计费清单复核完成且无未决切换风险。OpenShip 安装成功、单一 smoke 通过或 PR 合并均不单独构成迁移完成。

## 官方依据

- [Coolify 卸载步骤与验证](https://coolify.io/docs/core/instance-management/uninstallation)：定向删除控制面资源，避免全局 prune 误删其他应用。
- [OpenShip 安装与宿主机控制说明](https://openship.io/docs/getting-started/installation)：Linux Docker 模式、私有绑定、宿主机控制及卸载方式。
- [OpenShip 官方源码](https://github.com/oblien/openship)：命令接口、部署和域名处理的实际契约；升级时需重新核对使用的 release，不能把最新主分支当成已安装版本。
- [OpenShip 域名与 SSL 排查](https://openship.io/docs/troubleshooting/domains-ssl)：external ingress 表示由外部入口终止 TLS，不会由本机签发证书。
- [Docker 安全模型](https://docs.docker.com/engine/security/)与[网络过滤说明](https://docs.docker.com/engine/network/packet-filtering-firewalls/)：Docker socket 权限、资源隔离及端口发布的实际边界。
