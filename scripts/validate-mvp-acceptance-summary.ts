import { readFile } from "node:fs/promises";
import path from "node:path";

import { compileContract } from "../lib/contracts/validator";
import { assertMvpAcceptanceDecision, type MvpAcceptanceSummary } from "../lib/testing/mvp-acceptance";

async function main() {
  const summaryPath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!summaryPath) throw new Error("Usage: validate-mvp-acceptance-summary.ts <summary.json>");
  const [schemaContents, summaryContents] = await Promise.all([
    readFile(path.join(process.cwd(), "contracts/testing/mvp-acceptance-summary.schema.json"), "utf8"),
    readFile(path.resolve(summaryPath), "utf8"),
  ]);
  const summary = compileContract<MvpAcceptanceSummary>(JSON.parse(schemaContents))(
    JSON.parse(summaryContents),
  );
  assertMvpAcceptanceDecision(summary);
  console.log("PASS MVP acceptance summary decision gates");
}

void main();
