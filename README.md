# F-Trade Platform

AI 外贸工作流平台第一阶段 MVP，试点品类为汽车离合器。

## 当前目标

本仓库管理第一阶段的需求、数据契约、验证规则和研发交付流程。第一阶段只验证一条可控的业务闭环：

```text
产品资料 → 产品结构化 → 内容生成 → 人工审核 → 单渠道发布
→ 客户询盘 → RFQ 补全 → 人工报价 → 跟单 → 有效商机
```

第一阶段范围固定为：1 家工厂、约 20 个真实离合器 SKU、1 个海外渠道、4 个业务 Agent、1 个 Workflow Orchestrator 和 3 类 Human Gate。

应用以线性工作流为默认入口：全局工作台先汇总入站消息、跨项目待办、审批、到期跟进和项目 Pipeline；进入项目后，营销项目按“产品资料 → 营销内容 → 营销视频 → 发布”推进，销售项目按“客户线索 → 需求确认 → 报价 → 跟进 → 交期 → 商机”推进。工程事实、报价、审核和发布仍由既有受控工作流与人工 Gate 决定。

项目画布、布局存储和 React Flow 依赖已经从生产代码删除。项目只保留受控业务记录、成员关系和阶段导航；产品事实、报价、交期、审批与发布结果继续由领域状态机保存。迁移记录见 ADR 0005。

全局工作台承接尚未分流的入站会话，业务用户必须显式新建销售项目或关联已有项目。项目成员关系独立保存 owner/editor/viewer 角色，所有 Server Action 都会重新校验成员权限。产品表单只从当前用户可访问的持久化证据中选择来源，并逐字段保存绑定，不接受任意证据文本。

MVP1 的主要视频能力是在营销项目的“营销视频”步骤中，把用户已有且登记权利证据的素材剪成最长 15 秒的营销视频。真正的素材、片段、预览、渲染和审核工作进入独立视频编辑器；AI 只提出可编辑剪辑初稿。文本／图片生成视频及其模型、供应商和任务管理不在 MVP1 投入使用。

## 重要边界

- 工程事实（OE、车型适配、尺寸、花键、材料、认证、寿命等）必须来自工厂资料或已确认证据，AI 不得猜测。
- AI 不生成或决定最终价格、生产交期和正式报价。
- GitHub 只跟踪研发交付，不保存真实客户、RFQ、报价、目的港或其他业务流水。
- `docs/reference/目录总表.pdf` 是制动盘/刹车片目录，仅作为跨品类表格格式参考，不是离合器数据源。
- MVP1 已接受一个受控 Facebook Personal Profile 传输实验；它不是已证明的生产发布通道，仍受逐帖人工确认、固定出口和熔断边界约束。
- MVP 应用技术栈已经通过 ADR 0001 确定；试点部署前仍必须完成 Next.js 安全更新风险项。

## 导航

- [MVP 技术方案](docs/background/AI外贸工作流平台_第一阶段MVP_离合器.md)
- [业务工作流与 Human Gate](docs/architecture/business-workflow.md)
- [数据契约总览](docs/architecture/data-contracts.md)
- [ADR 0001：MVP 应用技术栈](docs/decisions/0001-mvp-application-stack.md)
- [ADR 0003：项目画布与角色边界](docs/decisions/0003-console-task-flow.md)（导航部分已由 ADR 0005 取代）
- [ADR 0004：MVP1 营销视频采用已有素材剪辑](docs/decisions/0004-mvp1-marketing-video-editing.md)
- [ADR 0005：工作台与项目采用线性引导流程](docs/decisions/0005-guided-workspace-navigation.md)
- [研发工作约定](CONTRIBUTING.md)
- [安全与数据分级](SECURITY.md)
- [项目状态](docs/PROJECT_STATUS.md)
- [Product Agent A–D 测试协议](docs/testing/product-cohort-protocol.md)
- [产品目录接收清单模板](docs/testing/product-catalog-intake.template.md)
- [官方渠道接入清单模板](docs/testing/channel-onboarding.template.md)
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
提供的 PostgreSQL 连接 URL。认证统一使用 Better Auth 的邮箱 OTP 与 Passkey，
不启用密码登录，也不允许公开注册。管理员发送的单次限时邀请会预配禁用账户；
受邀人完成邮箱 OTP 验证后才会激活，并可注册 Passkey。部署前必须配置
`RESEND_API_KEY`、已验证的 `AUTH_EMAIL_FROM` 和适用于域名的
`BETTER_AUTH_PASSKEY_RP_ID`。

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

`db:migrate` 会连接并修改目标数据库，执行前必须核对环境和连接 URL；前两个
命令只生成或检查迁移结构。

### 产品目录录入

业务员和管理员可在营销项目的“产品资料”步骤中，将工厂资料按“产品编号、OE、适配与规格”的目录结构创建为
`PRODUCT_REVIEW_REQUIRED` 草稿。每条已填写的字段必须从已上传、已持久化且当前项目可访问的私有证据中选择；录入不会使
产品成为 `ProductReady`，也不会生成正式报价或交期。真实目录、产品图片与本机路径都不能提交到 Git。

