# 业务工作流与 Human Gate

## 状态流

```text
PRODUCT_IMPORTED
  → PRODUCT_REVIEW_REQUIRED
  → PRODUCT_READY
  → CONTENT_GENERATING
  → CONTENT_REVIEW_REQUIRED
  → CONTENT_APPROVED
  → PUBLISHED
  → LEAD_RECEIVED
  → RFQ_COLLECTING
  → RFQ_READY
  → QUOTE_REVIEW_REQUIRED
  → QUOTED
  → FOLLOW_UP
  → OPPORTUNITY
  → WON / LOST
```

任何状态转换都要写入结构化 Workflow Event，包含实体、前后状态、actor、时间、证据和审批信息。Agent 不能绕过状态机直接发布、报价或承诺交期。

## 三类 Human Gate

### Gate 01 - 产品与内容真实性

产品导入后先检查来源、OE、车型、参数和缺失字段；内容发布前再检查产品事实、图片一致性和营销措辞。两次检查属于同一真实性门禁类型，分别对应 `PRODUCT_REVIEW_REQUIRED` 和 `CONTENT_REVIEW_REQUIRED`。

### Gate 02 - 正式报价

Sales Agent 只收集和整理 RFQ。价格、MOQ、Lead Time、付款条款和报价有效期由人工销售输入并批准后才允许发送。

### Gate 03 - 交期确认

客户出现明确采购意向后，工厂人工确认生产能力和交期；Agent 只能传递确认结果，不能自行承诺。

## 关键安全规则

- 营销语言可以生成，工程事实不能生成。
- AI 图片不能证明花键、孔位、尺寸、摩擦材料、零件数量或真实产品结构。
- RFQ 不完整时持续提问，不直接报价。
- 第一阶段 Demo 以 `OPPORTUNITY` 为成功终点；不把模拟询盘冒充真实成交。
