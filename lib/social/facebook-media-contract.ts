/** Local MVP limits, not claims about Facebook's maximum upload sizes. */
export const FACEBOOK_MEDIA_LIMITS = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
} as const;
export type FacebookMedia = {
  assetRef: string;
  contentType: "image/jpeg" | "image/png" | "video/mp4";
  sizeBytes: number;
  sha256: string;
};
export type FacebookMediaPayload = {
  version: 2;
  channelRef: string;
  accountRef: string;
  publicationId: string;
  format: "image" | "video";
  text: string;
  media: FacebookMedia;
};
export type PreparedFacebookMedia = FacebookMedia & { path: string; filename: string };

function fail(): never {
  throw new Error("invalid_facebook_media");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join("|") !== expected.sort().join("|")) fail();
}
function reference(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail();
  return value;
}
export function parseFacebookMedia(input: unknown): FacebookMedia {
  const v = object(input);
  keys(v, ["assetRef", "contentType", "sizeBytes", "sha256"]);
  const assetRef = reference(v.assetRef);
  if (!["image/jpeg", "image/png", "video/mp4"].includes(String(v.contentType))) fail();
  const contentType = v.contentType as FacebookMedia["contentType"];
  const kind = contentType === "video/mp4" ? "video" : "image";
  if (
    !Number.isSafeInteger(v.sizeBytes) ||
    Number(v.sizeBytes) < 1 ||
    Number(v.sizeBytes) > FACEBOOK_MEDIA_LIMITS[kind]
  )
    fail();
  if (typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256)) fail();
  return { assetRef, contentType, sizeBytes: Number(v.sizeBytes), sha256: v.sha256 };
}
export function parseFacebookMediaPayload(input: unknown): FacebookMediaPayload {
  const v = object(input);
  keys(v, ["version", "channelRef", "accountRef", "publicationId", "format", "text", "media"]);
  if (v.version !== 2 || !["image", "video"].includes(String(v.format))) fail();
  if (typeof v.text !== "string" || v.text.length > 20_000) fail();
  const media = parseFacebookMedia(v.media);
  if ((v.format === "video") !== (media.contentType === "video/mp4")) fail();
  return {
    version: 2,
    channelRef: reference(v.channelRef),
    accountRef: reference(v.accountRef),
    publicationId: reference(v.publicationId),
    format: v.format as "image" | "video",
    text: v.text,
    media,
  };
}
export function mediaFilename(media: FacebookMedia) {
  return `${media.sha256}.${media.contentType === "video/mp4" ? "mp4" : media.contentType === "image/png" ? "png" : "jpg"}`;
}
export function assertMediaMagic(bytes: Uint8Array, contentType: FacebookMedia["contentType"]) {
  const b = Buffer.from(bytes);
  const matches =
    contentType === "image/png"
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === "image/jpeg"
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : b.length >= 12 &&
          b.toString("ascii", 4, 8) === "ftyp" &&
          ["isom", "iso2", "mp41", "mp42", "avc1"].includes(b.toString("ascii", 8, 12));
  if (!matches) fail();
}
