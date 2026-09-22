import { readFileSync } from "node:fs";
import { validateSelectionReport } from "../evals/harbor/product-agent/selection-report";

try {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Pass at least one report path");
  for (const path of paths) {
    const report = validateSelectionReport(JSON.parse(readFileSync(path, "utf8")));
    console.log(`PASS valid model-selection report: ${report.trials.length} trials`);
  }
} catch {
  console.error(
    "Model-selection report validation failed: incomplete, inconsistent, unsafe, or invalid measurement.",
  );
  process.exitCode = 1;
}
