import { readFile } from "node:fs/promises";
import { localDeadline } from "./lease.mjs";
import { validateLoginProfile } from "./login-plugin/index.js";

export async function loadLoginProfiles(path) {
  const profiles = new Map();
  if (!path) return profiles;
  const source = await readFile(path, "utf8");
  if (source.length > 64000) throw new Error("login_profiles_limit");
  const values = JSON.parse(source);
  if (!Array.isArray(values) || !values.length || values.length > 16)
    throw new Error("login_profiles_invalid");
  for (const value of values) {
    if (
      !value ||
      Object.keys(value).sort().join(",") !== "accountRef,channelRef,profile" ||
      ![value.accountRef, value.channelRef].every(
        (ref) =>
          typeof ref === "string" && ref.trim() === ref && ref.length > 0 && ref.length <= 160,
      )
    )
      throw new Error("login_profile_scope_invalid");
    const key = JSON.stringify([value.channelRef, value.accountRef]);
    if (profiles.has(key)) throw new Error("login_profile_duplicate");
    profiles.set(key, { ...value, profile: validateLoginProfile(value.profile) });
  }
  return profiles;
}
export function loginScopes(profiles) {
  return [...profiles.values()].map(({ channelRef, accountRef, profile }) => ({
    channelRef,
    accountRef,
    expiresAt: Date.parse(profile.expiresAt),
  }));
}
export function loginProfileForRun(profiles, run) {
  if (run.kind !== "interactive") return null;
  const profile = profiles.get(JSON.stringify([run.channelRef, run.accountRef]))?.profile;
  return profile && Date.parse(profile.expiresAt) > Date.now()
    ? validateLoginProfile(profile)
    : null;
}
export function configureLoginRuntime(spec, run, profile) {
  if (!profile || run.kind !== "interactive") return;
  spec.body.Env.push(
    `FTRADE_ACCOUNT_ID=${run.accountId}`,
    `FTRADE_RUN_ID=${run.id}`,
    "FTRADE_RUN_KIND=interactive",
    `FTRADE_LOGIN_PROFILE_JSON=${JSON.stringify(validateLoginProfile(profile))}`,
  );
}
async function json(response) {
  if (!response.ok || !response.body) throw new Error("login_browser_unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) throw new Error("login_browser_response_limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
/** Only this module sees a released credential; never attach it to slots, journals or adapters. */
export function createSavedLoginExecutor({
  run,
  profile: input,
  assertActive,
  checkEgress,
  request,
  browserRequest,
}) {
  const profile = validateLoginProfile(input);
  let used = false;
  return async (notice) => {
    if (used) return "refused";
    used = true;
    let release;
    let claimAttempted = false;
    let outcome = "refused";
    try {
      if (run.kind !== "interactive" || !notice?.id) throw new Error("login_scope_invalid");
      assertActive();
      validateLoginProfile(profile);
      const status = await json(await browserRequest("/ftrade/login-status"));
      if (
        status.version !== 1 ||
        status.runId !== run.id ||
        status.accountId !== run.accountId ||
        status.reviewRef !== profile.reviewRef ||
        status.expiresAt !== Date.parse(profile.expiresAt)
      )
        throw new Error("login_runtime_mismatch");
      await checkEgress();
      assertActive();
      const tab = await json(
        await browserRequest("/tabs", {
          userId: run.accountId,
          sessionKey: run.id,
          url: profile.url,
          trace: false,
        }),
      );
      if (
        typeof tab.tabId !== "string" ||
        !tab.tabId ||
        tab.tabId.length > 200 ||
        tab.url !== profile.url
      )
        throw new Error("login_navigation_invalid");
      // Navigation can take time; recheck egress and connection before releasing a credential.
      await checkEgress();
      assertActive();
      claimAttempted = true;
      release = await request("claim-login", {
        runId: run.id,
        leaseId: run.leaseId,
        authorizationId: notice.id,
      });
      const credential = release.credential;
      if (
        release.authorizationId !== notice.id ||
        typeof credential?.username !== "string" ||
        !credential.username ||
        credential.username.length > 320 ||
        typeof credential.password !== "string" ||
        !credential.password ||
        credential.password.length > 4096
      )
        throw new Error("login_release_invalid");
      const expiresAt = localDeadline(release, release.expiresAt);
      assertActive();
      validateLoginProfile(profile);
      const result = await json(
        await browserRequest("/ftrade/login-fill", {
          userId: run.accountId,
          runId: run.id,
          requestId: notice.id,
          tabId: tab.tabId,
          username: credential.username,
          password: credential.password,
          expiresAt,
        }),
      );
      outcome = ["filled", "refused"].includes(result.outcome) ? result.outcome : "unknown";
    } catch {
      outcome = claimAttempted ? "unknown" : "refused";
    } finally {
      if (release?.credential) {
        delete release.credential.username;
        delete release.credential.password;
        delete release.credential;
      }
    }
    if (notice?.id) {
      try {
        await request("login-result", {
          runId: run.id,
          leaseId: run.leaseId,
          authorizationId: notice.id,
          outcome,
        });
      } catch {
        outcome = "unknown";
      }
    }
    return outcome;
  };
}
