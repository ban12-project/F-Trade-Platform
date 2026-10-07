# 工具依赖安全补丁与兼容验证 — 2026-10-07

关联 [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498)，基线 `main@b7982bb3a37273be19c1c1ec698947c1a5952ab3`。**两项工具依赖补丁及六项合成回归通过；剩余风险和正式 MVP 业务验收继续开放。** 本轮没有生产数据库写入、模型调用、资料上传或渠道操作。

## 新扫描与范围

同轮生产依赖扫描在改动前为 `0 critical / 4 high / 1 moderate / 0 low`，改动后为 **`0 critical / 3 high / 0 moderate / 0 low`**。新增的 MCP SDK 公告解释了改动前比[上一轮](workflow-security-patches-20261007.md)多出的一个 high；不能将两轮不同公告集混作同一基线。计数是公告版本匹配，不是已证明的应用可利用漏洞数。

| 精确父依赖 | 修复 | 核对依据 |
| --- | --- | --- |
| `@esbuild-kit/core-utils@3.3.2 → esbuild` | 0.18.20 → 0.25.12 | [上游公告](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)的修复下限为 0.25.0；[0.25.0 说明](https://github.com/evanw/esbuild/releases/tag/v0.25.0)明确包含开发服务器及 API 变化，不能只称为无兼容影响的补丁 |
| `shadcn@4.19.1 → @modelcontextprotocol/sdk` | 1.30.0 → 1.31.0 | [SDK 上游公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)说明带发行方的 OAuth 凭据保护及遗留凭据限制 |

两项 override 只绑定精确父版本；未来父依赖升级须重新评估。Drizzle Kit、shadcn、Workflow、Next、应用 Zod 及其原有认证依赖解析均保持原版本。锁文件删除不再使用的 esbuild 0.18.20 及对应原生包，替换 MCP SDK 节点，没有通过移动依赖分类隐藏扫描结果。依赖构建脚本仍被禁止，冻结锁文件安装通过。

实际可见入口有限：legacy core-utils 调用 esbuild 的 transform/transformSync，未发现应用启动其开发服务器；shadcn 的可见 MCP 导入为 server/types 和 stdio，未发现应用调用 SDK HTTP OAuth 客户端。因此下列安全对照证明的是安装包在合成条件下的行为差异，不能称作发现了本应用的公网利用或真实凭据泄漏。

## 兼容及安全对照

CI 新增 `scripts/test-tooling-security-compatibility.mjs`，从真实父依赖解析所用包，执行以下六项检查：

| 检查 | 结果 |
| --- | --- |
| legacy loader 同步 CJS、异步 ESM | 冷转换和缓存命中均执行得到期望值，source map 的版本、原文件、原文本及映射完整 |
| 精确 loader esbuild 的开发服务器 | 只在 loopback 提供合成 JS；旧包返回 `Access-Control-Allow-Origin: *`，当前包不提供跨源读取许可；测试文件和服务器均清理 |
| SDK 低阶 token 请求 | 发行方已标记的合成客户端凭据遇到另一发行方时拒绝，模拟 token endpoint 调用数为 0；旧包的拒绝断言失败 |
| SDK 缓存发现流程 | 另一发行方不能接收已标记的客户端凭据，token endpoint 调用及保存次数均为 0 |
| 合法同发行方认证 | 一次合成 token 请求成功，实际 `auth` 保存边界保留发行方标记 |
| 已安装 shadcn MCP 服务 | 实际 SDK 内存协议握手、工具发现及只读审核清单调用通过；不是 CLI/OAuth 真实账号登录，也不连接外部 MCP 服务 |

同时，原有 64 个冻结 seeded replay ID、旧序列化 wire、Buffer 可见切片和两个 world 的 HTTP 行为回归通过；没有改写固定夹具。真实应用 schema 的 Drizzle SQL 生成在改动前后逐字节相同，两个临时输出目录均不连接数据库；当前迁移元数据检查通过。认证/Passkey 适配器检查、TypeScript 7 类型检查、改动文件 Biome 及仓库总校验通过。

### 保留的失败和修正

- 首版工具回归在旧依赖上得到 2 通过 / 3 失败。其中两个安全断言对应旧 CORS/发行方行为；另一个失败来自测试把发行方保存要求误加在低阶 `fetchToken` 的返回值上。核对真实 SDK 后，改在 `auth` 的保存边界核实，合法请求和错发行方拒绝分别保留。
- 首版 source map 检查只接受 JSON 字符串，后续缓存命中返回 RawSourceMap 对象而失败。核对真实 loader/source-map-support 的支持类型后，同时验证两种表示的实际内容，并增加冷转换及缓存命中覆盖；没有降低映射、原文件或原文本断言。
- 首次依赖重解顺带将应用 Zod 从 4.4.3 改到 4.5.4。该无关变化已收回，原有 root/peer/认证内部解析全部恢复；最终冻结安装及相关检查通过。没有混入 AI 输出 schema 或认证行为升级。

## 剩余风险

- nanoid 5.1.6 的两条 high 仍存在。强制 5.1.16 会改变既有 seeded replay ID，仍需兼容重放策略；本轮没有更换它或重写期望。
- braces 3.0.3 的一条 high 仍存在，上游未列补丁；现有路径为 shadcn CLI 的 glob 工具，尚未证明公开应用输入可达。
- SDK 补丁不替遗留无发行方凭据绑定可信发行方，也不替 bundled provider 配置 `expectedIssuer`。当前可见 shadcn 服务属于 stdio/server，不能凭补丁通过宣称所有自定义 OAuth 客户端都安全。
- 新扫描同时带出 Workflow 4.8.4 的 registry 弃用提示：上游已记录连接池等待导致队列请求越过预算。[上游修复](https://github.com/vercel/workflow/pull/4049)及独立风险 [#509](https://github.com/ban12-project/F-Trade-Platform/issues/509) 跟踪兼容迁移和实际队列预算，未计入以上安全公告计数，也未认定为历史 CSV/Facebook 故障原因。

本轮 Node 24.21.0 / pnpm 12.3.4 / Next 16.3.8 / TypeScript 7.0.2。Cache Components、默认 Turbopack、两个 React Compiler 开关及默认 TypeScript CLI 均保留。用户原工作区的 16 个未提交文件未修改；临时诊断只含合成输入和依赖状态，原始日志留在忽略目录。完整生产构建、PostgreSQL、浏览器、Harbor 及交付 CI 由关联 PR 核对；正式业务验收仍由 #32 承接。
