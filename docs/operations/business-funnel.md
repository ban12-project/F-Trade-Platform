# 轻量业务漏斗口径

此面板是当前可见、未归档项目的独立阶段库存汇总，不是同一客户批次的归因分析，不计算转化率。营销项目与销售项目可能没有可验证的归属链，不能用阶段数字相除或将跨项目引用拼成客户转化链。

## 数据与权限

- 复用工作台按当前 actor 项目成员身份读取的 request-local snapshot，不增加跨用户共享缓存。
- 只计 `relation = owned` 的记录；引用不重复计数。已归档项目不纳入。
- 每个阶段按业务 aggregate ID 去重，每条计入记录都可打开其所属项目内的详情。仅返回记录 ID、项目名、计数与内部链接，不返回原始客户、价格或证据内容。
- 人工商机证据查询还会独立验证 actor 的项目成员身份、归属记录、候选 aggregate ID、human actor 与 `FOLLOW_UP → OPPORTUNITY` 事件。事件必须有非空确认人和证据引用。

## 阶段定义

1. **已核验产品**：`PRODUCT_READY` 且最新 Gate 01 审批为 approved。审批表约束保证已决审批由人工、带审批人和证据完成。草稿、待审、待修订不计入。
2. **已发布内容**：归属本项目的 content/video 有同项目 `social_publication.status = published` 回执。多账号和重复发布只计一份内容。submitted、unknown、pending 不计入；只有内容状态声称 published 而无回执时列入待核对。
3. **有效询盘**：`RFQ_READY` 且通过现有 RFQReady JSON 契约，含产品识别信息、正整数数量和目的地。这表示需求信息齐全，不是对客户购买意愿或商业价值的认证。
4. **已发送报价**：`QUOTE_SENT`、payload 为 sent、人工创建、引用最新已通过的 Gate 02，并有有效发送时间及非空发送渠道/凭证。这是人工登记的发送结果，不是客户收件或阅读确认。
5. **人工确认商机**：当前状态 `OPPORTUNITY`，且存在上述人工确认证据。HOT 评分、FOLLOW_UP、已发送报价都不能推定人工确认。WON/LOST 不属于此当前状态库存口径。

状态符合但凭证缺失/不一致的记录不计数，并单独提供待核对链接。若人工确认证据读取失败，商机显示“暂不可用”，不能显示 0，也不能直接按 OPPORTUNITY 状态计数。其他阶段仍可正常展示。面板读取整体失败时显示不可用信息，不制造零值。

## 验证命令

- `node --import tsx scripts/test-business-funnel.ts`
- `node --conditions=react-server --import tsx scripts/test-business-funnel-store.ts`
- `pnpm exec playwright test tests/e2e/business-funnel.spec.ts`
- `pnpm check && pnpm typecheck`

测试夹具只使用明确标注的 Synthetic 数据，测试页面仅在 `NEXT_ENABLE_TESTING_API=1` 时启用。生产面板不导入测试夹具。

本变更只读，不改变业务 Human Gate、契约、报价/商机写入、CI 或部署。营销视频创意审核不适用：面板只显示已有视频的发布状态，没有生成或改变视频内容。
