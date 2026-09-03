import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { eq, inArray } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";
import { VercelPrivateBlobEvidenceStore } from "@/lib/evidence/vercel-private-blob";

import type { VideoProject } from "./contracts";

const maximumAssetBytes = 20 * 1024 * 1024;
const maximumAssetCount = 8;
const maximumTotalAssetBytes = 20 * 1024 * 1024;
const allowedFiles: ReadonlyMap<string, { extensions: readonly string[]; mediaType: "image" | "video" }> = new Map([
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], mediaType: "image" }],
  ["image/png", { extensions: [".png"], mediaType: "image" }],
  ["image/webp", { extensions: [".webp"], mediaType: "image" }],
  ["video/mp4", { extensions: [".mp4"], mediaType: "video" }],
  ["video/quicktime", { extensions: [".mov"], mediaType: "video" }],
]);

export type UploadedVideoSourceAsset = VideoProject["sourceAssets"][number];

export function validateUploadedVideoSourceAsset(file: File) {
  const found = allowedFiles.get(file.type);
  if (!found) throw new Error("营销素材仅支持 JPG、PNG、WebP、MP4 或 MOV。 ");
  if (!found.extensions.includes(extname(file.name).toLowerCase())) throw new Error("营销素材的文件扩展名必须与其媒体类型匹配。 ");
  if (file.size < 1 || file.size > maximumAssetBytes) throw new Error("单个营销素材必须介于 1 字节和 20MB 之间。 ");
  return found;
}

/** Stores user-provided visual assets privately and exposes only the existing evidence reference. */
export async function prepareUploadedVideoAssets(files: File[], actorId: string, rightsEvidenceRef: string, database: Database = getDatabase()): Promise<UploadedVideoSourceAsset[]> {
  if (files.length > maximumAssetCount) throw new Error(`一次最多上传 ${maximumAssetCount} 个营销素材。`);
  if (files.reduce((total, file) => total + file.size, 0) > maximumTotalAssetBytes) throw new Error("一次上传的营销素材总计不能超过 20MB。 ");
  if (files.length && !rightsEvidenceRef.trim()) throw new Error("上传营销素材时必须提供权利证据引用。 ");
  const stored: UploadedVideoSourceAsset[] = [];
  for (const file of files) {
    const metadata = validateUploadedVideoSourceAsset(file);
    const data = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(data).digest("hex");
    const evidenceId = `evidence-${sha256}`;
    const [existing] = await database.select({ id: evidence.id }).from(evidence).where(eq(evidence.sha256, sha256)).limit(1);
    const assetRef = existing?.id ?? evidenceId;
    if (!existing) {
      const privateAsset = await new VercelPrivateBlobEvidenceStore().put({
        evidenceId,
        filename: `marketing-${sha256}${metadata.extensions[0]}`,
        contentType: file.type,
        body: new Blob([data], { type: file.type }),
      });
      await database.insert(evidence).values({
        id: evidenceId,
        classification: "restricted",
        blobKey: privateAsset.pathname,
        contentType: file.type,
        sha256,
        sizeBytes: data.byteLength,
        sourceLabel: `marketing-upload:${metadata.mediaType}`,
        uploadedByType: "human",
        uploadedById: actorId,
      });
    }
    stored.push({ assetRef, mediaType: metadata.mediaType, rightsEvidenceRef });
  }
  return stored;
}

function extensionForContentType(contentType: string) {
  return ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov" } as Record<string, string>)[contentType] ?? ".bin";
}

/** Materializes only authorized upload references for the duration of one render callback. */
export async function withTemporaryUploadedVideoAssets<T>(assetRefs: string[], callback: (paths: ReadonlyMap<string, string>) => Promise<T>): Promise<T> {
  const uniqueRefs = [...new Set(assetRefs)];
  if (!uniqueRefs.length || uniqueRefs.some((assetRef) => !/^evidence-[a-z0-9][a-z0-9_-]{2,120}$/i.test(assetRef))) {
    throw new Error("只能渲染已上传到私有证据库的营销素材。");
  }
  const rows = await getDatabase().select({ id: evidence.id, blobKey: evidence.blobKey, contentType: evidence.contentType }).from(evidence).where(inArray(evidence.id, uniqueRefs));
  if (rows.length !== uniqueRefs.length) throw new Error("部分私有营销素材不存在或已被移除。");
  const directory = await mkdtemp(join(tmpdir(), "f-trade-edit-assets-"));
  try {
    const paths = new Map<string, string>();
    const store = new VercelPrivateBlobEvidenceStore();
    for (const row of rows) {
      const asset = await store.get(row.blobKey);
      if (!asset) throw new Error("无法读取私有营销素材。");
      const filePath = join(/* turbopackIgnore: true */ directory, `${row.id}${extensionForContentType(row.contentType)}`);
      await pipeline(Readable.fromWeb(asset.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(filePath, { flags: "wx" }));
      paths.set(row.id, filePath);
    }
    return await callback(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
