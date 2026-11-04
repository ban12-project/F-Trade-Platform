import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BusinessFunnelPanel } from "@/components/workspace/business-funnel";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { deriveBusinessFunnel } from "@/lib/workspace/business-funnel";
import { syntheticFunnelSnapshot } from "@/tests/fixtures/business-funnel/snapshot";

async function Fixture({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const snapshot = syntheticFunnelSnapshot();
  if (state === "empty") snapshot.records = [];
  const funnel =
    state === "unavailable"
      ? null
      : deriveBusinessFunnel(snapshot, state === "unknown" ? null : ["synthetic-opportunity"]);
  return (
    <WorkspaceDirtyProvider>
      <main className="mx-auto max-w-7xl p-4">
        <h1>Synthetic business funnel fixture</h1>
        <BusinessFunnelPanel funnel={funnel} />
      </main>
    </WorkspaceDirtyProvider>
  );
}
export default function Page(props: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={<p>Loading synthetic fixture</p>}>
      <Fixture {...props} />
    </Suspense>
  );
}
