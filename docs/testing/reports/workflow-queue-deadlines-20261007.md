# Workflow 队列超时修复与运行验证 — 2026-10-07

关联 [#509](https://github.com/ban12-project/F-Trade-Platform/issues/509)，基线 `main@3515edda8279833888712921c1ddf8319ada246a`。**本地复现、七项队列回归及实际编译工作流验证通过；生产渠道和正式业务验收保持独立。** 本轮没有生产数据库写入、模型请求、原始资料上传或渠道操作。

## 已确认问题与修复

registry 对 Workflow 4.8.4 标记了队列连接池拥塞时的超时风险，并建议升级至 4.8.8 或更高版本。[上游修复](https://github.com/vercel/workflow/pull/4049)采用独立队列 dispatcher，并把等待连接的时间计入请求期限。实际安装的 world-vercel 4.7.0 将队列指向共享池；仅设置 headers/body timeout 不能约束尚未取得连接的请求。

在真实旧 dispatcher 上，十个合成 POST 发往只接收、不回应的 loopback 服务。请求阶段 timeout 为 5 秒，观察窗为 9 秒；窗口结束时仅 8/10 已拒绝，峰值 8 条连接，余下 2 个仍等待后续阶段。测试明确失败，并在断言后销毁自身 dispatcher、连接和服务。两次旧版本结果一致；失败日志保留在忽略目录。

选用已发布的 Workflow **4.8.8**，带入 core 4.8.8、world-local 4.4.1、world-vercel 4.7.4 及对应 4.x 构建插件。实际发布包已核对包含队列修复，没有跨 Workflow major。仓库校验器的严格版本要求同步改为 4.8.8；版本固定检查仍保留。

原安全 override 随精确父版本更新，继续使用 devalue 5.9.3 和两处 undici 7.29.1。nanoid 仍为 5.1.6。锁文件中未变更版本的非 Workflow 包及依赖块均与基线一致，包括 root/peer/认证内部 Zod、CLI-auth 的原有依赖。冻结安装通过，依赖安装脚本保持禁用。同轮审计前后均为 **0 critical / 3 high / 0 moderate / 0 low**；nanoid 两条、braces 一条公告仍由 #498 跟踪，队列问题不是新的安全公告计数。

## 可复验检查

CI 新增 `scripts/test-workflow-queue-deadlines.mjs`，从实际 Workflow 父依赖解析 world-vercel，不复制上游实现：

| 检查 | 已观察结果 |
| --- | --- |
| 拥塞与总期限 | 设置队列连接数 1、期限 5 秒，十个 POST 均在约 5.04 秒结束，活动 HTTP 请求峰值 1；全部在同一 9 秒观察窗内拒绝，同一路径未重复发送 |
| 默认配置和边界 | 默认期限 30 秒、连接数 64；期限限制在 5–120 秒，连接数限制在 1–1024，非法值使用默认值；headers/body 阶段期限与队列期限一致 |
| dispatcher 选择 | 默认队列池与共享池分离，重复获取保持同一实例，显式 dispatcher 覆盖保持有效；`WORKFLOW_NODE_HTTP` 模式下遵守上游 fallback 行为 |
| 正常及失败 POST | 合成成功请求正常读取；503 在 dispatcher 层只发送一次，未自动重发 POST；实际 RetryAgent 的关闭操作通过 |
| 主动取消 | 已到达本地服务的请求被调用方取消，随后请求能够使用释放的槽位完成 |
| 可用并发上限 | 两条连接配置下，十个正常延迟响应全部成功，活动 HTTP 请求峰值恰为 2 |
| 真实队列客户端 | 实际 `createQueue` 与 QueueClient 经 loopback 请求发送旧 JSON 与当前 CBOR；目标、部署及幂等头、run 关联、包装和原字节均正确，未接触真实 OIDC；测试 fetch 边界拒绝非本地目标 |

原有 64 个冻结 seeded replay ID、旧序列化 wire、循环对象、Buffer 可见字节及两个 world 的 HTTP 兼容回归全部通过，没有改写固定夹具。六项 loader/MCP 回归、认证适配器、TypeScript 7、数据库迁移元数据、产品增量解析/权限边界、媒体流程、Biome 和仓库总校验通过。

## 实际应用运行

Node 24.21.0 的 Next 16.3.8 dev 使用默认 Turbopack、Cache Components、原有两个 React Compiler 开关和默认 TypeScript CLI。80 个 step、5 个 workflow 编译完成。只停止并替换本任务自己拥有的 3141 开发服务；用户其他服务及原分支未改动。

给本地 SDK 与开发服务指定独立测试 world 目录和 loopback 地址，并关闭历史任务恢复。实际编译的 `waitForHumanGate` 通过三项检查：重复 token 的新 run 返回原 owner；明确标记的合成人工决定恢复原 run 并返回相同决定；Agent actor 的输入使该测试 run 按契约失败。终态依次为 completed、completed、failed，最后一个是预期拒绝；无未结束的测试 run。这不代表批准真实工程事实、正式报价或交期。

实际认证浏览器打开工作台和“开始新工作”对话框，项目选择及未选择时的禁用状态正常；未提交业务写入。Next MCP 的最终编译问题、配置错误和页面错误列表为空，React 组件树与实际对话框 fiber 已检查。测试夹具路由因未启用测试 API 返回 404，原日志保留；正式页面在独立最终服务上正常，不把预期 404 当作业务故障。

## 保留的失败与限制

- 首次将服务器观察到的未关闭 TCP socket 数当作池的活动请求数，关闭与替换连接短暂重叠而得到 2，期限测试本身已通过。改为在实际 HTTP 响应占用边界验证单请求峰值，并独立验证两连接配置的正常并发；原失败及 TCP 诊断保留。
- 第一次依赖解析顺带更新了 Zod 和一个 CLI-auth 子依赖。无关变化已收回，逐块核对基线及最终冻结安装通过；未更改 AI 输出或认证 schema。
- 总校验最初因旧的 4.8.4 固定版本要求失败。同步明确的 4.8.8 要求后重跑通过，未移除固定版本约束。
- 本地 SDK 首次把内置 world 当作自定义模块名，触发 pnpm 的模块解析错误，在开始工作流前失败。按实际 SDK 实现改用内置 `local` 选择，随后三个真实编译工作流检查通过。初始失败未计为成功。
- 上游在 `WORKFLOW_NODE_HTTP` 下使用全局 fetch，显式自定义 dispatcher 也优先；这两种路径不承诺默认队列池的期限。测试记录选择行为，未把默认路径结果扩大为所有配置的保证。当前本地应用未设置该 fallback，生产当前配置及部署需独立核对。
- POST 不重发结论限于 dispatcher；QueueClient 的既有队列确认/可见性策略未改动，不能据此推断所有上游 API 都不重试。应用发布未知结果的禁止重试规则保留。

完整生产构建、PostgreSQL、浏览器、Harbor 和交付 CI 由关联 PR 核对。Vercel 构建跳过不能证明生产版本已更新。历史 CSV/Facebook 故障原因未由本次合成结果确认，#348 和生产渠道验收继续由各自 Issue 承接；正式 Go/No-Go 仍由 #32 记录。
