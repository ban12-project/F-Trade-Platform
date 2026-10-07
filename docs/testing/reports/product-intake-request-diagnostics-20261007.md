# 产品导入失败响应与阶段诊断关联 — 2026-10-07

关联 [#348](https://github.com/ban12-project/F-Trade-Platform/issues/348)。基线 `main@bcade6dd23539194dc6387f73b210c7e0e796ef7`，Node 24.21.0 / pnpm 12.3.4 / Next 16.3.8。历史两个 CSV 启动失败的根因仍未证明；已经成功的冻结输入重放继续保留，不能改写原失败。

## 已确认的诊断缺口与修改

当前服务器已有固定白名单的 `stage / category / code` 诊断，但错误响应没有关联值。同一阶段的多个请求同时失败时，维护者无法仅凭响应把它与某一条服务器诊断对应。实际 Route Handler 的修改前测试在“响应缺少诊断编号”处失败，基线输出保留。

[`logProductIntakeFailure`](../../../lib/product/intake-diagnostics.ts)现在生成随机 UUID，将其作为 `diagnosticId` 加入原有安全诊断并返回。流式导入 Route Handler 的错误响应通过 `x-product-intake-diagnostic` 携带同一个值。编号由服务器生成，不接收客户端指定值，也不从账号、项目、产品、来源或异常内容派生。原有固定错误码、用户提示、HTTP 状态、身份认证与授权检查保持原行为。

新增值是运行诊断关联元数据，不是事实来源或业务审批。没有增加 UI 控件、自动重试、模型请求、数据写入或 Gate 放行逻辑。已有 Blob 读取、目录 Action 的诊断也获得随机编号；本轮只为流式 HTTP 错误响应提供匹配头，未宣称其他 Action 或已启动的 NDJSON 错误都拥有此响应关联。

## 验证证据与范围

- [`test-product-intake-request-diagnostics.mts`](../../../scripts/test-product-intake-request-diagnostics.mts)直接调用实际 Route Handler 和实际诊断函数，模拟六个失败阶段：input、project_access、model_config、document、images、start_run。另有两个相同 document 失败并发执行，八个响应编号各不相同，均匹配对应日志。
- 上述原生测试的外部身份、模型、文件和存储依赖由明确的 SYNTHETIC 替身隔离，不是八次生产故障或历史 CSV 根因复现。检查伪造的有效 UUID 不被沿用、资料/URL/凭据/actor/session/project 不进入输出，错误状态与固定提示保持一致；错误未触发自动重试、模型或草稿写入。跨来源及 viewer 请求仍为 403，不生成或返回内部诊断。
- 在实际 Next dev 和恢复的合成浏览器登录态中，两个同时发出的无效表单请求均返回 HTTP 400；两个响应的 UUID 分别与两条服务器日志逐一匹配，实际阶段为 `input / validation`。客户端伪造编号及 sourceText 未出现在服务器日志。现有 stream run 数量保持 0，上传回执数保持 14；没有创建新的资料、模型请求或云上传。
- 实际浏览器证明的是**输入校验阶段的 HTTP/日志关联**；其他五个阶段由上面的实际 handler 原生替身测试覆盖。没有把输入校验失败当成 Blob 传输故障复现。
- 初次浏览器探测脚本的顶层 await 写法不适用于当前执行器，在发出 HTTP 请求前失败。修改为返回 Promise 的表达式后成功；原失败和修正后的输出分别保留。
- 原有输入诊断/安全提示、Action 隐私、产品 stream 验证/存储/传输/实际 AI SDK 数组解析/图片来源限制测试通过；TypeScript、数据库迁移检查和仓库校验通过。React tree 与单 fiber inspect 成功，Next MCP 全路由 compilation issues、config errors、session errors 为空。

新的原生 handler 测试加入仓库 CI。完整生产构建、PostgreSQL、Harbor 及 252＋51 个浏览器检查，以交付 PR 最终 head 的检查记录为准。依赖、锁文件、数据库 schema、Next 编译开关和原始资料未变。

## 仍待核实

今后遇到该 HTTP 错误，可从响应头取得编号，在私有运维日志中找到同编号的阶段诊断。记录只说明处理阶段与白名单类别，**不证明历史根因、没有副作用或可以自动重试**；尤其 `start_run` 的现有范围包含创建及响应准备，仍须核对持久化状态。客户端从未收到响应的连接中断也可能无法取得编号。

历史 #348 继续保持开放，等待对应偶发故障的真实阶段证据或根因证据。该改动不替代当前生产版本/日志可用性、真实 RFQ、报价交期确认或正式 Go/No-Go。reference 资料测试和委托审核已经通过，业务聚合仍为六项 `not_run`、零真实 RFQ、`pending`。
