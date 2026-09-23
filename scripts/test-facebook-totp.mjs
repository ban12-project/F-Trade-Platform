import assert from "node:assert/strict";
import { generateTotp } from "../ops/browser-node/totp.mjs";

// RFC 6238 Appendix B SHA-1 public test seed; expected values modulo 10^6.
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
for (const [time, expected] of [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
])
  assert.equal(generateTotp(secret, time * 1000).code, expected);
assert.equal(generateTotp(secret, 59999).expiresAt, 60000);
assert.notEqual(generateTotp(secret, 59999).code, generateTotp(secret, 60000).code);
for (const bad of ["", "not-a-secret", "A".repeat(17), "A".repeat(17) + "B"])
  assert.throws(() => generateTotp(bad), /totp_input_invalid/);
assert.throws(() => generateTotp(secret, -1), /totp_input_invalid/);
console.log("PASS TOTP RFC vectors, step boundary, invalid Base32 and timestamp");
