# braces 本地深度防护与独立运行器边界 — 2026-10-07

关联 [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498)。基线 `main@af4de29815efe712b377c0fe730804513f082803`，Node 24.21.0 / pnpm 12.3.4。项目安装链为 shadcn 4.19.1 → fast-glob 3.3.3 → micromatch 4.0.8 → braces 3.0.3；扫描另列出 shadcn → ts-morph → @ts-morph/common → fast-glob 的同包路径。

## 证据与适用范围

[GitHub 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)列出 braces ≤3.0.3 的递归栈耗尽问题，当前没有已发布的修复版本。本轮 registry 查询仍为 3.0.3。实际安装的 `MAX_LENGTH: 10000` 与[上游 3.0.3 常量](https://github.com/micromatch/braces/blob/3.0.3/lib/constants.js)逐字节一致；长度限制不能代替嵌套限制。

隔离 Node 24 子进程使用 64 MiB 堆和 3 秒期限，输入为 4000 个左花括号加 `a}*`，共 4003 字符。未修改库的 compile 实际 stderr 出现 heap out of memory，进程未正常返回，父进程记录 `ETIMEDOUT / SIGABRT`。实际 fast-glob 的类似模式也出现超时或异常终止。另有人工构造的 20000 层 AST 在原 compile / expand / stringify 中触发原生栈溢出。这是受限测试进程中的资源耗尽证据，**不证明生产应用有公开可利用入口，也不把 AST 输入等同于字符串输入**。

在本机默认 Node 24 设置下，4900 层完整平衡字符串的 compile / expand 曾成功返回；没有将上游报告的 Node 26 栈溢出结果冒充本机同条件复现。应用、组件和领域代码未发现 shadcn 的运行时导入；这只是当前源码观察，不能推断所有未来公开输入路径均不可达。

## 修复

[`patches/braces@3.0.3.patch`](../../../patches/braces@3.0.3.patch)通过 pnpm `patchedDependencies` 应用于项目安装的 braces，不改包版本或屏蔽审计：

- parser 在分配第 129 个花括号或圆括号容器之前，抛出带 `BRACES_DEPTH_LIMIT` 的 `RangeError`；限制合计嵌套，不可用调用方选项关闭，避免异常未闭合模式先进入清理阶段。
- compile / expand / stringify 的直接 AST 入口先以迭代方式检查 `.nodes` 深度，再进入原递归处理；不沿 parent / prev 引用检查。
- 正常解析规则、10000 字符上限及 rangeLimit 保留。**超过 128 层的合法嵌套也会被拒绝**，这是明确的本地行为约束，并非完全保持所有历史输入兼容。

此补丁约束嵌套遍历，不承诺解决所有组合展开、宽 AST、恶意 JS getter 或人工 AST 的其他引用环引发的资源问题。后续升级 braces 必须重新审查补丁应用点和冻结输出，不能只依据版本号移除。

## 验证

修改前从实际未修改包冻结 [`braces-compatibility.synthetic.json`](../../../data/fixtures/braces-compatibility.synthetic.json)：17 个模式的 compile / expand / stringify / 默认返回值，包括范围、嵌套、引号、转义、字面字符和 128 层边界；另外冻结五个实际 fast-glob 合成文件匹配结果。修改后逐值对比通过，未重写预期结果。

[`test-braces-depth-guard.mjs`](../../../scripts/test-braces-depth-guard.mjs)的六项原生测试加入 CI：冻结输出与同步/异步文件匹配、129 层拒绝、引号/转义/原有长度与范围边界、深与循环 `.nodes` AST 拒绝及拒绝前不写 queue、64 MiB / 5 秒硬期限下的 18 次实际依赖边界拒绝。异常后继续检查正常表达式可处理。

初次新增测试误假设 fast-glob 对纯圆括号模式也调用 braces，因“未抛出预期错误”失败。已按实际父调用边界改正：纯圆括号只证明 braces API；两个包含花括号的异常模式才验证 fast-glob 的任务生成、同步和异步入口。未修改防护或正常输出断言来掩盖此范围差异。补丁编辑目录的直接探测也曾因该目录尚无依赖、且选中了默认 Node 26 而失败；有效测试均在安装后的实际 Node 24 依赖链执行。

冻结安装、原有六项 loader/MCP 测试、Workflow 冻结恢复与队列测试、TypeScript、Better Auth/Passkey schema、数据库迁移检查和仓库校验通过。锁文件两个 YAML 文档分别核对：pnpm 管理文档、应用 importer、1112 个 package、package.json 字节和原有 core 补丁不变；1113 个 snapshot 去除本轮 braces 补丁引用差异后相同。没有更新 Zod、Workflow 或 shadcn 的版本。

实际 Next dev 仍为 Turbopack / Cache Components / React Compiler；MCP 的全路由 compilation issues、config errors 和 session errors 为空。合成登录态下的工作台和新工作对话框可打开，React tree 与单 fiber inspect 通过。这里只作安装后的应用运行回归，不据此宣称生产渠道已经验收。

完整构建、PostgreSQL、Harbor 和浏览器验证以本轮交付 PR 的最终 head checks 为准。现有 Harbor 构建上下文与安装前复制已包含全部 `.patch`，继续使用冻结安装；不把局部测试当成完整 CI 或生产部署证据。

## 尚未覆盖

官方 `pnpm dlx shadcn@latest migrate --help` 本轮实际使用 **shadcn 4.21.3**，trace 确认 fast-glob / braces 解析到独立 dlx 缓存中的原版 3.0.3。该命令只查询帮助，没有执行迁移或更改组件。项目的 pnpm 补丁**不会自动进入独立运行器**，未修改全局缓存或用伪造新版本隐藏风险。未来独立 CLI 操作仍需确认输入模式和当前依赖；必须等上游修复或另有独立可验证的运行器防护，才可解除对应风险。

同轮生产依赖审计仍为 **0 critical / 1 high / 0 moderate**，唯一版本匹配为 braces 3.0.3；[#498](https://github.com/ban12-project/F-Trade-Platform/issues/498)保持开放。该数字不反映本地补丁有效性，也不直接证明公开应用入口可利用。

本轮仅使用明确标记的 SYNTHETIC 文件和本机隔离进程。未执行模型、云资料上传、生产业务写入或渠道动作。本次 reference 测试审核授权持续有效；正式业务聚合仍为六项 `not_run`、零真实 RFQ、`pending`。
