import assert from "node:assert/strict";
import { decideContent, publishContent } from "../lib/content/gate";

const review = { content_id: "synthetic", status: "review_required" };
const approved = decideContent(review, {
  actorType: "human",
  approved: true,
  approvalRef: "synthetic-approval",
  evidenceRef: "synthetic-evidence",
});
assert.equal(publishContent(approved, "system", "synthetic-post").status, "published");
assert.equal(
  decideContent(review, { actorType: "human", approved: false, approvalRef: "a", evidenceRef: "e" })
    .status,
  "revision_required",
);
assert.throws(
  () =>
    decideContent(review, {
      actorType: "agent",
      approved: true,
      approvalRef: "a",
      evidenceRef: "e",
    }),
  /human actor/,
);
console.log("PASS Content Gate 01");
