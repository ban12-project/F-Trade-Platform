# 数据契约总览

Agent 和服务之间通过 JSON/YAML 结构化对象交互，不依赖自然语言上下文。正式 Schema 位于 `contracts/`；PostgreSQL 将是运行时业务状态的事实来源，Schema 同时作为边界校验和测试依据。

## Product

- `ProductDraft`：允许资料不完整，必须保留来源、阻断缺失字段、可选缺失字段和审核状态。
- `ProductReady`：阻断缺失字段必须为空，并通过 Gate 01；产品身份需要 OE，或同时具备已确认的应用、品牌和车型。
- 产品名称、类型和内部 SKU 是 Ready 的最低核心字段。规格与商业字段可以作为可选缺失项；模型不能把缺失值填成猜测值。
- Ready 对象只保存 `approval_ref`，完整的人类决策保存在 Human Approval 中。

## Content

输出 `objective`、`target_customer`、`platform`、`hook`、`body`、`product_facts`、`call_to_action`、`hashtags` 和 `visual_instruction`。`product_facts` 必须逐项引用证据。

内容状态支持送审、退回修订、批准和发布。批准或发布必须引用 Gate 01；发布还需保存渠道返回的 `published_ref`。

## RFQ 与报价

RFQ 分为 Draft 和 Ready。Ready 至少要有可确认的产品身份、数量和目的地；身份不清时继续询问 OE 或准确车型。

Quotation 不包含自动决定价格的能力。正式金额和交期字段由人工 actor 创建，送审时可以没有审批结果；批准和发送状态必须引用 Gate 02，发送状态还要记录发送时间。

## Delivery Confirmation

交期确认是独立请求，不直接覆盖报价。Agent 可以发起 Pending 请求；Confirmed 或 Rejected 必须由工厂人工决策并引用 Gate 03。Confirmed 必须记录人工确认的交期天数；长时间未处理可以由系统转为 Expired。

## Human Approval 与 Workflow Event

Human Approval 区分请求和决策：请求可以由 agent、human 或 system 发起，批准或拒绝的 `decision.actor_type` 必须是 `human`。Pending 不得包含伪造的决策结果。

Workflow Event 只允许同一聚合内的合法转换。门禁转换必须同时提供 `gate` 和 `approval_ref`；跨聚合动作通过创建新对象与引用关联，不伪装成状态转换。

## 运行时持久化

Drizzle Schema 将业务对象保存为带 `type`、`state`、版本与结构化 payload 的聚合记录；边界层仍必须先使用对应 JSON Schema 校验 payload。Approval、Workflow Event、Evidence 和 Audit Event 使用独立表与外键关联。

Workflow Event 和 Audit Event 只追加，不允许在应用层更新；首个 SQL migration 还通过数据库触发器拒绝 UPDATE/DELETE。认证表由 Better Auth 使用，公开注册关闭，邀请只保存不可逆 token hash。
