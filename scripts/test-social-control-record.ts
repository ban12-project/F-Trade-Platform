import assert from "node:assert/strict";
import { applySocialControlChange } from "../lib/social/control-record";

const current = {
  enabled: false,
  circuitStatus: "paused" as const,
  pauseReason: "manual_pause",
  pauseEvidenceRef: "evidence-001",
};
assert.equal(
  applySocialControlChange(current, {
    channelRef: "social-facebook",
    accountRef: "account-001",
    action: "enable",
    actorType: "human",
    actorId: "admin-001",
    evidenceRef: "evidence-002",
  }).circuitStatus,
  "active",
);
assert.equal(
  applySocialControlChange(
    {
      ...current,
      enabled: true,
      circuitStatus: "active",
      pauseReason: null,
      pauseEvidenceRef: null,
    },
    {
      channelRef: "social-facebook",
      accountRef: "account-001",
      action: "pause",
      actorType: "human",
      actorId: "admin-001",
      evidenceRef: "evidence-003",
    },
  ).pauseEvidenceRef,
  "evidence-003",
);
assert.throws(
  () =>
    applySocialControlChange(current, {
      channelRef: "social-facebook",
      accountRef: "account-001",
      action: "enable",
      actorType: "agent",
      actorId: "agent-001",
      evidenceRef: "evidence-002",
    } as never),
  /Invalid input/,
);
console.log("PASS social controls require human evidence and fail closed by default");
