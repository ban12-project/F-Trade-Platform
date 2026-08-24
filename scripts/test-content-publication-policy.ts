import assert from "node:assert/strict";

import { publishThroughOfficialChannel, validatePublicationPolicy } from "../lib/content/publication-policy";

const policy = {
  channelRef: "synthetic-content-channel",
  accountRef: "synthetic-factory-account",
  officialApi: true,
  publishingEnabled: true,
};
const approved = { content_id: "synthetic-content-001", status: "approved", approval_ref: "synthetic-approval-001" };

assert.equal(publishThroughOfficialChannel(approved, policy, "system", "synthetic-publication-001").status, "published");
assert.throws(() => validatePublicationPolicy({ ...policy, officialApi: false }), /official API/);
assert.throws(() => validatePublicationPolicy({ ...policy, publishingEnabled: false }), /not enabled/);
assert.throws(() => publishThroughOfficialChannel(approved, policy, "agent", "synthetic-publication-001"), /agent/);
assert.throws(() => publishThroughOfficialChannel({ ...approved, status: "review_required" }, policy, "system", "synthetic-publication-001"), /Only approved/);

console.log("PASS content publication policy");
