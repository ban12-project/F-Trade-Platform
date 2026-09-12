import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function matches(value: string, hash: string) {
  const supplied = Buffer.from(digest(value), "hex");
  const expected = Buffer.from(hash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function createAccessKey(id: string) {
  return `fbn_${id}.${randomBytes(32).toString("base64url")}`;
}
export function accessKeyNodeId(value: string) {
  const match =
    /^fbn_([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(
      value,
    );
  if (!match) throw new Error("invalid_node_key");
  return match[1];
}
export function secureOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("https_origin_required");
  return url.origin;
}
