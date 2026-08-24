import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProductAgentModel } from "../lib/ai/model-provider";
import { AiSdkProductAgent } from "../lib/product/agent";
import { discoverCatalogCandidates } from "../lib/product/catalog-candidates";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { PRODUCT_AGENT_PROMPT_VERSION } from "../lib/product/product-agent-prompt";
import { PRODUCT_AGENT_PROMPT_HASH } from "../lib/product/product-agent-prompt";

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function positiveInteger(name: string, value: string, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

type CatalogResult = {
  identifier: string;
  status: "pending" | "succeeded" | "failed";
  draft?: unknown;
  error?: string;
};

async function main() {
  const documentPath = option("--document", "");
  if (!documentPath) throw new Error("Pass --document <catalog-file>");
  const modelId = option("--model", process.env.F_TRADE_MODEL ?? "");
  if (!modelId) throw new Error("Pass --model provider/model or set F_TRADE_MODEL");
  const outputPath = resolve(option("--output", "output/catalog-review.json"));
  const recordId = option("--record-id", "catalog-review");
  const limit = positiveInteger("--limit", option("--limit", ""), Number.POSITIVE_INFINITY);
  const concurrency = positiveInteger("--concurrency", option("--concurrency", ""), 1);
  const onlyIdentifiers = new Set(
    option("--identifiers", "")
      .split(",")
      .map((identifier) => identifier.trim())
      .filter(Boolean),
  );
  const timeoutMs = positiveInteger(
    "--model-timeout-seconds",
    option("--model-timeout-seconds", ""),
    75,
  ) * 1000;
  const document = await preprocessProductAgentDocument({
    documentPath,
    recordId,
    imageAvailability: "none",
    imageRefs: [],
  });
  const discoveredCandidates = discoverCatalogCandidates(document.source);
  const candidates = (onlyIdentifiers.size === 0
    ? discoveredCandidates
    : discoveredCandidates.filter((candidate) => onlyIdentifiers.has(candidate.identifier))
  ).slice(0, limit);
  if (onlyIdentifiers.size > 0 && candidates.length !== onlyIdentifiers.size) {
    throw new Error("One or more requested catalog candidate identifiers were not found");
  }
  if (candidates.length === 0) throw new Error("No supported catalog product identifiers found");

  const agent = new AiSdkProductAgent();
  const model = createProductAgentModel(modelId);
  const results: CatalogResult[] = candidates.map((candidate) => ({
    identifier: candidate.identifier,
    status: "pending",
  }));
  let reportWrite = Promise.resolve();
  async function writeReport() {
    reportWrite = reportWrite.then(async () => {
      const successCount = results.filter((result) => result.status === "succeeded").length;
      const failureCount = results.filter((result) => result.status === "failed").length;
      const temporaryPath = `${outputPath}.tmp`;
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify({
        model: modelId,
        prompt: { version: PRODUCT_AGENT_PROMPT_VERSION, hash: PRODUCT_AGENT_PROMPT_HASH },
        document: {
          document_sha256: document.document_sha256,
          filename: document.filename,
          media_type: document.media_type,
          ocr_enabled: document.ocr_enabled,
        },
        candidate_count: candidates.length,
        success_count: successCount,
        failure_count: failureCount,
        pending_count: candidates.length - successCount - failureCount,
        results,
      }, null, 2)}\n`);
      await rename(temporaryPath, outputPath);
    });
    await reportWrite;
  }
  await writeReport();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const candidate = candidates[index]!;
      try {
        const result = await agent.run({ model, source: candidate.source, timeout_ms: timeoutMs });
        results[index] = { identifier: candidate.identifier, status: "succeeded", draft: result.draft };
      } catch (error) {
        results[index] = {
          identifier: candidate.identifier,
          status: "failed",
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
      await writeReport();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  await writeReport();
}

main().catch((error: unknown) => {
  console.error(`Catalog Product Agent failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
