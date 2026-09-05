import "server-only";

import { issueSignedToken, presignUrl } from "@vercel/blob";
import { inArray } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";

export type SandboxVideoSource = {
  assetRef: string;
  contentType: string;
  extension: string;
  hostname: string;
  signedGetUrl: string;
};

function extensionForContentType(contentType: string) {
  return (
    {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
    } as Record<string, string>
  )[contentType];
}

/** Gives one Sandbox run a short, read-only URL for each exact evidence pathname. */
export async function issueSandboxVideoSources(assetRefs: string[]) {
  const uniqueRefs = [...new Set(assetRefs)];
  if (
    !uniqueRefs.length ||
    uniqueRefs.some((assetRef) => !/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(assetRef))
  )
    throw new Error("只能处理已认领的私有营销素材。");
  const rows = await getDatabase()
    .select({ id: evidence.id, blobKey: evidence.blobKey, contentType: evidence.contentType })
    .from(evidence)
    .where(inArray(evidence.id, uniqueRefs));
  if (rows.length !== uniqueRefs.length) throw new Error("部分私有营销素材不存在或已被移除。");
  const validUntil = Date.now() + 10 * 60 * 1_000;
  const result = new Map<string, SandboxVideoSource>();
  for (const row of rows) {
    const extension = extensionForContentType(row.contentType);
    if (!extension) throw new Error("营销素材类型不受 Sandbox 支持。");
    const token = await issueSignedToken({
      pathname: row.blobKey,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname: row.blobKey,
      validUntil,
      useCache: false,
    });
    const url = new URL(presignedUrl);
    result.set(row.id, {
      assetRef: row.id,
      contentType: row.contentType,
      extension,
      hostname: url.hostname,
      signedGetUrl: presignedUrl,
    });
  }
  return result;
}
