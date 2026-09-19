# Product Agent 真实模型验收 · 2026-09-19

结论：**未通过，13/60（21.67%）**。按冻结的全部通过阈值判定，没有修改期望、补跑替代失败或放宽事实安全校验。

关联 [#369](https://github.com/ban12-project/F-Trade-Platform/issues/369)、[缺陷与口径问题 #392](https://github.com/ban12-project/F-Trade-Platform/issues/392)。逐次脱敏结果见 [JSON 报告](product-agent-live-20260919.json)。

## 方法和授权

用户于本次会话明确授权使用 `.env` 环境变量做模型验收。只将 `OPENAI_COMPATIBLE_BASE_URL` 和 `OPENAI_COMPATIBLE_API_KEY` 映射为专用 `HARBOR_*` 变量，未传入数据库、邮件、Blob、认证或配置解密变量。地址与密钥不进入报告、PR 或 Issue。

模型列表请求返回 HTTP 200，包含仓库示例模型 `gpt-5.6-luna`，因此选择 `openai-compatible/gpt-5.6-luna`。这是本次单模型结果，不能推导其他模型的能力。

- 代码：`54ee9fd366d50421bda629b4ced461f66b11eb6d`；prompt `1.0.11`，hash 记录在逐次报告。
- 输入：运行前由 `eval:harbor:prepare` 固定的 A–D 各 5 个 synthetic 样例及 expectation hash。
- 执行：`node --import tsx scripts/run-harbor-product-agent.ts --input <task>/environment/input/source.json --output <trial>/output.json`。
- 验证：同一 `evals/harbor/product-agent/verifier.py` 的 `grade(expected, result)`；runner 非零退出直接计失败。
- 20 个样例各 3 次，独立调用，共 60 次；本机 4 路并发、每次 190 秒进程上限；未启用应用层修复重试。AI SDK 自身的默认传输重试策略未修改。
- 正式批次之前另有 1 次 a-01 模型探针，因尺寸类型错误退出；不包含在固定 60 次结果中。
- 所有正式试次均有确定的退出码，没有进程超时。未保存生产 validator 拒绝前的模型原始输出，因此错误分类依据 validator 诊断，不能进一步推断具体原始字符串或模型意图。

## 结果

| 队列 | 完成 | 通过 |
| --- | ---: | ---: |
| A | 15 | 7 |
| B | 15 | 6 |
| C | 15 | 0 |
| D | 15 | 0 |
| 总计 | 60 | 13 |

| 结果类别 | 次数 | 观察事实 |
| --- | ---: | --- |
| 完全符合冻结验收 | 13 | 生产 runner 和独立 verifier 均通过 |
| 尺寸类型被拒绝 | 8 | `clutch_diameter_mm must be number` |
| MOQ 类型被拒绝 | 10 | `moq must be integer` |
| 布尔类型被拒绝 | 9 | `sample_available must be boolean` |
| 字段证据不一致 | 5 | 生产校验要求 populated facts 与 field_evidence 精确对应 |
| OE 来源校验拒绝 | 6 | 生产校验拒绝未获匹配 OE/OEM 标签支持的输出；未保存原始模型响应，不能断言其具体值 |
| 包装标点口径不一致 | 9 | 实际 `neutral carton.`，冻结期望 `neutral carton` |

38 次在生产 runner 阶段被拒绝，22 次生成了生产校验接受的草稿，其中 9 次被独立 verifier 判失败。接受草稿不等于 Ready，更不等于人工 Gate 01。

包装差异需单独判断：源文本是 `Packaging: neutral carton.`，生产 `assertLabelledTextFact` 的归一化比较接受带句号的值，但 verifier 使用精确 JSON 比较。这里不能直接称为编造事实，也不能在跑完后改写冻结期望以宣称通过。需先决策一致的商业文本口径，再创建新批次。即使未来这 9 次按新口径接受，本批次其余 38 次失败依然存在。

提示词目前枚举字段名，但未明确列出所有 JSON 数值/布尔类型，可能是类型失败的原因之一；这是待验证推断，不是已证实的修复。后续修复和复测由 #392 跟踪，原记录不覆盖。

## Harbor 容器链路仍未通过

本机已构建当前评测镜像，ID `9b59dc2b0ad5ca745e5ab02bd72a945e68dfed1f75baca10fb3cdb9acf4dd38a`。安装的 Harbor 为 0.23.0，Podman 为 5.8.3。

启动诊断依次暴露 Podman 连接中断、podman-compose 1.6.0 缺少 Harbor 预检所需的 `compose ls`、Compose socket 路径不一致。使用官方 Docker Compose 5.5.1 并指定实际 socket 后可以调度任务，但 60 个 Harbor trial 全部在容器准备阶段失败，诊断为 overlay storage 的 `readlink .../overlay/l: invalid argument`。没有证据表明这些 Harbor 试次调用了模型。

Harbor job：`product-agent-20260919-1789779596905`。其 CLI 退出码为 0，但 60 个 trial 均带 RuntimeError，项目验收门禁正确退出失败。不能仅凭 CLI 退出码声称通过。

因此，本报告是 **本机生产 runner + 冻结 Harbor verifier 的真实模型验收**，没有伪造 Harbor result.json，也不满足 Harbor 容器发布门禁。此前 CI 的 oracle 链路通过，仍不能替代本次真实模型容器验收。

## 数据和边界

7 组确定性验收测试与 Harbor 20-task/API 检查在模型执行前通过。事实阈值、prompt、生产代码均未因本批次结果而修改。

原始日志、模型输出和可能含连接信息的 Harbor jobs 仅保留在本地忽略目录；提交内容只包含 synthetic ID、版本/hash、耗时、退出码和脱敏分类。本批次不代表真实工厂 20-slot 或任何人工批准，Gate 01/02/03 均未改变。
