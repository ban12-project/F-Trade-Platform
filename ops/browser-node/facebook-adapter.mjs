import { readFile } from "node:fs/promises";
import { createFacebookDriver, validateFacebookProfile } from "./facebook-driver.mjs";
import { createFacebookInbox, validateInboxProfile } from "./facebook-inbox.mjs";
import { createPublicationExecutor } from "./publication-executor.mjs";

// Explicit private local configuration; no live Facebook selectors are supplied.
async function profiles(path, validate) {
  const result = new Map();
  if (!path) return result;
  const source = await readFile(path, "utf8");
  if (source.length > 64000) throw new Error("facebook_dom_profiles_limit");
  const values = JSON.parse(source);
  if (!Array.isArray(values) || values.length < 1 || values.length > 16)
    throw new Error("facebook_dom_profiles_invalid");
  for (const value of values) {
    const profile = validate(value);
    const key = JSON.stringify([profile.channelRef, profile.accountRef]);
    if (result.has(key)) throw new Error("facebook_dom_profile_duplicate");
    result.set(key, profile);
  }
  return result;
}
const publishing = await profiles(process.env.FACEBOOK_DOM_PROFILES_FILE, validateFacebookProfile);
const inbox = await profiles(process.env.FACEBOOK_INBOX_PROFILES_FILE, validateInboxProfile);
if (!publishing.size && !inbox.size) throw new Error("facebook_dom_profiles_required");
const scopes = (profiles) =>
  [...profiles.values()].map(({ channelRef, accountRef, expiresAt }) => ({
    channelRef,
    accountRef,
    expiresAt: Date.parse(expiresAt),
  }));
export const capabilities = [
  ...(publishing.size ? ["publish"] : []),
  ...(inbox.size ? ["inbox"] : []),
];
export const publicationScopes = scopes(publishing);
export const inboxScopes = scopes(inbox);
export async function execute(context) {
  const key = JSON.stringify([context.run.channelRef, context.run.accountRef]);
  if (context.run.kind === "inbox") {
    const profile = inbox.get(key);
    return profile ? createFacebookInbox(profile, context.browserRequest)(context) : "failed";
  }
  if (context.run.kind === "publish") {
    const profile = publishing.get(key);
    return profile
      ? createPublicationExecutor(createFacebookDriver(profile, context.browserRequest))(context)
      : "failed";
  }
  return "failed";
}
