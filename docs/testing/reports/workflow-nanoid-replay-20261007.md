# Workflow nanoid 安全迁移与旧状态恢复 — 2026-10-07

关联 [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498)。基线 `main@07cd44f1de62368e84eb807009a63998b3227622`，Node 24.21.0 / pnpm 12.3.4 / Workflow 4.8.8。本轮只处理 nanoid 的限定依赖与恢复兼容；正式 MVP1 业务验收仍为 [#32](https://github.com/ban12-project/F-Trade-Platform/issues/32) 的 `pending`。

## 问题与修复

直接将 core 的 nanoid 5.1.6 更新至 5.1.16 会改变隐式 hook token。旧版在固定 64 字符字母表、长度 21 的情况下消耗 34 次 VM 随机数，倒序取末尾 21 个字节；新版仅要求 21 个字节。该 VM 随机数同时供工作流 `Math.random()` 和 ULID 使用，因此只保留 token 字符还不够。

现在只对 `@workflow/core@4.8.8` 将 nanoid 限定为 5.1.16，并由 pnpm 的可审核补丁替换 core 内的固定 token 回调：消耗原来的 34 次随机数，将末尾 21 字节交给新版库。包装函数只生成长度 21 的 token。没有改动 nanoid 包、回退其安全检查或开放调用方指定长度；其余原有 devalue/undici/esbuild/MCP 补丁保留。

补丁位于 [`patches/@workflow__core@4.8.8.patch`](../../../patches/@workflow__core@4.8.8.patch)。这是项目维护的上游包补丁；以后升级 core 必须重新审查应用点。只有上游迁移通过冻结状态与原有兼容测试，才能移除回调补丁，不能仅依据新版本号删除。

## 实际 SDK 恢复证据

旧状态由**未打补丁的 core 4.8.8 + nanoid 5.1.6 + world-local 4.4.1** 实际 `start()`、`workflowEntrypoint()` 和文件存储生成。合成 bundle 注册两个未指定 token 的 hook，并交错执行 `Math.random()` 和 ULID；暂停后保存 10 个原始存储文件及逐文件 SHA-256。另一份字节副本在旧库下完整运行，用于冻结完整返回值。

这段 bundle 是为实际 SDK VM 编写的合成测试输入，**不是应用 SWC 编译产物**。应用的 Human Gate 指定固定 token，不会调用 nanoid，不能用它单独证明此迁移安全。

| 比较 | 可观察结果 |
| --- | --- |
| 旧 nanoid 暂停状态的独立旧库副本 | 成功完成，保存 3 个隐式 token、交错随机值、ULID 和三个合成 payload 的完整结果 |
| 同一暂停状态的另一副本，直接使用 nanoid 5.1.16 | 实际 SDK 发现首个 token 不一致；4 次 divergence / 3 次 recovery replay 后以 `CORRUPTED_EVENT_LOG` 失败 |
| 原始暂停状态，升级 nanoid 并应用 core 回调补丁 | 原两个 token 保留；第三个新 token、前后随机值、ULID 和完整返回值与旧库结果完全一致，运行完成 |

升级前未重写原始暂停状态的 run/events/hooks。纳入 CI 的 [`workflow-nanoid-replay.synthetic.json`](../../../data/fixtures/workflow-nanoid-replay.synthetic.json)包含原始字节、哈希和旧库完整结果；[`test-workflow-nanoid-replay.mjs`](../../../scripts/test-workflow-nanoid-replay.mjs)恢复到独立临时目录，在实际 SDK 中恢复三个 hook，核对完整结果，并确认原有事件文件未改变。所有资料、身份、token 与 payload 均属于明确标记的 **SYNTHETIC** 测试，不包含工厂事实或真实客户数据。

初次基线尝试使用 specVersion 1，实际 SDK 不支持该旧协议的启动/事件写入，未产生两个暂停 hook，测试失败并保留。有效基线改为当前支持的 **specVersion 3**。本报告证明旧 nanoid 状态迁移，不宣称旧协议 1 已受支持或所有历史 SDK 版本均已覆盖。

## 验证与边界

- 原有 64 个冻结重放 ID 的预期值未修改，全部通过实际 core 回调；同时检查每个 token 的 34 次随机数消耗及后续 RNG 状态。原有旧 wire 类型/循环、Buffer 隔离和 HTTP GET/POST 行为继续通过。
- 新增两个原生测试通过：实际冻结 SDK 状态恢复，以及隔离进程中的安全回归。后者检查负数/整数溢出拒绝、非安全模块的负数长度及时返回，以及 CSPRNG 配额错误后的恢复；进程设硬超时，未让无限循环风险进入应用进程。
- 七项队列期限、六项 loader/MCP、实际 Better Auth/Passkey schema、数据库迁移检查、TypeScript、仓库总校验均通过。冻结安装成功。
- 锁文件两个 YAML 文档分别核对。pnpm 管理文档、应用 importer 与 `package.json` 不变；1112 个 package / 1113 个 snapshot 中只替换 nanoid，去除补丁哈希引用差异后仅 core 的 nanoid 依赖值改变。原有应用和 auth 的 Zod 解析保持不变。
- 实际 Next dev 使用 Turbopack，所有路由编译 issues 为空。合成登录态工作台和新工作对话框正常，React tree/单 fiber inspect 通过，最终 config/session errors 为空。
- 实际应用编译的 Human Gate 三个合成案例通过：重复 token 保留原 owner、合法测试 human 决策恢复、Agent actor 拒绝。它们用于应用集成回归；隐式 token 的恢复证据来自上表的实际 SDK 测试。
- 完整生产构建、PostgreSQL、Harbor 和浏览器 CI 结果以交付 PR 的最终 head checks 为准；本报告不以本地窄测试替代完整 CI 或生产部署证据。

同轮 `pnpm audit --prod`：**0 critical / 3 high / 0 moderate → 0 critical / 1 high / 0 moderate**。移除两个 nanoid 版本匹配；剩余 braces 3.0.3 仍由 #498 跟踪。版本匹配不证明应用可利用性。nanoid 溢出公告需要外部可影响的长度，[维护者公告](https://github.com/ai/nanoid/security/advisories/GHSA-xwg4-73v4-xw9w)说明修补版本；非安全模块的负数循环修复见[维护者 5.1.16 发布](https://github.com/ai/nanoid/releases/tag/5.1.16)。当前 core 只使用固定长度 21 的 seeded `customRandom`，不是接收用户长度的安全 token API。

本轮恢复测试使用临时本机目录与进程内 handler，外部 HTTP 为 0；应用集成仅访问自己的本机开发服务和合成数据库。生产业务写入、模型调用、云端原件上传、渠道操作均为 0。现有生产版本、真实业务 Gate/RFQ 与正式 Go/No-Go 仍需独立证据。
