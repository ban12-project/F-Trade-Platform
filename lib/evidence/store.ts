export interface EvidenceWrite {
  evidenceId: string;
  filename: string;
  contentType: string;
  body: PutBody;
}

export type PutBody = string | ReadableStream | Blob | ArrayBuffer | File;

export interface StoredEvidence {
  pathname: string;
  contentType: string;
}

export interface EvidenceRead {
  body: ReadableStream;
  contentType: string;
}

export interface EvidenceStore {
  put(input: EvidenceWrite): Promise<StoredEvidence>;
  get(pathname: string): Promise<EvidenceRead | null>;
}

export function safeEvidencePathSegment(value: string) {
  const safe = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!safe || safe === "." || safe === "..") {
    throw new Error("Evidence path segment is empty or unsafe");
  }
  return safe;
}
