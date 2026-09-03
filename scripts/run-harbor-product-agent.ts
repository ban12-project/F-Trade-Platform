import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getHarborEvaluationModelConfig } from "../lib/ai/harbor-evaluation-model";
import { createProductAgentModel } from "../lib/ai/model-provider";
import { validateProductAgentSource } from "../lib/product/agent";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main() {
  const inputPath = resolve(option("--input", "input/source.json"));
  const outputPath = resolve(option("--output", "output/product-draft.json"));
  const source = validateProductAgentSource(JSON.parse(await readFile(inputPath, "utf8")));
  const result = await new EvidenceLocatedProductAgent().run({
    model: createProductAgentModel(getHarborEvaluationModelConfig()),
    source,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ draft: result.draft, _evaluation: { ...result.metadata, evidence_mode: "bounded_location" } }, null, 2)}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Harbor Product Agent failed";
  console.error(`Harbor Product Agent failed: ${message}`);
  process.exitCode = 1;
});
