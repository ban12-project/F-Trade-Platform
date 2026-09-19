# 产品到图文发布的完整旅程

关联：#401、[ADR 0007](../decisions/0007-task-oriented-workspace.md)。仅使用隔离数据库和合成资料，没有真实客户、工厂事实或渠道发布。

## 本批行为

- 导入从同一个文件选择入口开始，单个产品与产品目录之间保留文件。手动录入仍可使用；切换方式写入 URL，离开未保存草稿需要明确放弃。
- 详情只展示当前产品或内容，列表、新建和复制分别承担各自职责。旧 URL 仍可打开原对象。
- 产品核实展示当前版本、中文字段名称、缺失来源、退回意见和原件入口。已核实产品的顶部直接提供“制作图文内容”。
- 内容保存后直接打开该草稿；内容详情包含文案、所引用的产品事实、修订、审核和该对象的发布确认与结果。
- 提交、未知、失败、暂停、成功分别说明当前状态与处理人。只有成功回执才能显示已发布；未知结果不出现再次提交入口。
- 发布读取不再丢弃 50 条以外的历史状态，避免旧记录无法打开或错误恢复为发布候选。客户端只接收展示所需的发布字段。

## 来源与审核边界

原件读取同时检查当前用户、账号状态、项目成员关系、产品归属和字段与文件关联。下载前后均重新检查授权；校验文件类型、大小与摘要。接口为认证二进制 GET，使用 private/no-store、nosniff 和受限 CSP，不暴露私有存储地址。

目录来源保留了可定位文本时，只有与已存字段引用精确匹配的片段才会显示。没有保留片段时明确提示核对原件；无法建立文件关联时提示补充来源。旧粘贴文本若只保存了不可逆的字段引用且无可核验文件关联，不能反推出原文或补写事实。

产品/内容的写入、审核角色、人工决定、版本检查与证据校验复用现有服务。只读成员可以查看原件，不能修改或审核。正式报价、交期和可选视频不属于本批。

## 验证

```sh
pnpm check
pnpm typecheck
pnpm test:content-catalog-entry
pnpm test:content-publication
pnpm test:workspace-navigation
DOCUMENT_UPLOAD_TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/f_trade_stream_test node --conditions=react-server --import tsx scripts/test-product-evidence-preview-postgres.ts
pnpm exec playwright test --reporter=line
pnpm exec playwright test --config=playwright.database.config.ts --reporter=line
```

- 来源服务：真实 PostgreSQL，合成文件读取器；覆盖最小展示数据、精确片段、编辑者/只读访问、跨项目/跨产品/未绑定来源拒绝、账号封禁、类型/大小/摘要不一致，以及读取期间撤销权限。
- 数据库浏览器：真实路由与 Server Actions，产品创建 → 退回 → 修订 → 核实 → 内容创建 → 退回 → 修订 → 审核 → 发布提交 → 合成成功回执。校验陈旧审核无写入、显示版本与确认版本一致、成员限制、旧链接、手机无横向溢出、超过 50 条的旧发布可访问。
- 界面：目录 20 条选择、失败重试、刷新恢复；单产品流式部分失败；共同文件切换与放弃保护；无可用内容的发布空状态。

本地专项界面检查 18 项、产品完整旅程与项目访问复验 10 项通过；类型、仓库校验、内容/发布策略和来源权限服务检查通过。快速选文件早于表单初始化的问题已修复；文件保留和键盘操作两项检查各连续运行 3 次通过。流式渲染的界面断言限定当前可见控件，跨项目数据不可见和数据库权限/版本校验独立保留，受影响的 13 项数据库浏览器检查复验通过。

[PR #402](https://github.com/ban12-project/F-Trade-Platform/pull/402) 最终 CI：187 项界面测试、37 项数据库浏览器测试均首次通过，全部检查成功后合并为 `0f76728`。[完整运行记录](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35441252680)。

开发运行时 Next MCP 的编译和运行错误均为空。React 树确认核实页只有一个 ProductPanel、ProductReview 和未保存保护根；导入页、产品核实页、内容修订页（桌面及窄屏）的 axe 扫描为零违规。以下截图来自显式开启的合成测试页面，只展示本批主要编辑区；全局外壳见上一批验证记录。

### 桌面产品核实

![产品字段与来源对照](assets/product-publication-401/review-desktop.png)

### 手机导入与修订

![390px 共同文件入口](assets/product-publication-401/intake-mobile.png)

![390px 内容修订](assets/product-publication-401/content-mobile.png)

合成检查不能代替真实用户无讲解试用、工厂来源授权或生产渠道发布资格验收。
