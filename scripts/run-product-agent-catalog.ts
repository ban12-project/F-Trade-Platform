import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProductAgentModel } from "../lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "../lib/ai/product-agent-model-config";
import { discoverCatalogCandidates } from "../lib/product/catalog-candidates";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";
import {
  PRODUCT_AGENT_PROMPT_HASH,
  PRODUCT_AGENT_PROMPT_VERSION,
} from "../lib/product/product-agent-prompt";

export interface CatalogPreflightReport {
  classification: "local_preflight";
  document: {
    document_sha256: string;
    filename: string;
    media_type: string;
    ocr_enabled: boolean;
    conversion_status: "converted" | "no_text";
  };
  candidate_count: number;
  candidate_identifiers: string[];
  manual_review: {
    status: "review_required";
    reasons: Array<
      | "catalog_candidates_require_source_field_review"
      | "no_supported_catalog_candidates"
      | "ocr_text_requires_visual_verification"
      | "document_conversion_requires_approved_ocr"
    >;
  };
}

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function positiveInteger(name: string, value: string, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

type CatalogResult = {
  identifier: string;
  status: "pending" | "succeeded" | "failed";
  draft?: unknown;
  error?: string;
};

export function createCatalogPreflightReport(
  document: Awaited<ReturnType<typeof preprocessProductAgentDocument>>,
  candidates: ReturnType<typeof discoverCatalogCandidates>,
): CatalogPreflightReport {
  const reviewReasons: CatalogPreflightReport["manual_review"]["reasons"] = [
    "catalog_candidates_require_source_field_review",
  ];
  if (candidates.length === 0) reviewReasons.push("no_supported_catalog_candidates");
  if (document.ocr_enabled) reviewReasons.push("ocr_text_requires_visual_verification");
  if (document.conversion_status === "no_text") {
    reviewReasons.push("document_conversion_requires_approved_ocr");
  }
  return {
    classification: "local_preflight",
    document: {
      document_sha256: document.document_sha256,
      filename: document.filename,
      media_type: document.media_type,
      ocr_enabled: document.ocr_enabled,
      conversion_status: document.conversion_status,
    },
    candidate_count: candidates.length,
    candidate_identifiers: candidates.map((candidate) => candidate.identifier),
    manual_review: {
      status: "review_required",
      reasons: reviewReasons,
    },
  };
}

async function main() {
  const documentPath = option("--document", "");
  if (!documentPath) throw new Error("Pass --document <catalog-file>");
  const preflight = hasFlag("--preflight");
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
  const timeoutMs =
    positiveInteger("--model-timeout-seconds", option("--model-timeout-seconds", ""), 75) * 1000;
  const document = await preprocessProductAgentDocument({
    documentPath,
    recordId,
    imageAvailability: "none",
    imageRefs: [],
    allowEmptySource: preflight,
  });
  const discoveredCandidates = discoverCatalogCandidates(document.source);
  const candidates = (
    onlyIdentifiers.size === 0
      ? discoveredCandidates
      : discoveredCandidates.filter((candidate) => onlyIdentifiers.has(candidate.identifier))
  ).slice(0, limit);
  if (onlyIdentifiers.size > 0 && candidates.length !== onlyIdentifiers.size) {
    throw new Error("One or more requested catalog candidate identifiers were not found");
  }
  if (preflight) {
    console.log(JSON.stringify(createCatalogPreflightReport(document, candidates), null, 2));
    return;
  }
  if (candidates.length === 0) throw new Error("No supported catalog product identifiers found");

  const modelConfig = await resolveProductAgentModelConfig();
  const agent = new EvidenceLocatedProductAgent();
  const model = createProductAgentModel(modelConfig);
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
      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          {
            model: `${modelConfig.provider}/${modelConfig.model}`,
            prompt: { version: PRODUCT_AGENT_PROMPT_VERSION, hash: PRODUCT_AGENT_PROMPT_HASH },
            evidence_mode: "bounded_location",
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
          },
          null,
          2,
        )}\n`,
      );
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
        results[index] = {
          identifier: candidate.identifier,
          status: "succeeded",
          draft: result.draft,
        };
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

if (process.argv[1]?.endsWith("run-product-agent-catalog.ts")) {
  main().catch((error: unknown) => {
    console.error(
      `Catalog Product Agent failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}
