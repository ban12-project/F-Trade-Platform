
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { VideoWorkspace } from "@/components/workspace/video-workspace";
import type { MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";

const projectId = "00000000-0000-4000-8000-000000000721";
const videoId = "00000000-0000-4000-8000-000000000401";
const products: ReadyVideoProductSource[] = [{ id: "00000000-0000-4000-8000-000000000301", productName: "Verified clutch kit", internalSku: "SYN-001", factOptions: [{ value: "product.product_name", label: "product.product_name" }] }];

function entry(state: "draft" | "review" | "approved"): MarketingVideoEditorEntry {
  const reviewed = state !== "draft";
  return {
    id: videoId,
    state: state === "approved" ? "VIDEO_APPROVED" : state === "review" ? "VIDEO_REVIEW_REQUIRED" : "VIDEO_DRAFT",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    productId: products[0]!.id,
    productName: products[0]!.productName,
    objective: "Create a concise product inquiry video",
    targetAudience: "Overseas distributors",
    platforms: ["facebook"],
    approvalStatus: state === "approved" ? "approved" : state === "review" ? "pending" : null,
    previewAssetRef: reviewed ? "asset-rendered-preview-001" : null,
    captionFactOptions: [
      { field: "product.product_name", value: "Verified clutch kit" },
      { field: "product.oe_numbers", value: "OE-SYN-001" },
    ],
    downloadAvailable: state === "approved",
    privateTestOnly: false,
    processingJob: null,
    draft: { version: 3, creativeFramework: "google_abcd", platform: "facebook", ctaText: "Contact us", clips: [
      { clipId: "clip-001", assetRef: "evidence-video-001", mediaType: "video", trimStartMs: 0, durationMs: 5_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["attention", "branding"], motionPreset: "punch_in" },
      { clipId: "clip-002", assetRef: "evidence-image-002", mediaType: "image", trimStartMs: 0, durationMs: 3_000, fitMode: "contain", audioMode: "muted", caption: { kind: "none" }, abcdRoles: ["connection", "direction"], motionPreset: "cta_hold" },
    ] },
  };
}

async function VideoWorkspaceFixture({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const query = await searchParams;
  const state = query.state === "review" || query.state === "approved" ? query.state : "draft";
  const current = entry(state);
  return <VideoWorkspace projectId={projectId} projectTitle="Synthetic project workspace" products={products} entries={[current]} copyCandidates={[]} canReview selectedId={current.id} />;
}

export default function VideoWorkspaceTestingPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <Suspense fallback={null}><VideoWorkspaceFixture searchParams={searchParams} /></Suspense>;
}
