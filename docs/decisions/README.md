# 决策记录

已接受的架构决策：

- [ADR 0001：MVP 应用技术栈](0001-mvp-application-stack.md)
- [ADR 0002：受控 Facebook Personal Profile 传输实验](0002-camofox-facebook-personal-profile-mvp1.md)（限该 MVP1 实验范围）
- [ADR 0003：项目画布与角色边界](0003-console-task-flow.md)（导航部分已由 ADR 0005 取代）
- [ADR 0004：MVP1 营销视频采用已有素材剪辑](0004-mvp1-marketing-video-editing.md)
- [ADR 0005：工作台与项目采用线性引导流程](0005-guided-workspace-navigation.md)
- [ADR 0006：移除个人视频画布布局持久化](0006-retire-personal-video-canvas.md)
- [ADR 0007：以业务任务与对象组织工作区](0007-task-oriented-workspace.md)（按批次取代 ADR 0005 的主导航）
- [ADR 0007：营销视频保留期与责任人](0007-marketing-video-release-policy.md)（与同编号的工作区决策分别按标题引用）
- [ADR 0008：工作区按对象一次性切换](0008-object-workspace-cutover.md)
- [ADR 0009：保留网关授权修复并退役 Firefox 155 候选版本](0009-current-runtime-gateway.md)
- [ADR 0010：产品以最终事实审核验收](0010-product-final-fact-acceptance.md)
- [ADR 0011：移除 MVP1 数据库时间点恢复验收](0011-remove-pitr-acceptance.md)

治理批次的规则归属、行为基线和未决事项见[架构治理记录](../architecture/governance.md)。分支保护与当前执行条件见[GitHub 分支保护记录](github-branch-protection.md)。

每个未确定但会影响实现的选择创建一个 `type:decision` Issue；决策关闭后再补充 ADR。

初始化后至少保留以下决策项：

- 首个海外社媒渠道及其发布能力边界。
- 工厂 20 个真实 SKU 的提供、授权和脱敏策略。
- Lead Score 是否继续使用首版规则，以及分数上限和阈值校准。
