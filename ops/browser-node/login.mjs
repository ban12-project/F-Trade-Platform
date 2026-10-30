import { readFile } from "node:fs/promises";
import { localDeadline, localLoginAuthorizationDeadline } from "./lease.mjs";
import { runFacebookLoginFlow } from "./login-flow.mjs";
import { validateLoginProfile } from "./login-plugin/index.js";

export async function loadLoginProfiles(path) {
  const profiles = new Map();
  const seen = new Set();
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
    if (seen.has(key)) throw new Error("login_profile_duplicate");
    seen.add(key);
    const now = Date.now();
    const expires = Date.parse(value.profile?.expiresAt);
    // Validate the entire original contract even for an expired review. Never
    // renew it: omit it from advertised scopes and allow interactive access.
    const validationTime = Number.isFinite(expires) && expires <= now ? expires - 1 : now;
    const profile = validateLoginProfile(value.profile, validationTime);
    if (expires > now) profiles.set(key, { ...value, profile });
  }
  return profiles;
}
export function loginScopes(profiles) {
  return [...profiles.values()].map(({ channelRef, accountRef, profile }) => ({
    channelRef,
    accountRef,
    expiresAt: Date.parse(profile.expiresAt),
    ...(profile.version === 2 ? { automatic: true } : {}),
  }));
}
export function loginProfileForRun(profiles, run) {
  if (run.kind !== "interactive") return null;
  const profile = profiles.get(JSON.stringify([run.channelRef, run.accountRef]))?.profile;
  // The reviewed map binds the opaque workbench reference; automation.accountRef is the Facebook identity.
  return profile && Date.parse(profile.expiresAt) > Date.now()
    ? validateLoginProfile(profile)
    : null;
}
export function configureLoginRuntime(spec, run, profile) {
  if (!profile || run.kind !== "interactive") return;
  spec.body.Env.push(
    `FTRADE_ACCOUNT_ID=${run.accountId}`,
    `FTRADE_RUN_ID=${run.id}`,
    ...(profile.version === 2 ? [`FTRADE_ACCOUNT_REF=${profile.automation.accountRef}`] : []),
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
  reportUncertain = () => {},
}) {
  const profile = validateLoginProfile(input);
  let used = false;
  return async (notice) => {
    if (used) return "refused";
    used = true;
    let release;
    let claimAttempted = false;
    let outcome = "refused";
    let challenge;
    let factorPrompts = [];
    let historyEvidence = "unverified";
    let stage = "preclaim";
    let uncertainStage;
    try {
      if (run.kind !== "interactive" || !notice?.id) throw new Error("login_scope_invalid");
      assertActive();
      validateLoginProfile(profile);
      const status = await json(await browserRequest("/ftrade/login-status"));
      if (
        status.version !== profile.version ||
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
          url:
            profile.version === 2 && profile.automation.mode === "observe-only"
              ? profile.automation.ready.url
              : profile.url,
          trace: false,
        }),
      );
      if (
        typeof tab.tabId !== "string" ||
        !tab.tabId ||
        tab.tabId.length > 200 ||
        (profile.version === 1
          ? tab.url !== profile.url
          : new URL(tab.url).origin !== "https://www.facebook.com")
      )
        throw new Error("login_navigation_invalid");
      // Navigation can take time; recheck egress and connection before releasing a credential.
      await checkEgress();
      assertActive();
      const acquireCredentials = async () => {
        if (profile.automation?.mode === "observe-only") return null;
        if (profile.version === 2) await checkEgress();
        assertActive();
        claimAttempted = true;
        stage = "claim";
        release = await request("claim-login", {
          runId: run.id,
          leaseId: run.leaseId,
          authorizationId: notice.id,
        });
        stage = "claim_response";
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
        return credential;
      };
      let expiresAt = Math.min(
        Date.now() + 175000,
        profile.version === 2 ? notice.expiresAt - 5000 : Date.now() + 30000,
        Date.parse(profile.expiresAt),
      );
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("login_expired");
      assertActive();
      validateLoginProfile(profile);
      if (profile.version === 2) {
        const packet = {
          userId: run.accountId,
          runId: run.id,
          requestId: notice.id,
          tabId: tab.tabId,
          expiresAt,
        };
        const result = await runFacebookLoginFlow({
          observeOnly: profile.automation.mode === "observe-only",
          acquireCredentials: async () => {
            const credential = await acquireCredentials();
            if (!credential) return null;
            packet.expiresAt = Math.min(
              expiresAt,
              localLoginAuthorizationDeadline(release, release.expiresAt),
            );
            return credential;
          },
          deadline: expiresAt,
          assertActive,
          onAttention: async (reason) => {
            const receipt = await request("login-challenge", {
              runId: run.id,
              leaseId: run.leaseId,
              authorizationId: notice.id,
              challenge: reason,
            });
            if (receipt.recorded !== true) throw new Error("challenge_not_recorded");
            challenge = reason;
          },
          observe: async () => {
            const observed = await json(await browserRequest("/ftrade/login-observe", packet));
            if (
              observed?.outcome !== "unknown" &&
              observed?.originVerified === true &&
              observed.accountMismatch !== true
            ) {
              // Keep a current checkpoint, including one revisited after recovery.
              // Only positive progress clears the historical human-attention notice.
              if (observed.state === "checkpoint") challenge = "checkpoint";
              else if (
                observed.state === "totp" ||
                (["pin", "messenger", "ready"].includes(observed.state) &&
                  observed.identityVerified === true)
              )
                challenge = undefined;
            }
            return observed;
          },
          submit: async (phase, values) => {
            await checkEgress();
            assertActive();
            return (
              await json(await browserRequest("/ftrade/login-submit", { ...packet, phase, values }))
            ).outcome;
          },
        });
        outcome =
          result.outcome === "ready"
            ? "ready"
            : result.outcome === "unknown"
              ? "unknown"
              : "refused";
        factorPrompts = result.factorPrompts ?? [];
        historyEvidence = result.historyEvidence ?? "unverified";
        if (
          result.outcome === "attention" &&
          ["checkpoint", "rejected", "unsupported_factor"].includes(result.reason)
        )
          challenge = result.reason;
      } else {
        const credential = await acquireCredentials();
        stage = "release_deadline";
        expiresAt = localDeadline(release, release.expiresAt);
        stage = "fill_request";
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
        stage = "fill_response";
        outcome = ["filled", "refused"].includes(result.outcome) ? result.outcome : "unknown";
        if (outcome === "unknown") uncertainStage = stage;
      }
    } catch {
      outcome = claimAttempted ? "unknown" : "refused";
      if (outcome === "unknown") uncertainStage = stage;
    } finally {
      if (release?.credential) {
        delete release.credential.username;
        delete release.credential.password;
        delete release.credential.totpSecret;
        delete release.credential.messengerPin;
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
          factorPrompts,
          historyEvidence,
          ...(challenge && outcome === "refused" ? { challenge } : {}),
        });
      } catch {
        if (outcome !== "unknown") uncertainStage = "result_receipt";
        outcome = "unknown";
      }
    }
    if (profile.version === 1 && outcome === "unknown") {
      // Fixed stage names only; exception text and credential values never enter diagnostics.
      try {
        reportUncertain(uncertainStage ?? "result_receipt");
      } catch {
        // Diagnostics must not alter the existing fail-closed outcome.
      }
    }
    return outcome;
  };
}

/** Uncertain automatic observations pause work; they do not establish logout. */
export function loginStopOutcome(version, outcome) {
  // Readiness is an observation, not a request to end the owner's viewer.
  // Idle grace, explicit stop and the lease still bound this interactive run.
  // A consumed automatic attempt pauses credential work but leaves human inspection bounded.
  if (version === 2) return null;
  if (outcome === "ready") return "completed";
  // A consumed v1 authorization cannot retry. Keep its bounded viewer available
  // to inspect an uncertain partial fill; never promote the account to ready.
  if (outcome === "unknown") return null;
  return null;
}
