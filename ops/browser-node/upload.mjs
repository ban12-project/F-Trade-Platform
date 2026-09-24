import { createHash } from "node:crypto";

/** Validate the confirmed bytes and derive a path without caller-controlled segments. */
export function publicationUploadFile({ bytes, media }) {
  const extension = { "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4" }[
    media?.contentType
  ];
  const limit = media?.contentType === "video/mp4" ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
  if (
    !extension ||
    !Buffer.isBuffer(bytes) ||
    bytes.length !== media.sizeBytes ||
    !bytes.length ||
    bytes.length > limit ||
    !/^[a-f0-9]{64}$/.test(media.sha256 ?? "") ||
    createHash("sha256").update(bytes).digest("hex") !== media.sha256
  )
    throw new Error("publication_upload_invalid");
  return { path: `/tmp/ftrade-uploads/${media.sha256}.${extension}`, bytes };
}

export async function stagePublicationUpload({
  docker,
  nodeId,
  run,
  containerId,
  asset,
  assertActive,
}) {
  if (!/^[a-f0-9]{64}$/.test(containerId ?? "") || run.kind !== "publish")
    throw new Error("publication_container_invalid");
  assertActive();
  const container = await docker("GET", `/containers/${containerId}/json`);
  const labels = container.Config?.Labels;
  if (
    !container.State?.Running ||
    labels?.["io.ftrade.node"] !== nodeId ||
    labels?.["io.ftrade.run"] !== run.id ||
    labels?.["io.ftrade.account"] !== run.accountId
  )
    throw new Error("publication_container_mismatch");
  assertActive();
  const upload = publicationUploadFile(asset);
  await docker.execInput(containerId, upload.path, upload.bytes, asset.media.sha256, 120_000);
  assertActive();
  return { path: upload.path, media: { ...asset.media } };
}
