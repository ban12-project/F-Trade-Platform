import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SandboxRegistrationCard } from "@/components/workspace/sandbox-registration-card";
import { SandboxStatus } from "@/components/workspace/sandbox-status";

async function Content({ searchParams }: { searchParams: Promise<{ enabled?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <div className="flex flex-col gap-6">
      <SandboxRegistrationCard enabled={(await searchParams).enabled === "1"} />
      <section aria-label="合成生命周期状态" className="flex flex-col gap-6">
        {(["stopped", "starting", "running", "stopping", "unknown"] as const).map((phase) => (
          <SandboxStatus
            key={phase}
            sandbox={{ phase, updatedAt: Date.parse("2026-09-01T00:00:00Z") }}
          />
        ))}
        <SandboxStatus sandbox={null} />
      </section>
    </div>
  );
}
export default function Page(props: { searchParams: Promise<{ enabled?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <main className="mx-auto max-w-xl p-6">
      <Suspense fallback={<p>加载合成表单…</p>}>
        <Content {...props} />
      </Suspense>
    </main>
  );
}
