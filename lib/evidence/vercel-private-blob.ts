import { get, put } from "@vercel/blob";

import type { EvidenceRead, EvidenceStore, EvidenceWrite, StoredEvidence } from "./store";
import { safeEvidencePathSegment } from "./store";

export class VercelPrivateBlobEvidenceStore implements EvidenceStore {
  async put(input: EvidenceWrite): Promise<StoredEvidence> {
    const evidenceId = safeEvidencePathSegment(input.evidenceId);
    const filename = safeEvidencePathSegment(input.filename);
    const pathname = `evidence/${evidenceId}/${crypto.randomUUID()}-${filename}`;
    const result = await put(pathname, input.body, {
      access: "private",
      addRandomSuffix: false,
      contentType: input.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return {
      pathname: result.pathname,
      contentType: input.contentType,
    };
  }

  async get(pathname: string): Promise<EvidenceRead | null> {
    const result = await get(pathname, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }
    return {
      body: result.stream,
      contentType: result.blob.contentType,
    };
  }
}
