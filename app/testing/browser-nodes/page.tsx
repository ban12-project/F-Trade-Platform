import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BrowserNodesPanel } from "@/components/workspace/browser-nodes-panel";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";

async function BrowserNodesFixture() {
  await connection();
  return (
    <WorkspaceDirtyProvider>
      <BrowserNodesPanel />
    </WorkspaceDirtyProvider>
  );
}

/** Tests intercept list actions; this route does not provide credentials or bypass action auth. */
export default function BrowserNodesTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto max-w-3xl p-4">
      <Suspense fallback={null}>
        <BrowserNodesFixture />
      </Suspense>
    </main>
  );
}