已配置模型后，业务员和管理员可在产品资料步骤上传已获授权的 PDF、CSV、XLS 或 XLSX（最大 25MB），
或粘贴已脱敏的预处理文本。上传文件会以 `restricted` 分类写入 Vercel Private Blob 与 evidence 表，再在
短生命周期的本地副本上预处理；Product Agent 只生成 `PRODUCT_REVIEW_REQUIRED` 草稿。该入口不支持把本机路径
或公开 URL 作为来源，且每次运行均需 Gate 01 人工审核。

### 托管服务适配层

- Workflow SDK 使用稳定版 4.x，Human Gate 只传递 approval/aggregate 标识和人工决策；业务状态仍写入 PostgreSQL。
- 工程资料通过 Vercel Private Blob 适配器保存，应用只持久化内部 pathname 和证据元数据，不暴露私有 URL。
- AI SDK 适配器不绑定模型供应商，只接受调用方注入的 `LanguageModel` 和带运行时校验的 Schema。

模型的安全提示不能证明事实正确。生成内容中的产品事实还必须逐项匹配已提供的 `field/value/evidenceRef`，并继续经过 Gate 01 人工审核。

### Product Agent 模型配置

Product Agent 只从工作台“Agent 配置”页面中保存的 provider 读取模型、端点和认证信息，不再读取模型环境变量或命令行 `--model` 覆盖。API key 和 Auth token 会使用 `MODEL_CONFIG_ENCRYPTION_KEY` 以 AES-256-GCM 加密后写入数据库；设置该变量为 `openssl rand -base64 32` 的结果。密钥永不回显。未保存可用 provider 时，Agent 会明确拒绝运行。

### 初始化管理员

迁移完成后，用受控 seed 脚本创建或提升多个指定管理员。脚本由 Node 自动加载项目根目录的 `.env`，因此无需另行导出 `DATABASE_URL`。它不会删除数据、重置账户或启用公开注册；必须显式加 `--confirm`，并为每项变更写入审计事件。管理员随后在 `/auth` 使用邮箱验证码首次登录。

```bash
pnpm seed:admins -- --emails admin1@example.com,admin2@example.com --confirm
```

### 产品真实性验证

产品草稿中的每个已填写事实都必须通过 `field_evidence` 指向
`evidence_refs` 中的来源。自动审核会列出核心缺失项、未绑定证据的字段，以及
尚未由人工核验的车型身份。只有具备有效人员、时间和证据记录的 Gate 01
人工批准，才能把草稿提升为 `ProductReady`；agent 形式的批准会在运行时被拒绝。

### Harbor Product Agent 评测

`pnpm eval:harbor:prepare` 会在临时目录生成 20 个仅含 synthetic 数据的 Harbor 任务。
本机使用 Podman 时，先启动 Podman machine，并把其 Docker 兼容 API socket 设置为
`DOCKER_HOST`；并为目标 provider 设置专用的 `HARBOR_*` 评测凭据。Harbor 使用专用 runner，
不会读取应用数据库、已保存的模型配置或 `MODEL_CONFIG_ENCRYPTION_KEY`。例如：

```bash
HARBOR_MODEL=openai-compatible/gpt-5.6-luna \
HARBOR_OPENAI_COMPATIBLE_BASE_URL=https://gateway.example.test/v1 \
HARBOR_OPENAI_COMPATIBLE_API_KEY=local-evaluation-key \
pnpm eval:harbor:podman
```

Issue #48 的 PDF 只能作为本机授权测试输入，不能提交、镜像复制或上传到 Harbor artifact。
Product Agent 会先使用 MarkItDown 的本地 `convert_local()` 将允许的 PDF、Office 和文本格式转为
Markdown，再把该 Markdown 作为不可信来源文本交给模型；生产服务必须继续限制上传路径、文件类型和
大小。[MarkItDown security guidance](https://github.com/microsoft/markitdown#security-considerations)

如经批准启用远程 OCR，使用 `F_TRADE_OCR_OPENAI_COMPATIBLE_BASE_URL`、
`F_TRADE_OCR_OPENAI_COMPATIBLE_API_KEY` 与 `F_TRADE_OCR_MODEL`。这些变量只供 MarkItDown OCR
预处理使用，不能作为 Product Agent 的模型提供商配置。

在配置模型前，可先运行本地预检；它只输出文档哈希、媒体类型、OCR 状态、候选标识符/数量和
`manual_review` 原因，不输出转换后的原文，也不会调用模型。预检始终要求人工复核：零候选必须调查
目录版式/提取失败，OCR 文本还必须逐页视觉核验。真实资料的输出不得保存到 Git 或 Issue：

```bash
MARKITDOWN_PYTHON=/path/to/python3 pnpm product-agent:catalog -- --preflight --document /authorized/catalog.pdf
```

图像型 PDF 的本地 OCR 默认关闭。若资料获授权、机器上已安装 Poppler 与 Tesseract，才可显式启用；
该路径只在本机渲染与识别，最多处理 64 页，绝不上传图册。OCR 文本仍是不可信来源，不能跳过字段级
证据和 Gate 01 人工核验：

```bash
F_TRADE_LOCAL_OCR_ENABLED=1 \
MARKITDOWN_PYTHON=/path/to/python3 \
pnpm product-agent:catalog -- --preflight --document /authorized/catalog.pdf
```
