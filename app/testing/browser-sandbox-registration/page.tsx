import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SandboxRegistrationCard } from "@/components/workspace/sandbox-registration-card";

async function Content({ searchParams }: { searchParams: Promise<{ enabled?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <SandboxRegistrationCard enabled={(await searchParams).enabled === "1"} />;
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
