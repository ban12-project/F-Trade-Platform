# 工作台导航与代码质量

关联：#263。

## 已确认的代码级等待链

旧版没有 `app/workspace/layout.tsx`。工作台与项目页各自创建 dock 和 dirty provider；页面的整页 Suspense 会连同 dock 一起替换为固定全屏骨架。

项目页每次切换 `?panel=` 都读取产品、内容、视频、发布或销售各面板数据，并等待成员、全局待办、模型配置。产品素材读取还在这一批查询之后追加等待。即使这些数据不属于当前步骤，也会影响页面完成时间。

`listWorkspaceTasks` 的成员列表之后，审核、RFQ、线索和待发布候选查询原来依次执行；发布状态只依赖待发布候选。改为四路并行后，存在发布状态时，关键依赖层数由最多六层降为三层。Pipeline 的记录与发布结果也改为并行。这是查询依赖层数，不是实测毫秒数。

## 新结构

`app/workspace/layout.tsx` → `WorkspaceShell`，页面 children 与 dock 是兄弟节点，各自有 Suspense 边界。页面 loading 不再绘制假 dock，也不覆盖整个视口。dock 的活动项目取自客户端路由参数，不依赖不会随导航更新的服务端 layout props。

项目页先完成身份和项目成员鉴权。显式步骤导航无需默认步骤分析；成员、当前项目待办、当前业务面板分别流式加载。只有缺省入口才读取不包含业务 payload 的轻量状态，用于保留“下一项待办 / 当前业务步骤”的默认选择。产品素材在产品详情内部继续流式加载。

`React.cache` 仅去重一次请求中的会话和共享读取。没有跨请求缓存用户权限，没有关闭 Proxy、成员校验或 Server Action 的授权。全局待办只由 dock/工作台读取；项目页限定项目。业务写入用 `revalidatePath('/workspace', 'layout')` 刷新持久 layout，普通导航不主动 refresh。

导航链接使用 Next Link 的 `onNavigate` 处理未保存修改，保留默认预取、键盘操作和 Ctrl/Cmd 新标签页行为。独立测试页面的 dirty provider 会复用上层 context，避免编辑器的未保存状态被 dock 忽略。

## 验证

`pnpm test:workspace-navigation` 检查默认步骤、旧任务 URL、布局契约，以及使用可控 thenable 数据库模拟验证四路/两路并行和成员过滤。`tests/e2e/workspace-navigation.spec.ts` 在明确的测试模式下，给子路由加入 1.5 秒延迟，验证 dock DOM 实例、交互和未保存修改保护。测试模式未开启时这些页面返回 404；没有真实客户数据或生产鉴权旁路。

合并前运行 `pnpm check:ci`、`pnpm typecheck`、导航回归、仓库验证及 Playwright 的生产构建测试。模拟延迟测试不代表生产页面已从 2–3 秒下降到某个固定数值。生产复测应分别记录冷启动与热导航的 RSC TTFB、完成时间、数据库区域延迟及 p50/p95，不使用 `next dev` 首次编译时间作为生产基准。

## Biome 与运行时

沿用 Next.js 官方 `examples/with-biome` 的 Git ignore、空格缩进以及 Next/React 推荐规则。固定 Biome v2 依赖并提交 lockfile；`pnpm format` 写格式，`pnpm lint:fix` 写安全修复，`pnpm check:ci` 只检查。生成物与锁文件不交给格式化器重写。底层 shadcn 标签/布局原语只对静态分析无法跨 props 推断的两处规则作局部、有理由的豁免。

应用维持 Node 24，`.nvmrc` 与 package engines 对齐。CI 中 JavaScript Action 自身的 Node runtime 也必须为 Node 24；仅设置 setup-node 的 node-version 并不会升级旧 Action 的内置 runtime。Actions 更新交给 Dependabot 持续检查。保留现有发布平台集成，不添加未知部署密钥或自动生产发布。
