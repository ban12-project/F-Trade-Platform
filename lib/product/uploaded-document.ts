import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { persistUploadedEvidence, type UploadEvidenceStore } from "@/lib/evidence/persist-upload";
import { VercelPrivateBlobEvidenceStore } from "@/lib/evidence/vercel-private-blob";

import { type ProductAgentDocumentSource, preprocessProductAgentDocument } from "./document-source";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".csv", ".xls", ".xlsx"]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function prepareUploadedProductAgentDocument(
  file: File,
  actorId: string,
  dependencies: {
    store: UploadEvidenceStore;
    preprocess: typeof preprocessProductAgentDocument;
  } = { store: new VercelPrivateBlobEvidenceStore(), preprocess: preprocessProductAgentDocument },
): Promise<ProductAgentDocumentSource> {
  const filename = basename(file.name || "");
  const extension = extname(filename).toLowerCase();
  if (!filename || !ALLOWED_EXTENSIONS.has(extension))
    throw new Error("只支持 PDF、CSV、XLS 和 XLSX 格式的产品资料。");
  if (file.size < 1 || file.size > MAX_BYTES)
    throw new Error("产品资料必须介于 1 字节和 25MB 之间。");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = await mkdtemp(join(tmpdir(), "f-trade-product-agent-"));
  const path = join(directory, `${randomUUID()}${extension}`);
  try {
    await writeFile(path, bytes, { flag: "wx" });
    const prepared = await dependencies.preprocess({
      documentPath: path,
      recordId: randomUUID(),
      imageAvailability: "none",
      imageRefs: [],
    });
    const evidenceId = await persistUploadedEvidence(
      {
        actorId,
        filename,
        contentType: file.type || "application/octet-stream",
        sha256,
        sizeBytes: bytes.length,
        sourceLabel: `uploaded:${extension.slice(1)}`,
        body: new Blob([bytes]),
      },
      undefined,
      dependencies.store,
    );
    return {
      ...prepared,
      source: { ...prepared.source, source_ref: `source-${sha256}`, evidence_refs: [evidenceId] },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
