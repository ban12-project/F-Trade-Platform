import { notFound } from "next/navigation";
import { Suspense } from "react";

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
    nodes: [
      { id: "product", kind: "product", position: { x: 0, y: 0 }, locked: true, label: "产品资料" },
      { id: "video", kind: "video", position: { x: 280, y: 0 }, locked: true, label: "营销视频" },
    ],
    edges: [],
  },
};

async function ProjectCanvasFixture({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const reviewState = state === "review";
  return <ProjectCanvas project={syntheticProject} videoEditor={{
    canReview: true,
    products: [{ id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ value: "product.product_name", label: "product.product_name" }] }],
    entries: [{
      id: "00000000-0000-4000-8000-000000000401",
      state: reviewState ? "VIDEO_REVIEW_REQUIRED" : "VIDEO_DRAFT",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      productId: "00000000-0000-4000-8000-000000000301",
      productName: "Verified clutch kit",
      objective: "Create a concise product inquiry video",
      targetAudience: "Overseas distributors",
      platforms: ["facebook"],
      approvalStatus: reviewState ? "pending" : null,
      previewAssetRef: reviewState ? "asset-rendered-preview-001" : null,
      draft: { version: 1, platform: "facebook", ctaText: "Contact us", clips: [
        { clipId: "clip-001", assetRef: "evidence-video-001", mediaType: "video", trimStartMs: 0, durationMs: 5_000, fitMode: "contain", audioMode: "muted", subtitle: "", claimRefs: [] },
        { clipId: "clip-002", assetRef: "evidence-image-002", mediaType: "image", trimStartMs: 0, durationMs: 3_000, fitMode: "contain", audioMode: "muted", subtitle: "", claimRefs: [] },
      ] },
    }],
  }} />;
}

/** Test-only fixture: production project canvas access remains permission protected. */
export default function ProjectCanvasTestingPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <Suspense fallback={null}><ProjectCanvasFixture searchParams={searchParams} /></Suspense>;
}
