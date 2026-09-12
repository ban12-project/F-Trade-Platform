import { createHmac } from "node:crypto";

export function inboxSignature(secret, packet) {
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32) throw new Error("inbox_key_invalid");
  return createHmac("sha256", key)
    .update("f-trade-node-inbox-v1\0")
    .update(JSON.stringify(packet))
    .digest("base64url");
}
