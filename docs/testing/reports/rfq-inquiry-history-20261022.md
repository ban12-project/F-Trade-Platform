# 多轮询盘整理验证

关联 [#644](https://github.com/ban12-project/F-Trade-Platform/issues/644)。MVP1 的客户需求可能分多次回复，原实现仅整理最新一条消息，无法把先前提供的 OE、数量和目的地一起补入 RFQ。

本次按时间汇总最近 30 条仍在保留期内、未删除、非未来时间的入站消息。每个建议保留消息 ID 和时间；不同值、范围或已识别的否定表达不自动选择。界面仅补空白字段，已有人工输入继续保留。超过 30 条会提示范围限制。规则只支持现有显式英文表达，不声称理解任意自然语言或确认工程事实；未覆盖的需求仍需阅读完整会话。

## 已执行验证

- `pnpm test:sales`：分条补充、重复值来源合并、不同数量、范围和否定表达，以及无自动报价／交期字段。
- `pnpm exec tsc --noEmit`：通过。
- `NODE_OPTIONS=--conditions=react-server SALES_CONTEXT_TEST_DATABASE_URL=<isolated-local-db> pnpm exec tsx scripts/test-sales-context-postgres.ts`：合成 PostgreSQL 验证所属会话与项目权限、删除／过期消息过滤、30 条上限、冲突和来源。
- 本地 `next dev` 加隔离合成数据库：浏览器点击整理按钮，将三条消息补成五个字段；加入不同数量后显示人工核对提示，人工数量 750 保持不变。未点击保存或发送。Next MCP `get_errors` 返回空配置与会话错误。

隔离副本位于仓库临时目录时，Tailwind 自动扫描受到临时二进制文件影响；验证副本通过限定扫描 app/components/lib 排除干扰。此测试环境调整未作为产品配置变更。新增数据库浏览器回归还需由 CI 验证。

这些是工程及合成验证，不能替代真实客户需求、人工报价审核或渠道验收。DM 验收按当前用户要求暂停。
