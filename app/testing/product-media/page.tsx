import { notFound } from "next/navigation";

import { ProductMediaPanel } from "@/components/workspace/product-media-panel";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import type { ProductMediaAsset, VideoReadyAssessment } from "@/lib/product/video-readiness";

const projectId = "00000000-0000-4000-8000-000000000701";
const productId = "00000000-0000-4000-8000-000000000702";
const assetId = "00000000-0000-4000-8000-000000000703";

const asset: ProductMediaAsset = {
  id: assetId,
  productId,
  evidenceRef: "evidence-product-media-701",
  mediaType: "image",
  origin: "factory",
  technical: {
    contentType: "image/jpeg",
    width: 1600,
    height: 1600,
    durationMs: null,
    fps: null,
    hasAudio: false,
  },
  semantic: {
    role: "product_hero",
    description: "Authorized front-facing synthetic product image.",
    tags: ["product", "hero"],
    productVisible: true,
    logoVisible: false,
    textPresent: false,
  },
  rights: {
    rightsEvidenceRef: "evidence-product-media-rights-701",
    editingAllowed: true,
    publicDistributionAllowed: true,
    paidAdvertisingAllowed: false,
    imageToVideoAllowed: true,
    referenceToVideoAllowed: false,
    expiresAt: "2027-09-03T00:00:00.000Z",
  },
  review: {
    status: "approved",
    reviewedBy: "synthetic-admin",
    reviewedAt: "2026-09-03T00:00:00.000Z",
    evidenceRef: "evidence-product-media-review-701",
    notes: "Synthetic browser fixture only.",
  },
  createdAt: "2026-09-02T23:00:00.000Z",
};

const assessment: VideoReadyAssessment = {
  version: 1,
  productId,
  status: "ready",
  evaluatedAt: "2026-09-03T01:00:00.000Z",
  verifiedFactPaths: ["product.product_name", "product.oe_numbers"],
  editingEligibleAssetIds: [assetId],
  generativeUse: {
    imageToVideoAssetIds: [assetId],
    referenceToVideoAssetIds: [],
  },
  blockers: [],
  warnings: [],
};

/** Test-only ProductMedia fixture; production access remains permission protected. */
export default function ProductMediaTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <main className="mx-auto min-h-screen max-w-3xl p-6">
    <WorkspaceDirtyProvider>
      <ProductMediaPanel projectId={projectId} productId={productId} assets={[asset]} assessment={assessment} canReview />
    </WorkspaceDirtyProvider>
  </main>;
}
