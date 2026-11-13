import { notFound } from "next/navigation";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { EvidenceSelectFixture } from "./fixture";

export default function Page() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto max-w-xl p-6">
      <WorkspaceDirtyProvider>
        <EvidenceSelectFixture />
      </WorkspaceDirtyProvider>
    </main>
  );
}
