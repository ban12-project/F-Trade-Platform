# ADR 0001: MVP 应用技术栈

- 状态：Accepted
- 日期：2026-08-24
- Decision Issue：[#38](https://github.com/ban12-project/F-Trade-Platform/issues/38)

## 背景

MVP 需要在一个可审计系统中实现产品数据、内容、RFQ、人工报价、跟单和三类 Human Gate。核心约束是业务状态可靠、工程事实有证据、人工决策可追踪，而不是尽早拆分多个服务或引入自主 Agent 平台。

## 决策

采用 TypeScript 模块化单体：

- Next.js 16.3 App Router 和 React 19 作为 Web 与服务端应用边界；
- Vercel 作为首选托管目标；
- Neon PostgreSQL 作为业务状态事实来源；
- Drizzle ORM 管理类型化表结构和迁移；
- Better Auth 实现邀请制内部账号与会话；
- Vercel Workflows 执行需要暂停、重试和等待人工门禁的长流程；
- Vercel Private Blob 存放受控原始资料，数据库只保存元数据、权限和证据引用；
- AI SDK 作为模型调用适配层，模型输出必须先通过结构化契约验证再写入业务状态；
- Playwright 和 `@next/playwright` 验证浏览器闭环与 Cache Components 的即时导航行为。

数据库是业务状态的唯一事实来源。Workflow 只保存执行进度和幂等键，不能成为产品、RFQ、报价或审批记录的替代数据库。

## 暂不采用

- 不在 MVP 引入微服务、Kubernetes、Redis、向量数据库或事件流平台；
- 不引入 WorkflowAgent 作为核心状态管理器；
- 不做运行时动态模型路由，先使用显式、可测试的任务适配器；
- 不自动生成正式价格、交期或工程事实。

## 后果

优点是部署面较小、类型和事务边界清晰，并能在同一代码库内端到端验证 Human Gate。代价是对 Vercel/Neon 的托管能力有依赖；业务模块仍需保持清晰边界，以便未来按经过验证的负载拆分。

Next.js 16.3 当前存在已公告的安全更新窗口。试点部署前必须完成 [#36](https://github.com/ban12-project/F-Trade-Platform/issues/36) 并重新验证，不把当前锁定版本视为可直接上线版本。
