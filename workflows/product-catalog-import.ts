import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { get } from "@vercel/blob";
import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import type { CatalogFailureCode } from "@/lib/product/catalog-import-contracts";
import {
  CatalogAccessError,
  claimCatalogAttempt,
  completeCatalogCandidate,
  completeCatalogParsing,
  failCatalogAttempt,
} from "@/lib/product/catalog-import-store";
import { preprocessProductAgentDocument } from "@/lib/product/document-source";
import { verifyDocumentUploadBytes } from "@/lib/product/document-upload-bytes";
import { EvidenceLocatedProductAgent } from "@/lib/product/evidence-located-agent";

async function processAttempt(attemptId: string) {
  "use step";
  let failureCode: CatalogFailureCode = "ACCESS_REVOKED";
  let directory: string | undefined;
  try {
    const work = await claimCatalogAttempt(attemptId);
    if (!work) return;
    if (work.source) {
      failureCode = "MODEL_FAILED";
      if (!work.modelConfigId || !work.model) throw new Error("Missing model selection");
      const config = await resolveProductAgentModelConfig(work.modelConfigId, work.model);
      const result = await new EvidenceLocatedProductAgent().run({
        model: createProductAgentModel(config),
        timeout_ms: 75_000,
        source: work.source,
      });
      await completeCatalogCandidate(attemptId, result);
    } else {
      failureCode = "SOURCE_UNAVAILABLE";
      const original = work.original;
      const blob = await get(original.blobPath, { access: "private", useCache: false });
      if (blob?.statusCode !== 200 || blob.blob.contentType !== original.contentType)
        throw new Error("Original document unavailable");
      const verified = await verifyDocumentUploadBytes(
        blob.stream,
        original.filename,
        original.sizeBytes,
      );
      if (verified.sha256 !== original.sha256) throw new Error("Original document changed");
      failureCode = "PREPROCESS_FAILED";
      directory = await mkdtemp(join(tmpdir(), "product-catalog-"));
      const documentPath = join(directory, `input${extname(original.filename).toLowerCase()}`);
      await writeFile(documentPath, verified.bytes, { mode: 0o600 });
      const document = await preprocessProductAgentDocument({
        documentPath,
        recordId: work.importId,
        imageAvailability: "none",
        imageRefs: [],
        allowEmptySource: true,
      });
      await completeCatalogParsing(attemptId, document);
    }
  } catch (error) {
    // Persist a bounded code, never provider errors, original text or storage paths.
    await failCatalogAttempt(
      attemptId,
      error instanceof CatalogAccessError ? "ACCESS_REVOKED" : failureCode,
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function productCatalogImportWorkflow(attemptIds: string[]) {
  "use workflow";
  // Bound concurrency within each selected batch. Claims fence duplicate deliveries.
  for (let offset = 0; offset < attemptIds.length; offset += 2) {
    await Promise.all(attemptIds.slice(offset, offset + 2).map((id) => processAttempt(id)));
  }
}
