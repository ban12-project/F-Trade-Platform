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

## MVP1 Facebook 受控浏览器入站边界

MVP1 可使用 `official_api` 或经 #155 明确批准的 `camofox_controlled_mvp1`。两种策略均只接收用户主动
发起的 inbound 消息，并要求人工确认回复窗口。CamoFox 路径必须提交 `controlled_browser_observation`、脱敏
`observation_ref` 与消息身份质量；只有可见 DOM ID 的观察才可主张平台 ID 去重，派生指纹仅是 best-effort
去重。窗口外自动回复一律禁止。

每个通过该边界的消息还必须在数据库 `social_inbound_delivery` 中原子领取：唯一索引使用
`channel_ref + account_ref + message_id`，只保存这些引用和接收时间。重复投递返回 `duplicate`，不能再次
创建或更新 Lead；表中不保存 Cookie 或凭据。官方 webhook 通过带平台 ID 的交付可主张 exactly-once；浏览器
观察只能在身份质量为 `dom_id` 时作同等主张，派生指纹必须在审计记录中标记为 best-effort。

内容发布也必须通过 `ContentPublicationPolicy`：只有人工启用的渠道、已完成 Gate 01 的内容和 system/human
发布 actor 才能进入传输。CamoFox 发布还需逐帖人工确认。安全检查、登录失效、固定出口 IP 不符、页面结构不确定
或外部结果不确定时必须熔断；不得自动换号、换代理、求解验证码或重试不确定的发布。

## Synthetic 端到端演示

执行 `pnpm demo:synthetic` 可验证产品导入、内容审核和发布、RFQ 完整、人工报价审批和发送、跟单到 `OPPORTUNITY` 的演示闭环。该脚本只读取带 `synthetic` 标识的 fixture，并在开始前按各自 JSON Schema 验证输入；它不会连接渠道、读取客户数据或生成真实报价。
