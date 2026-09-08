import { createHash } from "node:crypto";

/** Bytes are never handed to an adapter until size, content type and digest match
 * the confirmed manifest. No task-supplied URL or path is accepted. */
export async function readPublicationMedia({ run, request, assertActive }) {
  const media = run.publication?.media;
  const limit = {
    "image/png": 20 * 1024 * 1024,
    "image/jpeg": 20 * 1024 * 1024,
    "video/mp4": 200 * 1024 * 1024,
  }[media?.contentType];
  if (
    run.kind !== "publish" ||
    !limit ||
    !Number.isSafeInteger(media.sizeBytes) ||
    media.sizeBytes <= 0 ||
    media.sizeBytes > limit ||
    !/^[a-f0-9]{64}$/.test(media.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(run.publicationDigest ?? "")
  )
    throw new Error("publication_media_invalid");
  assertActive();
  const response = await request("publication-media", {
    runId: run.id,
    leaseId: run.leaseId,
    payloadDigest: run.publicationDigest,
  });
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("content-type") !== media.contentType ||
    response.headers.get("content-length") !== String(media.sizeBytes)
  ) {
    await response.body?.cancel();
    throw new Error("publication_media_response_invalid");
  }
  const reader = response.body.getReader();
  const chunks = [];
  const hash = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      assertActive();
      const { value, done } = await reader.read();
      if (done) break;
      assertActive();
      size += value.byteLength;
      if (size > media.sizeBytes) throw new Error("publication_media_size_invalid");
      hash.update(value);
      chunks.push(value);
    }
    if (size !== media.sizeBytes || hash.digest("hex") !== media.sha256)
      throw new Error("publication_media_integrity_invalid");
    assertActive();
    return { bytes: Buffer.concat(chunks, size), media: { ...media } };
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
