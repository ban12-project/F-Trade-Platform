import { randomUUID } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProductAgentModel } from "../lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "../lib/ai/product-agent-model-config";
import {
  discoverCatalogCandidates,
  selectCatalogCandidates,
} from "../lib/product/catalog-candidates";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";
import {
  type ProductAgentEvidenceLocation,
  prepareProductAgentEvidenceSource,
} from "../lib/product/evidence-locations";
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
    layout_recovered_pages: number[];
    conversion_status: "converted" | "no_text";
  };
  candidate_count: number;
  candidate_identifiers: string[];
  candidate_records: Array<
    Pick<
      ReturnType<typeof discoverCatalogCandidates>[number],
      "record_id" | "identifier" | "review_status"
    > & { evidence_ref: string }
  >;
  manual_review: {
    status: "review_required";
    reasons: Array<
      | "catalog_candidates_require_source_field_review"
      | "no_supported_catalog_candidates"
      | "ocr_text_requires_visual_verification"
      | "layout_recovery_requires_visual_verification"
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

export type CatalogResult = {
  identifier: string;
  record_id: string;
  review_status: ReturnType<typeof discoverCatalogCandidates>[number]["review_status"];
  evidence_ref: string;
  status: "pending" | "succeeded" | "failed";
  evidence_locations?: ProductAgentEvidenceLocation[];
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
  if (document.layout_recovered_pages.length > 0)
    reviewReasons.push("layout_recovery_requires_visual_verification");
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
      layout_recovered_pages: document.layout_recovered_pages,
      conversion_status: document.conversion_status,
    },
    candidate_count: candidates.length,
    candidate_identifiers: candidates.map((candidate) => candidate.identifier),
    candidate_records: candidates.map(({ identifier, record_id, review_status, source }) => ({
      identifier,
      record_id,
      review_status,
      evidence_ref: source.evidence_refs[0]!,
    })),
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
  const candidates = selectCatalogCandidates(discoveredCandidates, onlyIdentifiers, limit);
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
    record_id: candidate.record_id,
    review_status: candidate.review_status,
    evidence_ref: candidate.source.evidence_refs[0]!,
    status: "pending",
  }));
  let reportWrite = Promise.resolve();
  let firstReport = true;
  async function writeReport() {
    reportWrite = reportWrite.then(async () => {
      const successCount = results.filter((result) => result.status === "succeeded").length;
      const failureCount = results.filter((result) => result.status === "failed").length;
      await writeCatalogReportSnapshot(
        outputPath,
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
              layout_recovered_pages: document.layout_recovered_pages,
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
        firstReport,
      );
      firstReport = false;
    });
    await reportWrite;
  }
  await completeCatalogBatch(
    results,
    concurrency,
    async (index) => {
      const candidate = candidates[index]!;
      const result = await agent.run({ model, source: candidate.source, timeout_ms: timeoutMs });
      return {
        draft: result.draft,
        evidence_locations: prepareProductAgentEvidenceSource(
          candidate.source,
        ).evidence_locations.filter((location) =>
          result.draft.evidence_refs.includes(location.ref),
        ),
      };
    },
    writeReport,
  );
}

/** Reserve a new run atomically; never replace a report left by an earlier batch. */
export async function writeCatalogReportSnapshot(
  outputPath: string,
  contents: string,
  createOnly: boolean,
) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (createOnly) {
      try {
        await link(temporaryPath, outputPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error(
            "Catalog report already exists; choose a new --output path to preserve previous results",
          );
        throw error;
      }
    } else await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Finish independent records and persist their outcomes before failing the batch. */
export async function completeCatalogBatch(
  results: CatalogResult[],
  concurrency: number,
  extract: (index: number) => Promise<Pick<CatalogResult, "draft" | "evidence_locations">>,
  writeReport: () => Promise<void>,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Catalog concurrency must be a positive integer");
  if (!results.length || results.some((result) => result.status !== "pending"))
    throw new Error("Catalog batch requires pending records");
  await writeReport();
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < results.length) {
      const index = nextIndex++;
      try {
        results[index] = { ...results[index]!, ...(await extract(index)), status: "succeeded" };
      } catch (error) {
        results[index] = {
          ...results[index]!,
          status: "failed",
          error: error instanceof Error ? error.message : "unknown error",
        };
      }
      await writeReport();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, results.length) }, worker));
  await writeReport();
  const failed = results.filter((result) => result.status === "failed").length;
  const pending = results.filter((result) => result.status === "pending").length;
  if (failed || pending)
    throw new Error(
      `Catalog batch incomplete: ${results.length - failed - pending} succeeded, ${failed} failed, ${pending} pending; see local report`,
    );
}

if (process.argv[1]?.endsWith("run-product-agent-catalog.ts")) {
  main().catch((error: unknown) => {
    console.error(
      `Catalog Product Agent failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  });
}
