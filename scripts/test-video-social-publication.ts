import assert from "node:assert/strict";

import { approveReviewVideoExport, createReviewVideoExport } from "../lib/video/export-artifact";
import {
  createSocialVideoDraft,
  publishSocialVideoDraft,
  type SocialVideoPublicationAdapter,
} from "../lib/video/social-publication";

const measured = {
  container: "mp4" as const,
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1080,
  height: 1920,
  fps: 30,
  durationSeconds: 5,
  subtitleStreamCount: 0,
};
const review = createReviewVideoExport({
  videoId: "00000000-0000-4000-8000-000000000701",
  sourceAssetRef: "asset-video-701",
  platform: "tiktok",
  media: measured,
  timeline: { durationSeconds: 5 },
});
const policy = {
  channel: "tiktok" as const,
  transport: "official_api" as const,
  draftEnabled: true,
  publishingEnabled: true,
  accountRef: "social-account-701",
  credentialRef: "social-credential-701",
};
const adapter: SocialVideoPublicationAdapter = {
  channel: "tiktok",
  transport: "official_api",
  async createDraft(input) {
    assert.equal(input.credential, "synthetic-secret");
    return { publicationRef: "publication-701", status: "draft" };
  },
  async publishDraft(input) {
    assert.equal(input.humanConfirmationRef, "evidence-publish-701");
    return { publicationRef: input.publicationRef, status: "published" };
  },
};
const facebookPolicy = {
  channel: "facebook" as const,
  transport: "camofox_controlled_mvp1" as const,
  draftEnabled: true,
  publishingEnabled: true,
  accountRef: "social-account-702",
  credentialRef: "social-credential-702",
};
const facebookAdapter: SocialVideoPublicationAdapter = {
  channel: "facebook",
  transport: "camofox_controlled_mvp1",
  async createDraft(input) {
    assert.equal(input.accountRef, facebookPolicy.accountRef);
    return { publicationRef: "publication-702", status: "draft" };
  },
  async publishDraft(input) {
    assert.equal(input.humanConfirmationRef, "evidence-publish-702");
    return { publicationRef: input.publicationRef, status: "published" };
  },
};

async function main() {
  await assert.rejects(
    () => createSocialVideoDraft(review, policy, [adapter], async () => "synthetic-secret"),
    /人工审核/,
  );
  const approved = approveReviewVideoExport(review, "evidence-export-701");
  const draft = await createSocialVideoDraft(
    approved,
    policy,
    [adapter],
    async () => "synthetic-secret",
  );
  assert.equal(draft.status, "draft");
  assert.equal(
    (
      await publishSocialVideoDraft(
        draft,
        policy,
        "evidence-publish-701",
        [adapter],
        async () => "synthetic-secret",
      )
    ).status,
    "published",
  );
  await assert.rejects(
    () =>
      publishSocialVideoDraft(
        draft,
        { ...policy, publishingEnabled: false },
        "evidence-publish-701",
        [adapter],
        async () => "synthetic-secret",
      ),
    /未启用/,
  );
  const facebookReview = approveReviewVideoExport(
    createReviewVideoExport({
      videoId: "00000000-0000-4000-8000-000000000702",
      sourceAssetRef: "asset-video-702",
      platform: "facebook",
      media: measured,
      timeline: { durationSeconds: 5 },
    }),
    "evidence-export-702",
  );
  const facebookDraft = await createSocialVideoDraft(
    facebookReview,
    facebookPolicy,
    [facebookAdapter],
    async () => "synthetic-secret",
  );
  await assert.rejects(
    () =>
      publishSocialVideoDraft(
        facebookDraft,
        facebookPolicy,
        "not-evidence",
        [facebookAdapter],
        async () => "synthetic-secret",
      ),
    /人工确认/,
  );
  assert.equal(
    (
      await publishSocialVideoDraft(
        facebookDraft,
        facebookPolicy,
        "evidence-publish-702",
        [facebookAdapter],
        async () => "synthetic-secret",
      )
    ).status,
    "published",
  );
  console.log(
    "PASS social video publication requires export approval, transport draft, and human confirmation",
  );
}

void main();
