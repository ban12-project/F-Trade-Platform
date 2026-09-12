import { createHash } from "node:crypto";

function header(name, size, directory = false) {
  const block = Buffer.alloc(512);
  const write = (value, start, length) => block.write(value, start, length, "ascii");
  write(name, 0, 100);
  write(directory ? "0000755\0" : "0000444\0", 100, 8);
  write("0000000\0", 108, 8);
  write("0000000\0", 116, 8);
  write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  write("00000000000\0", 136, 12);
  block.fill(32, 148, 156);
  write(directory ? "5" : "0", 156, 1);
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  const sum = block.reduce((total, byte) => total + byte, 0);
  write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
}

/** A generated two-entry archive: no caller-controlled paths, links or modes. */
export function publicationUploadArchive({ bytes, media }) {
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
  const file = `ftrade-uploads/${media.sha256}.${extension}`;
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return {
    path: `/tmp/${file}`,
    archive: Buffer.concat([
      header("ftrade-uploads/", 0, true),
      header(file, bytes.length),
      bytes,
      padding,
      Buffer.alloc(1024),
    ]),
  };
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
  const upload = publicationUploadArchive(asset);
  await docker(
    "PUT",
    `/containers/${containerId}/archive?path=%2Ftmp&noOverwriteDirNonDir=1`,
    upload.archive,
    120_000,
  );
  assertActive();
  return { path: upload.path, media: { ...asset.media } };
}
