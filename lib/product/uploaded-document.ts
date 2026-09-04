import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";
import { VercelPrivateBlobEvidenceStore } from "@/lib/evidence/vercel-private-blob";

import { type ProductAgentDocumentSource, preprocessProductAgentDocument } from "./document-source";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".csv", ".xls", ".xlsx"]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function prepareUploadedProductAgentDocument(
  file: File,
  actorId: string,
): Promise<ProductAgentDocumentSource> {
  const filename = basename(file.name || "");
  const extension = extname(filename).toLowerCase();
  if (!filename || !ALLOWED_EXTENSIONS.has(extension))
    throw new Error("只支持 PDF、CSV、XLS 和 XLSX 格式的产品资料。");
  if (file.size < 1 || file.size > MAX_BYTES)
    throw new Error("产品资料必须介于 1 字节和 25MB 之间。");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const evidenceId = `evidence-${sha256}`;
  const [existing] = await getDatabase()
    .select({ id: evidence.id })
    .from(evidence)
    .where(eq(evidence.sha256, sha256))
    .limit(1);
  if (!existing) {
    const stored = await new VercelPrivateBlobEvidenceStore().put({
      evidenceId,
      filename,
      contentType: file.type || "application/octet-stream",
      body: new Blob([bytes]),
    });
    await getDatabase()
      .insert(evidence)
      .values({
        id: evidenceId,
        classification: "restricted",
        blobKey: stored.pathname,
        contentType: stored.contentType,
        sha256,
        sizeBytes: bytes.length,
        sourceLabel: `uploaded:${extension.slice(1)}`,
        uploadedByType: "human",
        uploadedById: actorId,
      });
  }
  const directory = await mkdtemp(join(tmpdir(), "f-trade-product-agent-"));
  const path = join(directory, `${randomUUID()}${extension}`);
  try {
    await writeFile(path, bytes, { flag: "wx" });
    const prepared = await preprocessProductAgentDocument({
      documentPath: path,
      recordId: randomUUID(),
      imageAvailability: "none",
      imageRefs: [],
    });
    return {
      ...prepared,
      source: { ...prepared.source, source_ref: `source-${sha256}`, evidence_refs: [evidenceId] },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
