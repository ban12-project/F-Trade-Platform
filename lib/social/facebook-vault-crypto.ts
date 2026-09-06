import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type VaultScope = { channelRef: string; accountRef: string };
export type VaultPurpose = "login" | "proxy";
export type VaultKeyring = { activeKeyId: string; keys: Record<string, string> };
const bad = () => new Error("facebook_credential_unavailable");
function key(ring: VaultKeyring, id: string) {
  const encoded = ring.keys[id];
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw bad();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== encoded) throw bad();
  return bytes;
}
function aad(scope: VaultScope, purpose: VaultPurpose, keyId: string) {
  if (!scope.channelRef || !scope.accountRef || !["login", "proxy"].includes(purpose)) throw bad();
  return Buffer.from(
    JSON.stringify([
      "f-trade-facebook-vault-v1",
      scope.channelRef,
      scope.accountRef,
      purpose,
      keyId,
    ]),
  );
}
/** Random IV plus scope/purpose AAD prevents copying ciphertext to another account.
 * The keyring lives in the deployment secret store, never in this database.
 */
export function encryptFacebookCredential(
  value: unknown,
  scope: VaultScope,
  purpose: VaultPurpose,
  ring: VaultKeyring,
) {
  const id = ring.activeKeyId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw bad();
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > 16_384) throw bad();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(ring, id), iv);
  cipher.setAAD(aad(scope, purpose, id));
  const ciphertext = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return [
    "fbv1",
    id,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
export function decryptFacebookCredential(
  value: string,
  scope: VaultScope,
  purpose: VaultPurpose,
  ring: VaultKeyring,
): unknown {
  try {
    if (value.length > 24_000) throw bad();
    const [version, id, iv, tag, encrypted, extra] = value.split(".");
    if (
      extra !== undefined ||
      version !== "fbv1" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
      !/^[A-Za-z0-9_-]{16}$/.test(iv) ||
      !/^[A-Za-z0-9_-]{22}$/.test(tag) ||
      !/^[A-Za-z0-9_-]+$/.test(encrypted)
    )
      throw bad();
    const decipher = createDecipheriv("aes-256-gcm", key(ring, id), Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(scope, purpose, id));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]);
    try {
      return JSON.parse(plain.toString("utf8")) as unknown;
    } finally {
      plain.fill(0);
    }
  } catch {
    throw bad();
  }
}
export function configuredFacebookKeyring(): VaultKeyring {
  const ring: VaultKeyring = {
    activeKeyId: process.env.FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID ?? "",
    keys: JSON.parse(process.env.FACEBOOK_CREDENTIAL_KEYS_JSON ?? "{}"),
  };
  key(ring, ring.activeKeyId);
  return ring;
}
