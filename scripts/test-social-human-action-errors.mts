import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  SOCIAL_HUMAN_ACCESS_MESSAGE,
  SocialHumanAccessError,
} from "../lib/social/human-write-access";

const actorId = "synthetic-owner",
  sessionId = "synthetic-session",
  projectId = "11111111-1111-4111-8111-111111111111",
  contentRef = "22222222-2222-4222-8222-222222222222",
  publicationId = "33333333-3333-4333-8333-333333333333";
const privateValue = "SYNTHETIC private SQL, cookies, credentials, URLs and business facts";
let postCommitFailure: unknown;
let allowed = true,
  authFailure: unknown,
  domainFailure: unknown,
  attempts = 0,
  deliveries = 0;
process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = actorId;
process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
const authenticate = async () => {
  if (authFailure) throw authFailure;
  return allowed ? { user: { id: actorId, role: "admin" }, session: { id: sessionId } } : null;
};
const identity = { actorId, sessionId };
const operation = async (_input: unknown, who: unknown) => {
  attempts++;
  assert.deepEqual(who, { ...identity, projectId });
  if (domainFailure) throw domainFailure;
  return { id: publicationId, publicationId, privateValue };
};
const account = async (_input: unknown, who: unknown) => {
  attempts++;
  assert.deepEqual(who, identity);
  if (domainFailure) throw domainFailure;
  return {
    id: publicationId,
    token: "synthetic-approved-ticket",
    origin: "https://synthetic.example.invalid",
    expiresAt: 123,
    privateValue,
  };
};
const url = (p: string) => new URL(p, import.meta.url).href;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", {
  exports: {
    revalidatePath: () => {
      if (postCommitFailure) throw postCommitFailure;
    },
  },
});
mock.module("next/server", {
  exports: {
    after: () => {
      deliveries++;
      if (postCommitFailure) throw postCommitFailure;
    },
  },
});
mock.module(url("../lib/auth.ts"), { exports: { auth: { api: { getSession: authenticate } } } });
mock.module(url("../lib/action-boundary.ts"), {
  exports: {
    authorizedActionSession: authenticate,
    refreshWorkspace: () => {
      if (postCommitFailure) throw postCommitFailure;
    },
    requireActionActor: async () => actorId,
    actionError: () => ({ status: "error", message: "Input invalid" }),
  },
});
mock.module(url("../lib/social/publication-store.ts"), {
  exports: { submitControlledPublication: operation },
});
mock.module(url("../lib/social/facebook-media-store.ts"), {
  exports: {
    submitFacebookMediaPublication: operation,
    listFacebookMediaOptions: async () => [],
    listFacebookMarketingProjects: async () => [],
  },
});
mock.module(url("../lib/social/publication-reconciliation.ts"), {
  exports: {
    reconcileUnknownTextPublication: operation,
    reconcileUnknownVideoPublication: operation,
  },
});
mock.module(url("../lib/social/control-store.ts"), {
  exports: {
    saveSocialChannelControl: async (_input: unknown, who: unknown) => {
      await account(null, who);
      return { circuitStatus: "active", privateValue };
    },
  },
});
mock.module(url("../lib/social/facebook-account-store.ts"), {
  exports: {
    saveFacebookCredentials: account,
    openFacebookInteractive: account,
    closeFacebookInteractive: account,
    resumeFacebookAccount: async (who: unknown) => account(null, who),
    readFacebookAccountStatus: async () => null,
  },
});
const { confirmPublicationAction } = await import("../lib/actions/closing");
const { submitFacebookMediaAction } = await import("../lib/actions/facebook-media");
const { saveSocialChannelControlAction } = await import("../lib/actions/social-controls");
const { reconcilePublicationAction, reconcileVideoPublicationAction } = await import(
  "../lib/actions/publication-reconciliation"
);
const accounts = await import("../lib/actions/facebook-account");
const idle = { status: "idle" as const, message: "" };
const form = (v: Record<string, unknown>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, String(x));
  return f;
};
const submit = {
  projectId,
  contentRef,
  format: "text",
  channelRef: "synthetic-channel",
  accountRef: "synthetic-account",
  confirmationRef: "evidence-synthetic-review",
  previewDigest: "a".repeat(64),
};
const observation = {
  projectId,
  publicationId,
  externalPublicationRef: "https://www.facebook.com/synthetic/posts/synthetic",
  evidenceRef: "evidence-synthetic-observation",
  confirmed: true,
};
const calls = [
  () => confirmPublicationAction(idle, form(submit)),
  () => submitFacebookMediaAction({ projectId }),
  () => reconcilePublicationAction(observation),
  () =>
    reconcileVideoPublicationAction({
      ...observation,
      externalPublicationRef: "https://www.facebook.com/reel/1234567890123456/",
    }),
  () =>
    saveSocialChannelControlAction(
      idle,
      form({
        channelRef: "synthetic-channel",
        accountRef: "synthetic-account",
        action: "resume",
        evidenceRef: "evidence-synthetic-control",
      }),
    ),
  () => accounts.saveFacebookCredentialsAction({}),
  () => accounts.openFacebookInteractiveAction({ useSavedLogin: false }),
  () => accounts.closeFacebookInteractiveAction(publicationId),
  () => accounts.resumeFacebookAccountAction(),
];
let count = 0;
for (const call of calls) {
  const result = await call();
  assert(!JSON.stringify(result).includes(privateValue), "Minimal success result");
  count++;
  for (const error of [
    new Error(privateValue),
    Object.assign(new SocialHumanAccessError(), { message: privateValue }),
    privateValue,
  ]) {
    domainFailure = error;
    const d = deliveries;
    const result = await call();
    assert(!JSON.stringify(result).includes(privateValue));
    assert("ok" in result ? !result.ok : result.status === "error");
    if (error instanceof SocialHumanAccessError)
      assert.equal(result.message, SOCIAL_HUMAN_ACCESS_MESSAGE);
    assert.equal(deliveries, d);
    count++;
  }
  domainFailure = undefined;
  authFailure = new Error(privateValue);
  const a = attempts;
  const authDenied = await call();
  assert(!JSON.stringify(authDenied).includes(privateValue));
  assert("ok" in authDenied ? !authDenied.ok : authDenied.status === "error");
  assert.equal(attempts, a);
  authFailure = undefined;
  count++;
  allowed = false;
  const b = attempts;
  const denied = await call();
  assert("ok" in denied ? !denied.ok : denied.status === "error");
  assert.equal(attempts, b);
  allowed = true;
  count++;
}
for (const call of [
  () => confirmPublicationAction(idle, new FormData()),
  () => submitFacebookMediaAction(null),
  () => reconcilePublicationAction(null),
  () => reconcileVideoPublicationAction(null),
  () => saveSocialChannelControlAction(idle, new FormData()),
  () => accounts.closeFacebookInteractiveAction("invalid"),
]) {
  const a = attempts;
  const r = await call();
  assert("ok" in r ? !r.ok : r.status === "error");
  assert.equal(attempts, a);
  count++;
}
for (const call of calls.slice(0, 5)) {
  postCommitFailure = new Error(privateValue);
  const result = await call();
  assert("ok" in result ? result.ok : result.status === "success");
  assert(!JSON.stringify(result).includes(privateValue));
  postCommitFailure = undefined;
  count++;
}
console.log(
  `PASS ${count} social human Action identity, input, minimal result and private failure checks; no external delivery`,
);
