# F-Trade Platform

AI 外贸工作流平台第一阶段 MVP，试点品类为汽车离合器。

## 当前目标

本仓库管理第一阶段的需求、数据契约、验证规则和研发交付流程。第一阶段只验证一条可控的业务闭环：

```text
产品资料 → 产品结构化 → 内容生成 → 人工审核 → 单渠道发布
→ 客户询盘 → RFQ 补全 → 人工报价 → 跟单 → 有效商机
```

第一阶段范围固定为：1 家工厂、约 20 个真实离合器 SKU、1 个海外渠道、4 个业务 Agent、1 个 Workflow Orchestrator 和 3 类 Human Gate。

## 重要边界

- 工程事实（OE、车型适配、尺寸、花键、材料、认证、寿命等）必须来自工厂资料或已确认证据，AI 不得猜测。
- AI 不生成或决定最终价格、生产交期和正式报价。
- GitHub 只跟踪研发交付，不保存真实客户、RFQ、报价、目的港或其他业务流水。
- `docs/reference/目录总表.pdf` 是制动盘/刹车片目录，仅作为跨品类表格格式参考，不是离合器数据源。
- 当前未选择首个社媒渠道；该决定通过 GitHub Decision Issue 完成，不在实现阶段擅自确定。
- MVP 应用技术栈已经通过 ADR 0001 确定；试点部署前仍必须完成 Next.js 安全更新风险项。

## 导航

- [MVP 技术方案](docs/background/AI外贸工作流平台_第一阶段MVP_离合器.md)
- [业务工作流与 Human Gate](docs/architecture/business-workflow.md)
- [数据契约总览](docs/architecture/data-contracts.md)
- [ADR 0001：MVP 应用技术栈](docs/decisions/0001-mvp-application-stack.md)
- [研发工作约定](CONTRIBUTING.md)
- [安全与数据分级](SECURITY.md)
- [项目状态](docs/PROJECT_STATUS.md)
- [Product Agent A–D 测试协议](docs/testing/product-cohort-protocol.md)
- [Product Agent 验收矩阵](docs/testing/product-agent-acceptance.md)
- [参考资料说明](docs/reference/README.md)

## 研发流

```text
Issue → type/issue-short-name 分支 → Pull Request → repository-validate
→ squash merge → 自动关闭 Issue
```

Milestone 依赖关系：`M0 → M1 → {M2, M3} → M4 → M5`。

## 本地验证

需要 Python 3.11+、`jsonschema`、`PyYAML` 和用于本地 Product Agent 文档预处理的 `markitdown[pdf]`：

```bash
python3 -m pip install -r requirements-dev.txt
python3 scripts/validate_repository.py
```

GitHub Actions 会在 Pull Request 和 `main` 推送时运行同一套核心校验。

### Next.js 与端到端测试

应用基线使用 Next.js 16.3 和 Playwright。需要 Node.js 24 与 pnpm：

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
```

Playwright 会构建并启动受控测试服务器。测试构建会启用 Next.js 的
`instant()` 测试 API，普通生产构建不会暴露该 API。

### 数据库与内部认证

复制 `.env.example` 中的变量到本地未跟踪的 `.env.local`，并使用 Neon
提供的 PostgreSQL 连接 URL。公开注册在 Better Auth 配置中关闭；首个管理员
通过受控运维流程创建，后续账号只允许管理员配置。

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

`db:migrate` 会连接并修改目标数据库，执行前必须核对环境和连接 URL；前两个
命令只生成或检查迁移结构。

### 托管服务适配层

- Workflow SDK 使用稳定版 4.x，Human Gate 只传递 approval/aggregate 标识和人工决策；业务状态仍写入 PostgreSQL。
- 工程资料通过 Vercel Private Blob 适配器保存，应用只持久化内部 pathname 和证据元数据，不暴露私有 URL。
- AI SDK 适配器不绑定模型供应商，只接受调用方注入的 `LanguageModel` 和带运行时校验的 Schema。

模型的安全提示不能证明事实正确。生成内容中的产品事实还必须逐项匹配已提供的 `field/value/evidenceRef`，并继续经过 Gate 01 人工审核。

### 产品真实性验证

产品草稿中的每个已填写事实都必须通过 `field_evidence` 指向
`evidence_refs` 中的来源。自动审核会列出核心缺失项、未绑定证据的字段，以及
尚未由人工核验的车型身份。只有具备有效人员、时间和证据记录的 Gate 01
人工批准，才能把草稿提升为 `ProductReady`；agent 形式的批准会在运行时被拒绝。

### Harbor Product Agent 评测

`pnpm eval:harbor:prepare` 会在临时目录生成 20 个仅含 synthetic 数据的 Harbor 任务。
本机使用 Podman 时，先启动 Podman machine，并把其 Docker 兼容 API socket 设置为
`DOCKER_HOST`；再在当前 shell 设置 OpenAI-compatible endpoint 和 key，执行：

```bash
pnpm eval:harbor:podman openai-compatible/gpt-5.6-luna
```

Issue #48 的 PDF 只能作为本机授权测试输入，不能提交、镜像复制或上传到 Harbor artifact。
Product Agent 会先使用 MarkItDown 的本地 `convert_local()` 将允许的 PDF、Office 和文本格式转为
Markdown，再把该 Markdown 作为不可信来源文本交给模型；生产服务必须继续限制上传路径、文件类型和
大小。[MarkItDown security guidance](https://github.com/microsoft/markitdown#security-considerations)

在配置模型前，可先运行本地预检；它只输出文档哈希、媒体类型、OCR 状态和候选标识符/数量，不输出
转换后的原文，也不会调用模型。真实资料的输出不得保存到 Git 或 Issue：

```bash
MARKITDOWN_PYTHON=/path/to/python3 pnpm product-agent:catalog -- --preflight --document /authorized/catalog.pdf
```
