import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { NavigationEditor } from "../../workspace-navigation/editor";

async function Shell({ children }: { children: ReactNode }) {
  if ((await cookies()).get("synthetic-layout-error")?.value === "fail") {
    throw new Error("SYNTHETIC_PRIVATE_LAYOUT_DETAIL");
  }
  return (
    <WorkspaceShell projects={[]} basePath="/testing/workspace-navigation">
      <NavigationEditor href="/testing/workspace-navigation" />
      {children}
    </WorkspaceShell>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={<p>正在读取合成布局</p>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
