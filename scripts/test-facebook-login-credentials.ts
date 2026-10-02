import assert from "node:assert/strict";
import { updateFacebookLoginCiphertext } from "../lib/social/facebook-login-credentials";
import { decryptFacebookCredential } from "../lib/social/facebook-vault-crypto";

const scope = { accountRef: "synthetic-account", channelRef: "synthetic-channel" };
const ring = { activeKeyId: "test", keys: { test: Buffer.alloc(32, 7).toString("base64") } };
const blank = {
  loginUsername: "",
  loginPassword: "",
  proxyHost: "",
  proxyPort: "",
  proxyUsername: "",
  proxyPassword: "",
  clearLogin: false,
  clearProxy: false,
};
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const original = updateFacebookLoginCiphertext(
  {
    ...blank,
    loginUsername: "synthetic-login",
    loginPassword: "synthetic-password",
    totpSecret: secret,
    messengerPin: "123456",
  },
  null,
  scope,
  ring,
)!;
assert.ok(!original.includes(secret));
const open = (value: string) =>
  decryptFacebookCredential(value, scope, "login", ring) as Record<string, string>;
assert.equal(open(original).totpSecret, secret);
assert.equal(open(original).messengerPin, "123456");
assert.equal(updateFacebookLoginCiphertext(blank, original, scope, ring), original);
const pinChanged = updateFacebookLoginCiphertext(
  { ...blank, messengerPin: "654321" },
  original,
  scope,
  ring,
)!;
assert.equal(open(pinChanged).totpSecret, secret);
assert.equal(open(pinChanged).password, "synthetic-password");
assert.equal(open(pinChanged).messengerPin, "654321");
assert.equal(
  open(updateFacebookLoginCiphertext({ ...blank, clearTotp: true }, original, scope, ring)!)
    .totpSecret,
  undefined,
);
assert.equal(
  updateFacebookLoginCiphertext({ ...blank, clearLogin: true }, original, scope, ring),
  null,
);
const replacement = open(
  updateFacebookLoginCiphertext(
    { ...blank, loginUsername: "different-account", loginPassword: "different-password" },
    original,
    scope,
    ring,
  )!,
);
assert.equal(replacement.totpSecret, undefined);
assert.equal(replacement.messengerPin, undefined);
assert.throws(() =>
  updateFacebookLoginCiphertext({ ...blank, messengerPin: "123456" }, null, scope, ring),
);
assert.throws(() =>
  updateFacebookLoginCiphertext(
    { ...blank, messengerPin: "123456", clearPin: true },
    original,
    scope,
    ring,
  ),
);
assert.throws(() =>
  updateFacebookLoginCiphertext(
    { ...blank, messengerPin: "123456" },
    original,
    { ...scope, accountRef: "wrong" },
    ring,
  ),
);
console.log(
  "PASS encrypted factor storage, blank preservation, rotation, clearing and account isolation",
);
