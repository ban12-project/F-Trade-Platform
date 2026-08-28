import assert from "node:assert/strict";

import { approveReviewVideoExport, createReviewVideoExport } from "../lib/video/export-artifact";
import { createSocialVideoDraft, publishSocialVideoDraft, type SocialVideoPublicationAdapter } from "../lib/video/social-publication";

const measured = { container: "mp4" as const, videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, fps: 30, durationSeconds: 5, subtitleStreamCount: 0 };
const review = createReviewVideoExport({ videoId: "00000000-0000-4000-8000-000000000701", sourceAssetRef: "asset-video-701", platform: "tiktok", media: measured });
const policy = { channel: "tiktok" as const, officialApi: true as const, draftEnabled: true, publishingEnabled: true, accountRef: "social-account-701", credentialRef: "social-credential-701" };
const adapter: SocialVideoPublicationAdapter = { channel: "tiktok", async createDraft(input) { assert.equal(input.credential, "synthetic-secret"); return { publicationRef: "publication-701", status: "draft" }; }, async publishDraft(input) { assert.equal(input.humanConfirmationRef, "evidence-publish-701"); return { publicationRef: input.publicationRef, status: "published" }; } };

async function main() {
  await assert.rejects(() => createSocialVideoDraft(review, policy, [adapter], async () => "synthetic-secret"), /人工审核/);
  const approved = approveReviewVideoExport(review, "evidence-export-701");
  const draft = await createSocialVideoDraft(approved, policy, [adapter], async () => "synthetic-secret");
  assert.equal(draft.status, "draft");
  assert.equal((await publishSocialVideoDraft(draft, policy, "evidence-publish-701", [adapter], async () => "synthetic-secret")).status, "published");
  await assert.rejects(() => publishSocialVideoDraft(draft, { ...policy, publishingEnabled: false }, "evidence-publish-701", [adapter], async () => "synthetic-secret"), /未启用/);
  console.log("PASS social video publication requires export approval, official draft, and human confirmation");
}

void main();
