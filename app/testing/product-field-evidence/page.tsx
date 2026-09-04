import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ProductPanel } from "@/components/workspace/product-panel";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";

/** Test-only fixture; production product intake remains authenticated and project-scoped. */
export default function ProductFieldEvidenceTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <main className="mx-auto min-h-screen max-w-4xl p-6">
    <Suspense fallback={<p>Loading product form…</p>}>
      <WorkspaceDirtyProvider>
        <ProductPanel
          projectId="00000000-0000-4000-8000-000000000701"
          entries={[]}
          detail={null}
          canReview={false}
          agentModelConfigs={[]}
          evidenceOptions={[
            { id: "evidence-synthetic-catalog-001", sourceLabel: "合成产品目录.pdf", contentType: "application/pdf", classification: "confidential", createdAt: new Date("2026-09-01T00:00:00Z") },
            { id: "evidence-synthetic-spec-002", sourceLabel: "合成规格表.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", classification: "internal", createdAt: new Date("2026-09-02T00:00:00Z") },
          ]}
        />
      </WorkspaceDirtyProvider>
    </Suspense>
  </main>;
}
