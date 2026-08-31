# 项目状态

## 阶段目标

第一阶段用一条可重复演示的闭环验证 AI 是否能参与离合器工厂的海外获客与销售辅助工作。验收终点是 `OPPORTUNITY`，不是自动成交；`WON/LOST` 仅作为后续业务状态保留。

## Milestone 依赖

```text
M0 基线与治理
  ↓
M1 产品数据闭环
  ├──→ M2 内容发布闭环
  └──→ M3 询盘报价闭环 → M4 跟单商机闭环
                               ↓
                         M5 集成 Demo 验收
```

## 研发阶段

| Milestone | 交付目标 | 当前状态 |
|---|---|---|
| M0 | 仓库、契约、校验、Issue/PR 流程 | 免费方案范围内的基线已完成；服务端分支保护明确不作为 M0 验收目标，残余风险见 GitHub 治理范围决策 |
| M1 | 产品导入、缺失识别、真实性门禁 | 契约与 Gate 01 已实现；真实 SKU 验收待工厂授权资料 |
| M2 | 三类内容、人工审核、单渠道发布适配 | 图文与视频的受控草稿、人工确认和合成链路已实现；Facebook MVP1 传输实验已接受，但真实渠道资格、素材与生产发布仍待验证 |
| M3 | 询盘澄清、RFQ Ready、人工报价交接 | 契约、完整性判断、澄清和人工报价 Gate 已实现 |
| M4 | 跟单策略、规则评分、交期门禁 | 上下文跟进、可解释评分与交期人工 Gate 已实现 |
| M5 | 端到端 Demo、验收报告和 Go/No-Go | 合成技术链路和报告已完成；真实资料演示与人工 Go/No-Go 待 #32 |

GitHub Issues 和 Milestones 是状态的事实来源；本页只保留阶段说明，不复制实时业务数据。

合成集成演示的可复现步骤、验收证据和外部依赖见[合成集成演示验收报告](testing/synthetic-integration-demo.md)。
真实演示的脱敏记录格式与人工决策条件见[MVP 验收与 Go/No-Go 记录模板](testing/mvp-acceptance-report.template.md)。
Next.js 安全补丁发布后的受控升级步骤见[Next.js 安全补丁升级运行手册](testing/next-security-release-runbook.md)。
真实 SKU 的脱敏授权记录格式与 A–D 分组条件见[真实 SKU 试点授权清单模板](testing/product-pilot-authorization.template.md)。
M0 的免费治理验收口径及未消除的直接推送风险见[GitHub 治理范围决策](decisions/github-branch-protection.md)。
应用采用项目画布：产品营销和销售机会分别在一张画布中组织受控记录，画布不改变任何事实或发布门禁，详见[项目画布与角色边界](decisions/0003-console-task-flow.md)。
