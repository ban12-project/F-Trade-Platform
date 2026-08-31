import { notFound } from "next/navigation";

import { WorkspaceHub } from "@/components/workspace/workspace-hub";

/** Test-only fixture: production canvas access remains protected by requirePermission. */
export default function WorkspaceCanvasTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <WorkspaceHub projects={[]} />;
}
