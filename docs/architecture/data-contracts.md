# 数据契约总览

Agent 和服务之间通过 JSON/YAML 结构化对象交互，不依赖自然语言上下文。正式 Schema 位于 `contracts/`；PostgreSQL 将是运行时业务状态的事实来源，Schema 同时作为边界校验和测试依据。

## Product

- `ProductDraft`：允许资料不完整，必须保留来源、阻断缺失字段、可选缺失字段、审核状态，以及每个已提供事实对应的 `field_evidence`。
- `ProductReady`：阻断缺失字段必须为空，并通过 Gate 01；产品身份需要 OE，或同时具备已确认的应用、品牌和车型。
- 产品名称、类型和内部 SKU 是 Ready 的最低核心字段。规格与商业字段可以作为可选缺失项；模型不能把缺失值填成猜测值。
- `evidence_refs` 只是对象可使用的证据集合；`field_evidence` 必须把每个已填写的产品、规格和商业字段映射到其中一个证据引用。仅有对象级来源不能证明具体 OE、车型或工程参数。
- 没有 OE 时，应用、品牌和车型即使都有来源也必须经 Gate 01 人工确认后才能成为 Ready；自动审核阶段保持 `review_required`。
- Ready 对象只保存 `approval_ref`，完整的人类决策保存在 Human Approval 中。

## Content

输出 `objective`、`target_customer`、`platform`、`hook`、`body`、`product_facts`、`call_to_action`、`hashtags` 和 `visual_instruction`。`product_facts` 必须逐项引用证据。

内容状态支持送审、退回修订、批准和发布。批准或发布必须引用 Gate 01；发布还需保存渠道返回的 `published_ref`。

## RFQ 与报价

RFQ 分为 Draft 和 Ready。Ready 至少要有可确认的产品身份、数量和目的地；身份不清时继续询问 OE 或准确车型。

Quotation 不包含自动决定价格的能力。正式金额和交期字段由人工 actor 创建，送审时可以没有审批结果；批准和发送状态必须引用 Gate 02，发送状态还要记录发送时间。

## Delivery Confirmation

交期确认是独立请求，不直接覆盖报价。业务用户可以发起 Pending 请求；Confirmed 或 Rejected 必须由工厂人工决策并引用 Gate 03。Confirmed 必须记录人工确认的交期天数和有效截止时间；长时间未处理或超过有效期可以由系统转为 Expired。销售线索保存当前 `delivery_confirmation_ref`，发送交期/样品回复时必须重新验证该引用属于当前 RFQ、状态为 Confirmed 且未过期。自由文本不能自行携带交期承诺，最终交期句由服务端从受控结果生成。

## Human Approval 与 Workflow Event

Human Approval 区分请求和决策：请求可以由 agent、human 或 system 发起，批准或拒绝的 `decision.actor_type` 必须是 `human`。Pending 不得包含伪造的决策结果。

Workflow Event 只允许同一聚合内的合法转换。门禁转换必须同时提供 `gate` 和 `approval_ref`；跨聚合动作通过创建新对象与引用关联，不伪装成状态转换。

## 运行时持久化

Drizzle 使用支持事务的 Neon serverless `Pool` 驱动，将业务对象保存为带 `type`、`state`、版本与结构化 payload 的聚合记录；边界层仍必须先使用对应 JSON Schema 校验 payload。Approval、Workflow Event、Evidence 和 Audit Event 使用独立表与外键关联。不得改用 transaction 会直接失败的 Neon HTTP 驱动。

Workflow Event 和 Audit Event 只追加，不允许在应用层更新；首个 SQL migration 还通过数据库触发器拒绝 UPDATE/DELETE。认证表由 Better Auth 使用，公开注册关闭，邀请只保存不可逆 token hash。

项目成员关系由 `workspace_project_member` 独立持久化，角色为 owner/editor/viewer。所有项目读取和写入都以成员关系重新授权；删除或降级最后一个 owner 会被事务内锁定检查拒绝。产品证据先写入 `evidence`，再通过 `workspace_project_evidence` 与项目关联；产品表单只允许选择当前用户拥有或已关联当前项目的证据记录，字段绑定仍逐字段保存。

受控渠道外部效果由 `social_browser_job` 与 `social_publication` 持久化。领取端使用 `FOR UPDATE SKIP LOCKED`，短期签名同时绑定任务和载荷摘要；成功、未知或失败回执必须验证 Worker 签名。未知/失败、领取前校验失败以及十分钟内未收到签名结果的过期领取都会暂停任务与渠道、写入审计，不会自动重排。

## 服务适配边界

Workflow SDK 只持久化运行、step 和 hook 进度；Human Gate hook 使用由 `approvalId` 派生的确定性 token，开始前必须确认 PostgreSQL 中存在对应 Pending Approval。收到决策后仍要先原子写入 Approval、聚合状态和审计事件，再恢复 workflow。

Vercel Blob 适配器强制 private read/write，并使用不可变随机 pathname。数据库保存 pathname、hash、内容类型、大小和来源，不把私有 Blob URL 当作公开业务字段。

AI SDK 由调用方注入模型和运行时可验证 Schema。结构化生成器只能使用传入的 verified facts；产品事实必须精确匹配证据三元组。提示词和 Schema 都不能替代 Gate 01 人工真实性审核。
