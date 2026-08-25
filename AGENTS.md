# Agent 工作规则

## 事实优先

- 把产品资料和用户结论视为待验证输入；先查来源、契约和可观察行为。
- 清楚区分事实、推断、假设和未知。
- 发现范围冲突、数据不一致或安全风险时，先指出并记录 Decision/Risk Issue。

## 离合器 MVP 约束

- AI 可以生成营销语言，不能生成工程事实。
- OE、车型、尺寸、花键、摩擦材料、认证、寿命和安全性能必须有工厂来源或人工确认。
- 正式报价和交期必须由人工确认；Agent 只能整理信息和提出问题。
- Agent 之间只交换结构化契约，不依赖自然语言“聊天”。

## GitHub 约束

- GitHub 只用于研发交付，不能用 Issues 记录真实业务流水。
- 所有工作通过 Issue → 分支 → PR → CI → squash merge 完成。
- 不提交密钥、真实客户数据、未经授权的原始资料或未标记的虚构产品事实。

## UI 与 Next.js 约定

- 新 UI 必须先采用 shadcn/ui 的组件与组合方式；仅在库中没有合适组件时才写自定义基础控件。
- Tailwind CSS 与 shadcn/ui 必须按 shadcn 官方 Next.js CLI 流程初始化和添加组件：`pnpm dlx shadcn@latest init`、`pnpm dlx shadcn@latest add <component>`。添加前先检查已有组件，避免手写或重复复制组件源码。
- Next.js 保持 `cacheComponents: true`，并使用默认 Turbopack 构建。新路由应按 Cache Components 模型设计，以静态壳、靠近动态数据的 `Suspense` 边界和即时导航为默认目标。
- 必须启用 `reactCompiler: true` 与实验性的 `experimental.turbopackRustReactCompiler: true`。若升级或构建暴露 React Compiler 兼容性问题，须记录风险并在 PR 中提供可观察证据，不能静默关闭。
- TypeScript 保持 7.x；Next.js 默认的项目本地 TypeScript CLI 校验必须保留，不能设 `experimental.useTypeScriptCli: false`。TypeScript 7 已移除 `baseUrl`，路径别名只使用 `compilerOptions.paths`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
