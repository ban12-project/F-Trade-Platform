# 合成集成演示验收报告

## 目的与边界

本报告记录 Issue #26 当前可重复的**合成**集成演示。它验证数据契约、状态转换和人工 Gate 的技术实现；不证明真实离合器资料、社媒账号、客户询盘、价格或生产交期已经可用。

全部 ID、证据引用、审批人和时间均使用 `synthetic-` 前缀或合成值，不能作为业务流水、产品事实或正式报价依据。

## 执行方式

```bash
pnpm demo:synthetic
pnpm test:demo
python3 scripts/validate_repository.py
```

预期演示报告：

```json
{
  "classification": "synthetic",
  "finalStates": {
    "product": "PRODUCT_READY",
    "content": "CONTENT_PUBLISHED",
    "rfq": "RFQ_READY",
    "quotation": "QUOTE_SENT",
    "lead": "OPPORTUNITY"
  },
  "transitionCount": 11,
  "approvedGates": ["gate_01_truth", "gate_02_quote"],
  "inboundMessaging": {
    "deliveryStatus": "accepted",
    "duplicateStatus": "duplicate",
    "replyWindowStatus": "within_window",
    "outsideWindowAction": "require_human_approved_template"
  }
}
```

## 已验证的验收链路

| #26 验收项 | 技术证据 | 当前结论 |
| --- | --- | --- |
| 识别产品 | `product-ready.synthetic.json` 经 ProductReady 契约校验，并从 `PRODUCT_IMPORTED` 通过人工 Gate 01 到 `PRODUCT_READY` | 仅合成 fixture 已验证 |
| 生成内容并人工批准 | 内容契约校验；`CONTENT_GENERATING → CONTENT_REVIEW_REQUIRED → CONTENT_APPROVED → CONTENT_PUBLISHED`，批准记录为 human | 已验证 |
| 模拟询盘并补全 RFQ | synthetic 官方 API/inbound-only 策略接受首条消息、去重重复投递、执行显式回复窗口；随后 RFQ Ready 契约校验并以 `RFQ_COLLECTING → RFQ_READY` 回放 | 已验证 |
| 人工报价、跟单并进入 Opportunity | Quote Gate 02 的 human 批准后才发送；跟单从 `LEAD_RECEIVED` 到 `FOLLOW_UP` 再到 `OPPORTUNITY` | 已验证 |
| 形成验收报告和 Go/No-Go 决策 | 本文提供技术报告；Go/No-Go 是业务负责人决策 | 报告完成；决策待人工 |

## Gate 与安全断言

- 产品就绪需要 Gate 01 的人工批准；Agent 批准会被运行时拒绝。
- 报价必须先由人工通过 Gate 02；Agent 不生成正式价格或交期。
- 演示会拒绝非 `synthetic-` 标识符，防止把真实业务记录带入版本库。
- `repository-validate` 额外覆盖非法状态转换、无来源工程事实、RFQ 完整性、内容安全和跟进规则。

## 尚未由本演示覆盖的事项

- #6：工厂授权的 20 个真实离合器 SKU 与原始证据资料。
- #11、#49、#50：首个社媒渠道选择、Business 账号/API 资格，以及禁止浏览器会话自动化作为生产通道的风险控制。
- #32：基于真实资料和人工操作记录的最终 Go/No-Go。

因此，Issue #26 只能视为“合成技术链路通过”，不能据此关闭真实业务上线或人工验收事项。
