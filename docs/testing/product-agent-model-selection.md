# Product Agent 模型选择协议 v2

最新完整比较：[2026-09-22 模型选择报告](reports/product-agent-model-selection-20260922.md)。

关联 #417、#392、#369。此协议回答“同一生产 Product Agent 在这些模型和端点上的表现”，不评估通用模型能力，不把合成测试当作工厂资料验收。

## 执行与比较边界

- 与生产一致：`runCatalogProductAgent`、共享 75 秒总预算、最多一次契约/来源错误纠正。HTTP 重试仍使用相同 SDK 策略并受同一预算限制。
- 20 个合成用例，每个重复 3 次；每个模型 60 次。固定输入、人工编写的期望值、业务契约、提示词和版本；运行前保存哈希及代码提交。
- 四个分组覆盖 OE 有无和图片有无；图片是合成占位图，不能用本套件评价真实产品视觉理解或 OCR。另有红色图片预检，只验证端点的基本图像传输与响应。
- 各模型采用生产能力策略：MiMo 官方端点 JSON 模式；Kimi K3 官方端点严格 JSON Schema；未验证网关默认文本。这是在比较可部署配置，不是在控制所有输出模式变量的因果实验。
- `outputMode` 可显式指定，但不得静默降级。显式配置的结果只适用于使用同一配置的部署。
- JSON Schema 强制表达形式；未知事实允许 `null`，生产解析后省略。工程事实仍必须通过原有来源校验。包装只统一大小写、空白和末尾句点/竖线；不改 OE 或车型。

## 评分

严格验收仍要求最终字段、OE、车型、缺失项、证据定位和状态边界全部符合冻结期望。60/60 是该合成回归集的完整通过，不是 Harbor 规定的模型选型阈值。

独立报告首次严格通过率、最终严格通过率、纠错恢复、模型原始输出契约有效率、事实 precision/recall、正确且有证据的事实 recall、原始缺失项与应用规则的一致率、模型状态边界、最终错误分类、总耗时 P50/P90 和已知 token 使用量。原始输出诊断仅做明确允许的 null/包装规范化，不注入正确答案；生产后处理结果用于最终严格评分。模型原始缺失项和状态与生产确定性补全/审查结果分别观察。

`model_blockers_exact` 只表示模型原始列表与应用确定性规则是否一致。当前提示词未完整定义该分类规则，而 `reviewProductDraft` 会重算阻断项，因此该指标不参与模型排名，也不能解释成模型的业务缺失识别准确率。最终阻断项仍由严格验收检查；事实 completeness 使用原始事实 recall。

未产生输出的尝试在输出诊断中记 0，同时单列超时/供应商/运行器失败。合法空对象的 precision 为 1、recall 为 0，不能以 precision 单独排名。各用例指标取宏平均，不能把多次重复当作 60 个独立业务场景。未完整运行不进入最终排名；预检不可用单列，不记作质量 0。预检与正式调用成本分开，token 缺失不推算成免费，缺少适用账单证据时金额为 null。

## 运行

私有配置只指定凭证的环境变量名称，勿在配置内填写密钥。例如放在被忽略的 `tmp/model-selection/config.json`：

```json
{
  "concurrency": 4,
  "models": [{
    "name": "kimi-k3",
    "provider": "openai-compatible",
    "model": "kimi-k3",
    "apiKeyEnv": "KIMI_API_KEY",
    "baseUrl": "https://api.moonshot.cn/v1"
  }]
}
```

```sh
pnpm eval:model-selection --config tmp/model-selection/config.json --env-file .env --output tmp/model-selection/new-batch
```

macOS 长批次使用 `caffeinate -i pnpm eval:model-selection ...`，只在该命令运行期间防止空闲睡眠。运行器每秒监测事件循环，超过 5 秒停顿、时钟倒退或单试次超过 80 秒（75 秒预算加 5 秒清理容差）会标记测量无效；无效或未完整批次不得排名。

父目录必须已存在；输出目录必须全新且被 Git 忽略。正式比较必须从干净提交运行，`--allow-dirty` 仅生成 diagnostic_only 数据。评分器在运行前复制到批次目录，并记录 SHA-256；诊断 revision 2 要求缺失项数组显式存在，缺省不能冒充空列表。私有文件权限 0600，记录原始响应、拒绝原因及 token；仅 `summary.json` 经逐层白名单汇总可供发布。不要提交或上传 `*-private.json`、端点配置和原始 Harbor jobs。

发布前执行 `pnpm exec tsx scripts/validate-product-model-selection-report.ts <summary.json>`：它要求完整且测量有效的正式批次，从试次重算统计，验证运行健康，并拒绝未知字段。`test:product-output` 也会复核已提交的选型 JSON 报告。统计表可用 `pnpm exec tsx scripts/render-product-model-selection-report.ts <summary.json> <new-report.md>` 从有效报告生成，输出文件拒绝覆盖；选型解释须在核对错误案例后另行补充。

该本地运行器使用生产策略及 Harbor 的同一 Python verifier，执行方式明确标为 `local-production-policy`，不声称运行了 Harbor 容器。Harbor 使用 `BaseInstalledAgent` 执行容器中的同一 CLI；`reward.json` 包含独立维度。CI 使用 oracle 和容器内合成 HTTP 服务，检查实际容器、生产适配器/CLI/SDK、事实拒绝后的纠错及产物收集，不测模型能力。Harbor 严格 gate 保留完整 60/60 条件，本地选型汇总把“测量完成”和“全量通过”分别表示。

## 解读与后续真实验收

v1 历史报告保持不变；v2 同时改变提示词、输出模式、包装规范化和纠错策略，前后差异不能全部归因于 Schema。Schema 可以消除大量格式错误，不能保证事实真伪、证据有效性或工程适配。

本套件适合第一轮候选筛选。最终部署前需要经授权的工厂资料留出集：真实版式与图片、缺失/冲突信息、多产品文档、难辨型号和跨语言表达；真值必须有工厂来源或人工确认，并与调提示词使用的数据分离。业务接受阈值应在看留出集结果前确定，尤其要求工程事实编造和越权审批为零；不能为了提高分数放宽这些规则。

官方参考：[Harbor verifier 多指标](https://docs.harborframework.com/core-concepts/tasks/verifier)、[容器内自定义 Agent](https://docs.harborframework.com/core-concepts/agents/custom-agents)、[MiMo JSON 输出](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/structured-output)、[Kimi K3 严格 Schema](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)。
