import "server-only";

import { listEditingEligibleProductMedia } from "@/lib/product/media-store";

import { listReadyVideoProductSources, type ReadyVideoProductSource } from "./store";

export type ReadyVideoProductMediaOption = {
  id: string;
  mediaType: "image" | "video";
  role:
    | "product_hero"
    | "product_detail"
    | "packaging"
    | "factory"
    | "inspection"
    | "application"
    | "other";
  description: string;
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
};

export type ReadyVideoProductSourceWithMedia = ReadyVideoProductSource & {
  mediaOptions: ReadyVideoProductMediaOption[];
};

/**
 * Adds only currently editing-eligible ProductMedia metadata to video product
 * choices. Evidence IDs, rights references, Blob paths, and signed URLs remain
 * server-side; final eligibility is rechecked transactionally on creation.
 */
export async function listReadyVideoProductSourcesWithMedia(
  projectId: string,
  evaluatedAt = new Date(),
): Promise<ReadyVideoProductSourceWithMedia[]> {
  const products = await listReadyVideoProductSources(projectId);
  const media = await Promise.all(
    products.map((product) => listEditingEligibleProductMedia(product.id, evaluatedAt)),
  );

  return products.map((product, index) => ({
    ...product,
    mediaOptions: (media[index]?.assets ?? []).map((asset) => ({
      id: asset.id,
      mediaType: asset.mediaType,
      role: asset.semantic.role,
      description: asset.semantic.description,
      width: asset.technical.width,
      height: asset.technical.height,
      durationMs: asset.technical.durationMs,
      hasAudio: asset.technical.hasAudio,
    })),
  }));
}
