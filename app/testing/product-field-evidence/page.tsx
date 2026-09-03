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
        />
      </WorkspaceDirtyProvider>
    </Suspense>
  </main>;
}
