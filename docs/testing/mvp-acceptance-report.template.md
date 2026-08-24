# MVP 验收与 Go/No-Go 记录模板

## 使用边界

此模板用于受控业务系统或经批准的内部文档，不在 Git 仓库、Issue 或 PR 中填写真实客户、SKU、报价、目的港、账号凭据、原始资料或原始聊天内容。若需将结论带回仓库，只能提交符合 `MvpAcceptanceSummary` 契约的 synthetic 或脱敏聚合摘要。

决策只能由人工负责人作出；Agent 只能汇总经批准的证据。

## 运行标识

- 运行分类：`synthetic` / `sanitized_aggregate`
- 运行标识：`<synthetic-or-sanitized-run-id>`
- 执行时间：`<ISO-8601>`
- 负责人类型：`human`
- 受控证据引用：`<internal-evidence-reference>`

## 验收项

| 验收项 | 状态 | 允许的失败码 | 脱敏证据引用 |
| --- | --- | --- | --- |
| 产品资料导入与识别 | passed / failed / not_run | source_unavailable / fact_mismatch / technical_failure / external_dependency | `<ref>` |
| 内容生成与 Gate 01 | passed / failed / not_run | fact_mismatch / gate_rejected / technical_failure / external_dependency | `<ref>` |
| 模拟询盘与 RFQ Ready | passed / failed / not_run | rfq_incomplete / technical_failure / external_dependency | `<ref>` |
| 人工报价交接 | passed / failed / not_run | gate_rejected / technical_failure / external_dependency | `<ref>` |
| 跟单到 Opportunity | passed / failed / not_run | technical_failure / external_dependency | `<ref>` |
| 门禁绕过检查 | passed / failed / not_run | gate_bypass / technical_failure | `<ref>` |

## 聚合指标

- 人工修订次数：`<non-negative-integer>`
- 事实错误次数：`<non-negative-integer>`
- RFQ 总数：`<non-negative-integer>`
- RFQ Ready 数：`<non-negative-integer>`
- 门禁绕过次数：`<non-negative-integer>`
- 外部依赖阻塞次数：`<non-negative-integer>`

不得在此处写产品事实、报价、交期、客户信息或原始错误文本；仅记录计数和受控证据引用。

## 人工决策

- 决策：`pending` / `go` / `no_go`
- 决策人类型：`human`
- 决策时间：`<ISO-8601>`
- 决策证据引用：`<internal-evidence-reference>`

`go` 的前提是六项验收均为 `passed`、事实错误为零、门禁绕过为零、`RFQ Ready` 数等于 RFQ 总数，且不存在未处理的外部依赖阻塞。否则应选择 `pending` 或 `no_go` 并由人工制定后续动作。
