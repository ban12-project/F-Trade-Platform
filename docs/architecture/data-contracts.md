# 数据契约总览

所有 Agent 之间通过 JSON/YAML 结构化对象交互，不直接依赖自然语言上下文。正式 Schema 位于 `contracts/`。

## Product

- `ProductDraft`：允许资料不完整，必须保留来源、缺失字段和人工审核状态。
- `ProductReady`：必须具备产品名称、类型、内部 SKU、OE 或明确应用身份、品牌和车型，并通过真实性审核。
- 规格与商业字段可以缺失；缺失不能被模型填成猜测值。

## Content

输出 `objective`、`target_customer`、`platform`、`hook`、`body`、`product_facts`、`call_to_action`、`hashtags` 和 `visual_instruction`。`product_facts` 必须引用已确认的 Product 字段。

## RFQ 与报价交接

RFQ 分为 Draft 和 Ready。Ready 至少要有可确认的产品身份、数量和目的地；身份不清时继续询问 OE 或准确车型。

Quotation Handoff 不包含自动计算价格能力。正式金额和交期字段由人工 actor 填写，并引用对应 RFQ 与审批证据。

## Workflow Event

状态转换必须匹配允许的前后状态组合。人工作为 gate approver 时必须提供 `approved_by`、`approved_at` 和 `evidence_ref`。
