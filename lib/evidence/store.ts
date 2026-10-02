export interface EvidenceWrite {
  evidenceId: string;
  filename: string;
  contentType: string;
  body: PutBody;
  /** Server-reserved path for durable upload reconciliation. Never accept from a client. */
  pathname?: string;
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

export function evidenceUploadPath(input: Pick<EvidenceWrite, "evidenceId" | "filename">) {
  return `evidence/${safeEvidencePathSegment(input.evidenceId)}/${safeEvidencePathSegment(input.filename)}`;
}

export function validateReservedEvidencePath(input: EvidenceWrite) {
  if (input.pathname !== undefined && input.pathname !== evidenceUploadPath(input))
    throw new Error("Invalid reserved evidence path");
  return input.pathname;
}
