import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER_PREFIX = "v1";

function encryptionKey() {
  const encoded = process.env.MODEL_CONFIG_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY is required to store provider credentials");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

/** Encrypts a single secret with AES-256-GCM for database storage. */
export function encryptStoredSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [CIPHER_PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

/** Decrypts the established v1 Product/Video provider credential envelope. */
export function decryptStoredSecret(value: string, invalidMessage = "Stored provider credential is invalid") {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== CIPHER_PREFIX || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error(invalidMessage);
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
