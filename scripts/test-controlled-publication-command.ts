import assert from "node:assert/strict";
import {
  assertFacebookMediaPreview,
  facebookMediaPreviewDigest,
} from "../lib/social/facebook-media-confirmation";
import { parseFacebookMediaPayload } from "../lib/social/facebook-media-contract";
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

const mediaPreview = {
  contentRef: "synthetic-content",
  format: "image" as const,
  mediaId: "synthetic-media",
  contentVersion: 1,
  caption: "SYNTHETIC reviewed caption",
};
const mediaConfirmation = {
  contentVersion: 1,
  previewDigest: facebookMediaPreviewDigest(mediaPreview),
};
assertFacebookMediaPreview(mediaConfirmation, mediaPreview);
for (const changed of [
  { ...mediaPreview, contentVersion: 2 },
  { ...mediaPreview, caption: "SYNTHETIC changed" },
  { ...mediaPreview, mediaId: "other-media" },
]) {
  assert.throws(
    () => assertFacebookMediaPreview(mediaConfirmation, changed),
    /changed_since_preview/,
  );
}
console.log("PASS media preview confirmation rejects changed versions, captions and assets");

const validMedia = {
  version: 2,
  channelRef: "facebook-personal",
  accountRef: "61588876867341 欧洲",
  publicationId: "publication-001",
  format: "video",
  text: "",
  media: {
    assetRef: "asset-video-001",
    contentType: "video/mp4",
    sizeBytes: 1234,
    sha256: "a".repeat(64),
  },
};
assert.equal(parseFacebookMediaPayload(validMedia).accountRef, "61588876867341 欧洲");
for (const invalidScope of ["", " leading", "trailing ", "bad\nline", "bad\u007fchar"]) {
  assert.throws(
    () => parseFacebookMediaPayload({ ...validMedia, accountRef: invalidScope }),
    /invalid_facebook_media/,
  );
  assert.throws(
    () => parseFacebookMediaPayload({ ...validMedia, channelRef: invalidScope }),
    /invalid_facebook_media/,
  );
}
assert.throws(
  () =>
    parseFacebookMediaPayload({
      ...validMedia,
      media: { ...validMedia.media, assetRef: "bad asset" },
    }),
  /invalid_facebook_media/,
);
assert.throws(
  () => parseFacebookMediaPayload({ ...validMedia, publicationId: "bad id" }),
  /invalid_facebook_media/,
);
console.log(
  "PASS media payload accepts workspace account remarks while keeping strict media/publication refs",
);
