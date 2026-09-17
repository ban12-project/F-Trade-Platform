# Harbor Agent Evals 验收

研发跟踪：[Issue #369](https://github.com/ban12-project/F-Trade-Platform/issues/369)。用户已确认升级对象是 agent 评测框架，原链接中的 goharbor 容器仓库不属于本仓库的评测依赖。

## 版本与执行契约

2026-09-17 核对 [上游稳定发行版](https://github.com/harbor-framework/harbor/releases/tag/v0.23.0) 和 PyPI，最新稳定版为 **0.23.0**，固定于 `evals/harbor/requirements.txt`。使用 task schema 1.4、自定义 `BaseAgent`、`--ae`、本地目录 `-p`、`--job-name`、原生 `-e podman`；`-t` 用于 registry task，不能直接替代本地 `-p`。

生产评测入口是 `EvidenceLocatedProductAgent`。输入先被重建为有标签的行/表格行证据，再由 AI SDK 执行抽取，服务端校验每个事实及其具体证据位置，最后压缩为实际使用的引用集合。不能再要求输出使用整份文档引用，也不能接受只具有合法外观、却不支持对应字段的证据 ID。

任务生成器在调用模型前固定事实真值、可支持各字段的证据位置、prompt version/hash 和 expectation hash。所有任务的输入与 hash 均为 synthetic；输入位于 `environment/input/`，预期答案仅位于 `tests/`。镜像构建上下文使用白名单，不包含 `.env`、本地参考资料、jobs 或验收答案。该镜像只承担已预处理的文本/图片抽取，不安装 PDF/OCR 工具。

## 分层验收

| 层级 | 执行与覆盖 | 通过含义 |
| --- | --- | --- |
| 确定性回归 | `pnpm test:harbor`：20 个样例经过当前生产证据包装器、Python verifier；7 组测试含错误字段位置、整篇引用、虚构/丢失 OE、车型/规格、越权状态、缺失阻断、历史 job、异常/缺失/重复试次、错误模型和旧 provenance | 固定真值与当前实现一致；不证明模型抽取质量 |
| 框架兼容性 | `pnpm eval:harbor:prepare` 后，以安装 Harbor 0.23.0 的 Python 执行 `scripts/test-harbor-framework.py`；验证 20 个 Task、四类 provider、凭据边界、非零退出码，再运行真实 CLI `--dry-run` | 发行版 API、task schema 和 job 配置可用；dry-run 仍要求所选容器运行时可响应 |
| 容器冒烟 | CI 的 `harbor-compatibility` 构建评测镜像，再执行 `python3 scripts/test-harbor-container-smoke.py`；临时副本中的 a-01/c-01 使用 oracle 各运行一次并检查实际 reward 与 artifact 路径 | 容器/verifier/artifact 链路可用；oracle 身份不能通过生产模型汇总门禁 |
| 真实模型 | `pnpm eval:harbor:podman` 或手动 `harbor-product-agent` workflow；20 个固定任务各 3 次，共 60 次 | 只有本次 job 的全部试次通过才算 synthetic 模型评测通过 |

20 个任务仍按 A–D 各 5 个分配，覆盖 OE/缺失 OE、有图/无图、规格/商业字段；补充 `Fit Model` 原样保留、通用 `Model` 不作车型事实和部件栏不提升为整件规格的情景。05 样例保留提示注入尝试。无标签恶意文字可能被证据预处理排除，因此不再将每次通过都记成“模型抵抗提示注入 100%”。1×1 synthetic 图片也不能证明真实产品视觉识别能力。

原有事实安全阈值不降低：已给定事实、OE、车型、阻断缺失和字段证据必须全部正确。每次输出只能是 `review_required`，不允许附带自动批准。真实工厂 20-slot、人工修订轮次和 Gate 01 Ready 仍按 [Product Agent 验收矩阵](product-agent-acceptance.md) 单独执行。内容、销售、RFQ、报价/交期的领域回归不因 Harbor Product Agent 通过而自动获得真实业务验收结论。

## 本地与 CI

```sh
uv tool install --python 3.12 --constraints evals/harbor/requirements.txt harbor
pnpm test:harbor
pnpm eval:harbor:prepare
uv run --python 3.12 --no-project --with-requirements evals/harbor/requirements.txt python scripts/test-harbor-framework.py
PYTHONPATH=. harbor run -p /tmp/f-trade-harbor-product-agent \
  -a evals.harbor.product_agent.f_trade_product_agent:FTradeProductAgent \
  -m openai/synthetic -k 3 -e podman --dry-run
```

真实执行前提供专用 `HARBOR_MODEL=provider/model` 与该 provider 的 `HARBOR_*` 凭据。不从应用数据库解密或借用生产凭据。GitHub 对应 `<provider>-product-agent-eval` environment；选择的 model 前缀必须与 environment 一致。凭据不写入仓库或验收报告。

本地 runner 生成唯一 job name，并在执行失败后仍尝试输出失败摘要；CI 使用 run ID + attempt。汇总仅读取指定 job，要求固定 20 个 ID 各三次、无异常、运行已结束、agent/model 与冻结 provenance 一致。历史目录、任意 20 个替代 ID 或重复 trial ID 不能补足 60 次。摘要使用独占创建，拒绝覆盖旧报告；原始 jobs 可能含连接信息，已加入 gitignore，仅上传白名单摘要。

手动汇总示例：

```sh
python3 scripts/validate-harbor-product-agent-results.py \
  --job-dir jobs/<本次job> \
  --manifest /tmp/f-trade-harbor-product-agent/acceptance-manifest.json \
  --model <provider/model> \
  --output harbor-artifacts/<本次job>.json
```

没有实际 60 次结果、provider 配置或容器运行失败时，真实模型验收为 **未完成**，不能用确定性回归或 oracle 的结果补记通过。
