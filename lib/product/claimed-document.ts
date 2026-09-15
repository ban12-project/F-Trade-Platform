import "server-only";

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { preprocessProductAgentDocument } from "./document-source";
import { claimDocumentUpload } from "./document-upload-receipts";

export async function prepareClaimedProductDocument(
  receiptId: unknown,
  projectId: string,
  actorId: string,
) {
  const claimed = await claimDocumentUpload({ receiptId, projectId, purpose: "agent" }, actorId);
  const directory = await mkdtemp(join(tmpdir(), "f-trade-claimed-document-"));
  try {
    const path = join(directory, `document${extname(claimed.filename).toLowerCase()}`);
    await writeFile(path, claimed.bytes, { flag: "wx" });
    const prepared = await preprocessProductAgentDocument({
      documentPath: path,
      recordId: randomUUID(),
      imageAvailability: "none",
      imageRefs: [],
    });
    return {
      ...prepared,
      source: {
        ...prepared.source,
        source_ref: `source-${claimed.sha256}`,
        evidence_refs: [claimed.evidenceId],
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
