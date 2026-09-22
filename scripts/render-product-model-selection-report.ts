import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { validateSelectionReport } from "../evals/harbor/product-agent/selection-report";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Pass validated summary JSON and a new Markdown output path");
const report = validateSelectionReport(JSON.parse(readFileSync(input, "utf8")));
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const seconds = (n: number | null) => (n === null ? "—" : (n / 1000).toFixed(2));
const lines = [
  "# Product Agent 模型比较：生产策略 v2",
  "",
  `数据：[完整白名单结果](${basename(input)})。生成代码提交：\`${report.source_commit}\`。`,
  `运行：${report.started_at} 至 ${report.finished_at}。${report.trials.length} 次正式试次，另有独立能力预检。`,
  "",
  "相同生产 Agent、固定合成输入、75 秒总预算、最多一次纠错。各端点使用明确支持的输出模式；严格通过要求事实、证据、缺失项和状态全部符合冻结期望。",
  "",
  "| 模型 | 模式 | 首次通过 | 最终通过 | 最终通过率 | 总耗时 P50 / P90（秒） | 纠错恢复 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];
for (const model of report.models) {
  lines.push(
    `| ${model.name} | ${model.output_policy.mode} | ${model.first_passed}/${model.completed_trials} | ${model.final_passed}/${model.completed_trials} | ${pct(model.final_pass_rate)} | ${seconds(model.latency_ms.p50)} / ${seconds(model.latency_ms.p90)} | ${model.recovered_trials} |`,
  );
}
lines.push(
  "",
  "不可用端点的 0/0 表示未正式测试，不代表质量零分。耗时包含失败及纠错；不同模型 token 不可直接等同于费用。",
  "",
  "## 分组结果",
  "",
  "A：有 OE、有合成图片；B：有 OE、无图；C：无 OE、有合成图片；D：无 OE、无图。每组 5 个用例，各重复 3 次。",
  "",
  "| 模型 | A | B | C | D |",
  "| --- | --- | --- | --- | --- |",
);
for (const model of report.models) {
  const cells = ["a", "b", "c", "d"].map((cohort) => {
    const trials = report.trials.filter(
      (t) => t.model === model.name && t.id.startsWith(`${cohort}-`),
    );
    return trials.length
      ? `${trials.reduce((n, t) => n + t.report.reward, 0)}/${trials.length}`
      : "—";
  });
  lines.push(`| ${model.name} | ${cells.join(" | ")} |`);
}
lines.push(
  "",
  "## 用量及失败分类",
  "",
  "| 模型 | 已知输入 token | 已知输出 token | 用量缺失尝试 | 最终超时 | 最终契约/来源拒绝 | 供应商/运行器失败 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
);
for (const model of report.models) {
  const tokens = (key: "input_tokens" | "output_tokens") =>
    model.usage[key].missing_attempts === model.attempt_count
      ? "未知"
      : String(model.usage[key].observed_sum);
  lines.push(
    `| ${model.name} | ${tokens("input_tokens")} | ${tokens("output_tokens")} | ${model.usage.total_tokens.missing_attempts}/${model.attempt_count} | ${model.final_outcomes.timeout} | ${model.final_outcomes.contract_or_source} | ${model.final_outcomes.provider + model.final_outcomes.runtime} |`,
  );
}
lines.push(
  "",
  "用量是实际返回值的总和，包含纠错；不含预检。超时未返回的用量未知，不能按零成本解释。没有适用账单证据，金额不估算。",
  "",
  "## 首次输出诊断",
  "",
  "| 模型 | 契约有效率 | 事实 precision | 事实 recall | 有证据正确事实 recall |",
  "| --- | --- | --- | --- | --- |",
);
for (const model of report.models) {
  const metrics = model.first_response_metrics;
  lines.push(
    `| ${model.name} | ${pct(metrics.contract_valid)} | ${pct(metrics.fact_precision)} | ${pct(metrics.fact_recall)} | ${pct(metrics.evidence_recall)} |`,
  );
}
lines.push(
  "",
  "诊断取试次宏平均，无响应记 0。合法空对象的 precision 可为 1，但 recall 为 0；不得以 precision 单独排名。原始缺失项一致率不参与排名，因为生产会按确定性规则重算，而提示词未完整定义该分类规则。",
  "",
  "## 测量有效性与范围",
  "",
  `- 所有正式试次通过报告完整性与版本校验。事件循环最大间隔 ${report.execution_health.max_event_loop_gap_ms} ms；超过 80 秒的试次 ${report.execution_health.invalid_duration_trials}。`,
  `- 评分 revision ${report.grading?.diagnostic_revision}；冻结评分器 SHA-256：\`${report.grading?.verifier_sha256}\`。`,
  "- 本次为本地生产策略调用，使用与 Harbor 相同的评分器；不是远程真实模型的 Harbor 容器批次。Harbor 容器链路另由 CI 验证。",
  "- 20 个合成用例的重复不是 60 个独立业务场景。1×1 图片只覆盖传输路径，不能证明真实产品视觉或 OCR 能力。",
  "- 本结果只适用于 Product Agent 目录提取，不能推广到营销生成、流式录入或其他 Agent。",
  "- 历史 v1 与 v2 的提示词、输出策略、包装处理和纠错不同，改善不能全部归因于 Schema。",
  "- 工程事实不得编造，正式报价、交期及产品批准仍需人工确认。真实部署验收需要经授权且与调参数据分离的工厂资料留出集。",
  "",
);
writeFileSync(output, lines.join("\n"), { flag: "wx" });
console.log(
  "Rendered validated model comparison; add evidence-based selection interpretation before publication.",
);
