import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { ProductDraftForm } from "@/components/workspace/product-draft-form";

/** The form reads returnTo search params; render it for a request, before client scripts. */
async function ProductDraftInitializationFixture() {
  await connection();
  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <WorkspaceDirtyProvider>
        <ProductDraftForm
          projectId="00000000-0000-4000-8000-000000000701"
          evidenceOptions={[
            {
              id: "evidence-synthetic-initialization-999",
              sourceLabel: "合成产品资料.pdf",
              contentType: "application/pdf",
              classification: "confidential",
              createdAt: new Date("2026-09-01T00:00:00Z"),
            },
          ]}
        />
      </WorkspaceDirtyProvider>
    </main>
  );
}

export default function ProductDraftInitializationPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProductDraftInitializationFixture />
    </Suspense>
  );
}
