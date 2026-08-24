# 业务工作流与 Human Gate

## 聚合状态机

产品到商机是一条业务旅程，但不是同一个实体的一条全局状态链。每个聚合只改变自己的状态，聚合之间通过引用和事件关联。

```text
Product: PRODUCT_IMPORTED → PRODUCT_REVIEW_REQUIRED
           ↑                    ├→ PRODUCT_READY
           └ PRODUCT_REVISION_REQUIRED ←┘

Content: CONTENT_GENERATING → CONTENT_REVIEW_REQUIRED
             ↑                    ├→ CONTENT_APPROVED → CONTENT_PUBLISHED
             └ CONTENT_REVISION_REQUIRED ←┘

RFQ: RFQ_COLLECTING → RFQ_READY

Quotation: QUOTE_DRAFT → QUOTE_REVIEW_REQUIRED
               ↑                    ├→ QUOTE_APPROVED → QUOTE_SENT
               └ QUOTE_REVISION_REQUIRED ←┘

Lead: LEAD_RECEIVED → FOLLOW_UP → OPPORTUNITY → WON / LOST

DeliveryConfirmation: DELIVERY_CONFIRMATION_PENDING
                        ├→ DELIVERY_CONFIRMATION_CONFIRMED
                        ├→ DELIVERY_CONFIRMATION_REJECTED
                        └→ DELIVERY_CONFIRMATION_EXPIRED
```

例如 `PRODUCT_READY` 不直接转换成 `CONTENT_GENERATING`。内容生成会创建新的 Content 聚合，并引用已就绪的 Product。这样可以让一个产品产生多份内容，也避免把不同实体的生命周期混为一谈。

任何状态转换都要写入结构化 Workflow Event，包含实体、前后状态、actor、时间和证据。需要门禁的转换还必须引用独立的 Human Approval。Agent 不能绕过状态机直接发布、报价或承诺交期。

运行时转换规则在 `lib/workflow/transitions.ts` 中集中执行：它会拒绝非法跳转、错误 actor、缺失或不匹配的审批，并可通过不可变事件流重放任一聚合状态。`lib/workflow/orchestrator.ts` 在一个数据库事务内锁定聚合、写入新状态、追加 Workflow Event 和 Audit Event；调用该服务前仍须完成 actor 的认证和授权。`pnpm test:workflow` 覆盖正常转换、三类门禁绕过和重放完整性；该校验也被 `scripts/validate_repository.py` 调用。

## 三类 Human Gate

### Gate 01 - 产品与内容真实性

产品导入后检查来源、产品身份、参数和阻断缺失字段；内容发布前检查产品事实、图片一致性和营销措辞。批准进入 Ready/Approved，拒绝进入对应 Revision Required，修订后可以重新送审。

### Gate 02 - 正式报价

Sales Agent 只收集和整理 RFQ。报价草稿由人工销售创建，价格、MOQ、Lead Time、付款条款和有效期经另一条可审计的人工决策批准后才允许发送。待审批报价不提前携带审批结果。

`lib/quotation/handoff.ts` 是报价交接的领域边界：只接受 human 创建人，Gate 02 决定必须带 human actor、决定时间和证据引用；只有已批准报价才能由 human 标记为 sent。它不使用公开 fixture 保存真实报价内容。

### Gate 03 - 交期确认

客户出现明确采购意向后，工厂人工确认生产能力和交期。Agent 可以发起确认请求和传递结果，不能作为决策人自行承诺。

## 关键安全规则

- 营销语言可以生成，工程事实不能生成。
- AI 图片不能证明花键、孔位、尺寸、摩擦材料、零件数量或真实产品结构。
- RFQ 不完整时持续提问，不直接报价。
- 审批和业务对象分别存储；业务对象只引用 `approval_ref`，避免伪造内嵌审批。
- 第一阶段 Demo 以 `OPPORTUNITY` 为成功终点；不把模拟询盘冒充真实成交。

## Synthetic 端到端演示

执行 `pnpm demo:synthetic` 可验证产品导入、内容审核和发布、RFQ 完整、人工报价审批和发送、跟单到 `OPPORTUNITY` 的演示闭环。该脚本只读取带 `synthetic` 标识的 fixture，并在开始前按各自 JSON Schema 验证输入；它不会连接渠道、读取客户数据或生成真实报价。
