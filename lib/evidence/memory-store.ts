import type { EvidenceRead, EvidenceStore, EvidenceWrite, StoredEvidence } from "./store";
import { safeEvidencePathSegment } from "./store";

interface MemoryValue {
  body: Blob;
  contentType: string;
}

async function toBlob(body: EvidenceWrite["body"]): Promise<Blob> {
  if (body instanceof Blob) return body;
  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return new Blob([body]);
  }
  return new Blob([await new Response(body).arrayBuffer()]);
}

export class MemoryEvidenceStore implements EvidenceStore {
  readonly values = new Map<string, MemoryValue>();

  async put(input: EvidenceWrite): Promise<StoredEvidence> {
    const pathname = `synthetic/${safeEvidencePathSegment(input.evidenceId)}/${safeEvidencePathSegment(input.filename)}`;
    this.values.set(pathname, {
      body: await toBlob(input.body),
      contentType: input.contentType,
    });
    return { pathname, contentType: input.contentType };
  }

  async get(pathname: string): Promise<EvidenceRead | null> {
    const value = this.values.get(pathname);
    if (!value) return null;
    return {
      body: value.body.stream(),
      contentType: value.contentType,
    };
  }
}
