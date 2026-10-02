"use client";
import type { ContentCopyCandidate, ReadyProductContentSource } from "@/lib/content/store";
import { ContentCopy } from "./content-copy";
import { ContentDraftForm } from "./content-draft-form";
export function ContentCreatePanel({
  projectId,
  products,
  copyCandidates = [],
}: {
  projectId: string;
  products: ReadyProductContentSource[];
  copyCandidates?: ContentCopyCandidate[];
}) {
  return (
    <div className="space-y-5">
      <ContentDraftForm projectId={projectId} products={products} />
      {copyCandidates.length ? (
        <ContentCopy projectId={projectId} candidates={copyCandidates} />
      ) : null}
    </div>
  );
}
