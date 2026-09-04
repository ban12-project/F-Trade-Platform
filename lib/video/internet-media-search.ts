import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Database, getDatabase } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";
import { VercelPrivateBlobEvidenceStore } from "@/lib/evidence/vercel-private-blob";

import { prepareUploadedVideoAssets, type UploadedVideoSourceAsset } from "./uploaded-assets";

const commonsApiUrl = "https://commons.wikimedia.org/w/api.php";
const maximumSearchResults = 12;
const maximumImportBytes = 20 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedMediaHosts = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

export const internetMediaSearchInputSchema = z
  .object({
    projectId: z.uuid("项目标识无效。"),
    productId: z.uuid("产品记录标识无效。"),
    query: z
      .string()
      .trim()
      .min(2, "检索词至少需要两个字符。")
      .max(120, "检索词不能超过 120 个字符。"),
  })
  .strict();

export const internetMediaResultIdSchema = z
  .string()
  .regex(/^wikimedia:\d+$/, "互联网素材标识无效。");

export const internetMediaImportInputSchema = internetMediaSearchInputSchema
  .extend({
    resultIds: z
      .array(internetMediaResultIdSchema)
      .min(1, "至少选择一个互联网素材。")
      .max(3, "每条视频最多选择三个互联网素材。")
      .refine((ids) => new Set(ids).size === ids.length, "互联网素材不能重复选择。"),
  })
  .strict();

export const internetMediaSearchResultSchema = z
  .object({
    id: internetMediaResultIdSchema,
    title: z.string().trim().min(1).max(240),
    thumbnailUrl: z.url(),
    sourcePageUrl: z.url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    license: z.string().trim().min(1).max(160),
    provider: z.literal("Wikimedia Commons"),
  })
  .strict();

export type InternetMediaSearchResult = z.infer<typeof internetMediaSearchResultSchema>;
export type InternetMediaFetcher = typeof fetch;

type CommonsImageInfo = {
  url?: string;
  descriptionurl?: string;
  thumburl?: string;
  thumbmime?: string;
  mime?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: { LicenseShortName?: { value?: string } };
};

type CommonsPage = { pageid?: number; title?: string; imageinfo?: CommonsImageInfo[] };
type CommonsResponse = { query?: { pages?: CommonsPage[] } };

function commonsRequestUrl(input: { query?: string; pageIds?: number[]; thumbnailWidth: number }) {
  const url = new URL(commonsApiUrl);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime|size|thumbmime|extmetadata");
  url.searchParams.set("iiurlwidth", String(input.thumbnailWidth));
  if (input.pageIds?.length) {
    url.searchParams.set("pageids", input.pageIds.join("|"));
  } else {
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrsearch", input.query ?? "");
    url.searchParams.set("gsrlimit", String(maximumSearchResults));
  }
  return url;
}

function cleanTitle(value: string) {
  return value
    .replace(/^File:/, "")
    .replace(/_/g, " ")
    .trim();
}

function parseCommonsPages(
  input: unknown,
): Array<InternetMediaSearchResult & { importUrl: string }> {
  const response = input as CommonsResponse;
  return (response.query?.pages ?? []).flatMap((page) => {
    const image = page.imageinfo?.[0];
    const mimeType = image?.thumbmime ?? image?.mime;
    const thumbnailUrl = image?.thumburl ?? image?.url;
    const width = image?.thumbwidth ?? image?.width;
    const height = image?.thumbheight ?? image?.height;
    if (
      !page.pageid ||
      !page.title ||
      !image?.descriptionurl ||
      !thumbnailUrl ||
      !mimeType ||
      !width ||
      !height ||
      !image.mime ||
      !allowedMimeTypes.has(image.mime) ||
      !allowedMimeTypes.has(mimeType)
    )
      return [];
    let mediaUrl: URL;
    let sourcePageUrl: URL;
    try {
      mediaUrl = new URL(thumbnailUrl);
      sourcePageUrl = new URL(image.descriptionurl);
    } catch {
      return [];
    }
    if (
      mediaUrl.protocol !== "https:" ||
      !allowedMediaHosts.has(mediaUrl.hostname) ||
      sourcePageUrl.protocol !== "https:" ||
      sourcePageUrl.hostname !== "commons.wikimedia.org"
    )
      return [];
    return [
      {
        id: `wikimedia:${page.pageid}` as const,
        title: cleanTitle(page.title).slice(0, 240),
        thumbnailUrl: mediaUrl.toString(),
        sourcePageUrl: sourcePageUrl.toString(),
        width,
        height,
        mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp",
        license:
          image.extmetadata?.LicenseShortName?.value
            ?.replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160) || "See source page",
        provider: "Wikimedia Commons" as const,
        importUrl: mediaUrl.toString(),
      },
    ];
  });
}

async function fetchCommonsPages(url: URL, fetcher: InternetMediaFetcher) {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "F-Trade/0.1 (private test media search)",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("互联网素材服务暂时不可用，请稍后重试。");
  return parseCommonsPages(await response.json());
}

export async function searchInternetVideoMedia(
  queryInput: string,
  fetcher: InternetMediaFetcher = fetch,
) {
  const query = internetMediaSearchInputSchema.shape.query.parse(queryInput);
  let pages = await fetchCommonsPages(
    commonsRequestUrl({ query: `intitle:"${query.replace(/["\\]/g, " ")}"`, thumbnailWidth: 960 }),
    fetcher,
  );
  if (!pages.length)
    pages = await fetchCommonsPages(commonsRequestUrl({ query, thumbnailWidth: 960 }), fetcher);
  return pages.map(({ importUrl: _importUrl, ...result }) =>
    internetMediaSearchResultSchema.parse(result),
  );
}

