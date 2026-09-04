import assert from "node:assert/strict";

import {
  publishThroughChannel,
  validatePublicationPolicy,
} from "../lib/content/publication-policy";

const policy = {
  channelRef: "synthetic-content-channel",
  accountRef: "synthetic-factory-account",
  transport: "camofox_controlled_mvp1" as const,
  publishingEnabled: true,
};
const approved = {
  content_id: "synthetic-content-001",
  status: "approved",
  approval_ref: "synthetic-approval-001",
};

assert.equal(
  publishThroughChannel(approved, policy, "system", "synthetic-publication-001").status,
  "published",
);
assert.throws(
  () => validatePublicationPolicy({ ...policy, transport: "unapproved" as "official_api" }),
  /approved channel transport/,
);
assert.throws(
  () => validatePublicationPolicy({ ...policy, publishingEnabled: false }),
  /not enabled/,
);
assert.throws(
  () => publishThroughChannel(approved, policy, "agent", "synthetic-publication-001"),
  /agent/,
);
assert.throws(
  () =>
    publishThroughChannel(
      { ...approved, status: "review_required" },
      policy,
      "system",
      "synthetic-publication-001",
    ),
  /Only approved/,
);

console.log("PASS content publication policy");
