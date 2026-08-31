import { notFound } from "next/navigation";

import { ProjectCanvas } from "@/components/workspace/project-canvas";
import type { WorkspaceProjectDetail } from "@/lib/workspace/store";

const syntheticProject: WorkspaceProjectDetail = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Synthetic project canvas",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  revision: 1,
  document: {
    version: 1,
    nodes: [{
      id: "product",
      kind: "product",
      position: { x: 0, y: 0 },
      locked: true,
      label: "产品资料",
    }],
    edges: [],
  },
};

/** Test-only fixture: production project canvas access remains permission protected. */
export default function ProjectCanvasTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <ProjectCanvas project={syntheticProject} />;
}