async function resolveInternetMedia(resultIds: string[], fetcher: InternetMediaFetcher) {
  const ids = resultIds.map((id) =>
    Number(internetMediaResultIdSchema.parse(id).slice("wikimedia:".length)),
  );
  const pages = await fetchCommonsPages(
    commonsRequestUrl({ pageIds: ids, thumbnailWidth: 1920 }),
    fetcher,
  );
  const byId = new Map(pages.map((page) => [page.id, page]));
  const resolved = resultIds.map((id) => byId.get(id));
  if (resolved.some((item) => !item)) throw new Error("所选互联网素材已不可用，请重新检索。");
  return resolved as Array<InternetMediaSearchResult & { importUrl: string }>;
}

function extensionForMimeType(mimeType: InternetMediaSearchResult["mimeType"]) {
  return mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : ".webp";
}

function matchesImageSignature(mimeType: InternetMediaSearchResult["mimeType"], bytes: Uint8Array) {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  return (
    new TextDecoder().decode(bytes.slice(0, 12)).startsWith("RIFF") &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  );
}

async function readBoundedBody(response: Response) {
  if (!response.body) throw new Error("互联网图片响应为空。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximumImportBytes) {
      await reader.cancel();
      throw new Error("互联网图片不能超过 20MB。");
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function downloadInternetImage(
  result: InternetMediaSearchResult & { importUrl: string },
  fetcher: InternetMediaFetcher,
) {
  const url = new URL(result.importUrl);
  if (url.protocol !== "https:" || !allowedMediaHosts.has(url.hostname))
    throw new Error("互联网素材地址不在允许范围内。");
  const response = await fetcher(url, {
    headers: { Accept: result.mimeType, "User-Agent": "F-Trade/0.1 (private test media import)" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("互联网素材发生了未经允许的跳转。");
  if (!response.ok) throw new Error("无法下载所选互联网素材。");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== result.mimeType) throw new Error("互联网素材类型与检索记录不一致。");
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > maximumImportBytes) throw new Error("互联网图片不能超过 20MB。");
  const data = await readBoundedBody(response);
  if (!data.byteLength) throw new Error("互联网图片必须介于 1 字节和 20MB 之间。");
  if (!matchesImageSignature(result.mimeType, data))
    throw new Error("互联网素材内容与声明格式不一致。");
  return new File(
    [data],
    `internet-${result.id.replace(":", "-")}${extensionForMimeType(result.mimeType)}`,
    { type: result.mimeType },
  );
}

/** Re-resolves opaque provider IDs and downloads only the provider-owned image URLs. */
export async function resolveInternetVideoMediaFiles(
  resultIdsInput: unknown,
  fetcher: InternetMediaFetcher = fetch,
) {
  const resultIds = z
    .array(internetMediaResultIdSchema)
    .min(1)
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length, "互联网素材不能重复选择。")
    .parse(resultIdsInput);
  const results = await resolveInternetMedia(resultIds, fetcher);
  const files = await Promise.all(results.map((result) => downloadInternetImage(result, fetcher)));
  return { results, files };
}

async function storeProvenanceEvidence(
  query: string,
  results: InternetMediaSearchResult[],
  actorId: string,
  database: Database,
) {
  const manifest = JSON.stringify(
    {
      kind: "internet_media_private_test_provenance",
      provider: "Wikimedia Commons",
      query,
      publicationAllowed: false,
      retrievedAt: new Date().toISOString(),
      sources: results.map(
        ({ id, title, sourcePageUrl, thumbnailUrl, mimeType, width, height, license }) => ({
          id,
          title,
          sourcePageUrl,
          importedMediaUrl: thumbnailUrl,
          mimeType,
          width,
          height,
          license,
        }),
      ),
    },
    null,
    2,
  );
  const bytes = new TextEncoder().encode(manifest);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const evidenceId = `evidence-${sha256}`;
  const [existing] = await database
    .select({ id: evidence.id })
    .from(evidence)
    .where(eq(evidence.sha256, sha256))
    .limit(1);
  if (existing) return existing.id;
  const stored = await new VercelPrivateBlobEvidenceStore().put({
    evidenceId,
    filename: `internet-media-private-test-${sha256}.json`,
    contentType: "application/json",
    body: new Blob([bytes], { type: "application/json" }),
  });
  await database.insert(evidence).values({
    id: evidenceId,
    classification: "restricted",
    blobKey: stored.pathname,
    contentType: "application/json",
    sha256,
    sizeBytes: bytes.byteLength,
    sourceLabel: "internet-search:wikimedia-commons:private-test-only",
    uploadedByType: "human",
    uploadedById: actorId,
  });
  return evidenceId;
}

export async function importInternetVideoMedia(
  input: z.infer<typeof internetMediaImportInputSchema>,
  actorId: string,
  options: { fetcher?: InternetMediaFetcher; database?: Database } = {},
): Promise<UploadedVideoSourceAsset[]> {
  const value = internetMediaImportInputSchema.parse(input);
  const fetcher = options.fetcher ?? fetch;
  const database = options.database ?? getDatabase();
  const { results: resolved, files } = await resolveInternetVideoMediaFiles(
    value.resultIds,
    fetcher,
  );
  const provenanceEvidenceRef = await storeProvenanceEvidence(
    value.query,
    resolved,
    actorId,
    database,
  );
  const assets = await prepareUploadedVideoAssets(files, actorId, provenanceEvidenceRef, database);
  return assets.map((asset) => ({ ...asset, usagePolicy: "private_test_only" as const }));
}
