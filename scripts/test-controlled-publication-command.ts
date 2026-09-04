import assert from "node:assert/strict";
import { createControlledPublicationCommand } from "../lib/social/publication-command";

const policy = {
  channelRef: "social-facebook",
  accountRef: "account-001",
  transport: "camofox_controlled_mvp1" as const,
  publishingEnabled: true,
};
const circuit = {
  channelRef: policy.channelRef,
  accountRef: policy.accountRef,
  status: "active" as const,
  stopReason: null,
  pausedAt: null,
};
const request = {
  publicationId: "publication-001",
  contentRef: "content-001",
  format: "image" as const,
  humanConfirmationRef: "confirmation-001",
  confirmedBy: "human" as const,
};
assert.equal(
  createControlledPublicationCommand(
    { status: "approved", approval_ref: "gate01-001" },
    policy,
    circuit,
    request,
  ).jobKind,
  "publish",
);
assert.throws(
  () => createControlledPublicationCommand({ status: "review_required" }, policy, circuit, request),
  /Gate 01/,
);
assert.throws(
  () =>
    createControlledPublicationCommand(
      { status: "approved", approval_ref: "gate01-001" },
      policy,
      { ...circuit, status: "paused" as const },
      request,
    ),
  /paused/,
);
console.log(
  "PASS controlled publication requires Gate 01, per-post human confirmation, and active circuit",
);
