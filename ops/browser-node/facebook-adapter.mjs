import { readFile } from "node:fs/promises";
import { createFacebookDriver, validateFacebookProfile } from "./facebook-driver.mjs";
import { createPublicationExecutor } from "./publication-executor.mjs";

// This file must be explicitly selected as the reviewed local adapter. No
// default selectors or claimed Facebook identities are supplied by the Agent.
const profilePath = process.env.FACEBOOK_DOM_PROFILES_FILE;
if (!profilePath) throw new Error("facebook_dom_profiles_required");
const source = await readFile(profilePath, "utf8");
if (source.length > 64000) throw new Error("facebook_dom_profiles_limit");
const profiles = JSON.parse(source);
if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 16)
  throw new Error("facebook_dom_profiles_invalid");
const scopes = new Map();
for (const value of profiles) {
  const profile = validateFacebookProfile(value);
  const key = JSON.stringify([profile.channelRef, profile.accountRef]);
  if (scopes.has(key)) throw new Error("facebook_dom_profile_duplicate");
  scopes.set(key, profile);
}
export const capabilities = ["publish"];
export const publicationScopes = [...scopes.values()].map(
  ({ channelRef, accountRef, expiresAt }) => ({
    channelRef,
    accountRef,
    expiresAt: Date.parse(expiresAt),
  }),
);
export async function execute(context) {
  const profile = scopes.get(JSON.stringify([context.run.channelRef, context.run.accountRef]));
  if (!profile) return "failed";
  return createPublicationExecutor(createFacebookDriver(profile, context.browserRequest))(context);
}
