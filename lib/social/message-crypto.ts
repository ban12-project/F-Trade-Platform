import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "social-v1";

function messageEncryptionKey() {
  const encoded = process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY;
  if (!encoded) throw new Error("SOCIAL_MESSAGE_ENCRYPTION_KEY is required to store social message bodies");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("SOCIAL_MESSAGE_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

/** Uses a dedicated key so social-message retention is isolated from provider credentials. */
export function encryptSocialMessageBody(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", messageEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSocialMessageBody(value: string) {
  const [prefix, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (prefix !== PREFIX || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Stored social message is invalid");
  const decipher = createDecipheriv("aes-256-gcm", messageEncryptionKey(), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64")), decipher.final()]).toString("utf8");
}
