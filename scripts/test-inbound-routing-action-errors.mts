import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import {
  SOCIAL_HUMAN_ACCESS_MESSAGE,
  SocialHumanAccessError,
} from "../lib/social/human-write-access";

const actorId = randomUUID(),
  sessionId = randomUUID(),
  projectId = randomUUID(),
  leadId = randomUUID();
let role = "user",
  authenticated = true,
  authFailure = false,
  cacheFailure = false,
  failure: unknown,
  calls = 0,
  received: unknown;
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/cache", {
  exports: {
    revalidatePath: () => {
      if (cacheFailure) throw Error("PRIVATE cache details");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: {
    auth: {
      api: {
        getSession: async () => {
          if (authFailure) throw Error("PRIVATE auth details");
          return authenticated ? { user: { id: actorId, role }, session: { id: sessionId } } : null;
        },
      },
    },
  },
});
mock.module(new URL("../lib/social/inbound-routing-store.ts", import.meta.url).href, {
  exports: {
    routeInboundConversation: async (_input: unknown, identity: unknown) => {
      calls++;
      received = identity;
      if (failure) throw failure;
      return { projectId, leadId, PRIVATE: "database and raw message details" };
    },
  },
});
globalThis.fetch = async () => {
  throw Error("External delivery forbidden");
};
const { routeInboundConversationAction: action } = await import("../lib/actions/closing");
function form(mode = "create") {
  const fd = new FormData();
  fd.set("conversationId", randomUUID());
  fd.set("mode", mode);
  if (mode === "link") fd.set("projectId", projectId);
  fd.set("actorId", "untrusted");
  fd.set("sessionId", "untrusted");
  return fd;
}
const initial = { status: "idle" as const, message: "" };
let count = 0;
for (const mode of ["create", "link"]) {
  for (const currentRole of ["user", "admin"]) {
    role = currentRole;
    const result = await action(initial, form(mode));
    assert.deepEqual(received, { actorId, sessionId });
    assert.equal(result.status, "success");
    assert.equal(result.id, leadId);
    assert.equal(result.projectId, projectId);
    assert.deepEqual(Object.keys(result).sort(), ["id", "message", "projectId", "status"]);
    count++;
  }
  for (const kind of ["missing", "denied", "auth-failure"]) {
    authenticated = kind !== "missing";
    role = kind === "denied" ? "synthetic-denied" : "user";
    authFailure = kind === "auth-failure";
    const before = calls,
      result = await action(initial, form(mode));
    assert.equal(result.status, "error");
    assert.equal(calls, before);
    assert(!JSON.stringify(result).includes("PRIVATE"));
    count++;
    authenticated = true;
    role = "user";
    authFailure = false;
  }
  for (const error of [
    Error("PRIVATE postgres credentials"),
    "PRIVATE non-error",
    { PRIVATE: "private details" },
    new SocialHumanAccessError(),
  ]) {
    failure = error;
    if (error instanceof SocialHumanAccessError)
      error.message = "PRIVATE overwritten access details";
    const result = await action(initial, form(mode));
    assert.equal(result.status, "error");
    assert(!JSON.stringify(result).includes("PRIVATE"));
    assert.deepEqual(Object.keys(result).sort(), ["message", "status"]);
    if (error instanceof SocialHumanAccessError)
      assert.equal(result.message, SOCIAL_HUMAN_ACCESS_MESSAGE);
    count++;
  }
  failure = undefined;
  cacheFailure = true;
  assert.equal((await action(initial, form(mode))).status, "success");
  count++;
  cacheFailure = false;
}
for (const [key, value] of [
  ["conversationId", ""],
  ["mode", "bad-mode"],
  ["projectId", "bad-uuid"],
]) {
  const fd = form("link");
  fd.set(key, value);
  const before = calls;
  assert.equal((await action(initial, fd)).status, "error");
  assert.equal(calls, before);
  count++;
}
for (const message of [
  "入站消息不存在或已过期。",
  "该入站消息已完成分流，请刷新工作台。",
  "项目已归档，请重开后再写入业务资料。",
  "你没有该项目的编辑权限。",
]) {
  failure = Error(message);
  assert.equal((await action(initial, form())).message, message);
  count++;
}
console.log(
  `PASS ${count} inbound routing Action identity, input, minimal return, private failure and committed refresh checks; no external delivery`,
);
