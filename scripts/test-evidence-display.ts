import assert from "node:assert/strict";
import { ownerCommandSchema } from "../lib/browser-fleet/contracts";
import {
  buildEvidenceDisplayItems,
  formatEvidenceSourceLabel,
  formatEvidenceTypeBadge,
} from "../lib/workspace/evidence-display";

assert.equal(
  formatEvidenceSourceLabel("marketing-upload:video", "video/quicktime"),
  "已上传视频素材",
);
assert.equal(formatEvidenceSourceLabel("marketing-upload:image", "image/png"), "已上传图片素材");
assert.equal(
  formatEvidenceSourceLabel("合成工厂授权书.pdf", "application/pdf"),
  "合成工厂授权书.pdf",
);

assert.equal(formatEvidenceTypeBadge("application/pdf"), "PDF");
assert.equal(formatEvidenceTypeBadge("text/csv"), "CSV");
assert.equal(
  formatEvidenceTypeBadge("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  "Excel",
);
assert.equal(formatEvidenceTypeBadge("video/quicktime"), "MOV 视频");

const items = buildEvidenceDisplayItems([
  {
    id: "evidence-synthetic-rights-761",
    label: "合成工厂授权书.pdf",
    detail: "application/pdf · 2026-10-02",
    contentType: "application/pdf",
    inCurrentProject: true,
  },
  {
    id: "evidence-old-1",
    label: "Qidie_Catalog_Part_1.pdf",
    detail: "application/pdf · 2026-10-01",
    contentType: "application/pdf",
    inCurrentProject: false,
  },
  {
    id: "evidence-old-2",
    label: "Qidie_Catalog_Part_1.pdf",
    detail: "application/pdf · 2026-10-02",
    contentType: "application/pdf",
    inCurrentProject: false,
  },
]);

assert.equal(items[0]?.group, "current");
assert.match(items[0]?.displayText ?? "", /合成工厂授权书\.pdf · 2026-10-02/);
assert.equal(items[1]?.group, "other");
assert.notEqual(items[1]?.displayText, items[2]?.displayText);
assert.ok(items[1]?.displayText.includes("#"));

const validPoll = ownerCommandSchema.safeParse({
  operation: "set-poll-interval",
  nodeId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  pollSeconds: 900,
});
assert.equal(validPoll.success, true);

const zeroPoll = ownerCommandSchema.safeParse({
  operation: "set-poll-interval",
  nodeId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  pollSeconds: 0,
});
assert.equal(zeroPoll.success, true);

const invalidPoll = ownerCommandSchema.safeParse({
  operation: "set-poll-interval",
  nodeId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  pollSeconds: 60,
});
assert.equal(invalidPoll.success, false);

console.log("evidence-display and set-poll-interval contracts passed");
