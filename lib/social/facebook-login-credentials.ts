import type { z } from "zod";
import {
  facebookCredentialFormSchema,
  facebookLoginSecretSchema,
  normalizeFacebookTotpSecret,
} from "./facebook-account-forms";
import {
  decryptFacebookCredential,
  encryptFacebookCredential,
  type VaultKeyring,
  type VaultScope,
} from "./facebook-vault-crypto";

/** Blank inputs preserve secrets; clearing login removes every associated factor. */
export function updateFacebookLoginCiphertext(
  input: z.input<typeof facebookCredentialFormSchema>,
  previous: string | null,
  scope: VaultScope,
  ring: VaultKeyring,
) {
  const value = facebookCredentialFormSchema.parse(input);
  if (value.clearLogin) return null;
  const factorsChanged = !!(
    value.totpSecret ||
    value.messengerPin ||
    value.clearTotp ||
    value.clearPin
  );
  if (!value.loginPassword && !factorsChanged) return previous;
  const saved = previous
    ? facebookLoginSecretSchema.parse(decryptFacebookCredential(previous, scope, "login", ring))
    : undefined;
  if (!value.loginPassword && !saved) throw new Error("facebook_login_required_before_factors");
  // Never carry an old account's factors across a username replacement.
  const sameIdentity = !value.loginPassword || saved?.username === value.loginUsername;
  const next = {
    username: value.loginPassword ? value.loginUsername : saved!.username,
    password: value.loginPassword || saved!.password,
    totpSecret: sameIdentity ? saved?.totpSecret : undefined,
    messengerPin: sameIdentity ? saved?.messengerPin : undefined,
  };
  if (value.clearTotp) next.totpSecret = undefined;
  else if (value.totpSecret) next.totpSecret = normalizeFacebookTotpSecret(value.totpSecret);
  if (value.clearPin) next.messengerPin = undefined;
  else if (value.messengerPin) next.messengerPin = value.messengerPin;
  return encryptFacebookCredential(facebookLoginSecretSchema.parse(next), scope, "login", ring);
}
