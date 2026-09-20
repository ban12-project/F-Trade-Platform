# MiMo 多模态模型验收 · 2026-09-20

关联 #369 / #392。本次用户指定小米支持多模态的模型，并在 `.env` 配置 `MIMO_API_KEY` 后确认开始测试。

依据 [模型列表](https://mimo.mi.com/docs/zh-CN/quick-start/summary/model) 和 [图片理解](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding) 选择 `mimo-v2.5`。实际凭据属于 Token Plan；[首次调用文档](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call) 要求配套的 Token Plan 端点。按量地址的认证检查返回 401，切换官方 Token Plan China 地址后成功，不是通过换 key 或降低权限绕过认证。

图片烟测使用代码生成的 128×128 红色 PNG，Base64 输入，模型准确返回 Red；HTTP 200，响应记录 16 image tokens。它证明该图片输入能被处理，不代表真实离合器图像识别或工程事实核验。

真实产品评测使用现有 `scripts/run-harbor-product-agent.ts`、`EvidenceLocatedProductAgent` 和冻结 Python verifier。20 个 synthetic 任务各三次，本机四路并发，每次 190 秒上限，未启用应用层修复重试；AI SDK 默认传输重试未更改。只将小米凭据映射为评测专用变量，未读取应用数据库或发送真实工厂资料。

此次 20 个 expectation hash、prompt 1.0.11 及其 hash 与 2026-09-19 的 Luna 批次完全一致。代码提交记录在 JSON 中。没有按测试结果修改期望，也没有补跑覆盖失败。

这是本机生产 runner 的真实模型验收，未执行 Harbor 容器批次；不能宣称本地 Podman 障碍已经修复或 Harbor 发布门禁通过。

## 验收结果

**15/60（25%），未通过**。37 次在生产校验阶段被拒绝；23 次输出草稿中，15 次通过冻结 verifier，8 次因包装句号差异失败。所有 60 次均完成，无进程超时；原始输出未重跑替换。

| 类别 | 次数 |
| --- | ---: |
| 通过 | 15 |
| 尺寸不是 number | 8 |
| MOQ 不是 integer | 11 |
| sample_available 不是 boolean | 6 |
| kit_contents 不是 array | 4 |
| oe_numbers 不是 array | 2 |
| 字段证据不一致 | 2 |
| OE 来源校验拒绝 | 3 |
| 非单一 JSON 对象 | 1 |
| 包装句号与固定期望不一致 | 8 |

| 队列 | 完成 | 通过 |
| --- | ---: | ---: |
| A | 15 | 2 |
| B | 15 | 6 |
| C | 15 | 3 |
| D | 15 | 4 |

8 次包装差异全部为源文/模型输出 `neutral carton.` 与冻结期望 `neutral carton`。生产允许该标点差异，verifier 精确比较不接受；单列为验收口径问题，不称为编造事实。旧记录未重评分。其他 37 次失败仍使本批次不通过。

生产 runner 未保存被校验拒绝前的模型原始响应，因此错误分类依据诊断，不能断言具体原始值、是否漏值或模型意图。输出类型不符合 schema，不等同于已证明模型编造工程事实。

上一轮 Luna 为 13/60，此轮 MiMo 为 15/60；2 次差异不足以证明模型总体优劣。两轮虽使用相同 prompt/expectation，但模型、服务端默认参数、日期和代码提交不同，也没有为统计比较设计样本量。未改变 MiMo 默认深度思考策略，也未加入供应商建议的身份 system prompt，以保留现有 Product Agent prompt。

[逐次脱敏 JSON](product-agent-mimo-20260920.json) 保留版本、hash、退出码、耗时、队列和失败分类。凭据、认证原文、模型原始日志保留在本地忽略目录，不进入 GitHub。没有执行真实工厂材料抽取或改变 Gate 01/02/03。

后续应先处理 #392 中的结构化类型指导、证据一致性和商业文本口径，再冻结新批次复测。本报告仅记录验收结果，没有修改生产实现以刷通过率。
