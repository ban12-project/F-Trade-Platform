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
      if (cacheFailure) throw Error("PRIVATE cache detail");
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: {
    auth: {
      api: {
        getSession: async () => {
          if (authFailure) throw Error("PRIVATE auth detail");
          return authenticated ? { user: { id: actorId, role }, session: { id: sessionId } } : null;
        },
      },
    },
  },
});
const exports: Record<string, unknown> = {};
for (const name of [
  "confirmOpportunity",
  "createDeliveryRequest",
  "createOrReviseQuotation",
  "decideDelivery",
  "decideQuotation",
  "sendQuotation",
])
  exports[name] = () => {
    throw Error("Unrelated write forbidden");
  };
exports.recordFollowUp = async (_input: unknown, identity: unknown) => {
  calls++;
  received = identity;
  if (failure) throw failure;
  return { PRIVATE: "raw message and database details" };
};
mock.module(new URL("../lib/sales/closing-store.ts", import.meta.url).href, { exports });
globalThis.fetch = async () => {
  throw Error("External delivery forbidden");
};
const { recordFollowUpAction: action } = await import("../lib/actions/closing");
function form() {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    projectId,
    leadId,
    context: "quote_sent_unread",
    draft: "SYNTHETIC reply only",
    confirmationRef: `evidence-mock-${randomUUID()}`,
    actorId: "untrusted",
    sessionId: "untrusted",
  }))
    fd.set(key, value);
  fd.append("triggeredRules", "active_inquiry");
  return fd;
}
const initial = { status: "idle" as const, message: "" };
let count = 0;
for (const currentRole of ["user", "admin"]) {
  role = currentRole;
  const result = await action(initial, form());
  assert.deepEqual(received, { actorId, sessionId, projectId });
  assert.equal(result.status, "success");
  assert.equal(result.id, leadId);
  assert.deepEqual(Object.keys(result).sort(), ["id", "message", "status"]);
  count++;
}
for (const kind of ["missing", "denied", "auth-failure"]) {
  authenticated = kind !== "missing";
  role = kind === "denied" ? "synthetic-denied" : "user";
  authFailure = kind === "auth-failure";
  const before = calls,
    result = await action(initial, form());
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
  "PRIVATE unknown",
  { PRIVATE: "raw" },
  new SocialHumanAccessError(),
]) {
  failure = error;
  if (error instanceof SocialHumanAccessError) error.message = "PRIVATE overwritten";
  const result = await action(initial, form());
  assert.equal(result.status, "error");
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert.deepEqual(Object.keys(result).sort(), ["message", "status"]);
  if (error instanceof SocialHumanAccessError)
    assert.equal(result.message, SOCIAL_HUMAN_ACCESS_MESSAGE);
  count++;
}
for (const message of [
  "项目已归档，请重开后再写入业务资料。",
  "你没有该项目的编辑权限。",
  "该操作只能在销售机会项目中执行。",
  "只有跟进中的线索可以发送回复。",
  "该线索没有可发送的渠道会话，请先关联入站消息。",
  "该线索未关联授权可见的渠道会话。",
  "渠道未启用或已暂停，不能发送回复。",
  "没有仍在保留期内的入站消息，不能发送回复。",
  "已超过渠道回复窗口；当前 MVP 禁止发送，需人工升级处理。",
  "自由文本不能包含交期承诺；请选择交期场景，由系统插入有效的 Gate 03 结果。",
  "该场景必须先完成 Gate 03 交期确认。",
  "Gate 03 尚未批准或已经失效，不能生成交期回复。",
  "Gate 03 与当前 RFQ 不匹配，不能用于回复。",
  "Gate 03 交期确认已过期，请重新申请确认。",
]) {
  failure = Error(message);
  assert.equal((await action(initial, form())).message, message);
  count++;
}
failure = undefined;
for (const [key, value] of [
  ["projectId", "bad"],
  ["leadId", ""],
  ["context", "bad"],
  ["draft", ""],
  ["confirmationRef", ""],
  ["triggeredRules", "bad"],
  ["nextFollowUpAt", "bad-date"],
]) {
  const fd = form();
  fd.set(key, value);
  const before = calls;
  assert.equal((await action(initial, fd)).status, "error");
  assert.equal(calls, before);
  count++;
}
cacheFailure = true;
const saved = await action(initial, form());
assert.equal(saved.status, "success");
assert.equal(saved.id, leadId);
assert(!JSON.stringify(saved).includes("PRIVATE"));
count++;
console.log(
  `PASS ${count} follow-up Action current identity, validation, private failure and committed-result cases`,
);
