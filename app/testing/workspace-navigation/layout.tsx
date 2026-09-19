import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { navigationProject } from "./data";
export default function Layout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <WorkspaceShell projects={[navigationProject]} basePath="/testing/workspace-navigation">
      {children}
    </WorkspaceShell>
  );
}
