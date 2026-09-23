import { createHmac } from "node:crypto";

/** RFC 6238, SHA-1 / 30 seconds / 6 digits. No remote OTP service. */
export function generateTotp(secret, now = Date.now()) {
  if (
    typeof secret !== "string" ||
    !/^[A-Z2-7]{16,128}$/.test(secret) ||
    ![0, 2, 4, 5, 7].includes(secret.length % 8) ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new Error("totp_input_invalid");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let buffer = 0,
    bits = 0;
  for (const char of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) throw new Error("totp_input_invalid");
  const key = Buffer.from(bytes);
  bytes.fill(0);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  try {
    const digest = createHmac("sha1", key).update(counter).digest();
    try {
      const offset = digest[digest.length - 1] & 15;
      const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
      return { code, expiresAt: (Math.floor(now / 30000) + 1) * 30000 };
    } finally {
      digest.fill(0);
    }
  } finally {
    key.fill(0);
  }
}
