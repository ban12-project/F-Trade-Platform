# Harbor 升级验收记录 · 2026-09-17

关联 [Issue #369](https://github.com/ban12-project/F-Trade-Platform/issues/369) / [PR #370](https://github.com/ban12-project/F-Trade-Platform/pull/370)。升级对象为 harbor-framework/harbor，固定 **0.23.0**。验收范围见 [Harbor Agent Evals](../harbor-agent-evals.md)。

## 已观察证据

| 验证项 | 结果 | 证据/范围 |
| --- | --- | --- |
| 上游版本与本机安装 | 通过 | GitHub 最新 stable tag 与 PyPI 均为 0.23.0；本机 `harbor --version` 输出 0.23.0 |
| 当前生产抽取契约 | 通过 | 20/20 固定 synthetic 样例经过 `EvidenceLocatedProductAgent` 和 Python verifier；无模型调用 |
| 失败门禁 | 通过 | 7 组测试，含错误/缺失/重复证据、工程事实变异、越权状态、缺失阻断、错误 provenance、异常/缺失/重复试次、历史 job 隔离、JSON boolean/number 区分和报告禁止覆盖 |
| Harbor API/task | 通过 | 20 个真实 Harbor Task 解析；四类 provider adapter、缺少凭据、非零退出码均验证 |
| 容器链路 | 通过（CI） | [harbor-compatibility](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35180289380/job/105070751165) 在 ea42342 上完成 CLI dry-run、镜像构建、2/2 oracle 试次与实际 artifact 路径校验；后续变更的检查以 PR 当前提交 CI 为准 |
| TypeScript / 格式 | 通过（本地） | `pnpm typecheck`，Biome 对改动 TypeScript/JSON 检查 |
| 现有业务规则回归 | 通过（本地） | `scripts/validate_repository.py` 全部通过，包含产品、内容、销售、RFQ、Gate 02 报价、Gate 03 交期、跟进规则、synthetic demo 和仓库卫生 |

本机直接使用全局 pnpm 时遇到 `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE`；验证改用项目指定版本的 Corepack pnpm。Python 子进程使用安装了验证依赖的解释器。未修改 package manager、锁文件或项目版本要求。

本机 Podman 启动后 Docker Hub `registry-1.docker.io:443` 连接被拒绝，未能完成本地镜像拉取。CI 的 Docker 环境已实际验证容器链路；没有把失败的本地操作记成通过，也没有宣称本地 Podman 端到端通过。

## 仍未完成的验收

**真实模型 20×3 次验收未执行（0/60），不能判为通过。** 当前 shell、`.env`、`.env.local` 未配置 `HARBOR_*`；GitHub 环境列表仅为 `Preview`、`Production`，没有 `<provider>-product-agent-eval`。仍需指定 provider/model，并在专用评测环境中配置凭据，随后运行 `harbor-product-agent` workflow 或本地 runner。

oracle 只写入临时 smoke 副本中的固定答案，不进入正式模型数据集；它验证评测基础设施，不能证明模型质量、真实工厂字段识别率、视觉识别能力或 Ready。

真实工厂 20-slot、人工作业耗时、修订轮数和 Gate 01 Ready 仍按原验收矩阵独立判断。Issue #369 保留跟踪真实模型验收的缺口。
