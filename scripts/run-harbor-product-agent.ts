import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getHarborEvaluationModelConfig } from "../lib/ai/harbor-evaluation-model";
import { createProductAgentModel } from "../lib/ai/model-provider";
import { validateProductAgentSource } from "../lib/product/agent";
import { runProductAgentEvaluation } from "../lib/product/evaluation-run";

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main() {
  process.umask(0o077);
  const inputPath = resolve(option("--input", "input/source.json"));
  const outputPath = resolve(option("--output", "output/product-draft.json"));
  const source = validateProductAgentSource(JSON.parse(await readFile(inputPath, "utf8")));
  const result = await runProductAgentEvaluation({
    model: createProductAgentModel(getHarborEvaluationModelConfig()),
    source,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Harbor Product Agent failed";
  console.error(`Harbor Product Agent failed: ${message}`);
  process.exitCode = 1;
});
